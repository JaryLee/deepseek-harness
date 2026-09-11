/** The Host half: one durable section, its defaults, and its bounds. */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { apply } from '../src/index.ts'
import { DESKTOP_NOTIFY_DEFAULTS, DESKTOP_NOTIFY_NS } from '../src/settings.ts'

class MemorySettings extends SettingsProvider {
  readonly writable = true
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
}

describe('desktop-notify host', () => {
  it('registers, validates, and disposes the durable section with its fiber', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    expect(ctx.settings.get(DESKTOP_NOTIFY_NS)).toEqual(DESKTOP_NOTIFY_DEFAULTS)
    await ctx.settings.update(DESKTOP_NOTIFY_NS, { enabled: true, quietMs: 3000 })
    expect(ctx.settings.get(DESKTOP_NOTIFY_NS)).toEqual({
      ...DESKTOP_NOTIFY_DEFAULTS, enabled: true, quietMs: 3000,
    })
    await expect(ctx.settings.update(DESKTOP_NOTIFY_NS, { quietMs: -1 })).rejects.toThrow()
    await expect(ctx.settings.update(DESKTOP_NOTIFY_NS, { quietMs: 60_001 })).rejects.toThrow()
    await expect(ctx.settings.update(DESKTOP_NOTIFY_NS, { enabled: 'yes' })).rejects.toThrow()
    await fiber.dispose()
    expect(ctx.settings.describe().map(row => row.ns)).not.toContain(DESKTOP_NOTIFY_NS)
  })

  it('mounts without a settings provider, contributing nothing', async () => {
    const ctx = new Context()
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    await fiber.dispose()
    expect(ctx.get('settings')).toBeUndefined()
  })
})
