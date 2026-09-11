/** The settings card: what each switch writes, and what the permission line offers. */
// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { DesktopNotifyCard, type DesktopNotifyCardProps } from '../src/client/card.tsx'
import type { DesktopNotifyCardState } from '../src/client/card-controller.ts'

const STATE: DesktopNotifyCardState = {
  available: true,
  writable: true,
  enabled: true,
  onlyWhenHidden: true,
  onQuestion: true,
  sound: false,
  permission: 'granted',
}

/** Mount the card over a real store, with the framework shares it never reads. */
function mount(overrides: Partial<DesktopNotifyCardState> = {}) {
  const store = createSnapshotStore<DesktopNotifyCardState>({ ...STATE, ...overrides })
  const face = {
    setEnabled: vi.fn(),
    setOnlyWhenHidden: vi.fn(),
    setOnQuestion: vi.fn(),
    setSound: vi.fn(),
    requestPermission: vi.fn(),
  }
  const props = {
    ...face,
    useDesktopNotifyCard: bindSnapshotSelector(store),
    t: (key: string) => key,
  } as unknown as DesktopNotifyCardProps
  render(<DesktopNotifyCard {...props} />)
  return face
}

const toggle = (name: string): HTMLElement => screen.getByRole('switch', { name })
const checked = (name: string): string | null => toggle(name).getAttribute('aria-checked')

afterEach(cleanup)

describe('DesktopNotifyCard', () => {
  it('renders nothing while the Host serves no such namespace', () => {
    mount({ available: false })
    expect(screen.queryByRole('switch')).toBeNull()
    expect(document.querySelector('li')).toBeNull()
  })

  it('renders the four switches and the permission the browser holds', () => {
    mount()
    expect(screen.getByText('card.title')).toBeDefined()
    expect(checked('field.enabled')).toBe('true')
    expect(checked('field.onlyWhenHidden')).toBe('true')
    expect(checked('field.onQuestion')).toBe('true')
    expect(checked('field.sound')).toBe('false')
    expect(screen.getByText('permission.granted')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'permission.request' })).toBeNull()
  })

  it('writes the opposite of the current state for each switch', () => {
    const face = mount()
    fireEvent.click(toggle('field.enabled'))
    fireEvent.click(toggle('field.onlyWhenHidden'))
    fireEvent.click(toggle('field.onQuestion'))
    fireEvent.click(toggle('field.sound'))
    expect(face.setEnabled).toHaveBeenCalledWith(false)
    expect(face.setOnlyWhenHidden).toHaveBeenCalledWith(false)
    expect(face.setOnQuestion).toHaveBeenCalledWith(false)
    expect(face.setSound).toHaveBeenCalledWith(true)
  })

  it('offers the permission request only while the browser has not chosen', () => {
    const face = mount({ permission: 'default' })
    expect(screen.getByText('permission.default')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'permission.request' }))
    expect(face.requestPermission).toHaveBeenCalledTimes(1)
  })

  it('locks every switch but the master one while notifications are off', () => {
    mount({ enabled: false })
    expect(toggle('field.enabled').hasAttribute('disabled')).toBe(false)
    expect(toggle('field.onlyWhenHidden').hasAttribute('disabled')).toBe(true)
    expect(toggle('field.onQuestion').hasAttribute('disabled')).toBe(true)
    expect(toggle('field.sound').hasAttribute('disabled')).toBe(true)
  })

  it('locks the whole card while the Host document refuses writes', () => {
    mount({ writable: false, permission: 'default' })
    for (const name of ['field.enabled', 'field.onlyWhenHidden', 'field.onQuestion', 'field.sound']) {
      expect(toggle(name).hasAttribute('disabled')).toBe(true)
    }
    expect(screen.getByRole('button', { name: 'permission.request' }).hasAttribute('disabled')).toBe(true)
  })
})
