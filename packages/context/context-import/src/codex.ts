import { basename } from 'node:path'
import { asRecord, readJsonLines, stringField } from './jsonl.ts'
import type { ForeignEntry, ForeignSkip, ForeignTranscript } from './types.ts'

/**
 * Top-level Codex record types that duplicate or annotate the conversation
 * without carrying a message, a call, or a result. They are stepped over
 * without a skip record: a long rollout repeats them tens of thousands of
 * times, and a skip entry per occurrence would bury the real skips.
 */
const ANNOTATION_TYPES = new Set([
  'event_msg',
  'token_usage_record',
  'world_state',
])

/**
 * Codex injects environment and instruction preludes as user-role text. They
 * are machine context rather than conversation, so an import must not replay
 * them as something the person said.
 */
const SYNTHETIC_USER_PREFIXES = [
  '<app-context>',
  '<environment_context>',
  '<heartbeat>',
  '<image>',
  '<recommended_plugins>',
  '<turn_aborted>',
  '<turn_context>',
  '<user_instructions>',
]

/**
 * Report whether Codex user-role text is injected machine context.
 * @param text - Text of a user-role Codex message.
 * @returns True when the text is a known Codex prelude rather than something the person wrote.
 */
export function isSyntheticUserText(text: string): boolean {
  return SYNTHETIC_USER_PREFIXES.some(prefix => text.startsWith(prefix))
}

/**
 * Parse the Codex rollout shards that make up one logical session.
 *
 * A logical Codex session spans several rollout files that share one
 * `session_id`: compaction, resume, and fork each open a new file while
 * repeating history. Shards are read in the order given and merged by payload
 * id, so an item written twice is translated once.
 *
 * @param sourcePaths - Rollout files of one logical session, in read order.
 * @returns The merged transcript, including the lines that were skipped and why.
 */
export async function parseCodexSession(sourcePaths: readonly string[]): Promise<ForeignTranscript> {
  const entries: ForeignEntry[] = []
  const skipped: ForeignSkip[] = []
  const seen = new Set<string>()
  let sessionId = ''
  let cwd: string | undefined
  let provider: string | undefined
  let model: string | undefined
  let summary: string | undefined

  for (const sourcePath of sourcePaths) {
    await readJsonLines(sourcePath, {
      visit: (value, line) => {
        const record = asRecord(value)
        if (record === undefined) {
          skipped.push({ reason: 'line is not a JSON object', detail: `${basename(sourcePath)}:${line}` })
          return
        }
        const type = stringField(record, 'type')
        if (type === 'session_meta') {
          const payload = asRecord(record.payload) ?? {}
          sessionId = stringField(payload, 'session_id') ?? stringField(payload, 'id') ?? sessionId
          cwd = stringField(payload, 'cwd') ?? cwd
          provider = stringField(payload, 'model_provider') ?? provider
          return
        }
        if (type === 'turn_context') {
          model = stringField(asRecord(record.payload) ?? {}, 'model') ?? model
          return
        }
        if (type === 'compacted') {
          const message = stringField(asRecord(record.payload) ?? {}, 'message')
          if (message !== undefined) summary = message
          skipped.push({ reason: 'compaction replacement history', detail: 'compacted' })
          return
        }
        if (type === undefined || ANNOTATION_TYPES.has(type)) return
        if (type !== 'response_item') {
          skipped.push({ reason: 'unknown record type', detail: type })
          return
        }
        const payload = asRecord(record.payload)
        if (payload === undefined) {
          skipped.push({ reason: 'response_item without payload', detail: `${basename(sourcePath)}:${line}` })
          return
        }
        const id = stringField(payload, 'id')
        if (id !== undefined) {
          if (seen.has(id)) return
          seen.add(id)
        }
        translatePayload(payload, stringField(record, 'timestamp'), entries, skipped)
      },
      onMalformed: (line) => {
        skipped.push({ reason: 'malformed JSON line', detail: `${basename(sourcePath)}:${line}` })
      },
    })
  }

  return {
    tool: 'codex',
    sessionId,
    sourcePaths,
    ...(cwd === undefined ? {} : { cwd }),
    ...(provider === undefined ? {} : { provider }),
    ...(model === undefined ? {} : { model }),
    ...(summary === undefined ? {} : { summary }),
    entries,
    skipped,
  }
}

