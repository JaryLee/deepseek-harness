import { afterAll, describe, expect, it } from 'vitest'
import { isSyntheticUserText, parseCodexSession } from '../src/codex.ts'
import { fixture, removeTempRoots, tempRoot } from './harness.ts'

afterAll(removeTempRoots)

const ROLLOUT_A = fixture('codex/rollout-a.jsonl')
const ROLLOUT_B = fixture('codex/rollout-b.jsonl')

describe('parseCodexSession', () => {
  it('reads identity, route, summary, and conversation entries from a rollout shard', async () => {
    const transcript = await parseCodexSession([ROLLOUT_A])

    expect(transcript).toMatchObject({
      tool: 'codex',
      sessionId: 'sess-a',
      sourcePaths: [ROLLOUT_A],
      cwd: 'D:\\work\\demo',
      provider: 'openai',
      model: 'gpt-5',
      summary: 'rolled up summary',
    })
    expect(transcript.entries).toEqual([
      { kind: 'message', role: 'user', text: 'hello codex', at: '2026-08-27T10:00:00.400Z' },
      { kind: 'message', role: 'assistant', text: 'hi there', at: '2026-08-27T10:00:01.000Z' },
      {
        kind: 'call',
        callId: 'c1',
        name: 'mcp__fastctx.inspect',
        arguments: '{"file_path":"a.ts"}',
        at: '2026-08-27T10:00:02.000Z',
      },
      { kind: 'result', callId: 'c1', output: 'file contents', at: '2026-08-27T10:00:03.000Z' },
      { kind: 'call', callId: 'c2', name: 'exec', arguments: 'run()', at: '2026-08-27T10:00:04.000Z' },
      { kind: 'result', callId: 'c2', output: '{"ok":true}', at: '2026-08-27T10:00:05.000Z' },
      { kind: 'message', role: 'user', text: 'plain string prompt', at: '2026-08-27T10:00:06.000Z' },
    ])
  })

  it('reports every unusable line with its reason, in read order', async () => {
    const { skipped } = await parseCodexSession([ROLLOUT_A])

    expect(skipped).toEqual([
      { reason: 'non-conversation role', detail: 'developer' },
      { reason: 'injected user prelude', detail: '<environment_context>cwd' },
      { reason: 'non-text content block', detail: 'input_image' },
      { reason: 'thinking transcript', detail: 'reasoning' },
      { reason: 'compaction replacement history', detail: 'compacted' },
      { reason: 'unknown record type', detail: 'mystery' },
      { reason: 'response_item without payload', detail: 'rollout-a.jsonl:19' },
      { reason: 'tool call without call_id or name', detail: 'function_call' },
      { reason: 'tool result without call_id', detail: 'function_call_output' },
      { reason: 'unknown response item', detail: 'mystery_item' },
      { reason: 'malformed JSON line', detail: 'rollout-a.jsonl:24' },
      { reason: 'line is not a JSON object', detail: 'rollout-a.jsonl:25' },
    ])
  })

  it('merges shards by payload id and keeps the later call the shard never answered', async () => {
    const transcript = await parseCodexSession([ROLLOUT_A, ROLLOUT_B])

    expect(transcript.sessionId).toBe('sess-a')
    expect(transcript.sourcePaths).toEqual([ROLLOUT_A, ROLLOUT_B])
    expect(transcript.entries.map(entry => (entry.kind === 'message' ? entry.text : entry.callId))).toEqual([
      'hello codex',
      'hi there',
      'c1',
      'c1',
      'c2',
      'c2',
      'plain string prompt',
      'second turn',
      'second reply',
      'c3',
    ])
  })

  it('reads a rollout that carries no session metadata', async () => {
    const transcript = await parseCodexSession([fixture('codex/legacy.jsonl')])

    expect(transcript.sessionId).toBe('')
    expect(transcript.cwd).toBeUndefined()
    expect(transcript.provider).toBeUndefined()
    expect(transcript.model).toBeUndefined()
    expect(transcript.summary).toBeUndefined()
    expect(transcript.skipped).toEqual([])
    expect(transcript.entries.map(entry => (entry.kind === 'message' ? entry.text : entry.kind))).toEqual([
      'legacy prompt',
      'legacy reply',
    ])
  })

  it('produces an empty transcript for no source paths', async () => {
    expect(await parseCodexSession([])).toEqual({
      tool: 'codex',
      sessionId: '',
      sourcePaths: [],
      entries: [],
      skipped: [],
    })
  })

  it('reads the fallback identity fields and every payload arm a rollout can carry', async () => {
    const root = await tempRoot('codex-arms')
    const path = await root.write('arms.jsonl', [
      { type: 'session_meta' },
      { type: 'session_meta', payload: 7 },
      { type: 'session_meta', payload: { id: 'fallback-id', cwd: 'C:\\arms', model_provider: 'arms-provider' } },
      { type: 'turn_context' },
      { type: 'turn_context', payload: { model: 'arms-model' } },
      { type: 'compacted' },
      { type: 'compacted', payload: { message: 'arms summary' } },
      {},
      { type: 'event_msg', payload: { type: 'token_count' } },
      { type: 'response_item', payload: { type: 'message', content: 'roleless' } },
      { type: 'response_item', payload: { type: 'message', role: 'user', content: '' } },
      { type: 'response_item', payload: { type: 'message', role: 'user', content: [42, { type: 'input_text', text: 'kept' }] } },
      { type: 'response_item', timestamp: 't', payload: { type: 'message', role: 'assistant', content: [{ type: 'input_image' }] } },
      { type: 'response_item', payload: { type: 'function_call', call_id: 'c9' } },
      { type: 'response_item', payload: { type: 'function_call', name: 'n9' } },
      { type: 'response_item', payload: { type: 'custom_tool_call', call_id: 'c10', name: 'n10' } },
      { type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'c11' } },
      { type: 'response_item', payload: { type: 'function_call_output', call_id: 'c12', output: null } },
      { type: 'response_item', payload: {} },
    ])

    const transcript = await parseCodexSession([path])

    expect(transcript).toMatchObject({
      sessionId: 'fallback-id',
      cwd: 'C:\\arms',
      provider: 'arms-provider',
      model: 'arms-model',
      summary: 'arms summary',
    })
    expect(transcript.entries).toEqual([
      { kind: 'message', role: 'user', text: 'kept', at: undefined },
      { kind: 'call', callId: 'c10', name: 'n10', arguments: '', at: undefined },
      { kind: 'result', callId: 'c11', output: '', at: undefined },
      { kind: 'result', callId: 'c12', output: '', at: undefined },
    ])
    expect(transcript.skipped).toEqual([
      { reason: 'compaction replacement history', detail: 'compacted' },
      { reason: 'compaction replacement history', detail: 'compacted' },
      { reason: 'non-conversation role', detail: 'unknown role' },
      { reason: 'non-text content block', detail: 'untyped block' },
      { reason: 'non-text content block', detail: 'input_image' },
      { reason: 'tool call without call_id or name', detail: 'function_call' },
      { reason: 'tool call without call_id or name', detail: 'function_call' },
      { reason: 'unknown response item', detail: 'untyped' },
    ])
  })
})

describe('isSyntheticUserText', () => {
  it.each([
    '<app-context>',
    '<environment_context>',
    '<heartbeat>',
    '<image>',
    '<recommended_plugins>',
    '<turn_aborted>',
    '<turn_context>',
    '<user_instructions>',
  ])('reports the injected prelude %s', (prefix) => {
    expect(isSyntheticUserText(`${prefix}body`)).toBe(true)
  })

  it('reports text a person wrote', () => {
    expect(isSyntheticUserText('hello')).toBe(false)
  })
})
