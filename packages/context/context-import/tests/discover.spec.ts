import { statSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import {
  canonicalTool,
  defaultClaudeRoot,
  defaultCodexIndexPath,
  defaultCodexRoot,
  detectForeignTool,
  extractTitle,
  listClaudeSessions,
  listCodexSessions,
  readCodexTitles,
  resolveCodexShards,
} from '../src/discover.ts'
import { fixture, removeTempRoots, tempRoot } from './harness.ts'

afterAll(removeTempRoots)

const ROLLOUT_A = fixture('codex/rollout-a.jsonl')
const ROLLOUT_B = fixture('codex/rollout-b.jsonl')
const CODEX_ROOT = fixture('codex')
const CLAUDE_ROOT = fixture('claude')

const SAVED_ENV = {
  codexHome: process.env['CODEX_HOME'],
  claudeConfigDir: process.env['CLAUDE_CONFIG_DIR'],
}

afterEach(() => {
  if (SAVED_ENV.codexHome === undefined) delete process.env.CODEX_HOME
  else process.env.CODEX_HOME = SAVED_ENV.codexHome
  if (SAVED_ENV.claudeConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = SAVED_ENV.claudeConfigDir
})

describe('canonicalTool', () => {
  it.each([
    ['codex', 'codex'],
    ['CLAUDE', 'claude-code'],
    ['claude-code', 'claude-code'],
    ['  codex  ', 'codex'],
    ['\tClaude-Code\n', 'claude-code'],
    ['gemini', undefined],
  ] as const)('maps %j to %j', (source, expected) => {
    expect(canonicalTool(source)).toBe(expected)
  })
})

describe('default roots', () => {
  it('follows CODEX_HOME and CLAUDE_CONFIG_DIR when the environment sets them', () => {
    process.env['CODEX_HOME'] = join('C:', 'codex-home')
    process.env['CLAUDE_CONFIG_DIR'] = join('C:', 'claude-home')

    expect(defaultCodexRoot()).toBe(join('C:', 'codex-home', 'sessions'))
    expect(defaultCodexIndexPath()).toBe(join('C:', 'codex-home', 'session_index.jsonl'))
    expect(defaultClaudeRoot()).toBe(join('C:', 'claude-home', 'projects'))
  })

  it('falls back to the home directory when the environment omits or empties the names', () => {
    delete process.env['CODEX_HOME']
    delete process.env['CLAUDE_CONFIG_DIR']
    const fromHome = {
      codex: defaultCodexRoot(),
      index: defaultCodexIndexPath(),
      claude: defaultClaudeRoot(),
    }

    process.env['CODEX_HOME'] = ''
    process.env['CLAUDE_CONFIG_DIR'] = ''

    expect(fromHome.codex).toContain(join('.codex', 'sessions'))
    expect(fromHome.index).toContain(join('.codex', 'session_index.jsonl'))
    expect(fromHome.claude).toContain(join('.claude', 'projects'))
    expect(defaultCodexRoot()).toBe(fromHome.codex)
    expect(defaultCodexIndexPath()).toBe(fromHome.index)
    expect(defaultClaudeRoot()).toBe(fromHome.claude)
  })
})

describe('readCodexTitles', () => {
  it('keeps the newest name per session and skips entries without a name or an id', async () => {
    const titles = await readCodexTitles(fixture('codex/session_index.jsonl'))

    expect([...titles]).toEqual([
      ['sess-a', '化债-综合系数法测试'],
      ['sess-b', '另一个会话'],
    ])
  })

  it('keeps the newer name when the index appends an older rename and skips non-object lines', async () => {
    const root = await tempRoot('titles')
    const path = await root.write('session_index.jsonl', [
      { id: 's', thread_name: 'newer', updated_at: '2026-08-27T10:00:00.000Z' },
      { id: 's', thread_name: 'older', updated_at: '2026-08-27T09:00:00.000Z' },
      { id: 's', thread_name: 'undated' },
      [1, 2, 3],
    ])

    expect([...await readCodexTitles(path)]).toEqual([['s', 'newer']])
  })

  it('yields an empty map for a missing index', async () => {
    const root = await tempRoot('titles-missing')

    expect([...(await readCodexTitles(join(root.path, 'absent.jsonl')))]).toEqual([])
  })
})

describe('extractTitle', () => {
  it('collapses whitespace to single spaces and trims', () => {
    expect(extractTitle('  hello\n\tworld  ')).toBe('hello world')
  })

  it('keeps a title of exactly the limit and truncates a longer one', () => {
    expect(extractTitle('a'.repeat(100))).toBe('a'.repeat(100))
    expect(extractTitle('a'.repeat(101))).toBe(`${'a'.repeat(100)}…`)
  })

  it('returns empty text for a prompt without visible characters', () => {
    expect(extractTitle(' \n ')).toBe('')
  })
})

describe('listCodexSessions', () => {
  it('groups the rollout shards of one session and takes the CLI name from the index', async () => {
    const titles = await readCodexTitles(fixture('codex/session_index.jsonl'))
    const summaries = await listCodexSessions(CODEX_ROOT, titles)

    expect(summaries).toHaveLength(1)
    const summary = summaries[0]!
    expect(summary).toMatchObject({
      tool: 'codex',
      id: 'sess-a',
      title: '化债-综合系数法测试',
      cwd: 'D:\\work\\demo',
    })
    expect([...summary.sourcePaths].sort()).toEqual([ROLLOUT_A, ROLLOUT_B].sort())
    expect(summary.sizeBytes).toBe(statSync(ROLLOUT_A).size + statSync(ROLLOUT_B).size)
    const newest = Math.max(statSync(ROLLOUT_A).mtimeMs, statSync(ROLLOUT_B).mtimeMs)
    expect(Date.parse(summary.updatedAt ?? '')).toBe(Date.parse(new Date(newest).toISOString()))
  })

  it('falls back to the first real prompt for the title when the index names nothing', async () => {
    const [summary] = await listCodexSessions(CODEX_ROOT)

    expect(summary?.title).toBe('hello codex')
  })

  it('skips a rollout without session metadata even though it parses', async () => {
    const summaries = await listCodexSessions(CODEX_ROOT)

    expect(summaries.some(summary => summary.sourcePaths.includes(fixture('codex/legacy.jsonl')))).toBe(false)
  })

  it('omits the title for a session whose only prompt is whitespace and the cwd it never recorded', async () => {
    const root = await tempRoot('codex-headless')
    const plain = await root.write('sessions/plain.jsonl', [
      { type: 'session_meta', payload: { session_id: 'headless' } },
      { type: 'response_item', payload: { type: 'message', role: 'user', content: '   ' } },
    ])
    const answered = await root.write('sessions/answered.jsonl', [
      { type: 'session_meta', payload: { session_id: 'answered', cwd: 'C:\\answered' } },
      { type: 'response_item', payload: { type: 'message', role: 'assistant', content: 'no prompt yet' } },
      { type: 'response_item', payload: { type: 'message', role: 'user', content: '' } },
      { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text' }] } },
    ])
    await root.stamp(plain, new Date('2026-08-27T09:00:00.000Z'))
    await root.stamp(answered, new Date('2026-08-27T10:00:00.000Z'))

    const summaries = await listCodexSessions(join(root.path, 'sessions'))

    expect(summaries.map(summary => ({ id: summary.id, title: summary.title, cwd: summary.cwd }))).toEqual([
      { id: 'answered', title: undefined, cwd: 'C:\\answered' },
      { id: 'headless', title: undefined, cwd: undefined },
    ])
  })

  it('reads a shard head from a payload without an object and stops at the head limit', async () => {
    const root = await tempRoot('codex-heads')
    await root.write('sessions/meta-payload.jsonl', [
      { type: 'session_meta', payload: 7 },
      { type: 'response_item', payload: 7 },
      [1, 2, 3],
      { type: 'response_item', payload: { type: 'message', role: 'user', content: 42 } },
      { type: 'response_item', payload: { type: 'message', role: 'user', content: [42, { type: 'input_text', text: 'block text' }] } },
      { type: 'response_item', payload: { type: 'message', role: 'user', content: [7, { type: 'wrong' }] } },
      { type: 'session_meta', payload: { id: 'from-id-field' } },
    ])
    await root.write('sessions/overflow.jsonl', Array.from({ length: 41 }, () => ({ type: 'event_msg' })))

    const summaries = await listCodexSessions(join(root.path, 'sessions'))

    expect(summaries).toHaveLength(1)
    expect(summaries[0]).toMatchObject({ id: 'from-id-field', tool: 'codex' })
    expect(summaries[0]?.title).toBe('block text')
  })

  it('orders sessions newest first and breaks a tie by identity', async () => {
    const root = await tempRoot('codex-order')
    const stamp = new Date('2026-08-27T10:00:00.000Z')
    const same = await Promise.all([
      root.write('sessions/b.jsonl', [{ type: 'session_meta', payload: { id: 'b' } }]),
      root.write('sessions/a.jsonl', [{ type: 'session_meta', payload: { id: 'a' } }]),
      root.write('sessions/newest.jsonl', [{ type: 'session_meta', payload: { id: 'newest' } }]),
    ])
    await root.stamp(same[0], stamp)
    await root.stamp(same[1], stamp)
    await root.stamp(same[2], new Date('2026-08-27T11:00:00.000Z'))

    const summaries = await listCodexSessions(join(root.path, 'sessions'))

    expect(summaries.map(summary => summary.id)).toEqual(['newest', 'a', 'b'])
  })

  it('yields nothing for an absent root', async () => {
    const root = await tempRoot('codex-absent')

    expect(await listCodexSessions(join(root.path, 'nowhere'))).toEqual([])
  })
})

describe('listClaudeSessions', () => {
  it('lists one summary per session file with its first prompt and cwd', async () => {
    const summaries = await listClaudeSessions(CLAUDE_ROOT)

    expect(summaries).toHaveLength(1)
    const summary = summaries[0]!
    expect(summary).toMatchObject({
      tool: 'claude-code',
      id: 'claude-a',
      sourcePaths: [fixture('claude/session-a.jsonl')],
      title: '你好呀',
      cwd: 'D:\\work\\demo',
      sizeBytes: statSync(fixture('claude/session-a.jsonl')).size,
    })
    expect(typeof summary.updatedAt).toBe('string')
  })

  it('falls back to the file name and omits a title and cwd the log never recorded', async () => {
    const root = await tempRoot('claude-heads')
    await root.write('projects/nameless.jsonl', [
      { type: 'system' },
      { type: 'assistant', message: { role: 'assistant', content: 'assistant first' } },
      { type: 'user', message: { role: 'assistant', content: 'not a user prompt' } },
      { type: 'user', message: { role: 'user', content: 42 } },
      { type: 'user', message: { role: 'user', content: [7, { type: 'wrong' }, { type: 'text' }] } },
      [1, 2, 3],
      'not json',
      { type: 'user', message: { role: 'user', content: '   ' } },
      ...Array.from({ length: 41 }, () => ({ type: 'system' })),
    ])

    const summaries = await listClaudeSessions(join(root.path, 'projects'))

    expect(summaries).toHaveLength(1)
    expect(summaries[0]?.id).toBe('nameless')
    expect(summaries[0]?.title).toBeUndefined()
    expect(summaries[0]?.cwd).toBeUndefined()
  })

  it('reads a string prompt, an empty string, and blocks that carry no text', async () => {
    const root = await tempRoot('claude-prompts')
    await root.write('projects/string.jsonl', [
      { sessionId: 'string', type: 'user', message: { role: 'user', content: 'string prompt' } },
    ])
    await root.write('projects/empty.jsonl', [
      { sessionId: 'empty', type: 'user', message: { role: 'user', content: '' } },
      { type: 'user', message: { role: 'user', content: [{ type: 'wrong' }, 7, { type: 'text' }] } },
    ])
    await root.write('projects/blocks.jsonl', [
      { sessionId: 'blocks', type: 'user', message: { role: 'user', content: [7, { type: 'text' }] } },
      { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'from blocks' }] } },
    ])
    await root.write('projects/sidechain.jsonl', [
      { sessionId: 'sidechain', isSidechain: true, type: 'user', message: { role: 'user', content: 'skipped' } },
    ])

    const summaries = await listClaudeSessions(join(root.path, 'projects'))

    expect(Object.fromEntries(summaries.map(summary => [summary.id, summary.title]))).toEqual({
      blocks: 'from blocks',
      empty: undefined,
      sidechain: undefined,
      string: 'string prompt',
    })
  })
})

