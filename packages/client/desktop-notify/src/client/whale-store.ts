/**
 * The in-page notice source: at most one notice is on screen, and each showing
 * carries its own identity so a dismissal that races a newer notice cannot
 * clear the wrong one.
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { NotifyNotice } from './engine.ts'

/** What the overlay renders: the notice on screen and the identity of that showing. */
export interface WhaleState {
  /** Notice on screen, absent between showings. */
  readonly notice: NotifyNotice | undefined
  /** Monotonic showing identity; a fresh value restarts the entrance. */
  readonly seq: number
}

/** The notice source plus the operations the plugin performs on it. */
export interface WhaleStore {
  /** Observable state bound to the overlay as `useWhale`. */
  readonly source: SnapshotStore<WhaleState>
  /**
   * Show a notice.
   * @param notice - what to show.
   * @param holdMs - how long it stays before dismissing itself.
   * @returns the showing identity, for a later {@link WhaleStore.dismiss}.
   */
  show(notice: NotifyNotice, holdMs: number): number
  /**
   * Dismiss one showing.
   * @param seq - identity returned by {@link WhaleStore.show}; a stale value is ignored.
   */
  dismiss(seq: number): void
  /** Stop the hold timer; the overlay unmounts with its registrant. */
  release(): void
}

/**
 * Create the notice source.
 * @returns a fresh store; module-level handles are forbidden, so the plugin
 * apply closure owns exactly one.
 */
export function createWhaleStore(): WhaleStore {
  const source = createSnapshotStore<WhaleState>({ notice: undefined, seq: 0 })
  let timer: ReturnType<typeof setTimeout> | undefined

  const clear = (): void => {
    if (timer === undefined) return
    clearTimeout(timer)
    timer = undefined
  }
  const dismiss = (seq: number): void => {
    if (source.getSnapshot().seq !== seq) return
    clear()
    source.set({ notice: undefined, seq })
  }
  return {
    source,
    show: (notice, holdMs) => {
      clear()
      const seq = source.getSnapshot().seq + 1
      source.set({ notice, seq })
      timer = setTimeout(() => {
        timer = undefined
        dismiss(seq)
      }, holdMs)
      return seq
    },
    dismiss,
    release: clear,
  }
}
