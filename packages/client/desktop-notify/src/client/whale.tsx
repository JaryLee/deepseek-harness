/**
 * The in-page notice: the whale from the artwork, leaping out of its own sea.
 *
 * Nothing here is drawn — the four layers come from one flat illustration
 * (scene, deep wave band, spray, whale) and the component only stages them:
 * the backdrop and the front wave band drift, the spray erupts and fades with
 * the breach, and the whale image itself rises, turns at the apex, falls back
 * and goes under the band again. Geometry lives in `art.ts` as percentages of
 * the scene box, so the layers stay exactly as the artwork drew them.
 */

import type { CSSProperties } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: ui-layout declares the shell.overlay SlotMap entry this overlay registers into.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { NotifyNotice } from './engine.ts'
import type { WhaleState } from './whale-store.ts'
import { ART_BACKDROP, ART_BUBBLE, ART_SEA_FRONT, ART_SPLASH, ART_WHALE, type ArtLayer } from './art.ts'
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
  return (
    <div className={css.layer} data-whale-scene={props.notice.sessionId}>
      <div className={css.stage}>
        <img className={css.backdrop} src={ART_BACKDROP} alt="" aria-hidden="true" />
        <img className={css.splash} style={boxOf(ART_SPLASH)} src={ART_SPLASH.src} alt="" aria-hidden="true" />
        <img
          className={css.whale}
          style={boxOf(ART_WHALE)}
          src={ART_WHALE.src}
          alt=""
          aria-hidden="true"
          data-whale-mark="whale"
        />
        <img className={css.seaFront} src={ART_SEA_FRONT.src} alt="" aria-hidden="true" />
      </div>
      <div
        className={css.bubble}
        data-whale-bubble=""
        role="status"
        aria-live="polite"
      >
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
        <button
          type="button"
          className={css.close}
          aria-label={props.dismissLabel}
          onClick={() => { props.onDismiss() }}
        >
          <span className={css.srOnly}>×</span>
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
