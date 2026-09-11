---
description: "Imports Codex and Claude Code session logs as a new dsh session or as recall context in the current session, for users and maintainers of `/import` and `ctx.contextImport`."
kind: "package-reference"
---

# @deepseek-ai/dsh-context-import

English | [中文](README.zh.md)

## Summary

`dsh-context-import` brings a conversation built in Codex or Claude Code into dsh. `/import` lists the foreign sessions under the configured roots, then either creates a new session seeded with one of them or injects a reduced rendering into the session you are already in. The imported session persists, resumes, forks, and renders like any other, because the whole conversation enters the durable log as ordinary events. The cost is the foreign history itself: it enters the context window and stays for the life of the log.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this plugin when a conversation built in Codex or Claude Code should continue inside dsh and those session logs are readable from the dsh host.

### Importing a conversation

`/import list` prints every importable session the configured roots expose. `/import codex <session-id>` and `/import claude-code <session-id>` (with `claude` accepted as an alias) create a new dsh session seeded with that conversation under the stable id `import-<tool>-<foreign-id>`, so re-importing one foreign conversation targets the same identity instead of scattering copies. `/import --inject <tool> <session-id>` instead appends one reduced rendering of the conversation to the session you are in. A bare `/import` and `/import help` return the usage line; any other first word returns an error result. Other plugins reach the same work through `ctx.contextImport`: `list()`, `parse()`, `importNewSession()`, and `injectIntoCurrent()`.

### Configuration

The minimal mount needs no configuration; every field has a default. A missing or unreadable root is not an error: the listing reports no sessions for it.

```yaml
- name: '@deepseek-ai/dsh-context-import'
  config:
    claudeDir: /home/me/.claude/projects
    injectTailMessages: 4
```

| Field | Default | Meaning |
|---|---|---|
| `codexDir` | `$CODEX_HOME/sessions`, else `~/.codex/sessions` | Root of the Codex rollout logs. |
| `claudeDir` | `$CLAUDE_CONFIG_DIR/projects`, else `~/.claude/projects` | Root of the Claude Code project logs, one directory per working directory. |
| `codexIndexPath` | `$CODEX_HOME/session_index.jsonl`, else `~/.codex/session_index.jsonl` | Codex session index that names the CLI's own conversations; an absent index falls back to the first prompt. |
| `provider` | the foreign tool name | Provider recorded on the imported history; a configured value overrides the foreign log's own provider. |
| `model` | `imported` | Model recorded on the imported history; a configured value overrides the foreign log's own model. |
| `injectTailMessages` | `8` | Messages rendered verbatim at the tail of an injected transcript; earlier messages collapse to one line each. |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-context-import) is the exhaustive source for every accepted field and its JSDoc. A negative or non-integer `injectTailMessages` fails plugin load rather than degrading the rendering.

### Reading Codex rollouts

A logical Codex session spans every rollout file that shares one `session_id`, because compaction, resume, and fork each open a new file. An import reads the shards in order and merges them by payload id, so an item written twice is translated once, and shards are searched under the `sessions` and `archived_sessions` roots implied by the given file's own location before the configured `codexDir`. Listing takes conversation names from `codexIndexPath` (`thread_name`, newest `updated_at` wins) and falls back to the first real user prompt. A `compacted` record is recorded as a skip while the pre-compaction history is kept. Codex injects environment and instruction preludes as user-role text, so `<app-context>`, `<environment_context>`, `<recommended_plugins>`, `<heartbeat>`, `<image>`, `<turn_aborted>`, `<turn_context>`, and `<user_instructions>` are dropped as machine context instead of being replayed as something the person said.

### Reading Claude Code sessions

Claude Code writes one file per session under `claudeDir`, in conversation order. `custom-title` supplies the conversation name and the transcript title, and `summary` supplies the summary. A tool result arrives in the following user record as a `tool_result` block, which the parser keeps as its own entry so the translator can pair it with the call by id. Side chains, `thinking` and `image` blocks, and the CLI's non-conversation record types do not survive the parse. The listing reads only each file's head, so a Claude Code row is titled from the first prompt even though the full parse captures the CLI's own title.

### Tolerance and failure

Unknown records, unknown content blocks, malformed lines, unpaired calls, orphan results, and a second result for one call are all skipped with a recorded reason and never fail the import; the unpaired and duplicated calls and results are reported through the outcome's `dropped` list, which `/import` counts in its result text. Two conditions fail loud instead: a file whose dialect matches neither parser, and a log that carries no conversation. Both raise from `parse()` and surface as an error result from `/import`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design of the plugin; the observable behavior is covered in [Use this package](#use-this-package).

### Design concept

