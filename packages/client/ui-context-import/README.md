---
description: "Web import surface: the session-header action and dialog that list Codex and Claude Code sessions and import one through the host `/import` command, for users and maintainers of the import experience."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-context-import

English | [中文](README.zh.md)

## Summary

This package renders the import surface of the Web GUI: a session-header action (导入会话 / Import session) and the dialog it opens. The dialog lists the foreign sessions the host reports, groups them by tool, filters by tool (Codex by default), searches titles and ids, and pages through the matches; each row either imports into a new session or injects into the current one. A bare `/import` typed in the composer opens the same dialog. Every listing read and every import is one host command execution, and the dialog reports the host's own result text.

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

Mount this plugin alongside the runtime; the import action then appears in the session header, and its dialog opens from that action or from a bare `/import` typed in the composer.

### The dialog

Rows are grouped by tool in the order Codex then Claude Code; the tool filter starts on Codex and `All` lifts it; the search matches the title when the host recorded one, else the id, case-insensitively; the table shows eight rows per page and clamps a page position past the last match. Each row shows the session name, the working directory, the last foreign write as a local `YYYY-MM-DD hh:mm` stamp, and the size in KiB. `Import` runs `/import <tool> <id>` and `Inject into this session` runs `/import --inject <tool> <id>`, both through `ctx.remote.commands.execute`.

### When the dialog opens

The header action opens it, and so does a bare `/import`: the plugin listens for `command/executed` and opens the dialog only when a successful `import` result text starts with `usage: `. `/import list` and an actual import report their own outcome in the composer and never re-open it.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design of the browser half; the observable behavior is covered in [Use this package](#use-this-package).

### Design concept

The package contributes one entry to `conversation.session.header.actions` (`ImportHeaderAction`, order 30) and one to `conversation.input.overlay` (`ImportDialog`, order 3). Both reach the same per-Session `ImportSurface`, which holds the parsed listing, the filter, search, and page inputs, one in-flight command, and the last outcome; the dialog reads that object through the entry's `hooks` compartment and writes through the injected verbs. `src/client/rows.ts` parses the `/import list` text into rows and does the grouping, filtering, searching, and paging with no React and no `ctx`.

### Source map

| File | Role |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | Browser entry: both slot registrations, the `command/executed` trigger, per-Session surfaces |
| [`src/client/surface.ts`](src/client/surface.ts) | Dialog state, the two command lines, and the page projection |
| [`src/client/rows.ts`](src/client/rows.ts) | `/import list` text parsed into rows, filtered, searched, paged |
| [`src/client/ImportDialog.tsx`](src/client/ImportDialog.tsx) | Dialog rendering: toolbar, table, state lines, footer |
| [`src/client/ImportHeaderAction.tsx`](src/client/ImportHeaderAction.tsx) | Session-header trigger that opens the dialog |
| [`src/client/locales.ts`](src/client/locales.ts) | `contextImport` dictionaries |
| [`src/index.ts`](src/index.ts) | Node half: an empty `apply` so the plugin has a Loader row |

### Main flow

Opening the dialog (from the header action or the usage line) publishes `open: true` and runs `/import list`; the returned text is parsed into rows unless the call failed, which the dialog shows as its own load-failure state. A row action reuses the same call with `/import <tool> <id>` or `/import --inject <tool> <id>`, publishes the host's result text as the outcome, and re-reads the listing because an import can change what is still importable. Each read carries a generation, so a settlement from a superseded read is dropped instead of overwriting newer rows.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the dialog is not enough. They move from the host command to the surrounding client layers.

- [dsh-context-import](../../context/context-import/README.md) — the host plugin that owns `/import`, the parsing, and the translation.
- [Client group map](../README.md) — sibling browser-side packages.
- [Web client architecture](../../../.agents/notes/implemented/architecture/2026-07-19-gui-web-client-architecture.md) — how browser plugin rows load and register slots.

-----

<a id="model-experience"></a>
## Model Experience

### The host commands the dialog runs

#### What the model sees

The browser half sends no prompt of its own. Every model-visible effect behind the dialog belongs to the host plugin: `/import <tool> <id>` seeds a new session's history, and `/import --inject <tool> <id>` appends the host's reduced `recall`-form message to the Session the dialog was opened from.

#### Token effect

None from this package. The tokens are those the host plugin's seed or injected message carries, and the dialog adds no text to either.

#### KV Cache effect

None; this package never assembles or sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the current dialog. They are current package constraints.

- **One import at a time** — the dialog runs one command per Session and disables its actions while a listing read or an import is in flight, so a second import waits for the first to settle.
- **The listing is a text wire format** — `/import list` returns the text a person reads and this package parses it back into rows, so a row whose text leaves that format disappears from the table; no typed Remote carries the listing.
- **A large foreign root slows the first read** — the host walks every `.jsonl` file under the configured roots and reads each file's head, so the dialog's first listing read costs as much as that walk.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The package owns two slot entries and one locale dictionary, all effect-owned and released with the plugin fiber, plus per-Session dialog surfaces held only in plugin memory; the HMR-safety spec proves the registrations are withdrawn, and no second authority exists to compare dialog state against.
