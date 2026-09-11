import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import CommandRuntime, { type CommandResult } from '@deepseek-ai/dsh-commands'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import * as contextImport from '../src/index.ts'
import { importedSessionId, renderInjection, renderSummary } from '../src/index.ts'
import { fixture, removeTempRoots, tempRoot, transcript } from './harness.ts'
import type { ForeignSessionSummary, ForeignTranscript } from '../src/types.ts'

afterAll(removeTempRoots)

const SIGNAL = new AbortController().signal
const CODEX_ROOT = fixture('codex')
const CLAUDE_ROOT = fixture('claude')
const INDEX_PATH = fixture('codex/session_index.jsonl')

/** Options one fake `agents.create` call received. */
interface CreateOptions {
  readonly sessionId: SessionId
  readonly meta: { readonly cwd: string }
  readonly seed: readonly SessionEvent[]
}

/** A real session owned by a minimal receiving agent. */
function receiver(id = 'receiver'): Agent {
  const session = Session.create(SessionId(id))
  return { id: session.id, session } as Agent
}

/**
 * Prepare a context that can host the plugin without Cordis config validation.
 * @returns The context with a recording `agents` service and the real commands registry.
 */
async function bareContext(): Promise<Context> {
  const ctx = new Context()
  ctx.provide('agents', { create: async () => {} } as never)
  await ctx.plugin(CommandRuntime)
  return ctx
}

/**
 * Mount the plugin on a real Cordis context with the real commands registry and a
 * recording `agents` service.
 * @param config - Plugin configuration.
 * @returns The context, the plugin fiber, the recorded agent creations, and the rejection any `create` raises.
 */
async function mount(config: contextImport.Config = {}): Promise<{
  ctx: Context
  fiber: Awaited<ReturnType<Context['plugin']>>
  created: CreateOptions[]
  failCreate: { error: unknown }
}> {
  const ctx = new Context()
  const created: CreateOptions[] = []
  const failCreate: { error: unknown } = { error: undefined }
  ctx.provide('agents', {
    create: async (options: CreateOptions) => {
      if (failCreate.error !== undefined) throw failCreate.error
      created.push(options)
    },
  } as never)
  await ctx.plugin(CommandRuntime)
  const fiber = await ctx.plugin(contextImport, config)
  return { ctx, fiber, created, failCreate }
}

/**
 * Run one `/import` line through the real command registry.
 * @param ctx - Mounted context.
 * @param agent - Receiving agent.
 * @param line - Complete command line.
 * @returns The command result.
 */
async function run(ctx: Context, agent: Agent, line: string): Promise<CommandResult> {
  const execution = await ctx.commands.execute(agent, line, [], SIGNAL)
  if (execution === undefined) throw new Error(`command did not resolve: ${line}`)
  return execution.result
}

/** Plugin user messages a session received, with their source and text. */
function contextMessages(agent: Agent): Array<{ source: unknown; text: string }> {
  const messages: Array<{ source: unknown; text: string }> = []
  for (const event of agent.session.snapshotEvents()) {
    if (event.type !== 'user/message' || event.data.source.kind !== 'plugin') continue
    messages.push({
      source: event.data.source,
      text: event.data.content.find(block => block.type === 'text')?.text ?? '',
    })
  }
  return messages
}