describe('detectForeignTool', () => {
  it.each([
    ['codex/rollout-a.jsonl', 'codex'],
    ['claude/session-a.jsonl', 'claude-code'],
    ['noise.jsonl', undefined],
  ] as const)('detects %s as %j', async (name, expected) => {
    expect(await detectForeignTool(fixture(name))).toBe(expected)
  })

  it('detects a log that only names a session id or only carries a message', async () => {
    const root = await tempRoot('detect')
    const bySessionId = await root.write('by-session-id.jsonl', [{ type: 'mystery', sessionId: 's' }])
    const byMessage = await root.write('by-message.jsonl', [{ type: 'mystery', message: { role: 'user' } }])
    const unreadable = await root.write('unreadable.jsonl', [[1, 2, 3], 'not json', { type: 'system' }])

    expect(await detectForeignTool(bySessionId)).toBe('claude-code')
    expect(await detectForeignTool(byMessage)).toBe('claude-code')
    expect(await detectForeignTool(unreadable)).toBeUndefined()
  })

  it('gives up after the head of a log that matches neither dialect', async () => {
    const root = await tempRoot('detect-overflow')
    const path = await root.write('overflow.jsonl', Array.from({ length: 41 }, () => ({ type: 'system' })))

    expect(await detectForeignTool(path)).toBeUndefined()
  })
})

