/**
 * The in-page notice cue, synthesized with Web Audio so the plugin ships no
 * audio asset: a humpback call, the splash of the breach, and two gulls.
 *
 * A page that has not received a user gesture yet holds its AudioContext
 * suspended, where scheduled sources would all fire at once on resume; the cue
 * is therefore skipped, with a console warning, instead of scheduled.
 */

/** The page audio surface this cue needs; tests supply a stand-in. */
export interface AudioScope {
  /** AudioContext constructor, absent where Web Audio is unavailable. */
  readonly AudioContext: typeof AudioContext | undefined
  /** Timer closing the context once the cue has finished. */
  readonly setTimeout: (handler: () => void, timeout: number) => number
  /** Cancels {@link AudioScope.setTimeout}. */
  readonly clearTimeout: (handle: number) => void
}

/** Milliseconds from the cue's start to the splash. */
export const SPLASH_AT_MS = 1700
/** Total cue length; the context closes after it. */
export const CUE_LENGTH_MS = 6500
/** Gull calls, relative to the cue's start. */
const GULL_OFFSETS_MS = [2700, 3200] as const

/** Master gain of the whole cue. */
const MASTER_GAIN = 0.5
/** Echo send level, so the call reads as a large space. */
const ECHO_SEND = 0.35

/**
 * Read the page's audio surface.
 * @returns the globals the cue uses, with an absent constructor where Web Audio is unavailable.
 */
export function pageAudioScope(): AudioScope {
  return {
    AudioContext: typeof AudioContext === 'undefined' ? undefined : AudioContext,
    setTimeout: (handler, timeout) => window.setTimeout(handler, timeout),
    clearTimeout: (handle) => { window.clearTimeout(handle) },
  }
}

/**
 * Play the notice cue.
 * @param scope - page audio surface; omitted for the real window.
 * @returns nothing; an unavailable or suspended context only warns.
 */
export function playNoticeSound(scope: AudioScope = pageAudioScope()): void {
  const Constructor = scope.AudioContext
  if (Constructor === undefined) {
    console.warn('desktop-notify: this browser has no Web Audio; the notice stays visual')
    return
  }
  const context = new Constructor()
  if (context.state !== 'running') {
    console.warn(`desktop-notify: page audio is "${context.state}"; the notice stays visual`)
    void context.close()
    return
  }
  const master = context.createGain()
  master.gain.value = MASTER_GAIN
  master.connect(context.destination)
  const dry = context.createGain()
  dry.gain.value = 1 - ECHO_SEND
  dry.connect(master)
  const send = context.createGain()
  send.gain.value = ECHO_SEND
  send.connect(master)
  const echoReturn = context.createGain()
  echoReturn.connect(master)
  const start = context.currentTime
  whaleCall(context, dry, start)
  breachEcho(context, send, echoReturn)
  splash(context, dry, start + SPLASH_AT_MS / 1000)
  for (const offset of GULL_OFFSETS_MS) gull(context, dry, start + offset / 1000)
  scope.setTimeout(() => { void context.close() }, CUE_LENGTH_MS)
}

/** Ramp one gain through a short attack into an exponential release. */
function envelope(gain: AudioParam, start: number, peak: number, attack: number, release: number): void {
  gain.setValueAtTime(0.0001, start)
  gain.exponentialRampToValueAtTime(peak, start + attack)
  gain.exponentialRampToValueAtTime(0.0001, start + attack + release)
}

/** Slide one frequency through the given waypoints, each reached in turn. */
function glide(frequency: AudioParam, start: number, points: readonly number[], step: number): void {
  const first = points[0]
  if (first === undefined) return
  frequency.setValueAtTime(first, start)
  points.slice(1).forEach((value, index) => {
    frequency.exponentialRampToValueAtTime(value, start + step * (index + 1))
  })
}

/** A white-noise buffer of the given length. */
function noise(context: AudioContext, seconds: number): AudioBuffer {
  const frames = Math.max(1, Math.floor(context.sampleRate * seconds))
  const buffer = context.createBuffer(1, frames, context.sampleRate)
  const channel = buffer.getChannelData(0)
  for (let index = 0; index < frames; index += 1) channel[index] = Math.random() * 2 - 1
  return buffer
}

