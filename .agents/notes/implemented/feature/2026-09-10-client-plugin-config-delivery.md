# Agent Note: Client plugin config delivery through the boot graph

Status: implemented

English | [中文](2026-09-10-client-plugin-config-delivery.zh.md)

## Problem

A browser client plugin is composed in the browser from the boot graph the host injects as `window.__DSH_BOOT__`. Every graph row carried only module-arrival facts — id, URL, revision, `inject`, `immediately`, `external` — so the Loader row's `config` never crossed the wire: `apply(ctx, config)` received nothing, and every config field declared by a client plugin was unreachable. The Web token and cost meter was the visible case: its `pricing`, `currency`, `peakWindows`, and `offPeakFactor` fields could not be set from cordis.yml, so a deployment could not price a model the shipped table did not list, and its documentation described a configuration path that did not exist.

## Decision

Carry each row's config through the boot graph.

- `WebBootEntry` gains `config?: unknown`. The host copies the Loader entry's `config` verbatim when it reconciles a package into its table, and re-applies the retained value whenever HMR rebuilds that row. A `null` config — how a row with an empty `config:` key parses — is treated as absent at both boundaries, because a client plugin's `apply(ctx, config = {})` default does not cover `null`.
- The config participates in the composition source key, so a scan that observes a different config composes a different row, and the graph revision changes because it hashes the rows. The value is read when the source is resolved: a config-only edit does not recreate the Loader entry, so a running entry keeps the config it was composed with, and the boot graph is the page's initial-load record. Applying a changed config therefore needs the entry recreated and the page reloaded, not a live patch reload.
- The boot-manifest parser copies `config` into the plugin view only. The module table fetches bundles and needs no config, so `BootModuleRow` is unchanged and the wire stays minimal.
- The boot kernel passes it to `loader.create({ name, config })`, and the browser Loader interpolates that value in the browser's own context, exactly as it does for a host row. A config is delivered only when it is browser-plane data: a `!!js` expression is authored against the Loader context that owns the row — the host's, in a shipped Web profile — so the host withholds it rather than let the browser evaluate a host expression against services it does not have. The deployed `connection` row is exactly such a row: it is dual-face, its `!!js` config feeds its host half, and delivering it verbatim rejects that entry and fails the whole boot.

## Alternatives considered

- **Deliver config through a host service or Remote call after boot** — rejected. It adds a second configuration path, ordering between activation and delivery, and failure modes on a surface the boot graph already covers for every other row fact.
- **Resolve `!!js` on the host and deliver the resolved value** — rejected. It requires the row's fiber to have resolved its config, which a scan cannot assume: a row whose `inject` waits on a host service resolves later, so the delivered value would depend on activation order. It would also hand a dual-face row's host config to its browser half. Withholding keeps one rule with no ordering dependency.
- **Serialize config into the plugin bundle** — rejected. Config is deployment data, not artifact content; baking it in would change the artifact hash per deployment and defeat the immutable bundle cache.

## Consequences

A client-config value must survive JSON, because the graph is serialized into the page: a config that cannot serialize fails loud with the row's name rather than composing an unkeyable source, and a non-JSON leaf degrades — a function, `undefined`, or a symbol drops out, a `Date` becomes a string, and a `Map` or `Set` becomes an empty object. A config holding a `!!js` expression is withheld, not delivered: it belongs to the row's host half, and the browser Loader would evaluate it against services the browser does not have, which rejects that entry and fails the whole boot. A config a scan sees differently composes a different row and bumps the graph revision, but applying it needs the entry recreated and the page reloaded. No Session format, event, or projection shape changed. Coverage: the parser spec pins that the plugin view carries the config, omits a null one, and leaves the module view untouched; the node-half spec pins that a browser-plane config reaches the composed row, that a host-plane one is withheld, that an unserializable one fails loud, and that a rescan seeing a changed config rebuilds the row; the boot spec pins that the plugin's `apply` receives it.
