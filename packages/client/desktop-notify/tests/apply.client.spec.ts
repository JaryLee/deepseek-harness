/**
 * The browser half's wiring: which event raises which notice, what the page
 * state and settings allow, and the two registrations that carry the card and
 * the whale overlay.
 */
// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { apply, inject, WHALE_HOLD_MS } from '../src/client/index.ts'
import type { WhaleFace } from '../src/client/whale.tsx'
import type { DesktopNotifyCardFace } from '../src/client/card-controller.ts'
import { DESKTOP_NOTIFY_DEFAULTS, type DesktopNotifySettings } from '../src/settings.ts'

const sound = vi.hoisted(() => ({ playNoticeSound: vi.fn() }))
vi.mock('../src/client/sound.ts', () => ({ playNoticeSound: sound.playNoticeSound }))

const ONE = 'session-1' as SessionId
const TWO = 'session-2' as SessionId

const ENABLED: DesktopNotifySettings = {
  enabled: true, onlyWhenHidden: true, onQuestion: true, sound: false, quietMs: 1500,
}

/** One recorded change to the page's visibility. */
function setHidden(hidden: boolean): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => (hidden ? 'hidden' : 'visible'),
  })
}

/** A Notification stand-in that keeps every toast the page raised. */
class FakeNotification {
  static permission: NotificationPermission = 'granted'
  static readonly raised: FakeNotification[] = []
  onclick: (() => void) | null = null

  constructor(readonly title: string, readonly options: NotificationOptions) {
    FakeNotification.raised.push(this)
  }
}

interface Row {
  id: SessionId
  displayTitle: string
  running: boolean
  parentId?: SessionId
  origin?: 'subagent'
}

interface Ask {
  key: string
  kind: string
  sessionId: SessionId
}

/** A client context carrying only the services this plugin reads. */
function bench() {
  const effects: (() => void)[] = []
  const remoteHandlers = new Map<string, ((sessionId: SessionId, running: boolean) => void)[]>()
  const contextHandlers = new Map<string, (() => void)[]>()
  const rowListeners = new Set<() => void>()
  const askListeners = new Set<() => void>()
  const entries: {
    name: string
    key?: string | undefined
    id?: string | undefined
    locale?: string | undefined
    inject?: (() => unknown) | undefined
  }[] = []
  const dictionaries = new Map<string, unknown>()
  const open = vi.fn()
  const bound = vi.fn()
  let rows: Row[] = []
  let asks: Ask[] = []
  let snapshot: SettingsScopeSnapshot<DesktopNotifySettings> = {
    status: 'loading',
    value: undefined,
    base: undefined,
    user: undefined,
    revision: undefined,
    writable: true,
    mode: 'host',
  }
  const scope = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    mutate: () => Promise.resolve(),
    set: () => Promise.resolve(),
    unset: () => Promise.resolve(),
  } as unknown as SettingsScope<DesktopNotifySettings>
  const ctx = {
    effect: (body: () => (() => void) | undefined) => {
      const dispose = body()
      if (dispose !== undefined) effects.push(dispose)
    },
    on: (name: string, handler: () => void) => {
      const handlers = contextHandlers.get(name) ?? []
      handlers.push(handler)
      contextHandlers.set(name, handlers)
      return () => { handlers.splice(handlers.indexOf(handler), 1) }
    },
    remote: {
      $on: (name: string, handler: (sessionId: SessionId, running: boolean) => void) => {
        const handlers = remoteHandlers.get(name) ?? []
        handlers.push(handler)
        remoteHandlers.set(name, handlers)
        return () => { handlers.splice(handlers.indexOf(handler), 1) }
      },
    },
    locale: {
      bind: (ns: string) => (key: string) => `${ns}:${key}`,
      register: (ns: string, dicts: unknown) => {
        dictionaries.set(ns, dicts)
        return () => { dictionaries.delete(ns) }
      },
    },
    settingsScope: {
      bind: (spec: { namespace: string }) => {
        bound(spec)
        return scope
      },
    },
    sessions: {
      list: {
        getSnapshot: () => ({ byId: Object.fromEntries(rows.map(row => [row.id, row])) }),
        subscribe: (listener: () => void) => {
          rowListeners.add(listener)
          return () => { rowListeners.delete(listener) }
        },
      },
      open,
    },
    uiSession: {
      pendingInteractions: {
        getSnapshot: () => new Map(asks.map(ask => [ask.sessionId, ask])),
        subscribe: (listener: () => void) => {
          askListeners.add(listener)
          return () => { askListeners.delete(listener) }
        },
      },
    },
    slots: {
      register: (options: Record<string, unknown>, _component: unknown) => {
        entries.push({
          name: String(options.name),
          key: options.key as string | undefined,
          id: options.id as string | undefined,
          locale: options.locale as string | undefined,
          inject: options.inject as (() => unknown) | undefined,
        })
        return () => {}
      },
      inject: (_name: string, factory: () => unknown) => {
        factory()
        return () => {}
      },
    },
  } as unknown as ClientContext
  return {
    entries,
    dictionaries,
    open,
    bound,
    start: () => { apply(ctx) },
    serve: (section: DesktopNotifySettings) => {
      snapshot = { ...snapshot, status: 'ready', value: section }
    },
    pushRows: (next: Row[]) => {
      rows = next
      for (const listener of [...rowListeners]) listener()
    },
    pushAsks: (next: Ask[]) => {
      asks = next
      for (const listener of [...askListeners]) listener()
    },
    status: (sessionId: SessionId, running: boolean) => {
      for (const handler of remoteHandlers.get('api-session/status') ?? []) handler(sessionId, running)
    },
    resetConnection: () => {
      for (const handler of contextHandlers.get('connection/reset') ?? []) handler()
    },
    stop: () => { for (const dispose of effects.splice(0)) dispose() },
    entry: (name: string) => entries.find(candidate => candidate.name === name),
    whale: () => {
      const entry = entries.find(candidate => candidate.name === 'shell.overlay')
      if (entry?.inject === undefined) throw new Error('the whale overlay is not registered')
      return entry.inject() as WhaleFace
    },
    card: () => {
      const entry = entries.find(candidate => candidate.name === 'settings.plugin.item')
      if (entry?.inject === undefined) throw new Error('the card is not registered')
      return entry.inject() as DesktopNotifyCardFace
    },
  }
}

