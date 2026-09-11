/**
 * Intermediate representation shared by both foreign session dialects.
 *
 * A foreign log is read into {@link ForeignTranscript} first and translated into
 * dsh session events afterwards. Keeping the two steps apart lets one translator
 * serve Codex and Claude Code, and lets each parser stay a pure line reader.
 */

/** Foreign CLI whose session log a transcript was read from. */
export type ForeignTool = 'codex' | 'claude-code'

/** One human or assistant message in a foreign transcript. */
export interface ForeignMessageEntry {
  readonly kind: 'message'
  readonly role: 'user' | 'assistant'
  readonly text: string
  /** Timestamp the foreign log recorded, when it recorded one. */
  readonly at?: string
}

/** One tool call a foreign assistant message issued. */
export interface ForeignCallEntry {
  readonly kind: 'call'
  /** Foreign call id, used to pair the call with its result. */
  readonly callId: string
  /** Tool name as the foreign CLI recorded it, namespace included when given. */
  readonly name: string
  /** Raw argument payload the foreign CLI recorded, verbatim. */
  readonly arguments: string
  /** Timestamp the foreign log recorded, when it recorded one. */
  readonly at?: string
}

/** One tool result a foreign log recorded. */
export interface ForeignResultEntry {
  readonly kind: 'result'
  /** Foreign call id this result answers. */
  readonly callId: string
  /** Result text as the foreign CLI recorded it. */
  readonly output: string
  /** Timestamp the foreign log recorded, when it recorded one. */
  readonly at?: string
}

/** One conversation step read from a foreign log, in foreign order. */
export type ForeignEntry = ForeignMessageEntry | ForeignCallEntry | ForeignResultEntry

/** One foreign log line the parser could not use, with the reason why. */
export interface ForeignSkip {
  /** Why the line was dropped. */
  readonly reason: string
  /** Foreign record type or content block that was dropped, for diagnosis. */
  readonly detail?: string
}

/** A foreign conversation read into dsh-independent entries. */
export interface ForeignTranscript {
  /** Dialect the log was recognized as. */
  readonly tool: ForeignTool
  /** Foreign session identity: Codex `session_id`, Claude Code file session id. */
  readonly sessionId: string
  /** Every file the transcript was merged from, in read order. */
  readonly sourcePaths: readonly string[]
  /** Working directory the foreign session ran in, when the log recorded one. */
  readonly cwd?: string
  /** Provider the foreign CLI recorded for the conversation, when it did. */
  readonly provider?: string
  /** Model the foreign CLI recorded for the conversation, when it did. */
  readonly model?: string
  /** Rolling summary the foreign CLI kept for the conversation, when present. */
  readonly summary?: string
  /** Name the foreign CLI itself gave the conversation, when it recorded one. */
  readonly title?: string
  /** Conversation entries in foreign order, shards merged. */
  readonly entries: readonly ForeignEntry[]
  /** Lines the parser skipped, in read order. */
  readonly skipped: readonly ForeignSkip[]
}

/** One importable foreign session as the picker and `/import list` show it. */
export interface ForeignSessionSummary {
  /** Dialect the session belongs to. */
  readonly tool: ForeignTool
  /** Foreign session identity. */
  readonly id: string
  /** Every file the logical session spans, in read order. */
  readonly sourcePaths: readonly string[]
  /** Display title: the CLI's own name for the conversation, else its first prompt. */
  readonly title?: string
  /** Last time the foreign CLI touched the session, when it recorded one. */
  readonly updatedAt?: string
  /** Working directory the foreign session ran in, when the log recorded one. */
  readonly cwd?: string
  /** Total size of every file the logical session spans. */
  readonly sizeBytes: number
}
