---
description: "Desktop notifications for the dsh web client: the OS notification a hidden window cannot show, the in-page breaching-whale notice, its synthesized cue, and the settings card that owns them."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-desktop-notify

English | [中文](README.zh.md)

## Summary

`dsh-client-desktop-notify` tells the user when a session finishes or asks them something, on whichever channel they can actually perceive. A hidden page gets a desktop notification; a visible page gets a whale breaching the water inside the app, with a synthesized whale-call cue when sound is on. One package ships both halves: the Host half registers the `desktop-notify` settings section, and the browser half reads that section together with the session list, the forwarded agent status, and the pending-interaction feed. Notifications are opt-in — `enabled` defaults to false and is turned on from the card in Settings → Plugins.

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

Turn the feature on in Settings → Plugins → Desktop notifications, then grant the browser notification permission from the same card. From then on a session that finishes, asks a question, requests approval, or submits a plan for review tells the user so.

### The two channels

The page decides by its own visibility. While the window is minimized or the tab is in the background, only the desktop notification is raised, because nothing inside the page can be seen. While the page is visible, the whale notice is raised in the page — and the desktop notification follows it only when the user turned off **System notification only while the page is hidden**, which is the default. The sound switch applies to the visible path alone; a hidden page leaves the sound to the operating system.

### Reading the whale notice

The notice stays for seven seconds, and any part of it may be acted on. Clicking the bubble brings the noticed session to the front, and the close control dismisses the showing early. Each showing carries its own identity, so dismissing one never clears a notice that replaced it.

### Retries and the quiet window

A session that stops and starts again within the quiet window is not announced: the window is what separates a paused turn from a finished session. A completion observed before the session's row reached the page is retried as the session list moves, and dropped after four attempts.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The browser half owns the browser: which session a notice names, what the page can currently do, and the two slot registrations. The notice rules themselves live behind ports, so they are testable without a DOM.

### Signals

A completion comes from two sources that must agree: the forwarded `api-session/status` remote event says an agent stopped, and the session list row says which session that was. The list is also what marks a session as running at page load, so a completion observed after a reload still names its session. A pending ask comes from `ctx.uiSession.pendingInteractions`, whose entries carry the opaque request key the engine marks as announced; the discriminator on that entry (`question`, `plan-review`, `approval`) picks the notice's wording.

### The notice rules

The engine raises one notice per completion or ask. Every ask is announced at most once, marked by its request key only after a notice was actually raised, and forgotten once it leaves the pending set. The quiet window, the visible and hidden channels, and the retry bound are all ports, so a spec drives them with no browser present.

### The whale, the cue, and the icon

The notice is one flat illustration staged from its own layers. Behind everything is the scene; over it five wave strips cut from the same sea scroll back and forth on their own speeds, directions, and bobs, each strip shown twice end to end so translating the pair by half its width loops without a seam, with a band of light crossing the swell. The whale breaches on its own curve — resting with its back at the surface, out of the water, a turn at the apex, then back down — while the spray bursts twice per cycle from two instances of the same image, once as the whale leaves the water and once as it falls back, each burst throwing its own droplets. The message floats in the artwork's own bubble over the scene, with three bubbles rising from the whale toward it, and the scene itself fades out on every side instead of ending on a card edge. Under `prefers-reduced-motion` the whale holds a pose at the surface and the sea stops moving.

The cue is synthesized with Web Audio, so the package ships no audio asset: a humpback call, the splash of the breach, and two gulls. A page that has not received a user gesture yet holds its audio context suspended, where scheduled sources would all fire at once on resume; the cue is skipped with a console warning instead. The toast icon is the brand mark rasterized at icon size, falling back to the site favicon where the canvas API is unavailable.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

These pages own the surfaces this plugin composes with.

- [ui-settings-plugins](../ui-settings-plugins/README.md) — the section that dispatches plugin cards by settings namespace.
- [ui-session](../ui-session/README.md) — the session list and pending-interaction feeds the notices read.
- [Web styling](../../../docs/web-styling.md) — the token and stylesheet rules the card and the whale follow.
- [Desktop completion notifications](../../../.agents/notes/implemented/feature/2026-09-02-desktop-completion-notifications.md) — why the feature reports on two channels.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side notification plugin that registers no session event and reaches no model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These are the constraints the feature ships with.

- **The operating system renders the toast** — a deployment whose notification settings disable banners shows the notice only in the Action Center, and no page-side code can override that.
- **The cue needs a user gesture** — browsers keep a page's audio suspended until the user interacts with it, so a first notice on an untouched page stays visual.
- **A denial is undone outside the app** — the card can request permission, but a refused permission is restored only from the browser's site settings.
- **A completion whose row never arrives is dropped** — four list updates without the session's row end the retry, because a notice cannot name a session the page has never seen.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The favicon the OS falls back to is `apps/web/public/favicon.svg`, which paints the mark in the DeepSeek brand blue in both color schemes so the tab icon and the toast icon match.

</details>

**Runtime invariant:** No companion is published. The notices read owner-scoped state — the pending-interaction feed and the session list — through their own subscriptions, and every rule they apply is covered directly by this package's specs.
