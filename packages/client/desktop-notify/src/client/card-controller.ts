/**
 * The desktop-notify settings card's projection over its settings scope. The
 * scope owns the durable section and the write fence; this controller only
 * derives what the card renders and republishes it on every scope change.
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { DesktopNotifySettings } from '../settings.ts'
import {
  notificationPermission, requestNotificationPermission, type NotificationPermissionState,
} from './permission.ts'

/** What the card renders. */
export interface DesktopNotifyCardState {
  /** Whether the Host serves this namespace; a card renders nothing while it does not. */
  readonly available: boolean
  /** Whether the Host document accepts writes. */
  readonly writable: boolean
  /** Whether notices are raised at all. */
  readonly enabled: boolean
  /** Whether the OS notification is reserved for a hidden page. */
  readonly onlyWhenHidden: boolean
  /** Whether a pending question also notifies. */
  readonly onQuestion: boolean
  /** Whether the in-page notice is accompanied by the cue. */
  readonly sound: boolean
  /** Current OS notification permission. */
  readonly permission: NotificationPermissionState
}

/** The registration-side face the card's slot entry injects. */
export interface DesktopNotifyCardFace {
  hooks: {
    /** Card snapshot bound by the renderer as useDesktopNotifyCard. */
    desktopNotifyCard: SnapshotStore<DesktopNotifyCardState>
  }
  /** Store the enabled switch. */
  setEnabled(value: boolean): void
  /** Store the hidden-page-only switch. */
  setOnlyWhenHidden(value: boolean): void
  /** Store the ask-notifies switch. */
  setOnQuestion(value: boolean): void
  /** Store the sound switch. */
  setSound(value: boolean): void
  /** Ask the browser for notification permission, then republish the answer. */
  requestPermission(): void
}

/** The unserved projection: nothing to render, and the switches read as off. */
const ABSENT: Omit<DesktopNotifyCardState, 'permission'> = {
  available: false,
  writable: false,
  enabled: false,
  onlyWhenHidden: true,
  onQuestion: true,
  sound: false,
}

/** Bridges the `desktop-notify` scope onto the settings card. */
export class DesktopNotifyCardController {
  private readonly store: SnapshotStore<DesktopNotifyCardState>

  /** @param scope - the bound settings scope for the `desktop-notify` namespace. */
  constructor(private readonly scope: SettingsScope<DesktopNotifySettings>) {
    this.store = createSnapshotStore(this.project())
    scope.subscribe(() => { this.publish() })
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot and its switch actions.
   */
  inject(): DesktopNotifyCardFace {
    return {
      hooks: { desktopNotifyCard: this.store },
      setEnabled: (value) => { void this.scope.set('enabled', value) },
      setOnlyWhenHidden: (value) => { void this.scope.set('onlyWhenHidden', value) },
      setOnQuestion: (value) => { void this.scope.set('onQuestion', value) },
      setSound: (value) => { void this.scope.set('sound', value) },
      requestPermission: () => { void requestNotificationPermission().then(() => { this.publish() }) },
    }
  }

  /** Republish the projection. */
  private publish(): void {
    this.store.set(this.project())
  }

  /**
   * Project the scope snapshot. Before the first accepted section the Host has
   * not answered, so the card has nothing to show; permission is readable
   * either way.
   */
  private project(): DesktopNotifyCardState {
    const snapshot = this.scope.getSnapshot()
    const value = snapshot.value
    if (value === undefined) return { ...ABSENT, permission: notificationPermission() }
    return {
      available: true,
      writable: snapshot.writable,
      enabled: value.enabled,
      onlyWhenHidden: value.onlyWhenHidden,
      onQuestion: value.onQuestion,
      sound: value.sound,
      permission: notificationPermission(),
    }
  }
}
