# Context Import

English | [中文](context-import.zh.md)

`ctx.contextImport` reads Codex and Claude Code session logs, translates one conversation into a dsh session seed, and either publishes a new session seeded with that history or appends a reduced rendering of it to the session you are already in. `/import` is the human entry point over the same service, and the Web import dialog reads its listing. The [package README](../../packages/context/context-import/README.md) owns the mount configuration, the root defaults, and the per-dialect parsing rules.

Sources: [`packages/context/context-import/src/index.ts`](../../packages/context/context-import/src/index.ts) · [`src/types.ts`](../../packages/context/context-import/src/types.ts) · [`src/translate.ts`](../../packages/context/context-import/src/translate.ts)

## Service operations

`list()` returns one summary per importable foreign session across both configured roots, newest first, so a picker and `/import list` render the same rows. `parse(sourcePath, tool?)` reads one session and returns its transcript, the translated seed events, and the conversation elements the translation left out; when `tool` is omitted, the dialect is detected from the head of the log. It throws when the file matches neither dialect or carries no conversation.

`importNewSession({ sourcePath, sessionId, cwd })` publishes the translated seed through `ctx.agents.create`, so the seeded session persists, resumes, forks, and renders like any other. `injectIntoCurrent({ agent, sourcePath })` appends one reduced rendering to the receiving agent's session instead of creating one: the foreign summary or title first when the log recorded one, then one `- <role>: <title>` line per message before the tail, then the last `injectTailMessages` messages verbatim as `<role>: <text>`. A transcript that carries no text injects nothing. The generated Cordis API region at the end of this page carries every operation's exact signature and source JSDoc.

## Foreign sessions

`ForeignTool` names the dialect a log is read as. A logical Codex session spans every rollout file that shares one `session_id`, so one summary covers all of a session's shards and its `sizeBytes` is their total.

```ts type-equiv
/** Foreign CLI whose session log a transcript was read from. */
type ForeignTool = 'codex' | 'claude-code'
```

```ts type-equiv
/** One importable foreign session as the picker and `/import list` show it. */
interface ForeignSessionSummary {
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
```

## Foreign transcripts

`parse()` reads a session into a `ForeignTranscript`: entries in foreign order with the shards of a logical Codex session merged, the route the foreign CLI recorded when it recorded one, and one `ForeignSkip` per line the parser could not use. A message, a tool call, and a tool result are the three entry kinds; a call and the result that answers it are separate entries, paired later by the foreign call id.

```ts type-equiv
/** One human or assistant message in a foreign transcript. */
interface ForeignMessageEntry {
  readonly kind: 'message'
  readonly role: 'user' | 'assistant'
  readonly text: string
  /** Timestamp the foreign log recorded, when it recorded one. */
  readonly at?: string
}
```

```ts type-equiv
/** One tool call a foreign assistant message issued. */
interface ForeignCallEntry {
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
```

```ts type-equiv
/** One tool result a foreign log recorded. */
interface ForeignResultEntry {
  readonly kind: 'result'
  /** Foreign call id this result answers. */
  readonly callId: string
  /** Result text as the foreign CLI recorded it. */
  readonly output: string
  /** Timestamp the foreign log recorded, when it recorded one. */
  readonly at?: string
}
```

```ts type-equiv
/** One conversation step read from a foreign log, in foreign order. */
type ForeignEntry = ForeignMessageEntry | ForeignCallEntry | ForeignResultEntry
```

```ts type-equiv
/** One foreign log line the parser could not use, with the reason why. */
interface ForeignSkip {
  /** Why the line was dropped. */
  readonly reason: string
  /** Foreign record type or content block that was dropped, for diagnosis. */
  readonly detail?: string
}
```

```ts type-equiv
/** A foreign conversation read into dsh-independent entries. */
interface ForeignTranscript {
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
```

## Seed translation

`translateTranscript()` turns a `ForeignTranscript` into a `TranslatedTranscript`: contiguous session events from seq 0 with every turn and step bracket closed, plus every conversation element it could not place. The rules are:

- One foreign round — a user message up to the next one — becomes one turn with one step, opened by `turn/start` and `step/start` and closed by `step/end` and `turn/end`. Entries before the first user message form the first round.
- Exactly one `request/header` opens the seed, in the first round, recording `{ provider, model }`: the route the foreign log recorded, else the configured route, else the tool name and `imported`.
- A user message enters as a `user/message` and an assistant message as an `assistant/message`, both carrying a surface operation, so request assembly derives the same model messages it would from a conversation dsh produced itself.
- A tool call answered inside its round enters twice: as a `tool-call` content block on the assistant message that issued it and as a `tool/call` event. A call the foreign log issued without a preceding assistant message becomes its own assistant message, so the call still precedes the result that answers it.
- A tool result enters as a `tool/result` after its call; the first result for one call wins.
- An unpaired call, an orphan result, a result that precedes its call, and a second result for one call leave the seed and are reported as a `ForeignDrop` with a reason; a translation never invents the missing half of a pair.

