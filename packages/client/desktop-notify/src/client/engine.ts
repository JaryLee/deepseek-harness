/**
 * Completion and pending-question observations behind the desktop notices.
 *
 * The engine owns when a notice is due; it performs no browser or React work
 * itself. Every collaborator arrives as a port, so the timing rules — the quiet
 * window that separates a paused turn from a finished session, the retry that
 * covers a Session row arriving after its status event, and the marker that
 * keeps one pending ask to one notice — are testable without a DOM.
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { DesktopNotifySettings } from '../settings.ts'
import type { NotificationPermissionState } from './permission.ts'

/** Attempts at resolving a finished Session's row before its notice is dropped. */
export const MAX_RETRIES = 4

/** One notice the plugin can raise. */
export interface NotifyNotice {
  /** Session the notice is about; also what opening the notice navigates to. */
  readonly sessionId: SessionId
  /** First line, naming the session or the state when the session is unknown. */
  readonly title: string
  /** Second line, naming what happened. */
  readonly body: string
}

/** One pending ask as the engine dedupes it. */
export interface PendingAsk {
  /** Opaque request identity; a replacement request carries a new key. */
  readonly key: string
  /** Session whose UI can answer the ask. */
  readonly sessionId: SessionId
  /** Domain-owned presentation discriminator, which picks the notice's wording. */
  readonly kind: string
}

/** One durable session row, as far as completion tracking reads it. */
export interface RunningRow {
  /** Durable Session identity. */
  readonly id: SessionId
  /** Whether the Host currently reports the session as running. */
  readonly running: boolean
}

/** Everything the engine needs from the page, the transport, and the audio. */
export interface CompletionPorts {
  /** Current user settings. */
  getSettings(): DesktopNotifySettings
  /** Current OS notification permission. */
  getPermission(): NotificationPermissionState
  /** Whether the page is a background tab or a minimized window. */
  isPageHidden(): boolean
  /**
   * Whether a finished session is one the user is told about. A subagent's
   * finish belongs to the parent turn that scheduled it, so it is not; an
   * unknown session is still reportable, because its row may simply be late.
   * @param sessionId - session that stopped running.
   */
  isReportable(sessionId: SessionId): boolean
  /** Describe a finished Session, or undefined while its row is still missing. */
  resolveCompletion(sessionId: SessionId): NotifyNotice | undefined
  /** Describe a pending ask, naming the session by its row or a generic title. */
  resolveWaiting(ask: PendingAsk): NotifyNotice
  /**
   * Run {@link run} after {@link delayMs}.
   * @returns the canceller.
   */
  schedule(delayMs: number, run: () => void): () => void
  /** Raise the OS notification. @returns whether the OS accepted it. */
  show(notice: NotifyNotice): boolean
  /** Raise the in-page notice. */
  showInline(notice: NotifyNotice): void
  /** Play the notice cue. */
  playSound(): void
}

/**
 * Completion and pending-ask observations for one page session. `schedule` must
 * not run its callback synchronously; the engine records the canceller after
 * the call returns.
 */
export class CompletionEngine {
  private readonly running = new Set<SessionId>()
  private readonly deferred = new Map<SessionId, number>()
  private readonly announced = new Set<string>()
  private readonly quiet = new Map<SessionId, () => void>()

  /** @param ports - page, transport, and audio collaborators. */
  constructor(private readonly ports: CompletionPorts) {}

  /**
   * Adopt the durable rows' running flags. Only running rows are recorded: a
   * completion is announced when a known-running session stops, so a row that
   * turns false before its status event arrives keeps its record until the
   * event lands.
   * @param rows - current durable session rows.
   */
  seed(rows: readonly RunningRow[]): void {
    for (const row of rows) if (row.running) this.running.add(row.id)
  }

  /**
   * Observe one agent status event. A stop opens the quiet window; whatever
   * the session did in between is what the notice describes. A subagent's stop
   * is reported by its parent turn instead, and a stop for a session this page
   * never saw running is not a completion observation at all.
   * @param sessionId - session whose status moved.
   * @param running - whether the agent is running.
   */
  handleStatus(sessionId: SessionId, running: boolean): void {
    this.clearQuiet(sessionId)
    if (running) {
      this.running.add(sessionId)
      this.deferred.delete(sessionId)
      return
    }
    if (!this.running.delete(sessionId)) return
    if (!this.ports.isReportable(sessionId)) return
    this.quiet.set(sessionId, this.ports.schedule(this.ports.getSettings().quietMs, () => {
      this.quiet.delete(sessionId)
      const notice = this.ports.resolveCompletion(sessionId)
      if (notice === undefined) this.defer(sessionId)
      else this.announce(notice)
    }))
  }

  /**
   * Announce every pending ask this page has not announced yet, unless the
   * user turned the question switch off. Idempotent, so the durable list may
   * call it again once a missing row arrives.
   * @param asks - the current pending asks.
   */
  handlePending(asks: readonly PendingAsk[]): void {
    if (!this.ports.getSettings().onQuestion) return
    for (const ask of asks) {
      if (this.announced.has(ask.key)) continue
      if (this.announce(this.ports.resolveWaiting(ask))) this.announced.add(ask.key)
    }
  }

  /**
   * Forget the markers of asks that are no longer pending, so the marker set
   * stays the size of the pending set rather than of the page's session.
   * @param asks - the current pending asks.
   */
  clearPending(asks: readonly PendingAsk[]): void {
    const live = new Set(asks.map(ask => ask.key))
    for (const key of [...this.announced]) if (!live.has(key)) this.announced.delete(key)
  }

  /**
   * Re-resolve the completions that raced their Session row. A completion whose
   * row never arrives is dropped after {@link MAX_RETRIES} attempts.
   */
  retryCompletions(): void {
    for (const [sessionId, attempts] of [...this.deferred]) {
      const notice = this.ports.resolveCompletion(sessionId)
      if (notice !== undefined) {
        this.deferred.delete(sessionId)
        this.announce(notice)
        continue
      }
      if (attempts >= MAX_RETRIES) this.deferred.delete(sessionId)
      else this.deferred.set(sessionId, attempts + 1)
    }
  }

  /** Drop every observation; a reconnected page re-seeds from the durable rows. */
  reset(): void {
    for (const cancel of this.quiet.values()) cancel()
    this.quiet.clear()
    this.running.clear()
    this.deferred.clear()
    this.announced.clear()
  }

  /** Cancel one session's quiet window, if it has one. */
  private clearQuiet(sessionId: SessionId): void {
    const cancel = this.quiet.get(sessionId)
    if (cancel === undefined) return
    cancel()
    this.quiet.delete(sessionId)
  }

  /** Remember a finished session whose row has not reached this page yet. */
  private defer(sessionId: SessionId): void {
    this.deferred.set(sessionId, 1)
  }

  /**
   * Raise one notice on the channels the current settings and page state allow.
   * @param notice - what to raise.
   * @returns whether the user was told at all, which is what marks an ask announced.
   */
  private announce(notice: NotifyNotice): boolean {
    const settings = this.ports.getSettings()
    if (!settings.enabled) return false
    if (this.ports.isPageHidden()) {
      return this.ports.getPermission() === 'granted' && this.ports.show(notice)
    }
    this.ports.showInline(notice)
    if (settings.sound) this.ports.playSound()
    if (settings.onlyWhenHidden) return true
    return this.ports.getPermission() === 'granted' && this.ports.show(notice)
  }
}
