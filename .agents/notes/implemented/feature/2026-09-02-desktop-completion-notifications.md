# Agent Note: Desktop completion and question notifications in the Web GUI

Status: implemented

English | [中文](2026-09-02-desktop-completion-notifications.zh.md)

## Problem

The Web GUI gave no signal when a session finished while the window was minimized or another tab was active: a multi-minute task at a background tab left the user to poll or rely on the sidebar's green dot. The same gap applied to sessions waiting on the user — a question, plan review, or approval pending for minutes behind a minimized window. Codex and Claude Code both raise an OS notification on completion; dsh has no equivalent. The fix must not spam — the running→idle edge also appears between goal rounds, queued turns, and resumes — must not alert for subagent completions (the parent turn is the user-visible unit), and must still alert for subagent questions, because any pending interaction blocks the run on the user.

## Decision

`@deepseek-ai/dsh-client-desktop-notify` ships in the `dsh-web-app` bundle as an opt-in client plugin. Its Node half registers the `desktop-notify` settings namespace (`enabled`, `onlyWhenHidden`, `onQuestion`, `sound`, `quietMs`); its browser half announces one notification per finished top-level session and per pending interaction, and registers a settings card under the plugin-configuration slot plus an in-page notice under the shell overlay seat.

The engine is pure logic over injected ports. It watches the forwarded `api-session/status` stream; a first observation per session only records the running bit (page load and reconnect replay must not fire), an observed running→idle edge arms a `quietMs` timer (default 1500 ms), and a false→true edge before it fires cancels it — that is the goal-round and queued-turn suppressor. Settings `enabled`, permission `granted` (OS surface only), visibility, and the top-level check (`origin !== 'subagent'`, no `parentId`) decide the single announcement. The list snapshot seeds the engine at mount and on `connection/reset` so a session already running at page load still arms on its completion; seeding is snapshot-only and never constructs an edge.

The engine also mirrors the client's pending-interaction snapshot (`uiSession.pendingInteractions`) — the object-layer record of what the GUI is waiting on — so it need not join the `user-questions/request` or `approval/request` remote waterfalls, whose listener chains are claimed by the presenting plugins and whose ordering no observer can guarantee. An interaction already pending at mount announces once (a question arriving during page boot must not be swallowed as replay); later ones announce immediately (no quiet window — the run is blocked on the answer), once per interaction key, and an answered interaction clears the marker so the next one re-announces. The kind selects the copy (`notify.waitingAnswer` / `notify.waitingApproval` / `notify.waitingPlan`), and subagent sessions notify because their questions also wait on the user.

The announcement routes on page state: a hidden page raises the OS notification, a visible page renders the in-page whale notice into `shell.overlay` (a shallow-angle water plane with caustics, glints, a foam collar, wakes, and spray; the official mark from `ui-primitives` drawn twice — clipped above the surface and lit, clipped below it and blurred, darkened, and refracted — carrying one perspective leap so the mark visibly breaks out of the water; the session label and status line in a glass bubble; retired by its own hold timer; static under `prefers-reduced-motion`). With `sound` on, the visible notice also plays a Web Audio cue — a long whale call over its own echo, the breach with its bubble tail, and two gull calls, no audio asset shipped — and a hidden page's OS toast carries the system sound instead. A visible page adds the OS toast only when `onlyWhenHidden` is off. The in-page notice needs no browser permission, so a denied or unsupported Notification API still shows it. The OS toast carries the brand mark as its `icon`, rasterized from the official geometry in the theme's DeepSeek blue and cached per page, falling back to the shell's favicon where canvas or the token is unavailable; Windows ignores that field in favor of the site icon.

The presentation resolves from the session list row (`displayTitle`, topology) and the live event window (last `assistant/message`, markdown-stripped through the shared plain-text extractor, capped at 140 chars; fallback copy when no text). Clicking the notification focuses the window and opens the session. The settings card reads and writes the namespace through the standard client settings scope, and runs the browser permission request from the toggle click because a grant requires a user gesture; a request rejection keeps the current state so a later retry can still succeed, and an absent API (non-secure context) reports `unsupported` on the card.

## Alternatives considered

**Always notify, no quiet window** — rejected. Goal rounds would produce a toast per round; the quiet window folds them into the single user-visible completion.

**Host-side OS toast (`node-notifier`)** — rejected for the Web GUI. The Host process cannot observe "the page is minimized", which is half the request; the browser's Notification API gives the same OS toast and knows the visibility state. A Host-side notifier remains a separate CLI/headless possibility, documented as out of scope here.

**Hook the `user-questions/request` / `approval/request` remote waterfalls** — rejected. Both are waterfall chains claimed by the presenting plugins, and an observer registered after the claimer would never run; the pending-interaction snapshot is the settled, order-independent signal.

**React `useSyncExternalStore` card state** — rejected. The card's state derives from the settings scope plus one browser permission string, not a cross-entry shared fact; the snapshot-store handle is served through the slot's inject hooks compartment like every other plugin card.

**The shared plain-text `Toast` for the visible page** — rejected. That control is a top-center text banner held by its owner; the requested surface is the brand mark's leap with the session as its click target, so the package owns an animated overlay entry instead, and `FISH_LOGO_PATH` is the exported geometry for exactly that composition.

**Notify on `turn/end` instead of running state** — rejected. `turn/end` fires between goal rounds and gives no knowledge of the next round; the running bit plus quiet window is the single signal that already carries "no more work scheduled".

## Consequences

The GUI gains Codex-style toasts with an OS-level `tag` per session (a later toast replaces an earlier one for the same session), question toasts that arrive immediately when the run blocks on the user, and an in-page whale notice for the visible page. The feature is opt-in, so no existing user is surprised. It depends on the browser staying open — closing the tab ends notifications — and the OS surface depends on a secure context, documented on the card; the in-page notice works without either. The quiet window is per session, so a resumed session whose next run begins after `quietMs` still yields one extra toast, and N sessions finish with N toasts; question toasts add one per interaction. The plugin appends no session events: nothing model-visible or durable changes.

## Verification

The engine spec pins edge detection, first-observation seeding, quiet-window cancellation, per-key question dedup, the hidden/visible routing, and the permission-free in-page path; the card and controller specs pin scope bridging, the permission-gesture flow, and disposal; the whale store spec pins the hold window, replacement, dismissal, and disposal, and the notice spec pins the rendered mark, copy, and click-to-open; the apply spec drives the forwarded `api-session/status` stream and the pending-interaction snapshot end to end with a Notification double (toast construction and its brand icon, click-to-open, kind-specific copy, constructor failure containment, reconnect re-seed) plus the overlay registration and its in-page notice. Per-file 100% coverage holds on every `src` file.
