import { afterAll, describe, expect, it } from 'vitest'
import { parseClaudeSession } from '../src/claude.ts'
import { fixture, removeTempRoots, tempRoot } from './harness.ts'

afterAll(removeTempRoots)

const SESSION_A = fixture('claude/session-a.jsonl')

describe('parseClaudeSession', () => {
  it('reads identity, route, the CLI title and summary, and conversation entries', async () => {
    const transcript = await parseClaudeSession(SESSION_A)

    expect(transcript).toMatchObject({
      tool: 'claude-code',
      sessionId: 'claude-a',
      sourcePaths: [SESSION_A],
      cwd: 'D:\\work\\demo',
      model: 'deepseek-v4',
      title: '我的会话',
      summary: '更早的摘要',
    })
    expect(transcript.entries).toEqual([
      { kind: 'message', role: 'user', text: '你好呀', at: '2026-08-27T12:00:01.000Z' },
      { kind: 'message', role: 'assistant', text: '我来看看', at: '2026-08-27T12:00:02.000Z' },
      { kind: 'call', callId: 'tu1', name: 'Bash', arguments: '{"command":"ls"}', at: '2026-08-27T12:00:02.000Z' },
      { kind: 'result', callId: 'tu1', output: '列出的内容', at: '2026-08-27T12:00:03.000Z' },
      { kind: 'message', role: 'assistant', text: '纯字符串回复', at: undefined },
      { kind: 'result', callId: 'tu2', output: '数组结果', at: undefined },
    ])
  })

  it('reports the records, side chains, and blocks it could not use', async () => {
    const { skipped } = await parseClaudeSession(SESSION_A)

    expect(skipped).toEqual([
      { reason: 'thinking transcript', detail: 'thinking' },
      { reason: 'side chain', detail: 'user' },
      { reason: 'non-text content block', detail: 'image' },
      { reason: 'unknown content block', detail: 'mystery_block' },
      { reason: 'message without content', detail: 'assistant' },
      { reason: 'record without message', detail: 'user' },
      { reason: 'tool call without id or name', detail: 'tool_use' },
      { reason: 'tool result without tool_use_id', detail: 'tool_result' },
      { reason: 'unknown record type', detail: 'mystery' },
      { reason: 'malformed JSON line', detail: 'session-a.jsonl:18' },
    ])
  })

  it('falls back to the file name for a log that names no session', async () => {
    const root = await tempRoot('claude-arms')
    const path = await root.write('claude-arms.jsonl', [
      { type: 'summary' },
      { type: 'custom-title' },
      { type: 'system' },
      { type: 'assistant', message: { role: 'assistant', content: '' } },
      { type: 'assistant', message: { role: 'assistant', content: 42 } },
      { type: 'user', message: { role: 'system', content: 'role from the record type' } },
      { type: 'assistant', message: { role: 'assistant', content: [42] } },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text' }] } },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'undated' }] } },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'NoInput' }] } },
      { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2' }] } },
      {
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 't3', content: [42, { untyped: true }, { type: 'text' }] }],
        },
      },
      [1, 2, 3],
    ])

    const transcript = await parseClaudeSession(path)

    expect(transcript.sessionId).toBe('claude-arms')
    expect(transcript).toMatchObject({ tool: 'claude-code', sourcePaths: [path] })
    expect(transcript.cwd).toBeUndefined()
    expect(transcript.model).toBeUndefined()
    expect(transcript.title).toBeUndefined()
    expect(transcript.summary).toBeUndefined()
    expect(transcript.entries).toEqual([
      { kind: 'message', role: 'user', text: 'role from the record type', at: undefined },
      { kind: 'message', role: 'assistant', text: 'undated', at: undefined },
      { kind: 'call', callId: 't1', name: 'NoInput', arguments: '{}', at: undefined },
      { kind: 'result', callId: 't2', output: '', at: undefined },
      { kind: 'result', callId: 't3', output: '', at: undefined },
    ])
    expect(transcript.skipped).toEqual([
      { reason: 'message without content', detail: 'assistant' },
      { reason: 'unknown content block', detail: 'untyped block' },
      { reason: 'line is not a JSON object', detail: 'claude-arms.jsonl:13' },
    ])
  })

  it('prefers the last identity and route a log recorded', async () => {
    const root = await tempRoot('claude-last')
    const path = await root.write('claude-last.jsonl', [
      { sessionId: 'first', cwd: 'C:\\first' },
      { sessionId: 'second', cwd: 'C:\\second' },
      { type: 'assistant', message: { role: 'assistant', model: 'first-model', content: 'a' } },
      { type: 'assistant', message: { role: 'assistant', model: 'second-model', content: 'b' } },
    ])

    const transcript = await parseClaudeSession(path)

    expect(transcript).toMatchObject({ sessionId: 'second', cwd: 'C:\\second', model: 'second-model' })
  })
})
