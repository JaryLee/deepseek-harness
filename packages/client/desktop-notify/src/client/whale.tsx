/**
 * The in-page notice: a flat-illustration whale breaching out of a moving sea.
 *
 * Everything is one SVG scene with no rectangular container — the sky is a
 * glow that fades into the app, the sea is wave silhouettes that fade at their
 * left and deep edges, and the splash is drawn around the waterline — so the
 * notice never shows a frame. The surface is one fixed waterline and two copies
 * of the same whale: the copy above the line is the dry body, the copy below it
 * is refracted — blurred and darkened, with the water's tint and caustics over
 * it. Both copies run the same leap animation, so which one shows is decided by
 * where the whale is, not by a second animation.
 */

import { useId } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: ui-layout declares the shell.overlay SlotMap entry this overlay registers into.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { NotifyNotice } from './engine.ts'
import type { WhaleState } from './whale-store.ts'
import { NS } from './locales.ts'
import css from './whale.module.css'

/** The waterline in scene coordinates, and the sea's depth below it. */
const WATERLINE = 300
/** Width and height of the scene, in the same units as the stage's pixels. */
const SCENE = { width: 340, height: 440 }
/** Where the whale sits before the leap moves it. */
const WHALE = { x: 158, y: 380 }

/** Wave silhouettes: deep to front, each spanning past both scene edges. The
 * deep wave's crest is the visible surface, so the whale's clip line is the
 * water it is actually cut against. */
const WAVE = {
  deep: `M-24 304 C40 292 78 316 132 310 C186 304 226 288 364 298 L364 ${SCENE.height} L-24 ${SCENE.height} Z`,
  mid: `M-24 336 C30 322 82 348 140 340 C198 332 250 314 364 328 L364 ${SCENE.height} L-24 ${SCENE.height} Z`,
  front: `M-24 364 C36 350 84 374 146 364 C208 354 262 338 364 352 L364 ${SCENE.height} L-24 ${SCENE.height} Z`,
}

/** The splash crown: spikes breaking around the waterline, tallest at the middle. */
const CROWN = [
  `M${WHALE.x - 96} ${WATERLINE + 8}`,
  `C${WHALE.x - 88} ${WATERLINE - 16} ${WHALE.x - 80} ${WATERLINE - 40} ${WHALE.x - 70} ${WATERLINE - 26}`,
  `C${WHALE.x - 64} ${WATERLINE - 54} ${WHALE.x - 54} ${WATERLINE - 66} ${WHALE.x - 48} ${WATERLINE - 32}`,
  `C${WHALE.x - 42} ${WATERLINE - 72} ${WHALE.x - 30} ${WATERLINE - 84} ${WHALE.x - 24} ${WATERLINE - 28}`,
  `C${WHALE.x - 16} ${WATERLINE - 96} ${WHALE.x - 2} ${WATERLINE - 102} ${WHALE.x + 2} ${WATERLINE - 24}`,
  `C${WHALE.x + 10} ${WATERLINE - 88} ${WHALE.x + 24} ${WATERLINE - 76} ${WHALE.x + 28} ${WATERLINE - 30}`,
  `C${WHALE.x + 36} ${WATERLINE - 62} ${WHALE.x + 48} ${WATERLINE - 50} ${WHALE.x + 54} ${WATERLINE - 32}`,
  `C${WHALE.x + 64} ${WATERLINE - 56} ${WHALE.x + 82} ${WATERLINE - 30} ${WHALE.x + 96} ${WATERLINE + 8}`,
  `C${WHALE.x + 50} ${WATERLINE - 6} ${WHALE.x - 50} ${WATERLINE - 6} ${WHALE.x - 96} ${WATERLINE + 8} Z`,
].join(' ')

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
  /**
   * Dismiss one showing.
   * @param seq - showing identity the overlay is rendering.
   */
  dismiss(seq: number): void
}

/** Props of the presentational whale stage. */
export interface WhaleStageProps {
  /** The notice to show. */
  notice: NotifyNotice
  /** Localized accessible name of the open control. */
  openLabel: string
  /** Localized accessible name of the dismiss control. */
  dismissLabel: string
  /** Bring the noticed session to the front. */
  onOpen(): void
  /** Dismiss this showing. */
  onDismiss(): void
}

