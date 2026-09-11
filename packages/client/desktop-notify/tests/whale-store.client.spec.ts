/** The in-page notice source: one showing at a time, each with its own identity. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createWhaleStore } from '../src/client/whale-store.ts'

const NOTICE = { sessionId: 's1' as SessionId, title: 'Session', body: 'finished' }
const SECOND = { sessionId: 's2' as SessionId, title: 'Other', body: 'asked' }
const HOLD = 1000

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('createWhaleStore', () => {
  it('starts with nothing on screen', () => {
    expect(createWhaleStore().source.getSnapshot()).toEqual({ notice: undefined, seq: 0 })
  })

  it('shows a notice and dismisses it when the hold elapses', () => {
    const store = createWhaleStore()
    const seq = store.show(NOTICE, HOLD)
    expect(store.source.getSnapshot()).toEqual({ notice: NOTICE, seq })
    vi.advanceTimersByTime(HOLD - 1)
    expect(store.source.getSnapshot().notice).toBe(NOTICE)
    vi.advanceTimersByTime(1)
    expect(store.source.getSnapshot().notice).toBeUndefined()
    // The hold already fired, so nothing is left to cancel.
    store.release()
  })

  it('replaces the showing and cancels the hold it replaced', () => {
    const store = createWhaleStore()
    store.show(NOTICE, HOLD)
    vi.advanceTimersByTime(600)
    expect(store.show(SECOND, HOLD)).toBe(2)
    // The first hold would elapse here; the second showing must survive it.
    vi.advanceTimersByTime(600)
    expect(store.source.getSnapshot()).toEqual({ notice: SECOND, seq: 2 })
    vi.advanceTimersByTime(400)
    expect(store.source.getSnapshot().notice).toBeUndefined()
  })

  it('dismisses a showing by identity and ignores a stale identity', () => {
    const store = createWhaleStore()
    const seq = store.show(NOTICE, HOLD)
    store.dismiss(seq + 1)
    expect(store.source.getSnapshot().notice).toBe(NOTICE)
    store.dismiss(seq)
    expect(store.source.getSnapshot().notice).toBeUndefined()
    store.dismiss(seq)
    vi.advanceTimersByTime(HOLD)
    expect(store.source.getSnapshot().notice).toBeUndefined()
  })

  it('release stops the hold without clearing what is on screen', () => {
    const store = createWhaleStore()
    store.show(NOTICE, HOLD)
    store.release()
    vi.advanceTimersByTime(HOLD * 2)
    expect(store.source.getSnapshot().notice).toBe(NOTICE)
  })
})
