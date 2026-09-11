---
description: "Token usage and cost display for the dsh web client: a session cost line beside the composer and a per-turn cost chip priced per model at the provider's peak or off-peak rates."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-cost-meter

English | [中文](README.zh.md)

## Summary

Token usage and cost display for the Web client. The browser half prices durable provider usage at the model that produced it and at the provider's peak or off-peak rates, and renders a session cost line beside the composer plus a per-turn chip in each settled turn's tail. The Node half is empty: pricing is a browser derivation over the durable log, with no Host-side state. The shipped Web patch is the only composition that loads this package, so removing its one cordis.yml entry removes both surfaces.

## Table of Contents

- [How it prices](#how-it-prices)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="how-it-prices"></a>
## How it prices

Cost is never recorded by the harness. This plugin computes it from the provider-reported token counts, a per-model rate table, and the provider's peak/off-peak schedule. Both surfaces bill each assistant step at the model that produced it and at the peak or off-peak rates in force when its request ran: the per-turn chip sums the settled Turn's steps, and the session line sums every assistant step in the loaded conversation window, so the line equals the sum of the chips. A model with no entry in the rate table renders no cost rather than guessing.

The rate table is a built-in reference holding the published **peak** rates in CNY per one million tokens (each value `{ input, output, cacheRead, cacheWrite }`, optionally with explicit `offPeak` rates of the same fields), merged under an optional `pricing` map in the plugin's cordis config. The published card prices three items — cached input, uncached input, and output — so `cacheWrite` follows this package's convention of the uncached-input rate; on DeepSeek's own routes no adapter reports a cache-write bucket, so that field prices nothing there. Peak windows use the provider's schedule (weekdays 01:00–04:00 and 06:00–10:00 UTC, whole weekend off-peak) and are overridable through `peakWindows` (UTC minutes-of-day) and `offPeakFactor` (the multiplier applied to a model's peak rates when it declares no explicit `offPeak` rates; default `0.5`). A `currency` key sets the display symbol (default `¥`). A browser client plugin reads these fields through its boot-graph row, which carries the Loader entry's config verbatim; changing a config needs the entry recreated and the page reloaded.

`costOf` applies the one-money formula per bucket: uncached input, cache read, cache write, and output, each at its own rate. `normalizeUsage` reads a per-step provider `TokenUsage` sample; `ratesAt` selects the peak or off-peak rates for one request instant, and `billedAt` picks that instant from a step's recorded start, falling back to its completion time. `formatTokens` and `formatCost` make the compact display. The plugin's two components only render when they can price a value, so a session or Turn that used an unknown model stays quiet — but since the table is keyed by the exact model id a route records, a renamed or newly added id would blank both surfaces with no visible cause. Each unpriceable id is therefore reported once per page through `console.warn`, naming the `pricing` key to add.

<a id="model-experience"></a>
## Model Experience

### Token usage and cost meter (pure UI)

#### What the model sees

Nothing new. The plugin registers presentation only through `ctx.slots` and adds no system-prompt section, tool schema, or model-visible input; it reads the durable conversation and its provider usage, which the model already produced.

#### Token effect

Zero in both directions. The plugin neither sends additional prompt context nor changes the request envelope; cost and token figures are derived client-side from existing durable data.

#### KV Cache effect

None. No prompt prefix or cache-shaping text is added; the surfaces are pure presentation over already-cached request state.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Both surfaces are window-scoped.** The session line sums the assistant steps in the loaded conversation window and the turn chip reads that window's steps, so a Turn paged or compacted out of the window stops contributing to either figure. The line equals the sum of the chips by construction rather than a durable whole-log total.
- **Peak/off-peak keys on the request time.** Each step's recorded start selects the window; when it is unavailable the completion time is used, so a request whose two observables straddle a boundary is billed at the nearer one that exists.
- **A row config crosses the wire as JSON.** The boot-graph row carries the Loader entry's config only when it is browser-plane data, so this plugin's config must be plain JSON data: a `!!js` expression belongs to the row's host half and is withheld, a function, `undefined`, or a symbol drops out of the round trip, a `Date` becomes a string, a `Map` or `Set` becomes an empty object, and a value that cannot serialize fails the composition loudly. Changing the config needs the entry recreated and the page reloaded.
- **Built-in rates and windows are a reference, not a contract.** The default entries hold current published DeepSeek peak rates and the published windows, and are meant to be verified per deployment; this plugin makes no network request for live pricing.
- **A model not in the table shows no cost.** This is deliberate — no estimated or inferred price is shown for an unknown model. Adding a model is a config-only change.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** The companion installs no check. The dictionaries and the two registrations are effect-owned with disposal proven by the plugin's specs, and this package owns no mutable state that could diverge from another source.