describe('plugin mount', () => {
  it('publishes the service and the /import command, and removes both with its fiber', async () => {
    const { ctx, fiber } = await mount()
    const agent = receiver()

    expect(ctx.get('contextImport')).toBeDefined()
    expect(ctx.contextImport).toBe(ctx.get('contextImport'))
    expect(ctx.commands.find(agent, 'import')?.name).toBe('import')
    expect(ctx.commands.list(agent).map(descriptor => descriptor.name)).toContain('import')

    await fiber.dispose()

    expect(ctx.commands.find(agent, 'import')).toBeUndefined()
    expect(ctx.get('contextImport')).toBeUndefined()
  })

  it.each([-1, 0.5])('refuses injectTailMessages %j at load', async (injectTailMessages) => {
    await expect(mount({ injectTailMessages })).rejects.toThrow(TypeError)
  })

  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN])('rejects injectTailMessages %j before registering anything', async (value) => {
    const ctx = await bareContext()

    expect(() => { contextImport.apply(ctx, { injectTailMessages: value }) }).toThrow(TypeError)
    expect(() => { contextImport.apply(ctx, { injectTailMessages: value }) }).toThrow(
      `context-import: injectTailMessages must be a non-negative safe integer, got ${String(value)}`,
    )
    expect(ctx.get('contextImport')).toBeUndefined()
  })

  it('defaults the injection bound when the caller supplies no configuration', async () => {
    const ctx = await bareContext()

    contextImport.apply(ctx, {})

    expect(ctx.get('contextImport')).toBeDefined()
    const result = await run(ctx, receiver(), '/import help')
    expect(result.kind).toBe('success')
  })

  it('accepts a zero injection bound and route names overrides', async () => {
    const { ctx } = await mount({ injectTailMessages: 0, provider: 'p', model: 'm' })
    const parsed = await ctx.contextImport.parse(fixture('codex/rollout-a.jsonl'))

    expect(parsed.transcript.tool).toBe('codex')
    expect(parsed.events.length).toBeGreaterThan(0)
    expect(parsed.dropped).toEqual([])
  })

  it('fills the configured route identity only where the foreign log recorded none', async () => {
    const root = await tempRoot('route-gap')
    const { ctx, created } = await mount({
      codexDir: root.path,
      codexIndexPath: `${root.path}/session_index.jsonl`,
      provider: 'route-provider',
      model: 'route-model',
    })

    const outcome = await ctx.contextImport.importNewSession({
      sourcePath: fixture('codex/legacy.jsonl'),
      sessionId: importedSessionId('codex', 'legacy'),
      cwd: 'C:\\legacy',
    })

    expect(outcome.events.length).toBeGreaterThan(0)
    expect(created[0]?.seed.find(event => event.type === 'request/header')).toMatchObject({
      data: { header: { config: { provider: 'route-provider', model: 'route-model' } } },
    })
  })
})

describe('/import usage and listing', () => {
  it.each(['/import', '/import help', '/import   help  '])('answers %j with the usage line', async (line) => {
    const { ctx } = await mount()

    const result = await run(ctx, receiver(), line)

    expect(result.kind).toBe('success')
    expect(result.text?.startsWith('usage: ')).toBe(true)
    expect(result.text).toContain('/import --inject')
  })

  it('renders one header line followed by one row per importable session', async () => {
    const { ctx } = await mount({
      codexDir: CODEX_ROOT,
      claudeDir: CLAUDE_ROOT,
      codexIndexPath: INDEX_PATH,
      injectTailMessages: 0,
    })

    const result = await run(ctx, receiver(), '/import list')
    const lines = result.text?.split('\n') ?? []

    expect(result.kind).toBe('success')
    expect(lines[0]).toBe('import list · 可导入会话：')
    const codexRow = lines.find(line => line.includes('sess-a'))
    expect(codexRow).toBeDefined()
    expect(codexRow).toContain('codex')
    expect(codexRow).toContain('D:\\work\\demo')
    expect(codexRow).toContain('KiB')
    expect(codexRow).toContain(JSON.stringify('化债-综合系数法测试'))
    expect(codexRow).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/)
    const claudeRow = lines.find(line => line.includes('claude-a'))
    expect(claudeRow).toContain(JSON.stringify('你好呀'))
  })

  it('reports an empty listing with the same first line', async () => {
    const root = await tempRoot('empty-list')
    const { ctx } = await mount({
      codexDir: root.path,
      claudeDir: root.path,
      codexIndexPath: `${root.path}/session_index.jsonl`,
    })

    const result = await run(ctx, receiver(), '/import list')

    expect(result.kind).toBe('success')
    expect(result.text?.startsWith('import list · 可导入会话：')).toBe(true)
    expect(result.text).toContain('none found under the configured roots')
  })
})

describe('renderSummary', () => {
  const base: ForeignSessionSummary = {
    tool: 'codex',
    id: 'sess',
    sourcePaths: ['/logs/rollout.jsonl'],
    sizeBytes: 2048,
  }

  it('renders tool, id, label, stamp, size, and a JSON-quoted title', () => {
    expect(renderSummary({
      ...base,
      cwd: 'C:\\work',
      updatedAt: '2026-08-27T10:00:00.000Z',
      title: '名前',
    })).toBe('codex sess  (C:\\work, 2026-08-27T10:00:00.000Z, 2 KiB, "名前")')
  })

  it('falls back from a missing cwd to the first source path and then to nothing', () => {
    expect(renderSummary({ ...base, updatedAt: 'stamp' }))
      .toBe('codex sess  (/logs/rollout.jsonl, stamp, 2 KiB)')
    expect(renderSummary({ ...base, sourcePaths: [] })).toBe('codex sess  (, , 2 KiB)')
  })

  it('never renders a sub-KiB size as zero', () => {
    expect(renderSummary({ ...base, sizeBytes: 0 })).toContain('1 KiB')
    expect(renderSummary({ ...base, sizeBytes: 1023 })).toContain('1 KiB')
  })

  it('truncates an over-long id and keeps an id of exactly the limit', () => {
    const long = 'i'.repeat(41)
    expect(renderSummary({ ...base, id: long })).toContain(`codex ${'i'.repeat(40)}…  (`)
    expect(renderSummary({ ...base, id: 'i'.repeat(40) })).toContain(`codex ${'i'.repeat(40)}  (`)
    expect(renderSummary({ ...base, id: long })).not.toContain(long)
  })
})