/** Props the renderer binds for the overlay. */
export type WhaleNoticeOverlayProps =
  PropsRuntime<'shell.overlay'>
  & PropsLocale<typeof NS>
  & InjectFace<WhaleFace>

/**
 * Render the notice overlay, or nothing between showings.
 * @param props - locale copy, the notice source, and the two operations.
 * @returns the whale scene, remounted per showing so the leap restarts.
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
      dismissLabel={t('notice.dismiss')}
      onOpen={() => { props.openSession(notice.sessionId) }}
      onDismiss={() => { props.dismiss(seq) }}
    />
  )
}

/**
 * Render the breaching whale and its message bubble.
 * @param props - the notice, its accessible names, and the two operations.
 * @returns the stage.
 */
export function WhaleStage(props: WhaleStageProps) {
  const id = useId().replace(/[^a-zA-Z0-9-]/g, '')
  return (
    <div className={css.layer} data-whale-scene={props.notice.sessionId}>
      <div className={css.stage}>
        <svg
          className={css.scene}
          viewBox={`0 0 ${SCENE.width} ${SCENE.height}`}
          aria-hidden="true"
        >
          <defs>
            <radialGradient id={`${id}-sky`} cx="0.5" cy="0.5" r="0.5">
              <stop offset="0" stopColor="#A8C2FF" stopOpacity="0.58" />
              <stop offset="0.5" stopColor="#7C9DFF" stopOpacity="0.32" />
              <stop offset="1" stopColor="#6E92FF" stopOpacity="0" />
            </radialGradient>
            <linearGradient id={`${id}-deep`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#3F62EC" />
              <stop offset="1" stopColor="#101C60" />
            </linearGradient>
            <linearGradient id={`${id}-mid`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#5478FF" />
              <stop offset="1" stopColor="#1B2CA8" />
            </linearGradient>
            <linearGradient id={`${id}-front`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#7A9BFF" />
              <stop offset="1" stopColor="#2A44C8" />
            </linearGradient>
            <linearGradient id={`${id}-tint`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#7FA4FF" stopOpacity="0.3" />
              <stop offset="1" stopColor="#0A1140" stopOpacity="0.45" />
            </linearGradient>
            <linearGradient id={`${id}-foam`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.98" />
              <stop offset="1" stopColor="#DCEBFF" stopOpacity="0.72" />
            </linearGradient>
            <linearGradient id={`${id}-fade-left`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#FFFFFF" stopOpacity="0" />
              <stop offset="0.4" stopColor="#FFFFFF" stopOpacity="1" />
              <stop offset="1" stopColor="#FFFFFF" stopOpacity="1" />
            </linearGradient>
            <linearGradient id={`${id}-fade-deep`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#FFFFFF" stopOpacity="1" />
              <stop offset="0.82" stopColor="#FFFFFF" stopOpacity="1" />
              <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
            </linearGradient>
            <mask id={`${id}-mask-left`}>
              <rect width={SCENE.width} height={SCENE.height} fill={`url(#${id}-fade-left)`} />
            </mask>
            <mask id={`${id}-mask-deep`}>
              <rect width={SCENE.width} height={SCENE.height} fill={`url(#${id}-fade-deep)`} />
            </mask>
            <clipPath id={`${id}-below`}>
              <rect y={WATERLINE} width={SCENE.width} height={SCENE.height - WATERLINE} />
            </clipPath>
            <clipPath id={`${id}-above`}>
              <rect width={SCENE.width} height={WATERLINE} />
            </clipPath>
            <clipPath id={`${id}-sea`}>
              <path d={WAVE.deep} />
              <path d={WAVE.mid} />
              <path d={WAVE.front} />
            </clipPath>
            <path id={`${id}-wave-deep`} d={WAVE.deep} />
            <path id={`${id}-wave-mid`} d={WAVE.mid} />
            <path id={`${id}-wave-front`} d={WAVE.front} />
          </defs>

          <ellipse className={css.sky} cx="164" cy="200" rx="172" ry="196" fill={`url(#${id}-sky)`} />

          <g className={css.sea} mask={`url(#${id}-mask-left)`}>
            <g mask={`url(#${id}-mask-deep)`}>
              <use className={css.wave} href={`#${id}-wave-deep`} fill={`url(#${id}-deep)`} />
              <g clipPath={`url(#${id}-below)`}>
                <g className={css.pet} data-whale-mark="water">
                  <WhaleArt id={`${id}w`} />
                </g>
                <rect
                  className={css.tint}
                  y={WATERLINE}
                  width={SCENE.width}
                  height={SCENE.height - WATERLINE}
                  fill={`url(#${id}-tint)`}
                />
              </g>
              <g className={css.caustics} clipPath={`url(#${id}-sea)`}>
                <path className={css.caustic} d="M-60 100 L60 -60 M-30 140 L110 -60 M10 190 L170 -60 M60 230 L230 -60 M120 260 L290 -60 M190 280 L340 -40" />
              </g>
              <g className={css.swell} clipPath={`url(#${id}-sea)`}>
                <ellipse className={css.swellGlint} cx="60" cy={WATERLINE + 30} rx="90" ry="5" />
                <ellipse className={css.swellGlint} cx="230" cy={WATERLINE + 58} rx="110" ry="7" />
                <ellipse className={css.swellGlint} cx="140" cy={WATERLINE + 96} rx="130" ry="6" />
              </g>
              <use className={css.wave} href={`#${id}-wave-mid`} fill={`url(#${id}-mid)`} />
              <use className={`${css.wave} ${css.foam}`} href={`#${id}-wave-mid`} fill="none" />
              <use className={css.wave} href={`#${id}-wave-front`} fill={`url(#${id}-front)`} />
              <use className={`${css.wave} ${css.foam}`} href={`#${id}-wave-front`} fill="none" />
            </g>
          </g>

          <g className={css.wake}>
            <ellipse className={css.wakeRing} cx={WHALE.x} cy={WATERLINE + 4} rx="26" ry="7" />
            <ellipse className={css.wakeRing} cx={WHALE.x} cy={WATERLINE + 4} rx="26" ry="7" />
          </g>

          <g clipPath={`url(#${id}-above)`}>
            <g className={css.pet} data-whale-mark="air">
              <WhaleArt id={`${id}a`} />
            </g>
          </g>

          <g className={css.splash}>
            <path className={css.splashCrown} d={CROWN} fill={`url(#${id}-foam)`} />
            <path
              className={css.splashWing}
              d={`M${WHALE.x - 88} ${WATERLINE + 6} C${WHALE.x - 118} ${WATERLINE - 26} ${WHALE.x - 152} ${WATERLINE - 14} ${WHALE.x - 178} ${WATERLINE + 6} C${WHALE.x - 144} ${WATERLINE + 16} ${WHALE.x - 112} ${WATERLINE + 18} ${WHALE.x - 88} ${WATERLINE + 12} Z`}
              fill={`url(#${id}-foam)`}
            />
            <path
              className={css.splashWing}
              d={`M${WHALE.x + 88} ${WATERLINE + 6} C${WHALE.x + 118} ${WATERLINE - 26} ${WHALE.x + 152} ${WATERLINE - 14} ${WHALE.x + 178} ${WATERLINE + 6} C${WHALE.x + 144} ${WATERLINE + 16} ${WHALE.x + 112} ${WATERLINE + 18} ${WHALE.x + 88} ${WATERLINE + 12} Z`}
              fill={`url(#${id}-foam)`}
            />
            <ellipse className={css.splashFoam} cx={WHALE.x - 62} cy={WATERLINE + 8} rx="40" ry="13" />
            <ellipse className={css.splashFoam} cx={WHALE.x + 66} cy={WATERLINE + 10} rx="36" ry="12" />
            <ellipse className={css.splashFoam} cx={WHALE.x} cy={WATERLINE + 14} rx="62" ry="16" />
          </g>

          <g className={css.drops}>
            <circle className={css.drop} cx={WHALE.x - 88} cy={WATERLINE - 30} r="7" />
            <circle className={css.drop} cx={WHALE.x - 62} cy={WATERLINE - 58} r="5" />
            <circle className={css.drop} cx={WHALE.x - 30} cy={WATERLINE - 82} r="4" />
            <circle className={css.drop} cx={WHALE.x + 8} cy={WATERLINE - 96} r="6" />
            <circle className={css.drop} cx={WHALE.x + 44} cy={WATERLINE - 74} r="5" />
            <circle className={css.drop} cx={WHALE.x + 74} cy={WATERLINE - 48} r="7" />
            <circle className={css.drop} cx={WHALE.x + 96} cy={WATERLINE - 18} r="4" />
            <circle className={css.drop} cx={WHALE.x - 44} cy={WATERLINE - 34} r="3" />
          </g>
        </svg>

        <button
          type="button"
          className={css.bubble}
          data-whale-bubble=""
          role="status"
          aria-live="polite"
          title={props.openLabel}
          onClick={() => { props.onOpen() }}
        >
          <span className={css.bubbleTitle}>{props.notice.title}</span>
          <span className={css.bubbleBody}>{props.notice.body}</span>
          <span className={css.bubbleTail} />
        </button>
        <button
          type="button"
          className={css.close}
          aria-label={props.dismissLabel}
          onClick={() => { props.onDismiss() }}
        >
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  )
}

/**
 * Render one copy of the whale in its own local frame — nose at -100, tail stock
 * at +100, belly down — placed by the animated group around it.
 * @param props.id - unique prefix for this copy's gradients and clip.
 * @returns the whale group.
 */
function WhaleArt(props: { id: string }) {
  const { id } = props
  return (
    <g transform={`translate(${WHALE.x} ${WHALE.y}) rotate(-24) scale(1.06)`}>
      <defs>
        <linearGradient id={`${id}-body`} x1="0.15" y1="0" x2="0.6" y2="1">
          <stop offset="0" stopColor="#D8E4FF" />
          <stop offset="0.3" stopColor="#8AA8FF" />
          <stop offset="0.72" stopColor="#4D6BFE" />
          <stop offset="1" stopColor="#22389F" />
        </linearGradient>
        <linearGradient id={`${id}-belly`} x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="1" stopColor="#D6E4FF" />
        </linearGradient>
        <linearGradient id={`${id}-tail`} x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor="#93B2FF" />
          <stop offset="1" stopColor="#3350D8" />
        </linearGradient>
        <linearGradient id={`${id}-fin`} x1="0" y1="0" x2="0.5" y2="1">
          <stop offset="0" stopColor="#7FA0FF" />
          <stop offset="1" stopColor="#2A44C8" />
        </linearGradient>
        <clipPath id={`${id}-body-clip`}>
          <ellipse cx="-14" cy="0" rx="92" ry="52" />
          <path d="M70 -28 C88 -18 102 -8 106 0 C102 8 88 18 70 28 Z" />
        </clipPath>
      </defs>

      {/* Flukes, behind the body: two lobes with a notch between them. */}
      <path
        d="M90 -6 C112 -38 152 -58 194 -52 C190 -22 162 8 124 22 C102 30 88 16 90 -6 Z"
        fill={`url(#${id}-tail)`}
      />
      <path
        d="M90 6 C112 38 152 58 194 52 C190 22 162 -8 124 -22 C102 -30 88 -16 90 6 Z"
        fill={`url(#${id}-tail)`}
      />

      {/* Body: an oval that tapers into the tail stock. */}
      <ellipse cx="-14" cy="0" rx="92" ry="52" fill={`url(#${id}-body)`} />
      <path d="M70 -28 C88 -18 102 -8 106 0 C102 8 88 18 70 28 Z" fill={`url(#${id}-body)`} />
      <g clipPath={`url(#${id}-body-clip)`}>
        {/* Belly, clipped to the body so it never spills over the outline. */}
        <ellipse cx="-34" cy="30" rx="70" ry="30" fill={`url(#${id}-belly)`} />
        <path
          className={css.backLit}
          d="M-74 -34 C-44 -54 4 -58 46 -44"
          fill="none"
        />
      </g>

      {/* Pectoral fin and the face. */}
      <path d="M-2 34 C14 54 20 76 10 92 C-6 82 -20 60 -24 40 Z" fill={`url(#${id}-fin)`} />
      <path
        className={css.mouth}
        d="M-84 8 C-70 20 -52 22 -36 15"
        fill="none"
      />
      <circle className={css.eye} cx="-58" cy="-12" r="7.5" />
      <circle className={css.eyeGlint} cx="-60.5" cy="-14.5" r="2.6" />
    </g>
  )
}
