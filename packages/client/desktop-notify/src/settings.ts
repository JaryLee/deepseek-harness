/**
 * Shared desktop-notify settings contract: the settings namespace constant,
 * the resolved section shape, and a client-side narrow decoder. Pure module —
 * imported by both halves and inlineable into the client bundle.
 */

/** Settings namespace owned by the desktop-notify plugin. */
export const DESKTOP_NOTIFY_NS = 'desktop-notify'

/** Quiet window before a completion is announced, when the user has chosen nothing. */
export const DEFAULT_QUIET_MS = 1500

/** Resolved `desktop-notify` settings section (schema defaults applied host-side). */
export interface DesktopNotifySettings {
  /** Whether completed sessions or pending user questions raise an OS notification. */
  readonly enabled: boolean
  /** Whether only a hidden page (minimized window or background tab) notifies. */
  readonly onlyWhenHidden: boolean
  /** Whether a session asking the user a question raises an OS notification. */
  readonly onQuestion: boolean
  /** Whether the notification plays the system sound. */
  readonly sound: boolean
  /** Quiet window before a completion is announced, in milliseconds. */
  readonly quietMs: number
}

/**
 * Schema defaults, shared with the browser half: a status event can arrive
 * before this page has read the settings document, and the notice rules then
 * have to stand on the same values the Host would have resolved.
 */
export const DESKTOP_NOTIFY_DEFAULTS: DesktopNotifySettings = Object.freeze({
  enabled: false,
  onlyWhenHidden: true,
  onQuestion: true,
  sound: false,
  quietMs: DEFAULT_QUIET_MS,
})

/**
 * Narrow an unknown wire section to the settings shape; anything that is not
 * an object with the expected JSON primitives is undefined. The older
 * four-field section stays decodable with `onQuestion` defaulting on.
 * @param section - the Host-served raw section.
 * @returns the narrowed section, or undefined when the shape is not this namespace's.
 */
export function decodeDesktopNotifySettings(section: unknown): DesktopNotifySettings | undefined {
  if (typeof section !== 'object' || section === null || Array.isArray(section)) return undefined
  const record = section as Record<string, unknown>
  const { enabled, onlyWhenHidden, sound, quietMs } = record
  const onQuestion = record.onQuestion === undefined ? true : record.onQuestion
  if (typeof enabled !== 'boolean' || typeof onlyWhenHidden !== 'boolean'
    || typeof sound !== 'boolean' || typeof onQuestion !== 'boolean'
    || typeof quietMs !== 'number' || !Number.isFinite(quietMs)) {
    return undefined
  }
  return Object.freeze({ enabled, onlyWhenHidden, onQuestion, sound, quietMs })
}