/**
 * Translate one Codex `response_item` payload into conversation entries.
 * @param payload - The record's `payload` object.
 * @param at - Timestamp the surrounding record carried, when it carried one.
 * @param entries - Transcript entries appended to, in foreign order.
 * @param skipped - Skip records appended to for content that does not survive.
 */
function translatePayload(
  payload: Record<string, unknown>,
  at: string | undefined,
  entries: ForeignEntry[],
  skipped: ForeignSkip[],
): void {
  const type = stringField(payload, 'type')
  switch (type) {
    case 'message': {
      const role = stringField(payload, 'role')
      if (role !== 'user' && role !== 'assistant') {
        skipped.push({ reason: 'non-conversation role', detail: role ?? 'unknown role' })
        return
      }
      const text = messageText(payload.content, skipped)
      if (text === undefined) return
      if (role === 'user' && SYNTHETIC_USER_PREFIXES.some(prefix => text.startsWith(prefix))) {
        skipped.push({ reason: 'injected user prelude', detail: text.slice(0, 40) })
        return
      }
      entries.push({ kind: 'message', role, text, ...(at === undefined ? {} : { at }) })
      return
    }
    case 'function_call':
    case 'custom_tool_call': {
      const callId = stringField(payload, 'call_id')
      const name = stringField(payload, 'name')
      if (callId === undefined || name === undefined) {
        skipped.push({ reason: 'tool call without call_id or name', detail: type })
        return
      }
      const namespace = stringField(payload, 'namespace')
      const input = stringField(payload, 'arguments') ?? stringField(payload, 'input') ?? ''
      entries.push({
        kind: 'call',
        callId,
        name: namespace === undefined ? name : `${namespace}.${name}`,
        arguments: input,
        ...(at === undefined ? {} : { at }),
      })
      return
    }
    case 'function_call_output':
    case 'custom_tool_call_output': {
      const callId = stringField(payload, 'call_id')
      if (callId === undefined) {
        skipped.push({ reason: 'tool result without call_id', detail: type })
        return
      }
      const output = outputText(payload.output)
      entries.push({
        kind: 'result',
        callId,
        output: output ?? '',
        ...(at === undefined ? {} : { at }),
      })
      return
    }
    case 'reasoning':
      skipped.push({ reason: 'thinking transcript', detail: 'reasoning' })
      return
    default:
      skipped.push({ reason: 'unknown response item', detail: type ?? 'untyped' })
  }
}

/**
 * Join the text blocks of a Codex message.
 * @param content - The message's `content` value: an array of typed blocks or a plain string.
 * @param skipped - Skip records appended to for blocks that are not text.
 * @returns The joined text, or `undefined` when the message carried no text.
 */
function messageText(content: unknown, skipped: ForeignSkip[]): string | undefined {
  if (typeof content === 'string') return content === '' ? undefined : content
  if (!Array.isArray(content)) return undefined
  const parts: string[] = []
  for (const block of content) {
    const record = asRecord(block)
    const type = record === undefined ? undefined : stringField(record, 'type')
    if (type === 'input_text' || type === 'output_text' || type === 'text') {
      /* v8 ignore next -- `record` is defined whenever `type` names a text block */
      const text = stringField(record ?? {}, 'text')
      if (text !== undefined) parts.push(text)
      continue
    }
    skipped.push({ reason: 'non-text content block', detail: type ?? 'untyped block' })
  }
  return parts.length === 0 ? undefined : parts.join('\n')
}

/**
 * Read a Codex tool result payload as text.
 * @param output - The result record's `output` value.
 * @returns The output when it is a string, otherwise its JSON rendering.
 */
function outputText(output: unknown): string | undefined {
  if (typeof output === 'string') return output
  if (output === undefined || output === null) return undefined
  return JSON.stringify(output)
}