describe('/import new session', () => {
  it('seeds a new session under a stable id derived from the foreign session', async () => {
    const { ctx, created } = await mount({
      codexDir: CODEX_ROOT,
      codexIndexPath: INDEX_PATH,
    })
    const agent = receiver()

    const first = await run(ctx, agent, '/import codex sess-a')
    const second = await run(ctx, agent, '/import codex sess-a')

    expect(first.kind).toBe('success')
    expect(first.text).toContain('(dropped 1)')
    expect(second.kind).toBe('success')
    expect(created).toHaveLength(2)
    expect(created[0]?.sessionId).toBe(importedSessionId('codex', 'sess-a'))
    expect(created[0]?.sessionId).toBe('import-codex-sess-a')
    expect(created[1]?.sessionId).toBe(created[0]?.sessionId)
    expect(created[0]?.meta).toEqual({ cwd: 'D:\\work\\demo' })
    expect(created[0]?.seed.length).toBeGreaterThan(0)
    expect(created[0]?.seed.every((event, index) => event.seq === index)).toBe(true)
  })

  it('accepts the claude alias and reports the imported event count', async () => {
    const { ctx, created } = await mount({ claudeDir: CLAUDE_ROOT, provider: 'p', model: 'm' })

    const result = await run(ctx, receiver(), '/import CLAUDE claude-a')

    expect(result.kind).toBe('success')
    expect(result.text).toMatch(/^imported \d+ events into import-claude-code-claude-a/)
    expect(created[0]?.sessionId).toBe('import-claude-code-claude-a')
    expect(created[0]?.meta).toEqual({ cwd: 'D:\\work\\demo' })
  })

  it('falls back to the process working directory for a session that recorded none', async () => {
    const root = await tempRoot('no-cwd')
    await root.write('rollout.jsonl', [
      { type: 'session_meta', payload: { session_id: 'no-cwd' } },
      { type: 'response_item', payload: { type: 'message', role: 'user', content: 'hello' } },
    ])
    const { ctx, created } = await mount({ codexDir: root.path, codexIndexPath: `${root.path}/session_index.jsonl` })

    const result = await run(ctx, receiver(), '/import codex no-cwd')

    expect(result.kind).toBe('success')
    expect(created[0]?.meta).toEqual({ cwd: process.cwd() })
  })
})

describe('/import --inject', () => {
  it('appends recall-form context to the receiving session', async () => {
    const { ctx } = await mount({
      codexDir: CODEX_ROOT,
      codexIndexPath: INDEX_PATH,
      injectTailMessages: 1,
    })
    const agent = receiver()

    const result = await run(ctx, agent, '/import --inject codex sess-a')

    expect(result.kind).toBe('success')
    expect(result.text).toContain('injected')
    const messages = contextMessages(agent)
    expect(messages).toHaveLength(1)
    expect(messages[0]?.source).toEqual({ kind: 'plugin', plugin: 'context-import', form: 'recall' })
    expect(messages[0]?.text).toContain('Recalled from a codex session in D:\\work\\demo:')
    const appended = agent.session.snapshotEvents().find(event => event.type === 'user/message')
    expect(appended?.surfaceOp).toBe('append')

    const outcome = await ctx.contextImport.injectIntoCurrent({
      agent: receiver('second-receiver'),
      sourcePath: join(CODEX_ROOT, 'rollout-a.jsonl'),
    })
    expect(outcome.injected).toBe(true)
    expect(outcome.summary).toMatch(/^injected \d+ foreign entries from codex$/)
  })

  it('injects nothing when the transcript carries no text', async () => {
    const root = await tempRoot('call-only')
    await root.write('rollout.jsonl', [
      { type: 'session_meta', payload: { session_id: 'call-only' } },
      { type: 'response_item', payload: { type: 'function_call', call_id: 'k1', name: 'tool', arguments: '{}' } },
      { type: 'response_item', payload: { type: 'function_call_output', call_id: 'k1', output: 'out' } },
    ])
    const { ctx } = await mount({ codexDir: root.path, codexIndexPath: `${root.path}/session_index.jsonl` })
    const agent = receiver()

    const result = await run(ctx, agent, '/import --inject codex call-only')

    expect(result).toEqual({ kind: 'success', text: 'nothing to inject: the foreign transcript has no text' })
    expect(contextMessages(agent)).toEqual([])

    const outcome = await ctx.contextImport.injectIntoCurrent({
      agent,
      sourcePath: join(root.path, 'rollout.jsonl'),
    })
    expect(outcome).toEqual({ injected: false, summary: 'nothing to inject: the foreign transcript has no text' })
  })
})

