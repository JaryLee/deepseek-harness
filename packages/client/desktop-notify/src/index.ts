/** Host registration for the browser notification preferences. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import { desktopNotifySettingsSchema } from './schema.ts'
import { DESKTOP_NOTIFY_NS } from './settings.ts'

/**
 * Register the durable desktop-notify section when a settings provider exists.
 * @param ctx - Host context whose optional settings service owns the section.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(DESKTOP_NOTIFY_NS, desktopNotifySettingsSchema)
  })
}
