/**
 * The in-page notice: the whale breaches the surface twice, the message rides
 * up in a water bubble, and the whole showing leaves on its own.
 *
 * The surface is one fixed waterline and two copies of the same whale: the copy
 * above the line is the dry body, the copy below it is refracted — blurred,
 * darkened, and vertically compressed by the water. Both copies run the same
 * leap animation, so which one shows is decided by where the whale is, not by
 * a second animation. The mark is the brand whale path, painted with the
 * brand blue: the plugin ships no artwork of its own.
 */

import { useId } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { FISH_LOGO_PATH, FISH_LOGO_VIEWBOX } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: ui-layout declares the shell.overlay SlotMap entry this overlay registers into.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { NotifyNotice } from './engine.ts'
import type { WhaleState } from './whale-store.ts'
import { NS } from './locales.ts'
import css from './whale.module.css'

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
 * @returns the whale stage, remounted per showing so the leap restarts.
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
        <div className={css.sky} />
        <div className={css.sea}>
          <div className={css.caustics} />
        </div>
        <div className={css.below}>
          <WhaleArt id={`${id}w`} />
          <span className={css.shadow} />
        </div>
        <div className={css.above}>
          <WhaleArt id={`${id}a`} />
        </div>
        <div className={css.surface} />
        <div className={css.wake}><span /><span /><span /><span /></div>
        <div className={css.drops}><span /><span /><span /><span /><span /></div>
        <div className={css.orbs}><span /><span /><span /><span /></div>
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
 * Render one copy of the brand whale, lit as if seen from above.
 * @param props.id - unique prefix for this copy's gradient ids.
 * @returns the whale svg.
 */
function WhaleArt(props: { id: string }) {
  const { id } = props
  return (
    <svg
      className={css.pet}
      viewBox={`0 0 ${FISH_LOGO_VIEWBOX.width} ${FISH_LOGO_VIEWBOX.height}`}
      data-whale-mark={id}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`${id}-body`} x1="0.15" y1="0" x2="0.45" y2="1">
          <stop offset="0" stopColor="#CFDCFF" />
          <stop offset="0.34" stopColor="#7C9CFF" />
          <stop offset="0.72" stopColor="#4D6BFE" />
          <stop offset="1" stopColor="#1B2C93" />
        </linearGradient>
        <linearGradient id={`${id}-lit`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.85" />
          <stop offset="0.55" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={`${id}-glow`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#8FB0FF" stopOpacity="0.5" />
          <stop offset="1" stopColor="#8FB0FF" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse
        className={css.glow}
        cx={FISH_LOGO_VIEWBOX.width / 2}
        cy={FISH_LOGO_VIEWBOX.height / 2}
        rx={FISH_LOGO_VIEWBOX.width * 0.72}
        ry={FISH_LOGO_VIEWBOX.height * 0.78}
        fill={`url(#${id}-glow)`}
      />
      <path className={css.body} d={FISH_LOGO_PATH} fill={`url(#${id}-body)`} />
      <path className={css.lit} d={FISH_LOGO_PATH} fill={`url(#${id}-lit)`} />
      <path className={css.rim} d={FISH_LOGO_PATH} />
    </svg>
  )
}