/** The call itself: a sine voice with vibrato, a triangle harmony, tape-delayed. */
function whaleCall(context: AudioContext, output: AudioNode, start: number): void {
  const shape = context.createBiquadFilter()
  shape.type = 'lowpass'
  shape.frequency.value = 880
  const voiceGain = context.createGain()
  envelope(voiceGain.gain, start, 0.32, 0.35, 2.1)
  const voice = context.createOscillator()
  voice.type = 'sine'
  glide(voice.frequency, start, [370, 152, 178], 0.95)
  const vibrato = context.createOscillator()
  vibrato.frequency.value = 4.5
  const depth = context.createGain()
  depth.gain.value = 6
  vibrato.connect(depth)
  depth.connect(voice.frequency)
  const harmony = context.createOscillator()
  harmony.type = 'triangle'
  glide(harmony.frequency, start, [555, 228], 1.2)
  const harmonyGain = context.createGain()
  harmonyGain.gain.value = 0.35
  voice.connect(shape)
  harmony.connect(harmonyGain)
  harmonyGain.connect(shape)
  shape.connect(voiceGain)
  voiceGain.connect(output)
  const stop = start + 2.6
  voice.start(start)
  harmony.start(start)
  vibrato.start(start)
  voice.stop(stop)
  harmony.stop(stop)
  vibrato.stop(stop)
}

/** A feedback delay off the call's send, darkening with each repeat. */
function breachEcho(context: AudioContext, send: AudioNode, output: AudioNode): void {
  const delay = context.createDelay(0.5)
  delay.delayTime.value = 0.26
  const damp = context.createBiquadFilter()
  damp.type = 'lowpass'
  damp.frequency.value = 1800
  const feedback = context.createGain()
  feedback.gain.value = 0.36
  send.connect(delay)
  delay.connect(damp)
  damp.connect(feedback)
  feedback.connect(delay)
  damp.connect(output)
}

/** The breach: swept band-passed noise with a spray layer and a body thump. */
function splash(context: AudioContext, output: AudioNode, start: number): void {
  const source = context.createBufferSource()
  source.buffer = noise(context, 0.9)
  const band = context.createBiquadFilter()
  band.type = 'bandpass'
  band.Q.value = 0.8
  glide(band.frequency, start, [1900, 560], 0.7)
  const body = context.createGain()
  envelope(body.gain, start, 0.34, 0.04, 1.1)
  const spray = context.createBiquadFilter()
  spray.type = 'highpass'
  spray.frequency.value = 3200
  const sprayGain = context.createGain()
  envelope(sprayGain.gain, start, 0.12, 0.06, 0.9)
  source.connect(band)
  band.connect(body)
  body.connect(output)
  source.connect(spray)
  spray.connect(sprayGain)
  sprayGain.connect(output)
  source.start(start)
  source.stop(start + 1.2)
  thump(context, output, start + 0.6)
}

/** The low body of the splash, plus three rising bubbles. */
function thump(context: AudioContext, output: AudioNode, start: number): void {
  const gain = context.createGain()
  envelope(gain.gain, start, 0.28, 0.03, 0.6)
  const voice = context.createOscillator()
  voice.type = 'sine'
  glide(voice.frequency, start, [155, 56], 0.4)
  voice.connect(gain)
  gain.connect(output)
  voice.start(start)
  voice.stop(start + 0.8)
  for (let index = 0; index < 3; index += 1) {
    bubble(context, output, start + 0.12 * (index + 1), 720 + index * 180)
  }
}

/** One short rising bubble of the given pitch. */
function bubble(context: AudioContext, output: AudioNode, start: number, pitch: number): void {
  const gain = context.createGain()
  envelope(gain.gain, start, 0.09, 0.012, 0.09)
  const voice = context.createOscillator()
  voice.type = 'sine'
  glide(voice.frequency, start, [pitch, pitch * 1.7], 0.05)
  voice.connect(gain)
  gain.connect(output)
  voice.start(start)
  voice.stop(start + 0.16)
}

/** One gull: a two-note triangle screech under a filtered noise breath. */
function gull(context: AudioContext, output: AudioNode, start: number): void {
  const shape = context.createBiquadFilter()
  shape.type = 'bandpass'
  shape.frequency.value = 2400
  const gain = context.createGain()
  envelope(gain.gain, start, 0.11, 0.05, 0.4)
  const voice = context.createOscillator()
  voice.type = 'triangle'
  glide(voice.frequency, start, [1180, 1720, 900, 1560], 0.11)
  const breath = context.createBufferSource()
  breath.buffer = noise(context, 0.4)
  const breathGain = context.createGain()
  envelope(breathGain.gain, start, 0.05, 0.04, 0.32)
  voice.connect(shape)
  shape.connect(gain)
  gain.connect(output)
  breath.connect(breathGain)
  breathGain.connect(output)
  voice.start(start)
  voice.stop(start + 0.5)
  breath.start(start)
  breath.stop(start + 0.45)
}
