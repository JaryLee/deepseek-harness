/** Browser notification permission, read and requested defensively. */
// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { notificationPermission, requestNotificationPermission } from '../src/client/permission.ts'

afterEach(() => { vi.unstubAllGlobals() })

describe('notificationPermission', () => {
  it('reports the state the browser holds', () => {
    vi.stubGlobal('Notification', { permission: 'denied' })
    expect(notificationPermission()).toBe('denied')
  })

  it('reports an environment without the API', () => {
    vi.stubGlobal('Notification', undefined)
    expect(notificationPermission()).toBe('unsupported')
  })
})

describe('requestNotificationPermission', () => {
  it('answers with what the browser grants', async () => {
    vi.stubGlobal('Notification', { requestPermission: () => Promise.resolve('granted') })
    await expect(requestNotificationPermission()).resolves.toBe('granted')
  })

  it('keeps the current state when the request is refused without a gesture', async () => {
    vi.stubGlobal('Notification', {
      permission: 'default',
      requestPermission: () => Promise.reject(new Error('a user gesture is required')),
    })
    await expect(requestNotificationPermission()).resolves.toBe('default')
  })

  it('refuses to ask where the API is absent', async () => {
    vi.stubGlobal('Notification', undefined)
    await expect(requestNotificationPermission()).resolves.toBe('unsupported')
  })
})
