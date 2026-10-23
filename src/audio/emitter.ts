/**
 * The spatial channel every sound plays through: its input → a lowpass (air, walls, the cabin) →
 * the placement gain → the stereo pan → the mixer's dry bus, plus a post-gain send to the shared
 * reverb. A started ConstantSourceNode carries the Doppler shift in cents for the voice to wire
 * into its detunes; it doubles as the emitter's clock, freeing every node when it ends.
 *
 * @module audio/emitter
 */
import type { Placement } from "./types.ts"

/** Where emitters feed the mix: the dry bus and the reverb send bus. */
export interface Bus {
  readonly dry: AudioNode
  readonly reverb: AudioNode
}

/** One sound's spatial channel. */
export interface Emitter {
  /** Where the voice or shot plays into. */
  readonly input: AudioNode
  /** Doppler cents: connect to every detune that should shift. */
  readonly cents: AudioNode
  /** Glides to a new placement from `now` (continuous voices, once per frame). */
  readonly place: (at: Placement, now: number) => void
  /** Fades out from `now` and frees the nodes once the fade is over. */
  readonly release: (now: number) => void
  /** Frees every node at context time `at`, without a fade (a one-shot that has finished). */
  readonly free: (at: number) => void
}

/** Smoothing time constants, s: gain, pan, send and Doppler; the cutoff glides slower. */
const GLIDE = 0.05,
  CUTOFF_GLIDE = 0.1
/** Release fade time constant, and how long after the release the nodes are freed (6 τ: −52 dB). */
const FADE = 0.08,
  LINGER = 0.5
/**
 * Web Audio reads a lowpass Q in dB. 20·log10(√½) ≈ −3.01 dB is Butterworth: maximally flat, no
 * resonance bump, −3 dB at the cutoff, so an open path (20 kHz) stays transparent.
 */
const LOWPASS_Q = 20 * Math.log10(Math.SQRT1_2)

/** An emitter into `bus` that starts at placement `at` (a one-shot sounds there from its first sample). */
export const makeEmitter = (ctx: BaseAudioContext, bus: Bus, at: Placement): Emitter => {
  const nyquist = ctx.sampleRate / 2
  const input = new GainNode(ctx)
  const lowpass = new BiquadFilterNode(ctx, {
    type: "lowpass",
    Q: LOWPASS_Q,
    frequency: Math.min(at.cutoff, nyquist),
  })
  const gain = new GainNode(ctx, { gain: at.gain })
  const panner = new StereoPannerNode(ctx, { pan: at.pan })
  const send = new GainNode(ctx, { gain: at.wet })
  const cents = new ConstantSourceNode(ctx, { offset: at.cents })
  input.connect(lowpass).connect(gain).connect(panner).connect(bus.dry)
  gain.connect(send).connect(bus.reverb)
  cents.onended = () => {
    for (const node of [input, lowpass, gain, panner, send, cents]) node.disconnect()
  }
  cents.start()
  const free = (time: number) => cents.stop(time)
  return {
    input,
    cents,
    place: (to, now) => {
      gain.gain.setTargetAtTime(to.gain, now, GLIDE)
      panner.pan.setTargetAtTime(to.pan, now, GLIDE)
      send.gain.setTargetAtTime(to.wet, now, GLIDE)
      cents.offset.setTargetAtTime(to.cents, now, GLIDE)
      lowpass.frequency.setTargetAtTime(Math.min(to.cutoff, nyquist), now, CUTOFF_GLIDE)
    },
    release: (now) => {
      gain.gain.cancelScheduledValues(now)
      gain.gain.setTargetAtTime(0, now, FADE)
      free(now + LINGER)
    },
    free,
  }
}
