/**
 * The notice cue: the whale call, its splash, and the gulls, synthesized with
 * Web Audio, plus the two states where the page cannot play it.
 */
// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CUE_LENGTH_MS, SPLASH_AT_MS, pageAudioScope, playNoticeSound, type AudioScope,
} from '../src/client/sound.ts'

/** One AudioParam stand-in recording every scheduled ramp. */
function param() {
  return {
    value: 0,
    setValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  }
}

/** One AudioNode stand-in. */
function node() {
  return { connect: vi.fn(), disconnect: vi.fn() }
}

/** A recording AudioContext plus the counts its factories reached. */
function fakeAudioContext(state: AudioContextState) {
  const created = { oscillators: 0, buffers: 0, delays: 0, filters: 0, gains: 0, sources: 0 }
  const context = {
    state,
    currentTime: 0,
    sampleRate: 48_000,
    destination: node(),
    close: vi.fn(() => Promise.resolve()),
    createGain: () => {
      created.gains += 1
      return { ...node(), gain: param() }
    },
    createOscillator: () => {
      created.oscillators += 1
      return { ...node(), type: 'sine', frequency: param(), start: vi.fn(), stop: vi.fn() }
    },
    createBiquadFilter: () => {
      created.filters += 1
      return { ...node(), type: 'lowpass', frequency: param(), Q: param() }
    },
    createDelay: () => {
      created.delays += 1
      return { ...node(), delayTime: param() }
    },
    createBufferSource: () => {
      created.sources += 1
      return { ...node(), buffer: null, start: vi.fn(), stop: vi.fn() }
    },
    createBuffer: (_channels: number, frames: number) => {
      created.buffers += 1
      return { getChannelData: () => new Float32Array(frames) }
    },
  }
  return { context, created }
}

/** A scope whose constructor returns the recording context and records the closing timer. */
function scopeOf(context: object, timers: { handler: () => void; ms: number }[]): AudioScope {
  const Constructor = function () { return context } as unknown as typeof AudioContext
  return {
    AudioContext: Constructor,
    setTimeout: (handler, ms) => {
      timers.push({ handler, ms })
      return timers.length
    },
    clearTimeout: vi.fn(),
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('playNoticeSound', () => {
  it('stays visual where the browser has no Web Audio', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    playNoticeSound({ AudioContext: undefined, setTimeout: vi.fn(), clearTimeout: vi.fn() })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no Web Audio'))
  })

  it('stays visual while the page holds its audio suspended, and releases the context', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { context, created } = fakeAudioContext('suspended')
    playNoticeSound(scopeOf(context, []))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('suspended'))
    expect(created.oscillators).toBe(0)
    await Promise.resolve()
    expect(context.close).toHaveBeenCalledTimes(1)
  })

  it('plays the whole cue on a running context and closes it when the cue is over', () => {
    const { context, created } = fakeAudioContext('running')
    const timers: { handler: () => void; ms: number }[] = []
    playNoticeSound(scopeOf(context, timers))
    // Two voices of the call, three bubbles, one thump, and two gulls.
    expect(created.oscillators).toBe(9)
    // The splash noise bed and one breath under each gull.
    expect(created.buffers).toBe(3)
    expect(created.delays).toBe(1)
    expect(created.filters).toBe(6)
    expect(created.sources).toBe(3)
    expect(SPLASH_AT_MS).toBe(1700)
    expect(timers).toHaveLength(1)
    expect(timers[0]!.ms).toBe(CUE_LENGTH_MS)
    expect(context.close).not.toHaveBeenCalled()
    timers[0]!.handler()
    expect(context.close).toHaveBeenCalledTimes(1)
  })
})

describe('pageAudioScope', () => {
  it('reports the page context and delegates its timers to the window', () => {
    vi.useFakeTimers()
    const scope = pageAudioScope()
    expect(scope.AudioContext).toBeUndefined()
    const handler = vi.fn()
    scope.setTimeout(handler, 10)
    vi.advanceTimersByTime(10)
    expect(handler).toHaveBeenCalledTimes(1)
    const cancelled = vi.fn()
    scope.clearTimeout(scope.setTimeout(cancelled, 10))
    vi.advanceTimersByTime(10)
    expect(cancelled).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('reports the global constructor where the browser has one', () => {
    const Constructor = vi.fn()
    vi.stubGlobal('AudioContext', Constructor)
    expect(pageAudioScope().AudioContext).toBe(Constructor)
  })
})