Both dialects share one translator because their logs share a shape: assistant text messages, tool calls (Codex `function_call`, Claude Code `tool_use`), and tool results (Codex `function_call_output`, Claude Code `tool_result`). Each parser reads its own format into the vendor-neutral `ForeignTranscript`, and the translator turns that into a contiguous seed: one round — a user message up to the next one — becomes one turn with one step, calls are paired to results by id inside their round, and a call the foreign log never answered leaves both the assistant message content and the `tool/call` records.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `/import` command, `contextImport` service, injection rendering |
| [`src/discover.ts`](src/discover.ts) | Root defaults, session listing, dialect detection, Codex shard resolution |
| [`src/codex.ts`](src/codex.ts) | Codex rollout parser |
| [`src/claude.ts`](src/claude.ts) | Claude Code session parser |
| [`src/translate.ts`](src/translate.ts) | Foreign transcript translated into a contiguous session seed |
| [`src/jsonl.ts`](src/jsonl.ts) | Streaming JSONL reader and record field readers |
| [`src/types.ts`](src/types.ts) | Vendor-neutral transcript types shared by both parsers |

### Main flow

`/import <tool> <id>` resolves the row from `list()`, parses and translates that file, and hands the seed to `ctx.agents.create`, which publishes the new session under `import-<tool>-<id>`; the Web dialog reads the same `list()`. Files are streamed line by line because foreign logs reach gigabytes, and a listing stops after the head of each file, so identifying and titling a session never reads the whole log. The seed starts at seq 0 with every turn and step bracket closed, and `Session.create` validates it before the session is published. `injectIntoCurrent` reuses the parse but appends one `user/message` with the plugin's own `recall` source instead of creating a session.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the sibling context packages to the browser surface and the generated configuration.

- [Context group map](../README.md) — sibling request-context packages.
- [Web import dialog](../../client/ui-context-import/README.md) — the session-header action and dialog over `/import list`.
- [Generated configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-context-import) — every accepted config field and its source declaration.

-----

<a id="model-experience"></a>
## Model Experience

### Imported session history

#### What the model sees

An imported session replays the foreign conversation through ordinary request assembly: the same user and assistant messages, the same `tool-call` content blocks and tool results, and one `request/header` recording the foreign provider and model. Nothing in the request marks the history as imported.

#### Token effect

The whole foreign history enters the imported session's requests and stays for the life of the log. The import adds no summarizing or framing text of its own, so the tokens are the foreign messages plus the calls and results between them.

#### KV Cache effect

The imported region is written once and never rewritten, so it forms a stable request prefix that later appends extend without invalidating.

### Injected transcript in the receiving session

#### What the model sees

`/import --inject` appends one user-role message to the receiving session: the foreign summary or title first when the log recorded one, then one `- <role>: <title>` line for each message before the tail, then the last `injectTailMessages` messages verbatim as `<role>: <text>`.

#### Token effect

One message per injection. The collapsed head costs about one line per earlier foreign message and the verbatim tail costs those messages in full, so `injectTailMessages` is the knob that trades context for fidelity.

#### KV Cache effect

Append-only: the message joins the end of the durable history and rewrites no earlier request tokens.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when an import is the wrong tool or needs care. They are current package constraints.

- **The whole history is imported** — token-budget reduction at import time is deferred, so a new-session import carries the entire foreign conversation; an import also keeps at most the first 20,000 foreign entries, and entries past that bound leave the seed without appearing in `dropped`.
- **Foreign formats are not stable contracts** — a changed dialect stops matching its parser, so the import fails loud instead of reading an unfamiliar log as conversation.
- **A Claude Code listing row is titled from the first prompt** — `/import list` reads only each file's head, so the CLI's own `custom-title` reaches the `importNewSession` outcome but never the picker row.
- **Timestamps fall back to the import clock** — a foreign record with no timestamp is stamped by the import in foreign order, so message order survives while that message's wall-clock time is the import's.
- **Dropped elements are reported, not repaired** — an unpaired call, an orphan result, and a second result for one call leave the seed; an import never invents the missing half of a pair.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The package was rebuilt from the Agent Note and the surviving end-to-end fixtures after its sources were deleted outside version control. The parser and translator suites cover both dialects, malformed lines, unknown records, unpaired calls, and duplicate results; the real-Loader e2e driver ([`context-import-driver.ts`](../../../examples/headless-agent/tests/fixtures/context-import/context-import-driver.ts)) imports a fixture through the headless composition.

</details>

**Runtime invariant:** No companion is published. The package owns no independent runtime relationship to observe: each import is one parse and one translation over files it reads, the durable state it produces belongs to the session `ctx.agents.create` publishes or to the session it appends to, and every listing is re-derived from the roots on each call.
