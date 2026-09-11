/** The card controller's projection over its settings scope. */
// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { DesktopNotifyCardController } from '../src/client/card-controller.ts'
import type { DesktopNotifySettings } from '../src/settings.ts'

const SECTION: DesktopNotifySettings = {
  enabled: true, onlyWhenHidden: false, onQuestion: false, sound: true, quietMs: 800,
}

/** A scope whose snapshot, listeners, and writes the case drives directly. */
function bench(initial: Partial<SettingsScopeSnapshot<DesktopNotifySettings>> = {}) {
  let snapshot: SettingsScopeSnapshot<DesktopNotifySettings> = {
    status: 'loading',
    value: undefined,
    base: undefined,
    user: undefined,
    revision: undefined,
    writable: false,
    mode: 'host',
    ...initial,
  }
  const listeners = new Set<() => void>()
  const set = vi.fn(() => Promise.resolve())
  const scope = {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    mutate: vi.fn(() => Promise.resolve()),
    set,
    unset: vi.fn(() => Promise.resolve()),
  } as unknown as SettingsScope<DesktopNotifySettings>
  return {
    set,
    controller: new DesktopNotifyCardController(scope),
    publish: (next: Partial<SettingsScopeSnapshot<DesktopNotifySettings>>) => {
      snapshot = { ...snapshot, ...next }
      for (const listener of [...listeners]) listener()
    },
  }
}

afterEach(() => { vi.unstubAllGlobals() })

describe('DesktopNotifyCardController', () => {
  it('renders nothing until the Host serves the namespace', () => {
    vi.stubGlobal('Notification', { permission: 'default' })
    const b = bench()
    expect(b.controller.inject().hooks.desktopNotifyCard.getSnapshot()).toEqual({
      available: false,
      writable: false,
      enabled: false,
      onlyWhenHidden: true,
      onQuestion: true,
      sound: false,
      permission: 'default',
    })
  })

  it('projects the served section and republishes on every scope change', () => {
    vi.stubGlobal('Notification', { permission: 'granted' })
    const b = bench()
    const store = b.controller.inject().hooks.desktopNotifyCard
    b.publish({ status: 'ready', value: SECTION, writable: true })
    expect(store.getSnapshot()).toEqual({
      available: true,
      writable: true,
      enabled: true,
      onlyWhenHidden: false,
      onQuestion: false,
      sound: true,
      permission: 'granted',
    })
    b.publish({ writable: false })
    expect(store.getSnapshot()).toMatchObject({ available: true, writable: false })
  })

  it('stores each switch through the scope', () => {
    const b = bench()
    const face = b.controller.inject()
    face.setEnabled(true)
    face.setOnlyWhenHidden(false)
    face.setOnQuestion(false)
    face.setSound(true)
    expect(b.set.mock.calls).toEqual([
      ['enabled', true],
      ['onlyWhenHidden', false],
      ['onQuestion', false],
      ['sound', true],
    ])
  })

  it('asks for permission from the gesture and republishes the answer', async () => {
    const notification = {
      permission: 'default' as NotificationPermission,
      requestPermission: () => {
        notification.permission = 'granted'
        return Promise.resolve('granted' as NotificationPermission)
      },
    }
    vi.stubGlobal('Notification', notification)
    const b = bench({ status: 'ready', value: SECTION, writable: true })
    const store = b.controller.inject().hooks.desktopNotifyCard
    expect(store.getSnapshot().permission).toBe('default')
    b.controller.inject().requestPermission()
    await vi.waitFor(() => { expect(store.getSnapshot().permission).toBe('granted') })
  })
})
