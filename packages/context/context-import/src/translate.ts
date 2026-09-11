/**
 * Translation of a foreign transcript into a contiguous dsh session seed.
 *
 * The seed replays as if dsh had produced the conversation itself: closed
 * turn/step brackets, surface-marked messages, paired tool calls and results,
 * and one request header carrying the foreign route identity. Everything the
 * foreign log recorded that cannot be paired or rendered is reported through
 * {@link TranslatedTranscript.dropped} instead of being silently invented.
 *
 * @module @deepseek-ai/dsh-context-import/translate
 */

import {
  ToolCallId,
  createAssistantMessage,
  createToolResultMessage,
  createUserMessage,
  type ContentBlock,
  type ToolCallBlock,
} from '@deepseek-ai/dsh-llm'
import { SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { ForeignCallEntry, ForeignEntry, ForeignTranscript } from './types.ts'

/**
 * One conversation element the translation could not turn into a seed event.
 *
 * Unpaired calls and orphan results are expected in an interrupted foreign
 * session; reporting them keeps an import honest about what it left out.
 */
export interface ForeignDrop {
  /** What was dropped. */
  readonly kind: 'call' | 'result'
  /** Foreign call id the element carried. */
  readonly callId: string
  /** Why the element could not enter the seed. */
  readonly reason: string
}

/** A translated foreign conversation: the dsh seed and the elements left out. */
export interface TranslatedTranscript {
  /** Contiguous session events from seq 0, with every bracket closed. */
  readonly events: readonly SessionEvent[]
  /** Conversation elements the translation left out. */
  readonly dropped: readonly ForeignDrop[]
}

/**
 * Translate a foreign transcript into a dsh session seed.
 *
 * One foreign round — a user message up to the next one — becomes one turn
 * with one step. A tool call enters the assistant message's content as a
 * `tool-call` block and is repeated as a `tool/call` event, mirroring what the
 * agent loop records for its own conversations.
 *
 * @param transcript - Transcript read from the foreign log.
 * @returns The seed events and every element that was dropped.
 */
export function translateTranscript(transcript: ForeignTranscript): TranslatedTranscript {
  const events: SessionEvent[] = []
  const dropped: ForeignDrop[] = []
  const provider = transcript.provider ?? transcript.tool
  const model = transcript.model ?? 'imported'
  let seq = 0
  let time = 0

  /** Advance the seed clock, keeping times non-decreasing and integral. */
  const stamp = (at: string | undefined): number => {
    const parsed = at === undefined ? Number.NaN : Date.parse(at)
    time = Number.isSafeInteger(parsed) && parsed > time ? parsed : time + 1
    return time
  }

  /** Append one event with the next sequence number and time. */
  const emit = (
    event: { type: SessionEvent['type']; data: unknown; surfaceOp?: 'append' },
    at: string | undefined,
  ): void => {
    // The mapped `SessionEvent` union cannot be rebuilt generically from a
    // widened `type`/`data` pair, so the assembled event is asserted once here.
    events.push({ ...event, seq: SessionSeq(seq), time: stamp(at) } as SessionEvent)
    seq += 1
  }

  const rounds = splitRounds(transcript.entries)
  for (const [index, round] of rounds.entries()) {
    const turn = index + 1
    const step = 1
    const at = round[0]?.at
    emit({ type: 'turn/start', data: { turn } }, at)
    emit({ type: 'step/start', data: { turn, step } }, at)

    const opener = round[0]
    if (opener !== undefined && opener.kind === 'message' && opener.role === 'user') {
      emit({
        type: 'user/message',
        data: {
          message: createUserMessage({ content: [{ type: 'text', text: opener.text }], source: { kind: 'user' } }),
        },
        surfaceOp: 'append',
      }, at)
    }
    if (index === 0) {
      emit({ type: 'request/header', data: { header: { config: { provider, model } }, reason: 'initial' } }, at)
    }

    const calls = new Map<string, ForeignCallEntry>()
    for (const entry of round) {
      if (entry.kind === 'call') calls.set(entry.callId, entry)
    }
    const answered = new Set<string>()
    for (const entry of round) {
      if (entry.kind === 'result' && calls.has(entry.callId)) answered.add(entry.callId)
    }
    const attached = attachCalls(round, answered)

    const emittedCalls = new Set<string>()
    for (const [position, entry] of round.entries()) {
      switch (entry.kind) {
        case 'message': {
          if (entry.role === 'user') break
          const content: ContentBlock[] = []
          if (entry.text !== '') content.push({ type: 'text', text: entry.text })
          content.push(...attached.get(position) ?? [])
          if (content.length === 0) break
          emit({
            type: 'assistant/message',
            data: {
              turn,
              step,
              message: createAssistantMessage({ content, source: { provider, model } }),
              stream: [],
            },
            surfaceOp: 'append',
          }, entry.at)
          break
        }
        case 'call': {
          if (!answered.has(entry.callId)) {
            dropped.push({ kind: 'call', callId: entry.callId, reason: 'tool call has no result in its round' })
            break
          }
          emittedCalls.add(entry.callId)
          emit({
            type: 'tool/call',
            data: { turn, step, callId: ToolCallId(entry.callId), name: entry.name, arguments: entry.arguments },
          }, entry.at)
          break
        }
        case 'result': {
          if (!calls.has(entry.callId)) {
            dropped.push({ kind: 'result', callId: entry.callId, reason: 'tool result has no call in its round' })
            break
          }
          if (!emittedCalls.has(entry.callId)) {
            dropped.push({ kind: 'result', callId: entry.callId, reason: 'tool result precedes its call' })
            break
          }
          emit({
            type: 'tool/result',
            data: {
              turn,
              step,
              message: createToolResultMessage({
                callId: ToolCallId(entry.callId),
                content: [{ type: 'text', text: entry.output }],
                isError: false,
              }),
            },
            surfaceOp: 'append',
          }, entry.at)
          break
        }
      }
    }

    emit({ type: 'step/end', data: { turn, step } }, at)
    emit({ type: 'turn/end', data: { turn, reason: { kind: 'completed' } } }, at)
  }

  return { events, dropped }
}

/**
 * Split foreign entries into rounds: a user message opens one, the next closes it.
 * @param entries - Transcript entries in foreign order.
 * @returns Rounds in order; entries before the first user message form the first round.
 */
function splitRounds(entries: readonly ForeignEntry[]): ForeignEntry[][] {
  const rounds: ForeignEntry[][] = []
  for (const entry of entries) {
    if (entry.kind === 'message' && entry.role === 'user') rounds.push([entry])
    else if (rounds.length === 0) rounds.push([entry])
    else rounds[rounds.length - 1]?.push(entry)
  }
  return rounds
}

/**
 * Attach each answered call to the assistant message that issued it.
 *
 * A call the foreign log never answered is left unattached: the walk reports
 * it once as a drop, so it is absent from both the message content and the
 * `tool/call` records.
 *
 * @param round - Entries of one round.
 * @param answered - Call ids that carry a result in this round.
 * @returns `tool-call` blocks by the assistant message's position in `round`.
 */
function attachCalls(
  round: readonly ForeignEntry[],
  answered: ReadonlySet<string>,
): Map<number, ToolCallBlock[]> {
  const attached = new Map<number, ToolCallBlock[]>()
  let owner: number | undefined
  for (const [position, entry] of round.entries()) {
    if (entry.kind === 'message' && entry.role === 'assistant') {
      owner = position
      continue
    }
    if (entry.kind !== 'call' || owner === undefined || !answered.has(entry.callId)) continue
    const blocks = attached.get(owner) ?? []
    blocks.push({
      type: 'tool-call',
      id: ToolCallId(entry.callId),
      name: entry.name,
      arguments: entry.arguments,
    })
    attached.set(owner, blocks)
  }
  return attached
}
