/** The desktop-notify section's client-side decoder and its fallback defaults. */

import { describe, expect, it } from 'vitest'
import {
  DESKTOP_NOTIFY_DEFAULTS, DESKTOP_NOTIFY_NS, decodeDesktopNotifySettings,
} from '../src/settings.ts'

const SECTION = { enabled: true, onlyWhenHidden: false, onQuestion: true, sound: true, quietMs: 2500 }

describe('decodeDesktopNotifySettings', () => {
  it('narrows a served section and freezes the result', () => {
    const decoded = decodeDesktopNotifySettings(SECTION)
    expect(decoded).toEqual(SECTION)
    expect(Object.isFrozen(decoded)).toBe(true)
  })

  it('defaults the question switch on for a section written before it existed', () => {
    const older = { enabled: true, onlyWhenHidden: false, sound: true, quietMs: 2500 }
    expect(decodeDesktopNotifySettings(older)).toEqual({ ...older, onQuestion: true })
  })

  it('refuses anything that is not an object section', () => {
    for (const value of [undefined, null, 3, 'section', [], ['enabled']]) {
      expect(decodeDesktopNotifySettings(value)).toBeUndefined()
    }
  })

  it('refuses a section whose fields are not the declared primitives', () => {
    expect(decodeDesktopNotifySettings({ ...SECTION, enabled: 'yes' })).toBeUndefined()
    expect(decodeDesktopNotifySettings({ ...SECTION, onlyWhenHidden: 1 })).toBeUndefined()
    expect(decodeDesktopNotifySettings({ ...SECTION, onQuestion: null })).toBeUndefined()
    expect(decodeDesktopNotifySettings({ ...SECTION, sound: {} })).toBeUndefined()
    expect(decodeDesktopNotifySettings({ ...SECTION, quietMs: '1500' })).toBeUndefined()
    expect(decodeDesktopNotifySettings({ ...SECTION, quietMs: Number.NaN })).toBeUndefined()
    expect(decodeDesktopNotifySettings({ ...SECTION, quietMs: Number.POSITIVE_INFINITY })).toBeUndefined()
  })

  it('names the namespace and the values the Host resolves when the user chooses nothing', () => {
    expect(DESKTOP_NOTIFY_NS).toBe('desktop-notify')
    expect(DESKTOP_NOTIFY_DEFAULTS).toEqual({
      enabled: false, onlyWhenHidden: true, onQuestion: true, sound: false, quietMs: 1500,
    })
  })
})
