/**
 * Desktop notifications, browser half: the OS notification when a session
 * finishes or asks the user something, and the in-page whale notice for the
 * sessions the user is already looking at.
 *
 * The engine owns the rules and this module owns the browser: which session
 * each notice names, what the page can currently do (permission, visibility,
 * audio), and the two registrations — the settings card and the notice overlay.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: ctx.remote and the forwarded api-session/status event.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: ctx.sessions (the Session list and navigation).
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: ctx.uiSession.pendingInteractions and the pending-interaction types.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: the ctx.settingsScope Context merge and the SettingsScope handle.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: the keyed settings.plugin.item slot this card registers into.
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
// Type-only: ui-layout declares the shell.overlay SlotMap entry.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { DesktopNotifyCard } from './card.tsx'
import { DesktopNotifyCardController } from './card-controller.ts'
import { CompletionEngine, type NotifyNotice, type PendingAsk } from './engine.ts'
import { notificationIcon } from './icon.ts'
import { notificationPermission } from './permission.ts'
import { playNoticeSound } from './sound.ts'
import { WhaleNoticeOverlay, type WhaleFace } from './whale.tsx'
import { createWhaleStore } from './whale-store.ts'
import { en, NS, zh, type DesktopNotifyKey } from './locales.ts'
import {
  DESKTOP_NOTIFY_DEFAULTS, DESKTOP_NOTIFY_NS, type DesktopNotifySettings,
} from '../settings.ts'

export type { DesktopNotifyCardFace, DesktopNotifyCardState } from './card-controller.ts'
export type { DesktopNotifySettings } from '../settings.ts'
export type { NotificationPermissionState } from './permission.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Desktop-notify card and notice copy. */
    desktopNotify: DesktopNotifyKey
  }
}

/** How long the in-page notice stays before it dismisses itself. */
export const WHALE_HOLD_MS = 7000

/** Required services: slots/locale plus the transport, list, and settings handles. */
export const inject = ['slots', 'locale', 'remote', 'sessions', 'uiSession', 'settingsScope']

/**
 * Mount the notices, the settings card, and the notice overlay.
 * @param ctx - client plugin context.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'desktop-notify: dictionaries')
  const scope = ctx.settingsScope.bind<DesktopNotifySettings>({ namespace: DESKTOP_NOTIFY_NS })
  const whale = createWhaleStore()
  ctx.effect(() => () => { whale.release() }, 'desktop-notify: notice hold')

  // A status event can arrive before this page has read the settings document;
  // the notice rules then stand on the values the Host would have resolved.
  const settings = (): DesktopNotifySettings =>
    scope.getSnapshot().value ?? DESKTOP_NOTIFY_DEFAULTS

  const openSession = (sessionId: SessionId): void => {
    ctx.sessions.open(sessionId)
    window.focus()
  }

  const describeCompletion = (sessionId: SessionId): NotifyNotice | undefined => {
    const row = ctx.sessions.list.getSnapshot().byId[sessionId]
    if (row === undefined) return undefined
    return { sessionId, title: row.displayTitle, body: t('notify.finished') }
  }

  // A subagent's finish is the parent turn's to report, because the parent is
  // still running and will finish once its child's result is folded in. Its
  // questions are not: those block the run on the user whichever session asked.
  const isReportable = (sessionId: SessionId): boolean => {
    const row = ctx.sessions.list.getSnapshot().byId[sessionId]
    return row === undefined || (row.parentId === undefined && row.origin !== 'subagent')
  }

  const describeWaiting = (ask: PendingAsk): NotifyNotice => {
    const row = ctx.sessions.list.getSnapshot().byId[ask.sessionId]
    return {
      sessionId: ask.sessionId,
      title: row?.displayTitle ?? t('notify.waitingTitle'),
      body: t(waitingBodyKey(ask.kind)),
    }
  }

  const engine = new CompletionEngine({
    getSettings: settings,
    getPermission: notificationPermission,
    isPageHidden: () => document.visibilityState === 'hidden',
    isReportable,
    resolveCompletion: describeCompletion,
    resolveWaiting: describeWaiting,
    schedule: (delayMs, run) => {
      const handle = window.setTimeout(run, delayMs)
      return () => { window.clearTimeout(handle) }
    },
    show: (notice) => {
      try {
        const toast = new Notification(notice.title, {
          body: notice.body,
          tag: `desktop-notify:${notice.sessionId}`,
          icon: notificationIcon(),
        })
        toast.onclick = () => { openSession(notice.sessionId) }
        return true
      } catch (error) {
        console.warn('desktop-notify: the browser refused the notification', error)
        return false
      }
    },
    showInline: (notice) => { whale.show(notice, WHALE_HOLD_MS) },
    playSound: () => { playNoticeSound() },
  })

  const pendingAsks = (): PendingAsk[] => {
    const pending = ctx.uiSession.pendingInteractions.getSnapshot()
    return [...pending.values()].map(interaction => ({
      key: interaction.key,
      sessionId: interaction.sessionId,
      kind: interaction.kind,
    }))
  }
  const syncPending = (): void => {
    const asks = pendingAsks()
    engine.handlePending(asks)
    engine.clearPending(asks)
  }
  const syncRows = (): void => {
    engine.seed(Object.values(ctx.sessions.list.getSnapshot().byId)
      .map(row => ({ id: row.id, running: row.running })))
    engine.retryCompletions()
    // An ask announced before its row arrived keeps its notice; one whose
    // announcement was suppressed gets its chance once rows move.
    syncPending()
  }

  ctx.effect(() => {
    const offPending = ctx.uiSession.pendingInteractions.subscribe(syncPending)
    const offRows = ctx.sessions.list.subscribe(syncRows)
    // Rows first: a question pending at page boot names its session.
    syncRows()
    return () => {
      offPending()
      offRows()
    }
  }, 'desktop-notify: session rows and pending asks')

  ctx.effect(
    () => ctx.remote.$on('api-session/status', (sessionId, running) => {
      engine.handleStatus(sessionId, running)
    }),
    'desktop-notify: session status',
  )

  ctx.effect(() => ctx.on('connection/reset', () => {
    engine.reset()
    syncRows()
  }), 'desktop-notify: connection generation')

  const card = new DesktopNotifyCardController(scope)
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    key: DESKTOP_NOTIFY_NS,
    locale: NS,
    inject: () => card.inject(),
  }, DesktopNotifyCard))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'desktop-notify-whale',
    order: 50,
    locale: NS,
    inject: (): WhaleFace => ({
      hooks: { whale: whale.source },
      openSession: (sessionId) => { openSession(sessionId) },
      dismiss: (seq) => { whale.dismiss(seq) },
    }),
  }, WhaleNoticeOverlay))
}

/**
 * Pick the line a pending ask's notice carries.
 * @param kind - the interaction's presentation discriminator.
 * @returns the copy key; an unknown kind reads as a generic question.
 */
function waitingBodyKey(kind: string): DesktopNotifyKey {
  if (kind === 'question') return 'notify.waitingAnswer'
  if (kind === 'plan-review') return 'notify.waitingPlan'
  if (kind === 'approval') return 'notify.waitingApproval'
  return 'notify.waitingTitle'
}
