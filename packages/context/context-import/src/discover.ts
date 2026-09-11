import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { isSyntheticUserText } from './codex.ts'
import { asRecord, readJsonLines, stringField } from './jsonl.ts'
import type { ForeignSessionSummary, ForeignTool } from './types.ts'

/**
 * Lines read from a foreign log head when listing sessions. Foreign logs reach
 * gigabytes, so a listing reads just enough of each file to identify the
 * session and title it.
 */
const HEAD_LINES = 40

/** Longest title a listing keeps from a foreign prompt. */
const TITLE_LIMIT = 100

/**
 * Map a user-supplied source name to the dialect it selects.
 * @param source - Source name from the command line or the dialog.
 * @returns The dialect, or `undefined` when the name selects no dialect.
 */
export function canonicalTool(source: string): ForeignTool | undefined {
  switch (source.trim().toLowerCase()) {
    case 'codex':
      return 'codex'
    case 'claude':
    case 'claude-code':
      return 'claude-code'
    default:
      return undefined
  }
}

/**
 * Codex session root: `$CODEX_HOME/sessions`, else `~/.codex/sessions`.
 * @returns Absolute path of the Codex session root.
 */
export function defaultCodexRoot(): string {
  const home = process.env.CODEX_HOME
  return home === undefined || home === '' ? join(homedir(), '.codex', 'sessions') : join(home, 'sessions')
}

/**
 * Codex session index that carries the CLI's own conversation names.
 * @returns Absolute path of `session_index.jsonl`.
 */
export function defaultCodexIndexPath(): string {
  const home = process.env.CODEX_HOME
  return home === undefined || home === ''
    ? join(homedir(), '.codex', 'session_index.jsonl')
    : join(home, 'session_index.jsonl')
}

/**
 * Claude Code project root: `$CLAUDE_CONFIG_DIR/projects`, else `~/.claude/projects`.
 * @returns Absolute path of the Claude Code project root.
 */
export function defaultClaudeRoot(): string {
  const home = process.env.CLAUDE_CONFIG_DIR
  return home === undefined || home === ''
    ? join(homedir(), '.claude', 'projects')
    : join(home, 'projects')
}

/**
 * Read the names Codex itself gave its conversations.
 *
 * The index appends one row per rename, so the newest `updated_at` per id wins.
 *
 * @param indexPath - Path of `session_index.jsonl`.
 * @returns Conversation titles by Codex session id; empty when the index is absent.
 */
export async function readCodexTitles(indexPath: string): Promise<Map<string, string>> {
  const titles = new Map<string, string>()
  const updated = new Map<string, string>()
  try {
    await readJsonLines(indexPath, {
      visit: (value) => {
        const record = asRecord(value)
        if (record === undefined) return
        const id = stringField(record, 'id')
        const title = stringField(record, 'thread_name')
        if (id === undefined || title === undefined) return
        const at = stringField(record, 'updated_at') ?? ''
        if (at >= (updated.get(id) ?? '')) {
          updated.set(id, at)
          titles.set(id, title)
        }
      },
      onMalformed: () => {},
    })
  } catch {
    // The index is an optional convenience: Codex installations without it
    // still list and import sessions using the fallback prompt title.
    return titles
  }
  return titles
}

/** One file discovered under a foreign root, with the facts a listing needs. */
interface ForeignFile {
  /** Absolute path of the session file. */
  readonly path: string
  /** Size in bytes. */
  readonly sizeBytes: number
  /** Last modification time as an ISO string. */
  readonly updatedAt: string
}

/**
 * List every regular file under a root, recursively.
 * @param root - Directory to walk.
 * @returns The files found; an unreadable or absent root yields an empty list.
 */
async function walkJsonl(root: string): Promise<ForeignFile[]> {
  const found: ForeignFile[] = []
  const visit = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        await visit(path)
        continue
      }
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue
      const info = await stat(path)
      found.push({ path, sizeBytes: info.size, updatedAt: info.mtime.toISOString() })
    }
  }
  try {
    await visit(root)
  } catch {
    // A missing foreign root is a normal deployment state: the tool is simply
    // not installed, and the listing stays empty rather than failing the command.
    return []
  }
  return found
}

/**
 * Read the head of a Codex rollout file: session identity plus a fallback title.
 * @param path - Rollout file to read.
 * @returns Session id, working directory, and the first real user prompt.
 */
