# 上下文导入

[English](context-import.md) | 中文

`ctx.contextImport` 读取 Codex 与 Claude Code 的会话日志，把一段对话翻译为 dsh 的会话种子，然后要么以该历史为种子发布一个新会话，要么把该对话的精简渲染追加到你当前所在的会话。`/import` 是同一服务面向人的入口，Web 导入对话框读取它的列表。挂载配置、根目录默认值和各方言的解析规则由[包 README](../../packages/context/context-import/README.zh.md)负责。

来源：[`packages/context/context-import/src/index.ts`](../../packages/context/context-import/src/index.ts) · [`src/types.ts`](../../packages/context/context-import/src/types.ts) · [`src/translate.ts`](../../packages/context/context-import/src/translate.ts)

## 服务操作

`list()` 为两个已配置根目录下每个可导入的外部会话返回一条摘要，最新的在前，因此选择器和 `/import list` 渲染相同的行。`parse(sourcePath, tool?)` 读取一个会话，返回它的 transcript（文本记录）、翻译后的种子事件，以及翻译舍弃的对话元素；省略 `tool` 时，从日志开头检测方言。文件不属于任何方言或不含对话时，它会抛出错误。

`importNewSession({ sourcePath, sessionId, cwd })` 通过 `ctx.agents.create` 发布翻译后的种子，因此带种子的会话会像其它会话一样持久化、恢复、fork 并渲染。`injectIntoCurrent({ agent, sourcePath })` 不创建会话，而是向接收方 agent 的会话追加一份精简渲染：日志记录了外部摘要或标题时先写入它，然后为尾部之前的每条消息写入一行 `- <role>: <title>`，最后把末尾 `injectTailMessages` 条消息按 `<role>: <text>` 原样写入。不含文本的 transcript 不注入任何内容。本页末尾生成的 Cordis API 区域给出每个操作的确切签名和源码 JSDoc。

## 外部会话

`ForeignTool` 是读取日志时采用的方言标签。一个逻辑 Codex 会话横跨所有共享同一个 `session_id` 的 rollout 文件，因此一条摘要覆盖该会话的全部分片，其 `sizeBytes` 是这些文件的总和。

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

## 外部 transcript

`parse()` 把一个会话读成 `ForeignTranscript`：条目按外部顺序排列，同一逻辑 Codex 会话的分片已合并；日志记录了路由时携带该路由；解析器无法使用的每一行对应一个 `ForeignSkip`。条目分为消息、工具调用和工具结果三类；调用与应答它的结果是彼此独立的条目，稍后按外部调用 id 配对。

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

## 种子翻译

`translateTranscript()` 把 `ForeignTranscript` 转换为 `TranslatedTranscript`：从 seq 0 开始连续的会话事件，每个轮次和步骤的括号都已闭合，外加它无法安置的所有对话元素。规则如下：

- 一个外部 round——从一条用户消息到下一条用户消息——变成一个只含单个步骤的轮次，由 `turn/start` 和 `step/start` 开启，由 `step/end` 和 `turn/end` 关闭。第一条用户消息之前的条目构成第一个轮次。
- 种子中恰好有一个 `request/header`，位于第一个轮次，记录 `{ provider, model }`：依次取外部日志记录的路由、已配置的路由，最后回退到工具名和 `imported`。
- 用户消息以 `user/message` 进入，助手消息以 `assistant/message` 进入，两者都带 surface 标记，因此请求组装推导出的模型消息与 dsh 自身产生的对话一致。
- 在本轮次内已获结果的工具调用进入两次：一次作为发起它的助手消息上的 `tool-call` 内容块，一次作为 `tool/call` 事件。外部日志发出但没有前置助手消息的调用会成为独立的助手消息，因此该调用仍先于应答它的结果。
- 工具结果在其调用之后以 `tool/result` 进入；同一个调用的第一个结果生效。
- 未配对的调用、遗留的结果、先于其调用出现的结果，以及同一调用的第二个结果都会离开种子，并作为带原因的 `ForeignDrop` 上报；翻译绝不虚构配对中缺失的另一半。

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

## 导入结果

`ImportOutcome` 报告新会话导入发布了什么；`InjectOutcome` 报告接收会话是否获得了上下文，并用一行说明结果，包括未注入任何内容的情况。

```ts type-equiv
/** Outcome of one new-session import. */
interface ImportOutcome {
  /** Session the imported history was published under. */
  readonly sessionId: SessionId
  /** Seed events written to the new session, contiguous from seq 0. */
  readonly events: readonly SessionEvent[]
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

## `/import` 命令

```text
/import
/import help
/import list
/import <codex|claude|claude-code> <session-id>
/import --inject <codex|claude|claude-code> <session-id>
```

裸 `/import` 和 `/import help` 返回用法行；其它任何未指明方言的词都会返回错误结果。

`/import list` 打印一行表头，然后为每个可导入会话打印一行。该行是 Web 对话框会解析回来的协议格式（wire format）：`<tool> <id>  (<label>, <stamp>, <size> KiB[, "<title>"])`，超过 40 个字符的 id 会被截断并以省略号结尾。

`/import <tool> <session-id>` 从 `list()` 解析出该会话，铸造稳定身份 `import-<tool>-<foreign-id>`，并报告种子事件数以及被舍弃元素的数量。`/import --inject <tool> <session-id>` 把精简渲染追加到接收会话，并报告注入摘要。`claude` 与 `claude-code` 都选中 Claude Code。其它方言、缺少会话 id、列表中没有该会话 id，或解析失败，都会返回携带原因的错误结果。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

Types: [Agent](core.zh.md) · [SessionId](core.zh.md)

Source: [`packages/context/context-import/src/index.ts`](../../packages/context/context-import/src/index.ts)
<!-- END GENERATED cordis-surface -->
