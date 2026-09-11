# Agent Note: Web token and cost meter — client-derived pricing over durable provider usage

Status: implemented

English | [中文](2026-08-27-web-token-and-cost-meter.zh.md)

## Problem

The web client already shows durable token counts (the chat stats strip rides `tokenUsage`, and each message's footer carries terse usage figures), but it shows no money cost. The harness never records a cost anywhere — `llm-pi-ai`'s `replay.ts` zeroes provider cost metadata and no consumer reads it — so "how much did this conversation cost" has no answer in the GUI. The user wanted cost displayed per reply and as a session total, priced against the selected model's official rate card.

## Decision

Add a pure client plugin, `@deepseek-ai/dsh-client-ui-cost-meter`, that derives cost from the durable provider usage it already reads and renders two surfaces. The Node half is empty: pricing is a client-only derivation over already-logged data, with no Host-side state and no model-facing input. Composing the plugin out of cordis.yml removes both surfaces.

### One money formula, one normalization

`costOf` prices each bucket at its own rate (uncached input, cache read, cache write, output in CNY per 1M tokens). `normalizeUsage` reads a per-step provider `TokenUsage` sample (`inputTokens`). `formatTokens`/`formatCost` make the compact display; a component renders only when it can price a value, so an unknown model stays quiet rather than guessing. Peak/off-peak rate selection is owned by [the peak/off-peak note](2026-09-10-web-cost-peak-off-peak-and-summed-session-total.md).

### Session total: composer dock line

`TotalCost` registers into `conversation.composer.dock` (id `cost`, order 1, after the stats strip). It now sums the loaded window's assistant steps, each priced at its own model and peak/off-peak window, so the line equals the sum of the chips; [the peak/off-peak note](2026-09-10-web-cost-peak-off-peak-and-summed-session-total.md) owns that decision and the durability it gives up.

### Per-turn chip: turn-tail chain

`TurnCost` registers into `conversation.chat.turnTail` and reads the engine-owned closing Turn through the same `TurnTailOwnerProps` currency the deliverables row uses: it sums every assistant step's usage in the Turn (via `turn.steps`' `assistant-step` data) and prices each step at its own `finalNode.provenance.model` and at the peak or off-peak rates in force when its request ran, so a Turn that switches models between steps is billed per-step. Its token total counts every step's usable usage, so the chip agrees with the turn-usage disclosure beside it; the cost reflects only the priced steps. The selector declines before mounting when no step can be priced, so the chip only appears for a priced Turn. It is window-scoped: a paged-out or compacted Turn renders no chip, and — since [the peak/off-peak note](2026-09-10-web-cost-peak-off-peak-and-summed-session-total.md) — so is the session line.

### Pricing table: built-in reference + config override

The price table is a module constant of published peak rates for the default routes, merged under an optional `pricing` map in the plugin's cordis config, with `currency`, `peakWindows`, and `offPeakFactor` keys; [the peak/off-peak note](2026-09-10-web-cost-peak-off-peak-and-summed-session-total.md) owns the schedule. This follows the "no hardcoded tunables" rule: prices are deployment-varying, so they are configurable, while the built-in entries are a documented external-spec starting point that deployments verify and override (official prices change).

## Alternatives considered

- **Host-records cost (a durable cost projection)** — accurate and per-model, but requires touching `llm/token-meter` and its projection tests, plus a per-model cost split on the usage sample. Deferred; the client derivation covers the common single-model case.
- **Reading per-step cost into the session log** — violates "model-visible ⟺ logged" for a value the model never produces; cost is a derived UI figure, not model-visible input.
- **Extending the existing `StatsLine`** — would couple this plugin's pricing policy to `ui-conversation` and make removal a core edit; the dock slot is already a list, so registering a sibling line keeps the surface removable in one cordis.yml entry.

## Consequences

Both surfaces are window-scoped and agree by construction since [the peak/off-peak note](2026-09-10-web-cost-peak-off-peak-and-summed-session-total.md), so neither survives paging or compaction. No snapshot, event, or projection shape changed, so no existing expected output moved; the plugin's own tests cover the pure derivation, the two renderers, and the slot registrations' fiber-disposal removal, and `verify-client-packages` / `verify-cordis-config` / `verify-package-invariants` pass.