async function codexHead(path: string): Promise<{ id?: string; cwd?: string; prompt?: string }> {
  let id: string | undefined
  let cwd: string | undefined
  let prompt: string | undefined
  let lines = 0
  await readJsonLines(path, {
    visit: (value) => {
      lines += 1
      const record = asRecord(value)
      if (record === undefined) return
      const type = stringField(record, 'type')
      if (type === 'session_meta') {
        const payload = asRecord(record.payload) ?? {}
        id = stringField(payload, 'session_id') ?? stringField(payload, 'id') ?? id
        cwd = stringField(payload, 'cwd') ?? cwd
        return
      }
      if (type !== 'response_item' || prompt !== undefined) return
      const payload = asRecord(record.payload) ?? {}
      if (payload.type !== 'message' || payload.role !== 'user') return
      const text = messageText(payload.content)
      if (text !== undefined && !isSyntheticUserText(text)) prompt = text
    },
    onMalformed: () => {},
    stop: () => (id !== undefined && prompt !== undefined) || lines >= HEAD_LINES,
  })
  return {
    ...(id === undefined ? {} : { id }),
    ...(cwd === undefined ? {} : { cwd }),
    ...(prompt === undefined ? {} : { prompt }),
  }
}

/**
 * Join the text blocks of a Codex message while listing.
 * @param content - The message's `content` value.
 * @returns The joined text, or `undefined` when the message carried no text.
 */
function messageText(content: unknown): string | undefined {
  if (typeof content === 'string') return content === '' ? undefined : content
  if (!Array.isArray(content)) return undefined
  const parts: string[] = []
  for (const block of content) {
    const record = asRecord(block)
    if (record === undefined) continue
    const type = stringField(record, 'type')
    if (type !== 'input_text' && type !== 'output_text' && type !== 'text') continue
    const text = stringField(record, 'text')
    if (text !== undefined) parts.push(text)
  }
  return parts.length === 0 ? undefined : parts.join('\n')
}

/**
 * Read the head of a Claude Code session file: working directory and first prompt.
 * @param path - Session file to read.
 * @returns Working directory, session id, and the first user prompt.
 */
async function claudeHead(path: string): Promise<{ id?: string; cwd?: string; prompt?: string }> {
  let id: string | undefined
  let cwd: string | undefined
  let prompt: string | undefined
  let lines = 0
  await readJsonLines(path, {
    visit: (value) => {
      lines += 1
      const record = asRecord(value)
      if (record === undefined) return
      id = stringField(record, 'sessionId') ?? id
      cwd = stringField(record, 'cwd') ?? cwd
      if (prompt !== undefined || record.isSidechain === true) return
      if (stringField(record, 'type') !== 'user') return
      const message = asRecord(record.message)
      if (message === undefined || message.role !== 'user') return
      const content = message.content
      if (typeof content === 'string') {
        if (content !== '') prompt = content
        return
      }
      if (!Array.isArray(content)) return
      for (const block of content) {
        const blockRecord = asRecord(block)
        if (blockRecord === undefined || stringField(blockRecord, 'type') !== 'text') continue
        const text = stringField(blockRecord, 'text')
        if (text !== undefined) {
          prompt = text
          break
        }
      }
    },
    onMalformed: () => {},
    stop: () => (cwd !== undefined && prompt !== undefined) || lines >= HEAD_LINES,
  })
  return {
    ...(id === undefined ? {} : { id }),
    ...(cwd === undefined ? {} : { cwd }),
    ...(prompt === undefined ? {} : { prompt }),
  }
}

/**
 * Shorten foreign prompt text into a one-line title.
 * @param text - Raw foreign prompt text.
 * @returns Collapsed, truncated text; empty when the prompt had no visible characters.
 */
export function extractTitle(text: string): string {
  const collapsed = text.replace(/\s+/gu, ' ').trim()
  return collapsed.length <= TITLE_LIMIT ? collapsed : `${collapsed.slice(0, TITLE_LIMIT)}…`
}

/**
 * List the logical Codex sessions under a root.
 *
 * A logical session spans every rollout file that shares one `session_id`;
 * their sizes are summed and the newest file mtime dates the session.
 *
 * @param root - Codex session root.
 * @param titles - Names Codex itself gave its conversations, by session id.
 * @returns One summary per logical session, newest first.
 */
export async function listCodexSessions(
  root: string,
  titles: ReadonlyMap<string, string> = new Map(),
): Promise<ForeignSessionSummary[]> {
  const files = await walkJsonl(root)
  const byId = new Map<string, {
    paths: string[]
    sizeBytes: number
    updatedAt: string
    cwd?: string | undefined
    prompt?: string | undefined
  }>()
  for (const file of files) {
    const head = await codexHead(file.path)
    if (head.id === undefined) continue
    const entry = byId.get(head.id) ?? { paths: [], sizeBytes: 0, updatedAt: file.updatedAt }
    entry.paths.push(file.path)
    entry.sizeBytes += file.sizeBytes
    if (file.updatedAt > entry.updatedAt) entry.updatedAt = file.updatedAt
    entry.cwd ??= head.cwd
    entry.prompt ??= head.prompt
    byId.set(head.id, entry)
  }
  const summaries: ForeignSessionSummary[] = []
  for (const [id, entry] of byId) {
    const title = titles.get(id) ?? (entry.prompt === undefined ? undefined : extractTitle(entry.prompt))
    summaries.push({
      tool: 'codex',
      id,
      sourcePaths: entry.paths.sort(),
      ...(title === undefined || title === '' ? {} : { title }),
      updatedAt: entry.updatedAt,
      ...(entry.cwd === undefined ? {} : { cwd: entry.cwd }),
      sizeBytes: entry.sizeBytes,
    })
  }
  return sortSummaries(summaries)
}

