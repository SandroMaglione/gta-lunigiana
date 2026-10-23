/**
 * Running water, three layers over one graph: a loop of bubbles (the drops and plinks, from
 * `bubbleTexture`), a filtered pink bed (the hiss of broken water) and, in the river, a brown
 * boulder rumble, the bed and rumble surging slowly. The fountain is a spout splashing into a stone
 * basin, the stream a trickle over pebbles, the river the Lucido's rapids.
 *
 * Loudness is the director's: a body's level at the listener (width, grade, distance) is in its
 * placement, so at every `flow` the voice peaks near 0.5 and `flow` moves only its colour: the
 * bed brightens, the rumble and surge grow, the separate drops sink into the roar.
 *
 * @module audio/synth/water
 */
import { bufferOf, loop } from "../buffers.ts"
import type { Continuous, VoiceFactory } from "../types.ts"
import { type Bubbles, bubbleTexture } from "./bubbles.ts"
import { fadeOut, normalise, outlet, unit } from "./graph.ts"

type Water = Extract<Continuous, { readonly kind: "water" }>
type Body = Water["body"]

/** Bubble populations (van den Doel 2005 ranges, synthesis.md §10.2). */
const BUBBLES = {
  fountain: { rate: 500, rMin: 0.0015, rMax: 0.006, gamma: 0.5, xi: 0.1 },
  stream: { rate: 800, rMin: 0.0003, rMax: 0.008, gamma: 1.5, xi: 0.1 },
  river: { rate: 5000, rMin: 0.0002, rMax: 0.02, gamma: 2, xi: 0.3 },
} as const satisfies Record<Body, Bubbles>

/** How a body mixes its layers (TUNED by rendering: peaks within ±2 dB of 0.5 across `flow`). */
interface Mix {
  /** The pink bed's filter: a band for the fountain's splash, a lowpass for running water. */
  readonly bed: BiquadFilterType
  /** Its centre or cutoff at `flow`, Hz. */
  readonly hz: (flow: number) => number
  readonly q: number
  /** The stone basin's resonance at 400 Hz, dB. */
  readonly basin: number
  /** Layer gains at `flow`: the bed, the bubbles (peak-normalised), the boulder rumble. */
  readonly layers: (flow: number) => {
    readonly bed: number
    readonly bubbles: number
    readonly rumble: number
  }
  /** Depth of the slow surge on the bed and rumble, 0…1. */
  readonly surge: (flow: number) => number
}

const MIXES = {
  fountain: {
    bed: "bandpass",
    hz: (flow) => 1500 + 1000 * flow,
    q: 0.7,
    basin: 8,
    layers: (flow) => ({ bed: 1.1 + 0.4 * flow, bubbles: 0.3 - 0.1 * flow, rumble: 0 }),
    surge: () => 0.1,
  },
  stream: {
    bed: "lowpass",
    hz: (flow) => 1500 + 1500 * flow,
    q: 0.5,
    basin: 0,
    layers: (flow) => ({ bed: 0.55 + 0.05 * flow, bubbles: 0.4 - 0.2 * flow, rumble: 0.1 * flow }),
    surge: (flow) => 0.1 + 0.1 * flow,
  },
  // The Lucido's rapids: pink lowpassed at 800 + 5000·√flow Hz, brown rumble ∝ flow^1.5.
  river: {
    bed: "lowpass",
    hz: (flow) => 800 + 5000 * Math.sqrt(flow),
    q: 0.5,
    basin: 0,
    layers: (flow) => ({
      bed: 0.75 - 0.35 * flow,
      bubbles: 0.35 - 0.25 * flow,
      rumble: 0.35 * flow ** 1.5,
    }),
    surge: (flow) => 0.15 + 0.2 * flow,
  },
} as const satisfies Record<Body, Mix>

/** Seconds of bubbles per loop: long enough not to be heard repeating under the bed. */
const LOOP_SECONDS = 3
/** Smoothing of `flow` changes, s: water does not jump. */
const TAU = 0.5

const textures = new WeakMap<BaseAudioContext, Map<Body, AudioBuffer>>()

/** `body`'s bubble loop for `ctx`, peaking at 1, made on first use. */
const bubblesOf = (ctx: BaseAudioContext, body: Body): AudioBuffer => {
  // ponytail: computed on the main thread the first time a body is heard (5–15 ms, once per body and context); bake ahead if it ever hitches.
  const made = textures.get(ctx) ?? new Map<Body, AudioBuffer>()
  textures.set(ctx, made)
  let buffer = made.get(body)
  if (buffer === undefined) {
    const samples = bubbleTexture(ctx.sampleRate, LOOP_SECONDS, BUBBLES[body])
    normalise([samples], 1)
    buffer = bufferOf(ctx, samples)
    made.set(body, buffer)
  }
  return buffer
}

/** A fountain, stream or river; the body's bubbles are swapped in if the held body ever changes. */
export const water: VoiceFactory<Water> = ({ ctx, out, cents, kit }) => {
  const level = outlet(ctx, out)
  const surge = new GainNode(ctx, { gain: 1 }),
    surgeDepth = new GainNode(ctx, { gain: 0 })
  surge.connect(level)
  // The gust signal at ×8 swings the surge at 0.25–4 Hz.
  const swell = loop(ctx, kit.gust, 8)
  swell.connect(surgeDepth).connect(surge.gain)
  const pink = loop(ctx, kit.pink),
    bedFilter = new BiquadFilterNode(ctx, { type: "lowpass", Q: 0.5 })
  const basin = new BiquadFilterNode(ctx, { type: "peaking", frequency: 400, Q: 2, gain: 0 }),
    bed = new GainNode(ctx, { gain: 0 })
  pink.connect(bedFilter).connect(basin).connect(bed).connect(surge)
  const brown = loop(ctx, kit.brown),
    rumble = new GainNode(ctx, { gain: 0 })
  brown
    .connect(new BiquadFilterNode(ctx, { type: "lowpass", frequency: 300 }))
    .connect(rumble)
    .connect(surge)
  const drops = new GainNode(ctx, { gain: 0 })
  drops.connect(level)
  for (const source of [pink, brown]) cents.connect(source.detune)
  let body: Body | undefined, bubbles: AudioBufferSourceNode | undefined
  return {
    update: (sound, now) => {
      // The first update lands at once (the outlet fades the voice in); later ones glide.
      const mix: Mix = MIXES[sound.body],
        flow = unit(sound.flow),
        tau = body === undefined ? 0.01 : TAU
      if (sound.body !== body) {
        body = sound.body
        bubbles?.stop(now)
        bubbles = loop(ctx, bubblesOf(ctx, body))
        bubbles.connect(drops)
        cents.connect(bubbles.detune)
        bedFilter.type = mix.bed
        bedFilter.Q.setTargetAtTime(mix.q, now, tau)
        basin.gain.setTargetAtTime(mix.basin, now, tau)
      }
      const layers = mix.layers(flow)
      bedFilter.frequency.setTargetAtTime(mix.hz(flow), now, tau)
      bed.gain.setTargetAtTime(layers.bed, now, tau)
      drops.gain.setTargetAtTime(layers.bubbles, now, tau)
      rumble.gain.setTargetAtTime(layers.rumble, now, tau)
      surgeDepth.gain.setTargetAtTime(mix.surge(flow), now, tau)
    },
    stop: (now) =>
      fadeOut(level, [swell, pink, brown, ...(bubbles === undefined ? [] : [bubbles])], now),
  }
}
