/** The notice stage and the overlay that renders whatever the store holds. */
// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { WhaleNoticeOverlay, WhaleStage, type WhaleNoticeOverlayProps } from '../src/client/whale.tsx'
import { createWhaleStore, type WhaleStore } from '../src/client/whale-store.ts'

const NOTICE = { sessionId: 'session-1' as SessionId, title: 'Session', body: 'finished' }
/** A hold no case waits out; the store's own timer is covered by its own spec. */
const HOLD = 60_000

afterEach(cleanup)

function stage() {
  const onOpen = vi.fn()
  render(
    <WhaleStage
      notice={NOTICE}
      openLabel="open the session"
      onOpen={onOpen}
    />,
  )
  return { onOpen }
}

/** Overlay props with the framework shares a component never reads. */
function overlayProps(store: WhaleStore) {
  const openSession = vi.fn()
  const props = {
    openSession,
    t: (key: string) => key,
    useWhale: (selector: (value: ReturnType<WhaleStore['source']['getSnapshot']>) => unknown) =>
      selector(store.source.getSnapshot()),
  } as unknown as WhaleNoticeOverlayProps
  return { props, openSession }
}

describe('WhaleStage', () => {
  it('carries the notice in the water bubble over the scene', () => {
    stage()
    const bubble = document.querySelector('[data-whale-bubble]')
    expect(bubble?.textContent).toContain('Session')
    expect(bubble?.textContent).toContain('finished')
    expect(document.querySelector('[data-whale-scene]')?.getAttribute('data-whale-scene'))
      .toBe(NOTICE.sessionId)
  })

  it('stages the artwork layers: scene, five sea strips, whale, sprays, and bubble', () => {
    stage()
    expect(document.querySelectorAll('[data-whale-mark]')).toHaveLength(1)
    expect(document.querySelector('[data-whale-mark]')?.tagName).toBe('IMG')
    const tracks = [...document.querySelectorAll('[class*="waveTrack"]')]
    expect(tracks).toHaveLength(5)
    for (const track of tracks) expect(track.querySelectorAll('img')).toHaveLength(2)
    const sources = [...document.querySelectorAll('[data-whale-scene] img')]
      .map(image => image.getAttribute('src') ?? '')
    expect(sources).toHaveLength(15)
    for (const source of sources) expect(source.startsWith('data:image/webp;base64,')).toBe(true)
    expect(document.querySelectorAll('i')).toHaveLength(12)
  })

  it('opens the session from the bubble', () => {
    const b = stage()
    fireEvent.click(screen.getByRole('button', { name: /finished/ }))
    expect(b.onOpen).toHaveBeenCalledTimes(1)
  })

  it('offers no dismiss control: the notice clears itself', () => {
    stage()
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })
})

describe('WhaleNoticeOverlay', () => {
  it('renders nothing between showings', () => {
    const { props } = overlayProps(createWhaleStore())
    render(<WhaleNoticeOverlay {...props} />)
    expect(document.querySelector('[data-whale-scene]')).toBeNull()
  })

  it('renders the notice the store holds and routes both operations', () => {
    const store = createWhaleStore()
    const seq = store.show(NOTICE, HOLD)
    const { props, openSession } = overlayProps(store)
    render(<WhaleNoticeOverlay {...props} />)
    expect(screen.getByText('finished')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: /finished/ }))
    expect(openSession).toHaveBeenCalledWith(NOTICE.sessionId)
    expect(seq).toBeGreaterThan(0)
    store.release()
  })
})
