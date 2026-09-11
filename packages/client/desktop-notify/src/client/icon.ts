/**
 * The toast icon. Windows draws whatever the notification carries, and it
 * scales a favicon poorly, so the whale mark is rasterized here at icon size in
 * the brand blue. Rasterizing needs the canvas API; where it is unavailable the
 * site favicon stands in.
 */

import { FISH_LOGO_PATH, FISH_LOGO_VIEWBOX } from '@deepseek-ai/dsh-client-ui-primitives'

/** Square size of the rasterized icon, in device pixels. */
const ICON_PX = 128
/** Fraction of the icon box the mark occupies. */
const MARK_SCALE = 0.82
/** DeepSeek brand blue, as the favicon uses it. */
const BRAND_BLUE = '#4D6BFE'

let cached: string | undefined

/**
 * Build the icon the OS notification carries.
 * @returns a PNG data URL of the brand mark, or the site favicon URL when the
 * canvas API is unavailable.
 */
export function notificationIcon(): string {
  cached ??= buildIcon()
  return cached
}

function buildIcon(): string {
  const favicon = new URL('favicon.svg', document.baseURI).href
  if (typeof Path2D === 'undefined') return favicon
  const canvas = document.createElement('canvas')
  canvas.width = ICON_PX
  canvas.height = ICON_PX
  const context = canvas.getContext('2d')
  if (context === null) return favicon
  const scale = (ICON_PX * MARK_SCALE) / FISH_LOGO_VIEWBOX.width
  context.scale(scale, scale)
  // Center the mark in the square: after the scale, coordinates are viewBox units.
  context.translate(0, (ICON_PX / scale - FISH_LOGO_VIEWBOX.height) / 2)
  context.fillStyle = BRAND_BLUE
  context.fill(new Path2D(FISH_LOGO_PATH))
  return canvas.toDataURL('image/png')
}