```ts type-equiv
/** A translated foreign conversation: the dsh seed and the elements left out. */
interface TranslatedTranscript {
  /** Contiguous session events from seq 0, with every bracket closed. */
  readonly events: readonly SessionEvent[]
  /** Conversation elements the translation left out. */
  readonly dropped: readonly ForeignDrop[]
}
```

```ts type-equiv
/**
 * One conversation element the translation could not turn into a seed event.
 *
 * Unpaired calls and orphan results are expected in an interrupted foreign
 * session; reporting them keeps an import honest about what it left out.
 */
interface ForeignDrop {
  /** What was dropped. */
  readonly kind: 'call' | 'result'
  /** Foreign call id the element carried. */
  readonly callId: string
  /** Why the element could not enter the seed. */
  readonly reason: string
}
```

## Import outcomes

`ImportOutcome` reports what a new-session import published; `InjectOutcome` reports whether a receiving session received context and accounts for the outcome in one line, including when nothing was injected.

```ts type-equiv
/** Outcome of one new-session import. */
interface ImportOutcome {
  /** Session the imported history was published under. */
  readonly sessionId: SessionId
  /** Seed events written to the new session. */
  readonly events: number
  /** Foreign conversation elements the translation left out. */
  readonly dropped: readonly ForeignDrop[]
  /** Title the import would show for the conversation. */
  readonly title?: string
}
```

```ts type-equiv
/** Outcome of one injection into the receiving session. */
interface InjectOutcome {
  /** Whether the receiving session received context. */
  readonly injected: boolean
  /** One-line account of what was injected, or why nothing was. */
  readonly summary: string
}
```

## The `/import` command

```text
/import
/import help
/import list
/import <codex|claude|claude-code> <session-id>
/import --inject <codex|claude|claude-code> <session-id>
```

A bare `/import` and `/import help` return the usage line; any other word that names no dialect returns an error result.

`/import list` prints one header line followed by one row per importable session. The row is a wire format the Web dialog parses back: `<tool> <id>  (<label>, <stamp>, <size> KiB[, "<title>"])`, with an id longer than 40 characters truncated and followed by an ellipsis.

`/import <tool> <session-id>` resolves that session from `list()`, mints the stable identity `import-<tool>-<foreign-id>`, and reports the seed event count plus the number of dropped elements. `/import --inject <tool> <session-id>` appends the reduced rendering to the receiving session and reports the injection summary. `claude` and `claude-code` both select Claude Code. Any other dialect, a missing session id, a session id no listing carries, or a parse failure returns an error result carrying the reason.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxcontextimport--contextimportapi"></a>

### `ctx.contextImport` — `ContextImportApi`

The `contextImport` service: foreign listing plus both import modes.

```ts cordis-catalog
/**
 * List every importable foreign session.
 * @returns Summaries newest first, with the CLI's own conversation names when the CLI recorded one.
 */
list(): Promise<ForeignSessionSummary[]>

/**
 * Read one foreign session and translate it into a dsh session seed.
 * @param sourcePath - Session file, or any shard of a multi-file Codex session.
 * @param tool - Dialect to read it as; omit to detect it from the log.
 * @returns The transcript and its translated seed.
 * @throws when the file is not a recognized foreign session or carries no conversation.
 */
parse(sourcePath: string, tool?: ForeignTool): Promise<{ readonly transcript: ForeignTranscript readonly events: TranslatedTranscript['events'] readonly dropped: readonly ForeignDrop[] }>

/**
 * Create a new session seeded with a foreign conversation.
 * @param options - Session file, identity to publish under, and working directory.
 * @returns The published session and what the translation left out.
 */
importNewSession(options: { readonly sourcePath: string readonly sessionId: SessionId readonly cwd: string }): Promise<ImportOutcome>

/**
 * Inject a reduced rendering of a foreign conversation into a live session.
 * @param options - Receiving agent and the foreign session file.
 * @returns Whether anything was injected, with a one-line account.
 */
injectIntoCurrent(options: { readonly agent: Agent readonly sourcePath: string }): Promise<InjectOutcome>
```

Types: [Agent](core.md) · [SessionId](core.md)

Source: [`packages/context/context-import/src/index.ts`](../../packages/context/context-import/src/index.ts)
<!-- END GENERATED cordis-surface -->
