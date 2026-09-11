import { basename } from 'node:path'
import { asRecord, readJsonLines, stringField } from './jsonl.ts'
import type { ForeignEntry, ForeignSkip, ForeignTranscript } from './types.ts'

/**
 * Claude Code record types that record CLI state, hooks, or prompt bookkeeping
 * rather than conversation.
 */
const ANNOTATION_TYPES = new Set([
  'atis-latch',
  'attachment',
  'custom-title',
  'file-history-snapshot',
  'last-prompt',
  'mode',
  'permission-mode',
  'queue-operation',
  'system',
])

/**
 * Parse one Claude Code session log.
 *
 * Claude Code writes one file per session under
 * `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`, in conversation
 * order. A tool result arrives in the *following* user record as a
 * `tool_result` block, which this parser keeps as its own entry so the
 * translator can pair it with the call by id.
 *
 * @param sourcePath - The session file to read.
 * @returns The transcript, including the lines that were skipped and why.
 */
export async function parseClaudeSession(sourcePath: string): Promise<ForeignTranscript> {
  const entries: ForeignEntry[] = []
  const skipped: ForeignSkip[] = []
  let sessionId = ''
  let cwd: string | undefined
  let model: string | undefined
  let title: string | undefined
  let summary: string | undefined

  await readJsonLines(sourcePath, {
    visit: (value, line) => {
      const record = asRecord(value)
      if (record === undefined) {
        skipped.push({ reason: 'line is not a JSON object', detail: `${basename(sourcePath)}:${line}` })
        return
      }
      const type = stringField(record, 'type')
      sessionId = stringField(record, 'sessionId') ?? sessionId
      cwd = stringField(record, 'cwd') ?? cwd
      if (type === 'custom-title') {
        title = stringField(record, 'customTitle') ?? title
        return
      }
      if (type === 'summary') {
        summary = stringField(record, 'summary') ?? summary
        return
      }
      if (type === undefined || ANNOTATION_TYPES.has(type)) return
      if (type !== 'user' && type !== 'assistant') {
        skipped.push({ reason: 'unknown record type', detail: type })
        return
      }
      if (record.isSidechain === true) {
        skipped.push({ reason: 'side chain', detail: type })
        return
      }
      const message = asRecord(record.message)
      if (message === undefined) {
        skipped.push({ reason: 'record without message', detail: type })
        return
      }
      model = stringField(message, 'model') ?? model
      translateMessage(message, stringField(record, 'timestamp'), entries, skipped)
    },
    onMalformed: (line) => {
      skipped.push({ reason: 'malformed JSON line', detail: `${basename(sourcePath)}:${line}` })
    },
  })

  return {
    tool: 'claude-code',
    sessionId: sessionId === '' ? basename(sourcePath, '.jsonl') : sessionId,
    sourcePaths: [sourcePath],
    ...(cwd === undefined ? {} : { cwd }),
    ...(model === undefined ? {} : { model }),
    ...(summary === undefined ? {} : { summary }),
    ...(title === undefined ? {} : { title }),
    entries,
    skipped,
  }
}

/**
 * Translate one Claude Code message into conversation entries.
 * @param message - The record's `message` object.
 * @param at - Timestamp the surrounding record carried, when it carried one.
 * @param entries - Transcript entries appended to, in foreign order.
 * @param skipped - Skip records appended to for content that does not survive.
 */
function translateMessage(
  message: Record<string, unknown>,
  at: string | undefined,
  entries: ForeignEntry[],
  skipped: ForeignSkip[],
): void {
  const role = stringField(message, 'role') === 'assistant' ? 'assistant' : 'user'
  const content = message.content
  if (typeof content === 'string') {
    if (content !== '') entries.push({ kind: 'message', role, text: content, ...(at === undefined ? {} : { at }) })
    return
  }
  if (!Array.isArray(content)) {
    skipped.push({ reason: 'message without content', detail: role })
    return
  }
  for (const block of content) {
    const record = asRecord(block)
    const type = record === undefined ? undefined : stringField(record, 'type')
    switch (type) {
      case 'text': {
        /* v8 ignore next -- `record` is defined whenever `type` is 'text' */
        const text = stringField(record ?? {}, 'text')
        if (text === undefined) break
        entries.push({ kind: 'message', role, text, ...(at === undefined ? {} : { at }) })
        break
      }
      case 'tool_use': {
        /* v8 ignore next -- `record` is defined whenever `type` is 'tool_use' */
        const callId = stringField(record ?? {}, 'id')
        /* v8 ignore next -- `record` is defined whenever `type` is 'tool_use' */
        const name = stringField(record ?? {}, 'name')
        if (callId === undefined || name === undefined) {
          skipped.push({ reason: 'tool call without id or name', detail: 'tool_use' })
          break
        }
        entries.push({
          kind: 'call',
          callId,
          name,
          arguments: JSON.stringify(record?.input ?? {}),
          ...(at === undefined ? {} : { at }),
        })
        break
      }
      case 'tool_result': {
        /* v8 ignore next -- `record` is defined whenever `type` is 'tool_result' */
        const callId = stringField(record ?? {}, 'tool_use_id')
        if (callId === undefined) {
          skipped.push({ reason: 'tool result without tool_use_id', detail: 'tool_result' })
          break
        }
        entries.push({
          kind: 'result',
          callId,
          output: resultText(record?.content) ?? '',
          ...(at === undefined ? {} : { at }),
        })
        break
      }
      case 'thinking':
        skipped.push({ reason: 'thinking transcript', detail: 'thinking' })
        break
      case 'image':
        skipped.push({ reason: 'non-text content block', detail: 'image' })
        break
      default:
        skipped.push({ reason: 'unknown content block', detail: type ?? 'untyped block' })
    }
  }
}

/**
 * Read a Claude Code tool result body as text.
 * @param content - The `tool_result` block's `content`: a string or typed blocks.
 * @returns The text the block carried, or `undefined` for a body without text.
 */
function resultText(content: unknown): string | undefined {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return undefined
  const parts: string[] = []
  for (const block of content) {
    const record = asRecord(block)
    if (record === undefined) continue
    const text = stringField(record, 'text')
    if (text !== undefined) parts.push(text)
  }
  return parts.length === 0 ? undefined : parts.join('\n')
}