describe('/import error arms', () => {
  it.each([
    ['/import sparkle sess-a', 'expected codex, claude, claude-code, list, or help'],
    ['/import codex', 'expected codex, claude, claude-code, list, or help'],
    ['/import --inject', 'expected codex, claude, claude-code, list, or help'],
    ['/import codex absent', 'no codex session "absent" under the configured roots'],
  ])('answers %j with an error', async (line, expected) => {
    const { ctx } = await mount({ codexDir: CODEX_ROOT, codexIndexPath: INDEX_PATH })

    const result = await run(ctx, receiver(), line)

    expect(result.kind).toBe('error')
    expect(result.text).toContain(expected)
    expect(result.text?.length).toBeGreaterThan(0)
  })

  it('reports a source file that is not a foreign session log', async () => {
    const root = await tempRoot('noise-root')
    await root.write('noise.jsonl', [{ unrelated: 'record' }])
    const { ctx } = await mount({ claudeDir: root.path })

    const result = await run(ctx, receiver(), '/import claude-code noise')

    expect(result.kind).toBe('error')
    expect(result.text).toContain('is not a recognized Codex or Claude Code session log')
  })

  it('reports a foreign log that carries no conversation', async () => {
    const root = await tempRoot('no-conversation')
    await root.write('rollout.jsonl', [{ type: 'session_meta', payload: { session_id: 'silent' } }])
    const { ctx } = await mount({ codexDir: root.path, codexIndexPath: `${root.path}/session_index.jsonl` })

    const result = await run(ctx, receiver(), '/import codex silent')

    expect(result.kind).toBe('error')
    expect(result.text).toContain('carries no importable conversation')
  })

  it('reports a rejected session creation through the same error result', async () => {
    const { ctx, failCreate } = await mount({ codexDir: CODEX_ROOT, codexIndexPath: INDEX_PATH })
    failCreate.error = new Error('agents refused the session')

    const failure = await run(ctx, receiver(), '/import codex sess-a')

    failCreate.error = 'a thrown string'
    const thrown = await run(ctx, receiver(), '/import codex sess-a')

    expect(failure.text).toBe('agents refused the session')
    expect(thrown.text).toBe('a thrown string')
  })
})

describe('renderInjection', () => {
  const entries: ForeignTranscript['entries'] = [
    { kind: 'message', role: 'user', text: 'first question' },
    { kind: 'message', role: 'assistant', text: 'first answer' },
    { kind: 'message', role: 'user', text: 'second question' },
    { kind: 'message', role: 'assistant', text: 'second answer' },
    { kind: 'message', role: 'user', text: '   ' },
    { kind: 'call', callId: 'k1', name: 'tool', arguments: '{}' },
  ]

  it('collapses every message to one line when no tail is kept verbatim', () => {
    expect(renderInjection(transcript(entries, { cwd: 'C:\\work' }), 0)).toBe([
      'Recalled from a codex session in C:\\work:',
      '- user: first question',
      '- assistant: first answer',
      '- user: second question',
      '- assistant: second answer',
    ].join('\n'))
  })

  it('keeps the trailing messages verbatim and collapses the head', () => {
    expect(renderInjection(transcript(entries, { cwd: 'C:\\work' }), 2)).toBe([
      'Recalled from a codex session in C:\\work:',
      '- user: first question',
      '- assistant: first answer',
      'user: second question',
      'assistant: second answer',
    ].join('\n'))
  })

  it('keeps every message verbatim when the bound covers the whole transcript', () => {
    expect(renderInjection(transcript([{ kind: 'message', role: 'user', text: 'only' }]), 2)).toBe([
      'Recalled from a codex session:',
      'user: only',
    ].join('\n'))
  })

  it('prefixes the foreign summary, else the foreign title, when the log recorded one', () => {
    expect(renderInjection(transcript([{ kind: 'message', role: 'user', text: 'hi' }], { summary: 'rolled up' }), 0))
      .toBe('rolled up\nRecalled from a codex session:\n- user: hi')
    expect(renderInjection(transcript([{ kind: 'message', role: 'user', text: 'hi' }], { title: 'named' }), 0))
      .toBe('named\nRecalled from a codex session:\n- user: hi')
  })

  it('renders an empty transcript that holds no message text, including a call-only round', () => {
    expect(renderInjection(transcript([]), 8)).toBe('')
    expect(renderInjection(transcript(entries.filter(entry => entry.kind !== 'message')), 8)).toBe('')
  })
})
