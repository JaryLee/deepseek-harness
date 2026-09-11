/**
 * The notice rules: the quiet window that separates a paused turn from a
 * finished session, what each page state and settings combination raises, the
 * retry that covers a Session row arriving after its status event, and the
 * marker that keeps one pending ask to one notice.
 */

import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  CompletionEngine, MAX_RETRIES, type CompletionPorts, type NotifyNotice, type PendingAsk,
} from '../src/client/engine.ts'
import type { NotificationPermissionState } from '../src/client/permission.ts'
import { DESKTOP_NOTIFY_DEFAULTS, type DesktopNotifySettings } from '../src/settings.ts'

const ONE = 'session-1' as SessionId
const TWO = 'session-2' as SessionId

interface Scheduled {
  delay: number
  run: () => void
}

/** A driven engine: every port is a local handle the case can move. */
function bench(options: {
  settings?: Partial<DesktopNotifySettings>
  permission?: NotificationPermissionState
  hidden?: boolean
  reportable?: boolean
} = {}) {
  const show = vi.fn(() => true)
  const showInline = vi.fn()
  const playSound = vi.fn()
  const scheduled: Scheduled[] = []
  const titles = new Map<SessionId, string>()
  const settings: { -readonly [K in keyof DesktopNotifySettings]: DesktopNotifySettings[K] } = {
    ...DESKTOP_NOTIFY_DEFAULTS, enabled: true, ...options.settings,
  }
  let permission = options.permission ?? 'granted'
  let hidden = options.hidden ?? false
  let reportable = options.reportable ?? true
  const ports: CompletionPorts = {
    getSettings: () => settings,
    getPermission: () => permission,
    isPageHidden: () => hidden,
    isReportable: () => reportable,
    resolveCompletion: (sessionId) => {
      const title = titles.get(sessionId)
      return title === undefined
        ? undefined
        : { sessionId, title, body: 'notify.finished' }
    },
    resolveWaiting: (ask: PendingAsk): NotifyNotice => ({
      sessionId: ask.sessionId,
      title: titles.get(ask.sessionId) ?? 'notify.waitingTitle',
      body: `wait:${ask.kind}`,
    }),
    schedule: (delayMs, run) => {
      scheduled.push({ delay: delayMs, run })
      return () => {
        const at = scheduled.findIndex(entry => entry.run === run)
        if (at >= 0) scheduled.splice(at, 1)
      }
    },
    show,
    showInline,
    playSound,
  }
  return {
    engine: new CompletionEngine(ports),
    show,
    showInline,
    playSound,
    scheduled,
    titles,
    settings,
    setPermission: (next: NotificationPermissionState) => { permission = next },
    setHidden: (next: boolean) => { hidden = next },
    setReportable: (next: boolean) => { reportable = next },
    /** Run every scheduled callback, as the page's timers eventually would. */
    fire: () => { for (const entry of scheduled.splice(0)) entry.run() },
  }
}

/** A finished session whose row is present, up to and including its notice. */
function finish(b: ReturnType<typeof bench>, sessionId: SessionId = ONE, title = 'Session'): void {
  b.titles.set(sessionId, title)
  b.engine.seed([{ id: sessionId, running: true }])
  b.engine.handleStatus(sessionId, false)
  b.fire()
}