describe('resolveCodexShards', () => {
  it('returns every shard of the shard\'s own logical session', async () => {
    const shards = await resolveCodexShards(ROLLOUT_A, CODEX_ROOT)

    expect(shards).toEqual([ROLLOUT_A, ROLLOUT_B])
    expect(await resolveCodexShards(ROLLOUT_B, CODEX_ROOT)).toEqual([ROLLOUT_A, ROLLOUT_B])
  })

  it('returns only the given file when no listing under the configured root contains it', async () => {
    const claude = fixture('claude/session-a.jsonl')

    expect(await resolveCodexShards(claude, CODEX_ROOT)).toEqual([claude])
  })

  it('finds the session through the roots the file\'s own location implies', async () => {
    const root = await tempRoot('codex-implied')
    const [live, archived] = await Promise.all([
      root.write('home/sessions/2026/rollout-live.jsonl', [{ type: 'session_meta', payload: { session_id: 'implied' } }]),
      root.write('home/archived_sessions/2026/rollout-old.jsonl', [{ type: 'session_meta', payload: { session_id: 'implied' } }]),
    ])

    expect(await resolveCodexShards(live, join(root.path, 'unused-root'))).toEqual([live])
    expect(await resolveCodexShards(archived, join(root.path, 'unused-root'))).toEqual([archived])
  })

  it('matches a shard path that differs only in case', async () => {
    if (process.platform !== 'win32') return

    expect(await resolveCodexShards(ROLLOUT_A.toUpperCase(), CODEX_ROOT)).toEqual([ROLLOUT_A, ROLLOUT_B])
  })
})
