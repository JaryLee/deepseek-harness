/**
 * The in-page notice: the artwork's whale breaching out of the artwork's sea.
 *
 * Nothing here is drawn. The layers are the illustration's own pixels — the
 * scene, the whale, the spray, and the water from the waterline down — and the
 * component only stages them: the whale breaches on its own curve, the spray
 * bursts where it crosses the waterline (once going up, once coming down), the
 * droplets fly with each burst, and the water layer hides the whale while it is
 * under the surface. Layer boxes come from `art.ts` as percentages of the scene
 * they were measured in, so the composite is the artwork's composition.
 */

import type { CSSProperties } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: ui-layout declares the shell.overlay SlotMap entry this overlay registers into.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { NotifyNotice } from './engine.ts'
import type { WhaleState } from './whale-store.ts'
import {
  ART_BACKDROP, ART_BUBBLE, ART_SPLASH, ART_WATERLINE, ART_WHALE, type ArtLayer,
} from './art.ts'
import { NS } from './locales.ts'
import css from './whale.module.css'

/** One droplet's launch: where it starts, how big it is, and where it flies. */
interface Droplet {
  /** Left as a percent of the scene width. */
  readonly x: number
  /** Top as a percent of the scene height. */
  readonly y: number
  /** Diameter as a percent of the scene width. */
  readonly size: number
  /** Horizontal travel, as a percent of the scene width. */
  readonly dx: number
  /** Vertical travel, as a percent of the scene width. */
  readonly dy: number
  /** Delay inside the cycle, in seconds. */
  readonly delay: number
}

/** Six droplets ride the launch and six ride the entry, as the reference does. */
const DROPLETS: readonly Droplet[] = [
  { x: 30, y: 58, size: 1.5, dx: -7, dy: -30, delay: 0.1 },
  { x: 36, y: 52, size: 1.0, dx: -4, dy: -36, delay: 0.35 },
  { x: 43, y: 60, size: 1.9, dx: 2, dy: -33, delay: 0.15 },
  { x: 50, y: 55, size: 1.2, dx: 6, dy: -40, delay: 0.6 },
  { x: 57, y: 61, size: 1.6, dx: 9, dy: -28, delay: 0.45 },
  { x: 64, y: 54, size: 1.1, dx: 12, dy: -34, delay: 0.7 },
  { x: 70, y: 59, size: 1.7, dx: 5, dy: -26, delay: 2.7 },
  { x: 25, y: 63, size: 1.3, dx: -11, dy: -22, delay: 2.95 },
  { x: 76, y: 62, size: 1.4, dx: 8, dy: -24, delay: 3.2 },
  { x: 47, y: 49, size: 0.9, dx: -1, dy: -42, delay: 2.75 },
  { x: 61, y: 50, size: 1.0, dx: 3, dy: -38, delay: 3.05 },
  { x: 38, y: 57, size: 1.4, dx: -6, dy: -29, delay: 3.3 },
]

/** The registration-side face the overlay's slot entry injects. */
export interface WhaleFace {
  hooks: {
    /** Notice source bound by the renderer as useWhale. */
    whale: SnapshotStore<WhaleState>
  }
  /**
   * Bring the noticed session to the front.
   * @param sessionId - session the notice is about.
   */
  openSession(sessionId: SessionId): void
}

/** Props of the presentational whale stage. */
export interface WhaleStageProps {
  /** The notice to show. */
  notice: NotifyNotice
  /** Localized accessible name of the open control. */
  openLabel: string
  /** Bring the noticed session to the front. */
  onOpen(): void
}

/** Props the renderer binds for the overlay. */
export type WhaleNoticeOverlayProps =
  PropsRuntime<'shell.overlay'>
  & PropsLocale<typeof NS>
  & InjectFace<WhaleFace>

/**
 * Render the notice overlay, or nothing between showings.
 * @param props - locale copy, the notice source, and the two operations.
 * @returns the whale scene, remounted per showing so the breach restarts.
 */
export function WhaleNoticeOverlay(props: WhaleNoticeOverlayProps) {
  const { t } = props
  const { notice, seq } = props.useWhale(snapshot => snapshot)
  if (notice === undefined) return null
  return (
    <WhaleStage
      key={seq}
      notice={notice}
      openLabel={t('notice.open')}
      onOpen={() => { props.openSession(notice.sessionId) }}
    />
  )
}

/**
 * Render the breaching whale and its message bubble.
 * @param props - the notice, its accessible names, and the two operations.
 * @returns the stage.
 */
export function WhaleStage(props: WhaleStageProps) {
  return (
    <div className={css.layer} data-whale-scene={props.notice.sessionId}>
      <div className={css.stage}>
        <img className={css.backdrop} src={ART_BACKDROP} alt="" aria-hidden="true" />
        <div className={css.whalePos} style={boxOf(ART_WHALE)}>
          <div className={css.whaleBob}>
            <img className={css.whale} src={ART_WHALE.src} alt="" aria-hidden="true" data-whale-mark="whale" />
          </div>
        </div>
        <img className={css.waterline} style={{ top: `${ART_WATERLINE.top}%` }} src={ART_WATERLINE.src} alt="" aria-hidden="true" />
        <img className={`${css.splash} ${css.splashLaunch}`} style={boxOf(ART_SPLASH)} src={ART_SPLASH.src} alt="" aria-hidden="true" />
        <img className={`${css.splash} ${css.splashLand}`} style={boxOf(ART_SPLASH)} src={ART_SPLASH.src} alt="" aria-hidden="true" />
        <div className={css.droplets} aria-hidden="true">
          {DROPLETS.map(drop => (
            <i key={`${drop.x}-${drop.y}`} className={css.drop} style={dropStyle(drop)} />
          ))}
        </div>
      </div>
      <div className={css.bubble} data-whale-bubble="" role="status" aria-live="polite">
        <img className={css.bubbleArt} src={ART_BUBBLE.src} alt="" aria-hidden="true" />
        <button
          type="button"
          className={css.bubbleOpen}
          title={props.openLabel}
          onClick={() => { props.onOpen() }}
        >
          <span className={css.bubbleTitle}>{props.notice.title}</span>
          <span className={css.bubbleBody}>{props.notice.body}</span>
        </button>
      </div>
    </div>
  )
}

/**
 * Place one artwork layer inside the scene box.
 * @param layer - the layer's image and its percentage box.
 * @returns the inline style that positions it.
 */
function boxOf(layer: ArtLayer): CSSProperties {
  return { left: `${layer.left}%`, top: `${layer.top}%`, width: `${layer.width}%` }
}

/**
 * Place one droplet and give it its flight.
 * @param drop - the droplet's launch and travel.
 * @returns the custom properties the droplet's animation reads.
 */
function dropStyle(drop: Droplet): CSSProperties {
  return {
    '--x': `${drop.x}%`,
    '--y': `${drop.y}%`,
    '--s': `${drop.size}cqw`,
    '--dx': `${drop.dx}cqw`,
    '--dy': `${drop.dy}cqw`,
    '--d': `${drop.delay}s`,
  } as CSSProperties
}
