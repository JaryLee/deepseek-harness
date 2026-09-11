/** Host-side schema for the `desktop-notify` settings section. */

import z from '@deepseek-ai/schemastery'
import { DESKTOP_NOTIFY_DEFAULTS, type DesktopNotifySettings } from './settings.ts'

/**
 * Validated schema for the desktop-notify settings section. Namespace fields
 * are the plugin's user-facing tunables; quietMs bounds the debounce window
 * that separates a paused mid-task turn from a finished session.
 */
export const desktopNotifySettingsSchema: z<DesktopNotifySettings> = z.object({
  /** Opt-in: sessions notify only after the user enables the feature. */
  enabled: z.boolean().default(DESKTOP_NOTIFY_DEFAULTS.enabled),
  /** Match the requested minimize-while-working behavior; off notifies always. */
  onlyWhenHidden: z.boolean().default(DESKTOP_NOTIFY_DEFAULTS.onlyWhenHidden),
  /** A session asking the user a question notifies; off only announces completion. */
  onQuestion: z.boolean().default(DESKTOP_NOTIFY_DEFAULTS.onQuestion),
  /** Notification sound; off leaves the in-page notice silent. */
  sound: z.boolean().default(DESKTOP_NOTIFY_DEFAULTS.sound),
  /** Debounce before announcing completion (0 disables the window). */
  quietMs: z.number().step(1).min(0).max(60_000).default(DESKTOP_NOTIFY_DEFAULTS.quietMs),
})