describe('CompletionEngine completions', () => {
  it('records only the rows the Host reports as running', () => {
    const b = bench()
    b.engine.seed([{ id: ONE, running: true }, { id: TWO, running: false }])
    b.engine.handleStatus(TWO, false)
    expect(b.scheduled).toHaveLength(0)
    b.engine.handleStatus(ONE, false)
    expect(b.scheduled).toHaveLength(1)
  })

  it('announces only after the quiet window the settings ask for', () => {
    const b = bench({ settings: { quietMs: 2500, onlyWhenHidden: true } })
    b.titles.set(ONE, 'Session')
    b.engine.seed([{ id: ONE, running: true }])
    b.engine.handleStatus(ONE, false)
    expect(b.scheduled).toHaveLength(1)
    expect(b.scheduled[0]!.delay).toBe(2500)
    expect(b.showInline).not.toHaveBeenCalled()
    b.fire()
    expect(b.showInline).toHaveBeenCalledWith({
      sessionId: ONE, title: 'Session', body: 'notify.finished',
    })
  })

  it('cancels a pending window when the session starts running again', () => {
    const b = bench()
    b.titles.set(ONE, 'Session')
    b.engine.seed([{ id: ONE, running: true }])
    b.engine.handleStatus(ONE, false)
    b.engine.handleStatus(ONE, true)
    expect(b.scheduled).toHaveLength(0)
    b.fire()
    expect(b.showInline).not.toHaveBeenCalled()
  })

  it('ignores a stop for a session this page never saw running', () => {
    const b = bench()
    b.titles.set(ONE, 'Session')
    b.engine.handleStatus(ONE, false)
    expect(b.scheduled).toHaveLength(0)
    expect(b.showInline).not.toHaveBeenCalled()
  })

  it('leaves a subagent finish to the parent turn while still reporting its ask', () => {
    const b = bench()
    b.titles.set(ONE, 'Child')
    b.setReportable(false)
    b.engine.seed([{ id: ONE, running: true }])
    b.engine.handleStatus(ONE, false)
    expect(b.scheduled).toHaveLength(0)
    b.engine.handlePending([{ key: 'question:1', sessionId: ONE, kind: 'question' }])
    expect(b.showInline).toHaveBeenCalledTimes(1)
  })

  it('shows the in-page notice while the page is visible, with the cue only when asked for', () => {
    const silent = bench({ settings: { onlyWhenHidden: true, sound: false } })
    finish(silent)
    expect(silent.showInline).toHaveBeenCalledTimes(1)
    expect(silent.playSound).not.toHaveBeenCalled()
    expect(silent.show).not.toHaveBeenCalled()

    const loud = bench({ settings: { onlyWhenHidden: true, sound: true } })
    finish(loud)
    expect(loud.showInline).toHaveBeenCalledTimes(1)
    expect(loud.playSound).toHaveBeenCalledTimes(1)
    expect(loud.show).not.toHaveBeenCalled()
  })

  it('also raises the OS notification for a visible page when the user asked for it', () => {
    const b = bench({ settings: { onlyWhenHidden: false } })
    finish(b)
    expect(b.showInline).toHaveBeenCalledTimes(1)
    expect(b.show).toHaveBeenCalledTimes(1)
  })

  it('keeps a visible page to the in-page notice without permission', () => {
    const b = bench({ settings: { onlyWhenHidden: false }, permission: 'denied' })
    finish(b)
    expect(b.showInline).toHaveBeenCalledTimes(1)
    expect(b.show).not.toHaveBeenCalled()
  })

  it('raises only the OS notification for a hidden page', () => {
    const b = bench({ settings: { onlyWhenHidden: false, sound: true }, hidden: true })
    finish(b)
    expect(b.show).toHaveBeenCalledTimes(1)
    expect(b.showInline).not.toHaveBeenCalled()
    expect(b.playSound).not.toHaveBeenCalled()
  })

  it('raises nothing for a hidden page without permission', () => {
    const b = bench({ hidden: true, permission: 'denied' })
    finish(b)
    expect(b.show).not.toHaveBeenCalled()
    expect(b.showInline).not.toHaveBeenCalled()
  })

  it('raises nothing at all while notifications are off', () => {
    const b = bench({ settings: { enabled: false } })
    finish(b)
    expect(b.show).not.toHaveBeenCalled()
    expect(b.showInline).not.toHaveBeenCalled()
  })

  it('announces a completion once its Session row arrives', () => {
    const b = bench()
    b.engine.seed([{ id: ONE, running: true }])
    b.engine.handleStatus(ONE, false)
    b.fire()
    expect(b.showInline).not.toHaveBeenCalled()

    b.titles.set(ONE, 'Session')
    b.engine.retryCompletions()
    expect(b.showInline).toHaveBeenCalledWith({
      sessionId: ONE, title: 'Session', body: 'notify.finished',
    })
  })

  it('drops a completion whose Session row never arrives', () => {
    const b = bench()
    b.engine.seed([{ id: ONE, running: true }])
    b.engine.handleStatus(ONE, false)
    b.fire()
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) b.engine.retryCompletions()
    b.titles.set(ONE, 'Session')
    b.engine.retryCompletions()
    expect(b.showInline).not.toHaveBeenCalled()
  })
})