/**
 * List the Claude Code sessions under a root.
 * @param root - Claude Code project root, holding one directory per working directory.
 * @returns One summary per session file, newest first.
 */
export async function listClaudeSessions(root: string): Promise<ForeignSessionSummary[]> {
  const files = await walkJsonl(root)
  const summaries: ForeignSessionSummary[] = []
  for (const file of files) {
    const head = await claudeHead(file.path)
    const id = head.id ?? basename(file.path, '.jsonl')
    const title = head.prompt === undefined ? undefined : extractTitle(head.prompt)
    summaries.push({
      tool: 'claude-code',
      id,
      sourcePaths: [file.path],
      ...(title === undefined || title === '' ? {} : { title }),
      updatedAt: file.updatedAt,
      ...(head.cwd === undefined ? {} : { cwd: head.cwd }),
      sizeBytes: file.sizeBytes,
    })
  }
  return sortSummaries(summaries)
}

/**
 * Order a listing newest first, breaking ties by identity.
 * @param summaries - Summaries to order.
 * @returns A new ordering of the same summaries.
 */
function sortSummaries(summaries: ForeignSessionSummary[]): ForeignSessionSummary[] {
  return summaries.sort((left, right) => {
    /* v8 ignore next -- both listings date every summary from a file mtime */
    const at = left.updatedAt ?? ''
    /* v8 ignore next -- both listings date every summary from a file mtime */
    const bt = right.updatedAt ?? ''
    return at === bt ? left.id.localeCompare(right.id) : bt.localeCompare(at)
  })
}

/**
 * Detect which foreign dialect wrote a session log.
 * @param sourcePath - Session file to read.
 * @returns The dialect, or `undefined` when the head matches neither.
 */
export async function detectForeignTool(sourcePath: string): Promise<ForeignTool | undefined> {
  let tool: ForeignTool | undefined
  let lines = 0
  await readJsonLines(sourcePath, {
    visit: (value) => {
      lines += 1
      const record = asRecord(value)
      if (record === undefined) return
      const type = stringField(record, 'type')
      if (type === 'session_meta' || type === 'response_item') tool = 'codex'
      else if (stringField(record, 'sessionId') !== undefined || asRecord(record.message) !== undefined) tool = 'claude-code'
    },
    onMalformed: () => {},
    stop: () => tool !== undefined || lines >= HEAD_LINES,
  })
  return tool
}

/**
 * Resolve every rollout file of the logical Codex session one file belongs to.
 *
 * Shards are found by listing the roots implied by the file's own location
 * first, then the configured root, and matching the file against the logical
 * session it was grouped into.
 *
 * @param sourcePath - Any rollout file of the session.
 * @param codexRoot - Configured Codex session root.
 * @returns The session's rollout files in read order; the file alone when no listing matches it.
 */
export async function resolveCodexShards(sourcePath: string, codexRoot: string): Promise<string[]> {
  const target = normalizePath(sourcePath)
  const roots = new Set([...impliedCodexRoots(sourcePath), codexRoot])
  for (const root of roots) {
    const summaries = await listCodexSessions(root)
    const found = summaries.find(summary => summary.sourcePaths.some(path => normalizePath(path) === target))
    if (found !== undefined) return [...found.sourcePaths]
  }
  return [sourcePath]
}

/**
 * Compare two paths as the same file on a case-insensitive platform.
 * @param path - Path to normalize.
 * @returns The resolved path in a single case.
 */
function normalizePath(path: string): string {
  return resolve(path).toLowerCase()
}

/**
 * Derive the Codex roots one session file's location implies.
 * @param sourcePath - Any rollout file.
 * @returns `sessions` and `archived_sessions` roots under the same home; empty when the file sits outside either.
 */
function impliedCodexRoots(sourcePath: string): string[] {
  let current = dirname(resolve(sourcePath))
  for (;;) {
    const base = basename(current)
    if (base === 'sessions' || base === 'archived_sessions') {
      const home = dirname(current)
      return [join(home, 'sessions'), join(home, 'archived_sessions')]
    }
    const parent = dirname(current)
    if (parent === current) return []
    current = parent
  }
}
