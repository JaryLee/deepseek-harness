/** The toast icon: the brand mark rasterized at icon size, with the favicon as the floor. */
// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'

const FAVICON = new URL('favicon.svg', document.baseURI).href

/** A fresh module, so the icon cache of one case cannot answer the next. */
async function fresh() {
  vi.resetModules()
  return await import('../src/client/icon.ts')
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('notificationIcon', () => {
  it('falls back to the site favicon without the canvas path API', async () => {
    vi.stubGlobal('Path2D', undefined)
    const { notificationIcon } = await fresh()
    expect(notificationIcon()).toBe(FAVICON)
  })

  it('falls back to the site favicon when the canvas refuses a 2D context', async () => {
    vi.stubGlobal('Path2D', function Path2D() { /* only its presence is inspected */ })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const { notificationIcon } = await fresh()
    expect(notificationIcon()).toBe(FAVICON)
  })

  it('rasterizes the mark in the brand blue and caches the answer', async () => {
    vi.stubGlobal('Path2D', function Path2D() { /* only its presence is inspected */ })
    const context = { scale: vi.fn(), translate: vi.fn(), fill: vi.fn(), fillStyle: '' }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(context as unknown as CanvasRenderingContext2D)
    const toDataURL = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL')
      .mockReturnValue('data:image/png;base64,mark')
    const { notificationIcon } = await fresh()
    expect(notificationIcon()).toBe('data:image/png;base64,mark')
    expect(context.fillStyle).toBe('#4D6BFE')
    expect(context.scale).toHaveBeenCalledTimes(1)
    expect(context.translate).toHaveBeenCalledTimes(1)
    expect(notificationIcon()).toBe('data:image/png;base64,mark')
    expect(toDataURL).toHaveBeenCalledTimes(1)
  })
})