describe('CompletionEngine pending asks', () => {
  const ASK: PendingAsk = { key: 'question:1', sessionId: ONE, kind: 'question' }

  it('announces each ask once, whatever the poll does afterwards', () => {
    const b = bench()
    b.titles.set(ONE, 'Session')
    b.engine.handlePending([ASK])
    b.engine.handlePending([ASK])
    expect(b.showInline).toHaveBeenCalledTimes(1)
    expect(b.showInline).toHaveBeenCalledWith({
      sessionId: ONE, title: 'Session', body: 'wait:question',
    })
  })

  it('names an ask whose Session row has not arrived yet', () => {
    const b = bench()
    b.engine.handlePending([ASK])
    expect(b.showInline).toHaveBeenCalledWith({
      sessionId: ONE, title: 'notify.waitingTitle', body: 'wait:question',
    })
  })

  it('carries the ask kind into the notice', () => {
    const b = bench()
    b.engine.handlePending([{ key: 'plan-review:2', sessionId: ONE, kind: 'plan-review' }])
    expect(b.showInline).toHaveBeenCalledWith(
      expect.objectContaining({ body: 'wait:plan-review' }),
    )
  })

  it('announces nothing while notifications are off, then announces once they are on', () => {
    const b = bench({ settings: { enabled: false } })
    b.engine.handlePending([ASK])
    expect(b.showInline).not.toHaveBeenCalled()
    b.settings.enabled = true
    b.engine.handlePending([ASK])
    expect(b.showInline).toHaveBeenCalledTimes(1)
  })

  it('leaves asks alone while the question switch is off', () => {
    const b = bench({ settings: { onQuestion: false } })
    b.engine.handlePending([ASK])
    expect(b.showInline).not.toHaveBeenCalled()
    b.settings.onQuestion = true
    b.engine.handlePending([ASK])
    expect(b.showInline).toHaveBeenCalledTimes(1)
  })

  it('forgets the marker of an ask that is no longer pending', () => {
    const b = bench()
    b.engine.handlePending([ASK])
    b.engine.clearPending([])
    b.engine.handlePending([ASK])
    expect(b.showInline).toHaveBeenCalledTimes(2)
  })

  it('keeps the marker of an ask that is still pending', () => {
    const b = bench()
    b.engine.handlePending([ASK])
    b.engine.clearPending([ASK])
    b.engine.handlePending([ASK])
    expect(b.showInline).toHaveBeenCalledTimes(1)
  })
})

describe('CompletionEngine reset', () => {
  it('cancels the pending window and forgets every observation', () => {
    const b = bench()
    b.titles.set(ONE, 'Session')
    b.engine.seed([{ id: ONE, running: true }])
    b.engine.handlePending([{ key: 'question:1', sessionId: TWO, kind: 'question' }])
    b.engine.handleStatus(ONE, false)
    expect(b.scheduled).toHaveLength(1)

    b.engine.reset()
    expect(b.scheduled).toHaveLength(0)
    b.fire()
    expect(b.showInline).toHaveBeenCalledTimes(1)

    // The running record went with the reset, so a later stop is not a completion.
    b.engine.handleStatus(ONE, false)
    expect(b.scheduled).toHaveLength(0)
    // The ask marker went too.
    b.engine.handlePending([{ key: 'question:1', sessionId: TWO, kind: 'question' }])
    expect(b.showInline).toHaveBeenCalledTimes(2)
  })

  it('keeps one quiet window per session and raises nothing the page cannot show', () => {
    const b = bench()
    b.titles.set(ONE, 'Session')
    b.titles.set(TWO, 'Other')
    b.engine.seed([{ id: ONE, running: true }, { id: TWO, running: true }])
    b.engine.handleStatus(ONE, false)
    b.engine.handleStatus(TWO, true)
    expect(b.scheduled).toHaveLength(1)
    b.engine.handleStatus(TWO, false)
    b.setPermission('denied')
    b.setHidden(true)
    b.fire()
    expect(b.show).not.toHaveBeenCalled()
  })
})