/** Raise a finished session on a page that already knew it was running. */
function complete(b: ReturnType<typeof bench>, sessionId: SessionId = ONE): void {
  b.pushRows([{ id: sessionId, displayTitle: 'Session', running: true }])
  b.status(sessionId, false)
  vi.advanceTimersByTime(ENABLED.quietMs)
}

beforeEach(() => {
  FakeNotification.raised.length = 0
  FakeNotification.permission = 'granted'
  vi.stubGlobal('Notification', FakeNotification)
  // jsdom reports its unimplemented window.focus through the virtual console.
  vi.spyOn(window, 'focus').mockImplementation(() => {})
  vi.useFakeTimers()
})

afterEach(() => {
  Reflect.deleteProperty(document, 'visibilityState')
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  sound.playNoticeSound.mockClear()
})

describe('desktop-notify client apply', () => {
  it('declares the services it reads', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'sessions', 'uiSession', 'settingsScope'])
  })

  it('registers the section dictionary, the card, and the overlay', () => {
    const b = bench()
    b.start()
    expect(b.bound).toHaveBeenCalledWith({ namespace: 'desktop-notify' })
    expect([...b.dictionaries.keys()]).toEqual(['desktopNotify'])
    expect(b.entry('settings.plugin.item')?.key).toBe('desktop-notify')
    expect(b.entry('settings.plugin.item')?.locale).toBe('desktopNotify')
    expect(b.entry('shell.overlay')?.id).toBe('desktop-notify-whale')
    expect(b.entry('shell.overlay')?.locale).toBe('desktopNotify')
    // Both faces are built from the apply closure's own scope and store.
    expect(b.card().hooks.desktopNotifyCard.getSnapshot().available).toBe(false)
    expect(b.whale().hooks.whale.getSnapshot()).toEqual({ notice: undefined, seq: 0 })
  })

  it('raises the OS notification for a completion the hidden page cannot show', () => {
    const b = bench()
    setHidden(true)
    b.serve(ENABLED)
    b.start()
    complete(b)
    expect(FakeNotification.raised).toHaveLength(1)
    const toast = FakeNotification.raised[0]!
    expect(toast.title).toBe('Session')
    expect(toast.options.body).toBe('desktopNotify:notify.finished')
    expect(toast.options.tag).toBe(`desktop-notify:${ONE}`)
    expect(toast.options.icon).toContain('favicon.svg')
    expect(b.whale().hooks.whale.getSnapshot().notice).toBeUndefined()
    toast.onclick?.()
    expect(b.open).toHaveBeenCalledWith(ONE)
  })

  it('shows the whale notice on a visible page and opens the session from it', () => {
    const b = bench()
    b.serve(ENABLED)
    b.start()
    complete(b)
    const face = b.whale()
    const state = face.hooks.whale.getSnapshot()
    expect(state.notice).toEqual({
      sessionId: ONE, title: 'Session', body: 'desktopNotify:notify.finished',
    })
    expect(FakeNotification.raised).toHaveLength(0)
    expect(sound.playNoticeSound).not.toHaveBeenCalled()
    face.openSession(ONE)
    expect(b.open).toHaveBeenCalledWith(ONE)
    vi.advanceTimersByTime(WHALE_HOLD_MS)
    expect(face.hooks.whale.getSnapshot().notice).toBeUndefined()
  })

  it('plays the cue on a visible page when the user asked for sound', () => {
    const b = bench()
    b.serve({ ...ENABLED, sound: true })
    b.start()
    complete(b)
    expect(sound.playNoticeSound).toHaveBeenCalledTimes(1)
  })

  it('also raises the OS notification for a visible page when the user asked for it', () => {
    const b = bench()
    b.serve({ ...ENABLED, onlyWhenHidden: false })
    b.start()
    complete(b)
    expect(FakeNotification.raised).toHaveLength(1)
    expect(b.whale().hooks.whale.getSnapshot().notice).not.toBeUndefined()
  })

  it('stays quiet while the browser refuses notifications and the page is hidden', () => {
    FakeNotification.permission = 'denied'
    const b = bench()
    setHidden(true)
    b.serve(ENABLED)
    b.start()
    complete(b)
    expect(FakeNotification.raised).toHaveLength(0)
  })

  it('stays quiet where the browser has no notification API at all', () => {
    vi.stubGlobal('Notification', undefined)
    const b = bench()
    setHidden(true)
    b.serve(ENABLED)
    b.start()
    complete(b)
    expect(FakeNotification.raised).toHaveLength(0)
  })

  it('drops a notice the browser refuses to construct', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const Refusing = function () { throw new Error('notifications are blocked') }
    Refusing.permission = 'granted'
    vi.stubGlobal('Notification', Refusing)
    const b = bench()
    setHidden(true)
    b.serve(ENABLED)
    b.start()
    complete(b)
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('refused the notification'), expect.any(Error),
    )
  })

  it('stands on the schema defaults until the settings document answers', () => {
    const b = bench()
    b.start()
    complete(b)
    expect(b.whale().hooks.whale.getSnapshot().notice).toBeUndefined()
    expect(FakeNotification.raised).toHaveLength(0)
    expect(DESKTOP_NOTIFY_DEFAULTS.enabled).toBe(false)
  })

  it('holds the whale notice for its own window and lets teardown stop the hold', () => {
    const b = bench()
    b.serve(ENABLED)
    b.start()
    complete(b)
    const face = b.whale()
    vi.advanceTimersByTime(WHALE_HOLD_MS - 1)
    expect(face.hooks.whale.getSnapshot().notice).not.toBeUndefined()
    vi.advanceTimersByTime(1)
    expect(face.hooks.whale.getSnapshot().notice).toBeUndefined()

    complete(b)
    expect(face.hooks.whale.getSnapshot().notice).not.toBeUndefined()
    b.stop()
    vi.advanceTimersByTime(WHALE_HOLD_MS)
    expect(face.hooks.whale.getSnapshot().notice).not.toBeUndefined()
  })

  it('waits out the quiet window and follows the session back to running', () => {
    const b = bench()
    b.serve(ENABLED)
    b.start()
    b.pushRows([{ id: ONE, displayTitle: 'Session', running: true }])
    b.status(ONE, false)
    vi.advanceTimersByTime(ENABLED.quietMs - 1)
    expect(b.whale().hooks.whale.getSnapshot().notice).toBeUndefined()
    b.status(ONE, true)
    vi.advanceTimersByTime(ENABLED.quietMs * 2)
    expect(b.whale().hooks.whale.getSnapshot().notice).toBeUndefined()
    b.status(ONE, false)
    vi.advanceTimersByTime(ENABLED.quietMs)
    expect(b.whale().hooks.whale.getSnapshot().notice).not.toBeUndefined()
  })

  it('announces a completion once its Session row comes back', () => {
    const b = bench()
    b.serve(ENABLED)
    b.start()
    b.pushRows([{ id: ONE, displayTitle: 'Session', running: true }])
    b.status(ONE, false)
    // The row leaves before the quiet window elapses, so the notice has
    // nothing to name yet and waits for the list.
    b.pushRows([])
    vi.advanceTimersByTime(ENABLED.quietMs)
    expect(b.whale().hooks.whale.getSnapshot().notice).toBeUndefined()
    b.pushRows([{ id: ONE, displayTitle: 'Session', running: false }])
    expect(b.whale().hooks.whale.getSnapshot().notice?.title).toBe('Session')
  })

  it('raises one notice per pending ask and names the session it can resolve', () => {
    const b = bench()
    b.serve(ENABLED)
    b.start()
    b.pushAsks([{ key: 'question:1', kind: 'plan-review', sessionId: TWO }])
    let state = b.whale().hooks.whale.getSnapshot()
    expect(state.notice).toEqual({
      sessionId: TWO, title: 'desktopNotify:notify.waitingTitle', body: 'desktopNotify:notify.waitingPlan',
    })
    // The same ask polled again is the same notice, not a second one.
    b.pushAsks([{ key: 'question:1', kind: 'plan-review', sessionId: TWO }])
    expect(b.whale().hooks.whale.getSnapshot().seq).toBe(state.seq)
    // Answered: the marker goes, so the next request is a new notice.
    b.pushAsks([])
    b.pushAsks([{ key: 'question:2', kind: 'approval', sessionId: TWO }])
    state = b.whale().hooks.whale.getSnapshot()
    expect(state.notice?.body).toBe('desktopNotify:notify.waitingApproval')
    b.pushAsks([{ key: 'question:3', kind: 'question', sessionId: TWO }])
    expect(b.whale().hooks.whale.getSnapshot().notice?.body).toBe('desktopNotify:notify.waitingAnswer')
    b.pushAsks([{ key: 'question:4', kind: 'unknown-kind', sessionId: TWO }])
    expect(b.whale().hooks.whale.getSnapshot().notice?.body).toBe('desktopNotify:notify.waitingTitle')
  })

  it('names a pending ask after its Session row once the row arrives', () => {
    const b = bench()
    b.serve(ENABLED)
    b.start()
    b.pushAsks([{ key: 'question:1', kind: 'question', sessionId: ONE }])
    expect(b.whale().hooks.whale.getSnapshot().notice?.title).toBe('desktopNotify:notify.waitingTitle')
    b.pushRows([{ id: ONE, displayTitle: 'Session', running: true }])
    b.pushAsks([])
    b.pushAsks([{ key: 'question:2', kind: 'question', sessionId: ONE }])
    expect(b.whale().hooks.whale.getSnapshot().notice?.title).toBe('Session')
  })

  it('leaves pending asks alone while the question switch is off', () => {
    const b = bench()
    b.serve({ ...ENABLED, onQuestion: false })
    b.start()
    b.pushAsks([{ key: 'question:1', kind: 'question', sessionId: ONE }])
    expect(b.whale().hooks.whale.getSnapshot().notice).toBeUndefined()
  })

  it('leaves a subagent finish to the parent turn while still reporting its ask', () => {
    const b = bench()
    b.serve(ENABLED)
    b.start()
    b.pushRows([{ id: TWO, displayTitle: 'Child', running: true, parentId: ONE, origin: 'subagent' }])
    b.status(TWO, false)
    vi.advanceTimersByTime(ENABLED.quietMs)
    expect(b.whale().hooks.whale.getSnapshot().notice).toBeUndefined()
    b.pushAsks([{ key: 'question:1', kind: 'approval', sessionId: TWO }])
    expect(b.whale().hooks.whale.getSnapshot().notice).toEqual({
      sessionId: TWO, title: 'Child', body: 'desktopNotify:notify.waitingApproval',
    })
  })

  it('re-seeds the durable rows after a reconnection', () => {
    const b = bench()
    b.serve(ENABLED)
    b.start()
    complete(b)
    const first = b.whale().hooks.whale.getSnapshot().seq
    b.resetConnection()
    b.pushRows([{ id: ONE, displayTitle: 'Session', running: true }])
    b.status(ONE, false)
    vi.advanceTimersByTime(ENABLED.quietMs)
    expect(b.whale().hooks.whale.getSnapshot().seq).toBe(first + 1)
  })
})
