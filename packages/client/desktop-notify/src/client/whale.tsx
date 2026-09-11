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
const SCENE = { width: 340, height: 460 }
/** Where the whale sits before the leap moves it. */
const WHALE = { x: 172, y: 330 }

/** Wave silhouettes: deep to front, each spanning past both scene edges. The
 * deep wave's crest is the visible surface, so the whale's clip line is the
 * water it is actually cut against. */
const WAVE = {
  deep: `M-24 304 C40 292 78 316 132 310 C186 304 226 288 364 298 L364 ${SCENE.height} L-24 ${SCENE.height} Z`,
  mid: `M-24 336 C30 322 82 348 140 340 C198 332 250 314 364 328 L364 ${SCENE.height} L-24 ${SCENE.height} Z`,
  front: `M-24 366 C36 352 84 376 146 366 C208 356 262 340 364 354 L364 ${SCENE.height} L-24 ${SCENE.height} Z`,
}

/** The splash: a fan of spray breaking outward from the waterline, kept low
 * enough that the whale's body always clears it. */
const CROWN = [
  `M${WHALE.x - 156} ${WATERLINE + 12}`,
  `C${WHALE.x - 141} ${WATERLINE - 12} ${WHALE.x - 128} ${WATERLINE - 36} ${WHALE.x - 113} ${WATERLINE - 26}`,
  `C${WHALE.x - 101} ${WATERLINE - 48} ${WHALE.x - 84} ${WATERLINE - 66} ${WHALE.x - 74} ${WATERLINE - 24}`,
  `C${WHALE.x - 61} ${WATERLINE - 72} ${WHALE.x - 41} ${WATERLINE - 78} ${WHALE.x - 31} ${WATERLINE - 22}`,
  `C${WHALE.x - 18} ${WATERLINE - 88} ${WHALE.x + 5} ${WATERLINE - 92} ${WHALE.x + 13} ${WATERLINE - 20}`,
  `C${WHALE.x + 26} ${WATERLINE - 78} ${WHALE.x + 46} ${WATERLINE - 70} ${WHALE.x + 54} ${WATERLINE - 24}`,
  `C${WHALE.x + 67} ${WATERLINE - 62} ${WHALE.x + 84} ${WATERLINE - 52} ${WHALE.x + 95} ${WATERLINE - 22}`,
  `C${WHALE.x + 113} ${WATERLINE - 40} ${WHALE.x + 138} ${WATERLINE - 14} ${WHALE.x + 156} ${WATERLINE + 12}`,
  `C${WHALE.x + 77} ${WATERLINE - 2} ${WHALE.x - 77} ${WATERLINE - 2} ${WHALE.x - 156} ${WATERLINE + 12} Z`,
].join(' ')

