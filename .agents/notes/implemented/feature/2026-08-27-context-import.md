# Agent Note: Context import from Codex and Claude Code session logs

Status: implemented

English | [中文](2026-08-27-context-import.zh.md)

## Problem

Users switch between coding CLIs; the conversation they built up in Codex or Claude Code does not travel with them. DSH could only start fresh or fork its own sessions. The imported history must enter the durable session log as first-class events — the model-visible ⟺ logged invariant forbids injecting un-logged text — and the foreign tool-call structure should survive so an imported conversation replays like one dsh produced itself.

## Decision

`@deepseek-ai/dsh-context-import` parses Codex session logs (`~/.codex/sessions/<month>/<rollout>.jsonl`) and Claude Code session logs (`~/.claude/projects/<encoded-cwd>/<session>.jsonl`) into a vendor-neutral `ForeignTranscript`, then translates it into a contiguous dsh session seed: closed turn/step brackets, `user/message` / `assistant/message` / `tool/call` / `tool/result` events with surface markers, and a single `request/header` carrying the foreign provider/model identity. The seed flows through `ctx.agents.create({ seed })`, so the imported session persists, resumes, and replays exactly like any other.

The two dialects share one translator because their logs share a shape: assistant text messages, tool calls (Codex `function_call`, Claude Code `tool_use`), and tool results (Codex `function_call_output`, Claude Code `tool_result` placed in the *following* user record). Translation works in rounds — a round opens with a user text message and closes at the next one — and pairs calls to results by id across the round. An interrupted session's unpaired calls are dropped from both the assistant message content and the `tool/call` records, and reported through the outcome's `dropped` list. A result carrier with no preceding assistant step is dropped as an orphan.

Foreign formats are not stable public contracts. Both parsers are tolerant: unknown lines and content blocks are skipped with a reason, never fatal, and a file whose dialect neither parser recognizes degrades to an empty transcript, which the import rejects loud. Thinking transcripts, side chains, system rows, images, and Claude Code's non-conversation record types (`attachment`, `last-prompt`, `custom-title`, `mode`, `queue-operation`) do not survive the parse; the file's rolled-up summary and working directory are retained as provenance.

Two import modes exist. `importNewSession` creates a new agent seeded with the translated history (the deployment's default preset composes it when a roster exists); `injectIntoCurrent` injects a reduced rendering into the receiving agent's next request as `recall`-form context — the head collapses to one line per message, the tail stays verbatim up to `injectTailMessages`. The `/import` command is the human entry point (`/import list`, `/import <codex|claude> <session-id>`, `/import --inject …`).

## Alternatives considered

**A skill that teaches the model to read the JSONL files itself** — rejected for the real capability. The model would re-parse on every use, cost tokens repeatedly, lose the tool-call structure, and produce non-deterministic seeds; the plugin translates once, deterministically, with tests.

**A new session event type for imports** — rejected for the first version. The `recall` context form on the plugin-sourced `user/message` and the `request/header` with the foreign provider already make imports reconstructable; a dedicated event would have required a format-version mechanism review for no current consumer.

**Token-budget reduction at import time** — deferred. A new-session import carries the whole history; a reduction policy needs a real token model and is recorded under Known Limitations.

## Consequences

An imported conversation is indistinguishable in the log from one dsh produced, so persistence, resume, forking, and the Web GUI render it without special cases. The tolerance rule means a changed foreign format fails loud (empty import) instead of silently misreading history. `injectIntoCurrent` never injects a transcript that has no text content, and its title lines are only rendered when the corresponding section has content.

## Verification

Fixture-based parser suites cover both dialects plus malformed lines, unknown types, unpaired calls, and silent record types; the translator suite asserts the exact event sequence and proves every seed is accepted by `Session.create` and derives the expected message history. A real-Loader e2e imports a fixture through the headless `cordis.yml` and asserts the persisted log. Real Codex and Claude Code session files from a developer machine were parsed and accepted by `Session.create` (2,872-message and 339-message sessions) during development; the fixture files are synthetic so the suite replays anywhere.
