import { describe, expect, it } from 'vitest'
import { Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { parseClaudeSession } from '../src/claude.ts'
import { parseCodexSession } from '../src/codex.ts'
import { translateTranscript, type TranslatedTranscript } from '../src/translate.ts'
import type { ForeignEntry } from '../src/types.ts'
import { fixture, transcript } from './harness.ts'

const ROLLOUT_A = fixture('codex/rollout-a.jsonl')
const ROLLOUT_B = fixture('codex/rollout-b.jsonl')
const CLAUDE_A = fixture('claude/session-a.jsonl')

/** Event types with their sequence numbers, for bracket and ordering assertions. */
function outline(events: readonly SessionEvent[]): string[] {
  return events.map(event => `${String(event.seq)}:${event.type}`)
}

/** Every `tool/call` event as the identity a `tool-call` content block repeats. */
function emittedCalls(events: readonly SessionEvent[]): Array<{ id: string; name: string; arguments: string }> {
  return events.flatMap(event => (event.type === 'tool/call'
    ? [{ id: event.data.callId, name: event.data.name, arguments: event.data.arguments }]
    : []))
}

/** Every `tool-call` content block across one session's derived message history. */
function derivedCalls(session: Session): Array<{ id: string; name: string; arguments: string }> {
  return session.deriveMessages().flatMap(message => message.content.flatMap(block => (block.type === 'tool-call'
    ? [{ id: block.id, name: block.name, arguments: block.arguments }]
    : [])))
}

/**
 * Create the session a translated seed publishes as, through the same constructor
 * an import uses, and require the derived history to agree with the emitted calls.
 * @param translated - Seed under test.
 * @returns The accepted session.
 */
function accept(translated: TranslatedTranscript): Session {
  const session = Session.create(SessionId('imported'), [...translated.events])
  expect(session.deriveMessages().length).toBeGreaterThan(0)
  expect(derivedCalls(session)).toEqual(emittedCalls(translated.events))
  return session
}

/** Entries of a round that opens with a user message, a call, and its result. */
function pairedRound(): ForeignEntry[] {
  return [
    { kind: 'message', role: 'user', text: 'ask' },
    { kind: 'message', role: 'assistant', text: 'answer' },
    { kind: 'call', callId: 'k1', name: 'tool', arguments: '{}' },
    { kind: 'result', callId: 'k1', output: 'out' },
  ]
}

describe('translateTranscript event order', () => {
  it('brackets one turn per foreign round with contiguous sequences', async () => {
    const { events, dropped } = translateTranscript(await parseCodexSession([ROLLOUT_A]))

    expect(outline(events)).toEqual([
      '0:turn/start',
      '1:step/start',
      '2:user/message',
      '3:request/header',
      '4:assistant/message',
      '5:tool/call',
      '6:tool/result',
      '7:tool/call',
      '8:tool/result',
      '9:step/end',
      '10:turn/end',
      '11:turn/start',
      '12:step/start',
      '13:user/message',
      '14:step/end',
      '15:turn/end',
    ])
    expect(dropped).toEqual([])
  })

  it('marks the surface operations the transcript replays and gives assistant messages an empty stream', async () => {
    const { events } = translateTranscript(await parseCodexSession([ROLLOUT_A]))

    const surfaces = events.flatMap(event => ('surfaceOp' in event && event.surfaceOp !== undefined
      ? [[event.type, event.surfaceOp] as const]
      : []))
    expect(surfaces).toEqual([
      ['user/message', 'append'],
      ['assistant/message', 'append'],
      ['tool/result', 'append'],
      ['tool/result', 'append'],
      ['user/message', 'append'],
    ])
    for (const event of events) {
      if (event.type !== 'assistant/message') continue
      expect(event.data.stream).toEqual([])
    }
  })

  it('carries one initial request header inside the open turn, from the foreign route', async () => {
    const codex = translateTranscript(await parseCodexSession([ROLLOUT_A]))
    const claude = translateTranscript(await parseClaudeSession(CLAUDE_A))

    expect(codex.events.filter(event => event.type === 'request/header')).toHaveLength(1)
    const header = codex.events[3]
    expect(header).toMatchObject({
      type: 'request/header',
      data: { reason: 'initial', header: { config: { provider: 'openai', model: 'gpt-5' } } },
    })
    const openTurn = codex.events.filter(event => event.type === 'turn/start' || event.type === 'turn/end')
    expect(openTurn[0]!.seq).toBeLessThan(header!.seq)
    expect(openTurn[1]!.seq).toBeGreaterThan(header!.seq)

    expect(claude.events.find(event => event.type === 'request/header')).toMatchObject({
      data: { header: { config: { provider: 'claude-code', model: 'deepseek-v4' } } },
    })
  })

  it('names the foreign tool and marks the model imported when the log records neither', () => {
    const { events } = translateTranscript(transcript([{ kind: 'message', role: 'user', text: 'ask' }]))

    expect(events.find(event => event.type === 'request/header')).toMatchObject({
      data: { header: { config: { provider: 'codex', model: 'imported' } } },
    })
  })

  it('records the assistant route from an explicit provider and model', () => {
    const { events } = translateTranscript(transcript(
      [{ kind: 'message', role: 'assistant', text: 'answer' }],
      { provider: 'p', model: 'm' },
    ))

    expect(events.find(event => event.type === 'assistant/message')).toMatchObject({
      data: { message: { source: { kind: 'model', provider: 'p', model: 'm' } } },
    })
  })

  it('produces no events and no drops for an empty transcript', () => {
    expect(translateTranscript(transcript([]))).toEqual({ events: [], dropped: [] })
  })
})

describe('translateTranscript tool pairing', () => {
  it('drops an unpaired call from the message content and from the records, reporting it once', async () => {
    const { events, dropped } = translateTranscript(await parseCodexSession([ROLLOUT_A, ROLLOUT_B]))

    expect(dropped).toEqual([{ kind: 'call', callId: 'c3', reason: 'tool call has no result in its round' }])
    expect(emittedCalls(events).map(call => call.id)).toEqual(['c1', 'c2'])
    const assistant = events.find(event => event.type === 'assistant/message' && event.data.turn === 3)
    expect(assistant).toMatchObject({ data: { message: { content: [{ type: 'text', text: 'second reply' }] } } })
  })

  it('drops a result with no call and reports it once', () => {
    const { events, dropped } = translateTranscript(transcript([
      { kind: 'message', role: 'user', text: 'ask' },
      { kind: 'result', callId: 'ghost', output: 'orphan' },
    ]))

    expect(dropped).toEqual([{ kind: 'result', callId: 'ghost', reason: 'tool result has no call in its round' }])
    expect(events.some(event => event.type === 'tool/result')).toBe(false)
  })

  it('drops a result that precedes its call in the same round', () => {
    const { events, dropped } = translateTranscript(transcript([
      { kind: 'message', role: 'user', text: 'ask' },
      { kind: 'result', callId: 'k1', output: 'early' },
      { kind: 'call', callId: 'k1', name: 'tool', arguments: '{}' },
      { kind: 'result', callId: 'k1', output: 'late' },
    ]))

    expect(dropped).toEqual([{ kind: 'result', callId: 'k1', reason: 'tool result precedes its call' }])
    expect(events.filter(event => event.type === 'tool/result')).toHaveLength(1)
  })

  it('drops a second result for a call that already has one', () => {
    const { events, dropped } = translateTranscript(transcript([
      ...pairedRound(),
      { kind: 'result', callId: 'k1', output: 'again' },
    ]))

    expect(dropped).toEqual([{ kind: 'result', callId: 'k1', reason: 'tool call already has a result' }])
    expect(events.filter(event => event.type === 'tool/result')).toHaveLength(1)
  })

  it('opens an assistant message for an answered call the log issued without one', () => {
    const { events, dropped } = translateTranscript(transcript([
      { kind: 'message', role: 'user', text: 'ask' },
      { kind: 'call', callId: 'k1', name: 'tool', arguments: '{}' },
      { kind: 'result', callId: 'k1', output: 'out' },
    ]))

    expect(dropped).toEqual([])
    expect(outline(events)).toEqual([
      '0:turn/start',
      '1:step/start',
      '2:user/message',
      '3:request/header',
      '4:assistant/message',
      '5:tool/call',
      '6:tool/result',
      '7:step/end',
      '8:turn/end',
    ])
    expect(events[4]).toMatchObject({
      type: 'assistant/message',
      data: { message: { content: [{ type: 'tool-call', id: 'k1', name: 'tool', arguments: '{}' }] } },
    })
    expect(derivedCalls(accept({ events, dropped }))).toEqual([{ id: 'k1', name: 'tool', arguments: '{}' }])
  })

  it('attaches several answered calls to the assistant message that issued them', () => {
    const { events, dropped } = translateTranscript(transcript([
      { kind: 'message', role: 'user', text: 'ask' },
      { kind: 'message', role: 'assistant', text: 'both' },
      { kind: 'call', callId: 'k1', name: 'one', arguments: '{}' },
      { kind: 'call', callId: 'k2', name: 'two', arguments: '{}' },
      { kind: 'result', callId: 'k1', output: 'a' },
      { kind: 'result', callId: 'k2', output: 'b' },
    ]))

    expect(dropped).toEqual([])
    expect(events.filter(event => event.type === 'assistant/message')).toHaveLength(1)
    expect(events.find(event => event.type === 'assistant/message')).toMatchObject({
      data: {
        message: {
          content: [
            { type: 'text', text: 'both' },
            { type: 'tool-call', id: 'k1' },
            { type: 'tool-call', id: 'k2' },
          ],
        },
      },
    })
  })

  it('leaves an unpaired call out of the message content and out of the records', () => {
    const { events, dropped } = translateTranscript(transcript([
      { kind: 'message', role: 'user', text: 'ask' },
      { kind: 'message', role: 'assistant', text: 'issued' },
      { kind: 'call', callId: 'k1', name: 'tool', arguments: '{}' },
    ]))

    expect(dropped).toEqual([{ kind: 'call', callId: 'k1', reason: 'tool call has no result in its round' }])
    expect(emittedCalls(events)).toEqual([])
    expect(events.find(event => event.type === 'assistant/message')).toMatchObject({
      data: { message: { content: [{ type: 'text', text: 'issued' }] } },
    })
  })
})

describe('translateTranscript rounds and timestamps', () => {
  it('emits no user message for a round that opens with assistant content', () => {
    const { events, dropped } = translateTranscript(transcript([
      { kind: 'message', role: 'assistant', text: 'leading answer' },
      { kind: 'call', callId: 'k1', name: 'tool', arguments: '{}' },
      { kind: 'result', callId: 'k1', output: 'out' },
    ]))

    expect(dropped).toEqual([])
    expect(events.some(event => event.type === 'user/message')).toBe(false)
    expect(accept({ events, dropped }).deriveMessages()[0]?.role).toBe('assistant')
  })

  it('omits an assistant message that would carry neither text nor a call', () => {
    const { events } = translateTranscript(transcript([
      { kind: 'message', role: 'user', text: 'ask' },
      { kind: 'message', role: 'assistant', text: '' },
    ]))

    expect(events.some(event => event.type === 'assistant/message')).toBe(false)
    expect(outline(events)).toEqual([
      '0:turn/start',
      '1:step/start',
      '2:user/message',
      '3:request/header',
      '4:step/end',
      '5:turn/end',
    ])
  })

  it('keeps the seed clock non-decreasing and integral across foreign timestamps', () => {
    const { events } = translateTranscript(transcript([
      { kind: 'message', role: 'user', text: 'undated' },
      { kind: 'message', role: 'assistant', text: 'dated later', at: '2026-08-27T10:00:00.000Z' },
      { kind: 'message', role: 'assistant', text: 'dated earlier', at: '2026-08-27T09:00:00.000Z' },
      { kind: 'message', role: 'assistant', text: 'unreadable date', at: 'not a date' },
    ]))

    const times = events.map(event => event.time)
    for (const [index, time] of times.entries()) {
      expect(Number.isSafeInteger(time)).toBe(true)
      if (index > 0) expect(time).toBeGreaterThanOrEqual(times[index - 1]!)
    }
    expect(times[0]).toBe(1)
    expect(events[2]!.time).toBe(3)
    expect(events[4]!.time).toBe(Date.parse('2026-08-27T10:00:00.000Z'))
    expect(events[5]!.time).toBe(Date.parse('2026-08-27T10:00:00.000Z') + 1)
    expect(events[6]!.time).toBe(Date.parse('2026-08-27T10:00:00.000Z') + 2)
  })

  it('translates the real Claude Code fixture and reports its orphan result', async () => {
    const { events, dropped } = translateTranscript(await parseClaudeSession(CLAUDE_A))

    expect(dropped).toEqual([{ kind: 'result', callId: 'tu2', reason: 'tool result has no call in its round' }])
    expect(outline(events)).toEqual([
      '0:turn/start',
      '1:step/start',
      '2:user/message',
      '3:request/header',
      '4:assistant/message',
      '5:tool/call',
      '6:tool/result',
      '7:assistant/message',
      '8:step/end',
      '9:turn/end',
    ])
  })
})

describe('translated seeds through Session.create', () => {
  it('accepts the Codex seed and derives the recorded roles and calls', async () => {
    const translated = translateTranscript(await parseCodexSession([ROLLOUT_A, ROLLOUT_B]))
    const session = accept(translated)

    expect(session.deriveMessages().map(message => message.role)).toEqual([
      'user',
      'assistant',
      'user',
      'user',
      'user',
      'user',
      'assistant',
    ])
    expect(derivedCalls(session)).toEqual([
      { id: 'c1', name: 'mcp__fastctx.inspect', arguments: '{"file_path":"a.ts"}' },
      { id: 'c2', name: 'exec', arguments: 'run()' },
    ])
  })

  it('accepts the Claude Code seed and derives the recorded roles and calls', async () => {
    const translated = translateTranscript(await parseClaudeSession(CLAUDE_A))
    const session = accept(translated)

    expect(session.deriveMessages().map(message => message.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
    ])
    expect(derivedCalls(session)).toEqual([{ id: 'tu1', name: 'Bash', arguments: '{"command":"ls"}' }])
  })
})
