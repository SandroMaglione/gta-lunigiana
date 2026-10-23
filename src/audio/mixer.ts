/**
 * The master bus: every emitter's dry signal and the shared reverb's return meet in a master gain,
 * then a limiter (its makeup gain trimmed off), an analyser (the output level, for browser checks)
 * and the speakers. The reverb is one convolver with a generated stone street's impulse response;
 * the emitters' sends say how much of it each sound gets (none in the open).
 *
 * @module audio/mixer
 */
import { impulseResponse } from "./buffers.ts"
import type { Bus } from "./emitter.ts"

/** The mix the emitters play into. */
export interface Mixer extends Bus {
  /** The output's RMS level over the last ~43 ms, dBFS (`SILENCE_DB` when silent). */
  readonly level: () => number
}

/** The floor `level` reports for silence, dBFS. */
export const SILENCE_DB = -100

const MASTER = 0.8
/**
 * A gentle limiter rather than the squashing defaults (synthesis.md §1.1, physics.md §9). TUNED: a 1 ms attack, so a crash
 * (crest ~10 dB) driven 15–25 dB over, as one a few metres away or the player's own is, peaks near −0.3 dBFS at worst; at
 * 3 ms its transients got through to +0.1…+2.4 dBFS and clipped.
 */
const LIMITER = { threshold: -6, knee: 6, ratio: 12, attack: 0.001, release: 0.25 } as const
/**
 * The compressor's built-in makeup gain for LIMITER, dB (spec: (1 / curve(1))^0.6; measured 2.14 in
 * Chrome, 2.13 with the 1 ms attack; re-measure when LIMITER changes). Trimmed off after it, so quiet
 * mixes keep MASTER.
 */
const MAKEUP_DB = 2.14
/**
 * The street's impulse response: length, RT60 and pre-delay (the first facade's return across a 4 m
 * lane), s. A long stone street canyon measures 1.2–1.4 s (Picaut et al. 2005); the valley's lanes
 * are lower, shorter and broken.
 */
const STREET = { seconds: 1.2, rt60: 1, preDelay: 0.012 } as const
/** A fully wet send returns this many dB below the dry signal. */
const WET_DB = -12

/** RMS of `samples` in dBFS, floored at `SILENCE_DB`. */
export const rmsDb = (samples: Float32Array): number => {
  let sum = 0
  for (const v of samples) sum += v * v
  return Math.max(SILENCE_DB, 10 * Math.log10(sum / samples.length))
}

/** The return gain that puts a fully wet send `db` below the dry: the dry pan keeps power, so divide by the IR's energy. */
const returnGain = (ir: AudioBuffer, db: number): number => {
  let energy = 0
  for (let c = 0; c < ir.numberOfChannels; c++)
    for (const v of ir.getChannelData(c)) energy += v * v
  return 10 ** (db / 20) / Math.sqrt(energy)
}

/** The mix for `ctx`, playing to its destination. */
export const makeMixer = (ctx: BaseAudioContext): Mixer => {
  const master = new GainNode(ctx, { gain: MASTER })
  const analyser = new AnalyserNode(ctx, { fftSize: 2048 })
  master
    .connect(new DynamicsCompressorNode(ctx, LIMITER))
    .connect(new GainNode(ctx, { gain: 10 ** (-MAKEUP_DB / 20) }))
    .connect(analyser)
    .connect(ctx.destination)
  const reverb = new GainNode(ctx),
    buffer = impulseResponse(ctx, STREET.seconds, STREET.rt60, STREET.preDelay)
  // Normalisation would scale the IR by its own rule; returnGain calibrates it instead.
  reverb
    .connect(new ConvolverNode(ctx, { buffer, disableNormalization: true }))
    .connect(new GainNode(ctx, { gain: returnGain(buffer, WET_DB) }))
    .connect(master)
  const samples = new Float32Array(analyser.fftSize)
  return {
    dry: master,
    reverb,
    level: () => {
      analyser.getFloatTimeDomainData(samples)
      return rmsDb(samples)
    },
  }
}
