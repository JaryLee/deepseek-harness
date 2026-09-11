# Agent Note: Web cost meter — peak/off-peak rates and a summed session total

Status: implemented

English | [中文](2026-09-10-web-cost-peak-off-peak-and-summed-session-total.zh.md)

## Problem

The shipped [Web token and cost meter](2026-08-27-web-token-and-cost-meter.md) priced every step at one flat per-model rate and computed the session line from the whole-log `tokenUsage` projection priced at the session's latest model route. Two problems followed. A session that switched models reported an approximate total that could disagree with the per-turn chips, and the provider introduced time-of-day billing — lower rates outside weekday peak windows, with whole weekends off-peak — that a single rate per model cannot express.

## Decision

### Peak/off-peak rates

The built-in rate table now holds the published **peak** rates. Off-peak billing applies `offPeakFactor` (default `0.5`, the published half rate) to every bucket inside `peakWindows`, whose default is the published schedule: weekdays 01:00–04:00 and 06:00–10:00 UTC, with the whole weekend off-peak. Both are config fields, per the "no hardcoded tunables" rule, because the provider's rates and schedule are deployment-varying external specs. A model may instead declare explicit `offPeak` rates of the same fields; those are used verbatim.

`isPeakTime` decides one instant from its UTC weekday and minute-of-day; `billedAt` picks the instant to bill for one assistant step — its recorded step start when present, otherwise its completion time; `ratesAt` turns a price and an instant into the rates that apply. Keying on the request start is what the provider bills, and the completion time is the only fallback when the window never recorded the step start.

### Session total: a sum of the loaded window

`TotalCost` no longer reads the `tokenUsage` projection. It sums every assistant step in the loaded conversation window, pricing each at its own model and at the peak/off-peak rates in force when it ran, so the line equals the sum of the per-turn chips by construction. This reverses the earlier durable-projection trade-off: the line is now window-scoped, and a Turn paged or compacted out of the window stops contributing to it. The durable projection still exists and still backs the stats strip; this plugin simply no longer reads it.

### One normalization over the per-step sample

With the projection pricing gone, `normalizeUsage` reads only the per-step provider `TokenUsage` sample (`inputTokens` plus the cache and output fields). The whole-log projection shape is no longer accepted.

## Alternatives considered

- **Keep the durable projection and add a per-model/per-time split** — accurate and page-safe, but it requires a Host-side projection change (a per-model, per-window breakdown) and its tests. Deferred; the summed window covers the displayed surfaces without a durable shape change.
- **One global discount on all models instead of per-model off-peak rates** — rejected. The provider's schedule is external and may diverge per model, and explicit per-model `offPeak` rates keep that door open while the factor covers the uniform case.
- **Bill peak/off-peak on the completion time** — rejected. The provider bills the request, and the recorded step start is the closer observable.

## Consequences

Both surfaces now read the loaded window and agree by construction, so the "two surfaces disagree after a model switch" limitation is gone; the accepted cost is that the session line no longer survives paging or compaction. Peak/off-peak is a client-side approximation of the provider's schedule: it uses UTC weekday windows and the step's observable time, and the built-in rates and windows must be verified per deployment — the plugin still makes no network request. The `pricing`, `currency`, `peakWindows`, and `offPeakFactor` fields are configurable from cordis.yml: [client config delivery](2026-09-10-client-plugin-config-delivery.md) carries each row's config through the boot graph. A model the table cannot price still renders no cost, but since the table is keyed by the exact id a route records, a renamed id blanked both surfaces with nothing naming the cause; each unpriceable id is now reported once per page through `console.warn` naming the `pricing` key to add. No Session format, event, or projection shape changed, so no captured expected output moved; the plugin's own tests cover the schedule, the rate selection, both derivations, and the two renderers.