/** The whale's outline: a rounded head that tapers into the tail stock. */
const BODY = 'M-108 0 C-104 -30 -86 -50 -48 -55 C-4 -61 48 -52 82 -32 C94 -24 102 -12 106 -2 '
  + 'C102 8 94 18 82 26 C48 46 -4 55 -48 55 C-86 50 -104 30 -108 0 Z'

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

          <ellipse className={css.sky} cx="164" cy="210" rx="174" ry="208" fill={`url(#${id}-sky)`} />

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

          <g className={css.splash}>
            <path className={css.splashCrown} d={CROWN} fill={`url(#${id}-foam)`} />
            <path
              className={css.splashWing}
              d={`M${WHALE.x - 100} ${WATERLINE + 8} C${WHALE.x - 132} ${WATERLINE - 22} ${WHALE.x - 166} ${WATERLINE - 10} ${WHALE.x - 190} ${WATERLINE + 12} C${WHALE.x - 154} ${WATERLINE + 22} ${WHALE.x - 122} ${WATERLINE + 22} ${WHALE.x - 100} ${WATERLINE + 14} Z`}
              fill={`url(#${id}-foam)`}
            />
            <path
              className={css.splashWing}
              d={`M${WHALE.x + 100} ${WATERLINE + 8} C${WHALE.x + 132} ${WATERLINE - 22} ${WHALE.x + 166} ${WATERLINE - 10} ${WHALE.x + 190} ${WATERLINE + 12} C${WHALE.x + 154} ${WATERLINE + 22} ${WHALE.x + 122} ${WATERLINE + 22} ${WHALE.x + 100} ${WATERLINE + 14} Z`}
              fill={`url(#${id}-foam)`}
            />
            <ellipse className={css.splashFoam} cx={WHALE.x - 74} cy={WATERLINE + 12} rx="48" ry="15" />
            <ellipse className={css.splashFoam} cx={WHALE.x + 78} cy={WATERLINE + 14} rx="44" ry="14" />
            <ellipse className={css.splashFoam} cx={WHALE.x} cy={WATERLINE + 18} rx="76" ry="19" />
          </g>

          <g className={css.drops}>
            <circle className={css.drop} cx={WHALE.x - 118} cy={WATERLINE - 26} r="7" />
            <circle className={css.drop} cx={WHALE.x - 92} cy={WATERLINE - 54} r="5" />
            <circle className={css.drop} cx={WHALE.x - 58} cy={WATERLINE - 76} r="4" />
            <circle className={css.drop} cx={WHALE.x - 16} cy={WATERLINE - 88} r="6" />
            <circle className={css.drop} cx={WHALE.x + 30} cy={WATERLINE - 80} r="5" />
            <circle className={css.drop} cx={WHALE.x + 76} cy={WATERLINE - 56} r="7" />
            <circle className={css.drop} cx={WHALE.x + 112} cy={WATERLINE - 24} r="4" />
            <circle className={css.drop} cx={WHALE.x - 34} cy={WATERLINE - 40} r="3" />
          </g>

          <g className={css.wake}>
            <ellipse className={css.wakeRing} cx={WHALE.x} cy={WATERLINE + 4} rx="30" ry="8" />
            <ellipse className={css.wakeRing} cx={WHALE.x} cy={WATERLINE + 4} rx="30" ry="8" />
          </g>

          <g clipPath={`url(#${id}-above)`}>
            <g className={css.pet} data-whale-mark="air">
              <WhaleArt id={`${id}a`} />
            </g>
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
    <g transform={`translate(${WHALE.x} ${WHALE.y}) rotate(-26) scale(0.88)`}>
      <defs>
        <linearGradient id={`${id}-body`} x1="0.1" y1="0" x2="0.55" y2="1">
          <stop offset="0" stopColor="#DCE7FF" />
          <stop offset="0.26" stopColor="#93B2FF" />
          <stop offset="0.62" stopColor="#4D6BFE" />
          <stop offset="1" stopColor="#2C46CC" />
        </linearGradient>
        <linearGradient id={`${id}-belly`} x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="1" stopColor="#DCE8FF" />
        </linearGradient>
        <linearGradient id={`${id}-tail`} x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor="#A2BCFF" />
          <stop offset="1" stopColor="#3D5CE8" />
        </linearGradient>
        <linearGradient id={`${id}-fin`} x1="0" y1="0" x2="0.5" y2="1">
          <stop offset="0" stopColor="#8FADFF" />
          <stop offset="1" stopColor="#3350DC" />
        </linearGradient>
        <clipPath id={`${id}-body-clip`}>
          <path d={BODY} />
        </clipPath>
      </defs>

      {/* Flukes, behind the body: two lobes with a notch between them. */}
      <path
        d="M90 -12 C110 -44 144 -68 184 -64 C178 -32 148 -2 112 16 C98 22 88 8 90 -12 Z"
        fill={`url(#${id}-tail)`}
      />
      <path
        d="M92 12 C116 6 148 -6 174 -26 C168 2 140 26 110 40 C96 46 86 32 92 12 Z"
        fill={`url(#${id}-tail)`}
      />

      {/* Body: a rounded head tapering into the tail stock. */}
      <path d={BODY} fill={`url(#${id}-body)`} />
      <g clipPath={`url(#${id}-body-clip)`}>
        {/* Belly and the pale patch around the eye, both clipped to the outline. */}
        <ellipse cx="-44" cy="28" rx="64" ry="28" fill={`url(#${id}-belly)`} />
        <ellipse cx="-70" cy="-4" rx="20" ry="16" fill={`url(#${id}-belly)`} />
        <path className={css.backLit} d="M-84 -28 C-52 -50 -2 -56 44 -46" fill="none" />
      </g>

      {/* Pectoral fin and the face. */}
      <path d="M2 42 C16 60 20 82 10 96 C-6 84 -18 64 -22 46 Z" fill={`url(#${id}-fin)`} />
      <path className={css.mouth} d="M-102 14 C-86 26 -64 28 -46 20" fill="none" />
      <circle className={css.eye} cx="-74" cy="-8" r="6.5" />
      <circle className={css.eyeGlint} cx="-76.5" cy="-10.5" r="2.3" />
    </g>
  )
}
