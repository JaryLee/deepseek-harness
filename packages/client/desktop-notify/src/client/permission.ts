/**
 * Browser notification permission, read defensively: the API is absent in a
 * non-secure context and a request without a user gesture can reject, so both
 * surface as a state the card can render instead of an exception.
 */

/** Permission states the notice surfaces understand. */
export type NotificationPermissionState = 'granted' | 'denied' | 'default' | 'unsupported'

/**
 * Read the current browser notification permission.
 * @returns the permission state, or `unsupported` where the API is absent.
 */
export function notificationPermission(): NotificationPermissionState {
  if (typeof Notification === 'undefined') return 'unsupported'
  return Notification.permission
}

/**
 * Ask the browser for notification permission.
 * @returns the resulting state; a rejected request keeps the current one so a
 * later retry from a real gesture can still succeed.
 */
export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  if (typeof Notification === 'undefined') return 'unsupported'
  try {
    return await Notification.requestPermission()
  } catch (_rejectedWithoutUserGesture) {
    return notificationPermission()
  }
}
