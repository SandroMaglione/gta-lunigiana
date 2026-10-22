/**
 * Farm and village animals' calls, rendered in pure TypeScript into a buffer at play (like the
 * crash) and replayed for the call's echoes, so they are testable in Node and reproducible with a
 * seeded random source. Each voiced call is a source-filter voice: a Rosenberg glottal pulse train
 * on an F0 contour, with jitter, shimmer, period doubling and breath noise, through a cascade of
 * four formant resonators (Klatt 1980) gliding between targets, and a closed-mouth (nasal) murmur
 * that low-passes it. The tract of each species is a uniform tube closed at the larynx (formants at
 * (2n − 1)·c / 4L), its length from the animal's size; `size` scales F0 and formants down together
 * (a bigger animal sounds lower). The hiss is breath noise alone.
 *
 * - `moo`: a cow's call, 1–2 s, F0 near 105–150 Hz, from a hum through the nose into an open
 *   "ooo" and back (cattle calls: F0 mostly 80–200 Hz, means of 120–180, Padilla de la Torre et
 *   al. 2015; a 600 kg cow's tract about 0.42 m long, estimate).
 * - `grunt`: one to three of a pig's low, rough, nasal grunts, 0.15–0.3 s each, F0 near 90 Hz
 *   with the spectrum peaking at 300–700 Hz (a 0.25 m tract, estimate).
 * - `squeal`: a scared pig's high, harsh scream, 1–1.5 s, F0 near 1 kHz, chaotic (period
 *   doubling, jitter and noise), the mouth open.
 * - `yelp`: a dog's short, high cry, 0.12–0.22 s, two to four in a row ("kai kai kai"), each
 *   lower than the last (a 0.15 m tract: Riede and Fitch 1999 put dogs' at 10–24 cm by size).
 * - `meow`: a cat's "mi-a-ou", F0 rising from 500 to 800 Hz and falling, 0.5–1 s (meows: 0.5–3 s,
 *   F0 mostly 500–800 Hz; Schötz 2013), its tract half a man's (formants twice his vowels'); a
 *   `yowl` is the long, wavering, rough cry of a cat in pain, `MEOW_QUIET` dB over a meow.
 * - `hiss`: a cat's 0.5–1 s burst of breath noise, 2–8 kHz, spat out at its start.
 *
 * Every call peaks at 0.5 (−6 dBFS), the meow `MEOW_QUIET` dB under its yowl.
 *
 * @module audio/synth/animals
 */
import { bufferOf } from "../buffers.ts"
import type { OneShot, Shot } from "../types.ts"
import { playBuffer } from "./graph.ts"

/** The calls this module renders. */
export type AnimalCall = Extract<OneShot, { readonly kind: "moo" | "grunt" | "squeal" | "yelp" | "meow" | "hiss" }>

/** Breakpoints [t, value], t from 0 (the call's start) to 1 (its end), linear between. */
type Contour = ReadonlyArray<readonly [number, number]>
/** F1–F4, Hz. */
type Formants = readonly [number, number, number, number]

/** One voiced call. */
interface Voiced {
  readonly seconds: number
  readonly f0: Contour
  /** Amplitude 0…1; starts and ends at 0, so the call starts and ends silent. */
  readonly amp: Contour
  /** Formant targets [t, F1–F4], linear between. */
  readonly formants: ReadonlyArray<readonly [number, Formants]>
  readonly bandwidths: Formants
  /** 0 the mouth open … 1 a closed-mouth hum through the nose (the voice low-passed at `NASAL_HZ`). */
  readonly nasal?: Contour
  /** Random period-to-period change of the period and of the pulse's amplitude (fractions). */
  readonly jitter: number
  readonly shimmer: number
  /** Breath noise against the voicing, pulsing with the glottis. */
  readonly breath: number
  /** Every other pulse this much weaker (period doubling: the harsh, "chaotic" register of a scream). */
  readonly doubling?: number
  /** Vibrato: depth (fraction of F0) and rate, Hz. */
  readonly vibrato?: readonly [number, number]
  /** The share of a period the glottis takes to close (0.24 by default): shorter is a tenser, brighter voice. */
  readonly closing?: number
}

/** Speed of sound, m/s (15 °C), for the tube formants. */
const C = 340.4
/** A uniform tube of `length` m closed at one end: its first four resonances, Hz. */
const tube = (length: number): Formants => {
  const f = (n: number) => (n * C) / (4 * length)
  return [f(1), f(3), f(5), f(7)]
}
/** Scales a formant set. */
const times = ([f1, f2, f3, f4]: Formants, k: number): Formants => [f1 * k, f2 * k, f3 * k, f4 * k]
/** The closed-mouth murmur's lowpass, Hz: a nasal hum keeps little above its first resonance. */
const NASAL_HZ = 450
/** A plain meow plays this many dB under a yowl, its nominal peak. */
export const MEOW_QUIET = 12
/** Every call's peak (−6 dBFS). */
const PEAK = 0.5
/** Formant coefficients are updated every this many samples. */
const BLOCK = 16

/** `lo`…`hi`, uniformly. */
const between = (random: () => number, lo: number, hi: number): number => lo + (hi - lo) * random()

/** The value of `contour` at `t`. */
const at = (contour: Contour, t: number): number => {
  if (t <= contour[0]![0]) return contour[0]![1]
  for (let i = 1; i < contour.length; i++) {
    const [t1, v1] = contour[i]!
    if (t <= t1) {
      const [t0, v0] = contour[i - 1]!
      return t1 === t0 ? v1 : v0 + ((v1 - v0) * (t - t0)) / (t1 - t0)
    }
  }
  return contour[contour.length - 1]![1]
}

/** Rosenberg's glottal flow at phase `phase` (0…1 of a period): rising over 0.36 of it, falling over `closing`, closed for the rest. */
const flow = (phase: number, closing: number): number =>
  phase < 0.36 ? 0.5 * (1 - Math.cos((Math.PI * phase) / 0.36)) : phase < 0.36 + closing ? Math.cos((Math.PI * (phase - 0.36)) / (2 * closing)) : 0

/** The glottal pulse's slope per unit of phase, scaled so its sharpest (the closing) drives the tract near 1 whatever the pitch. */
const DRIVE = 0.15

/** Renders `call` at `rate` Hz, unscaled. The contours and the formants move every `BLOCK` samples (a third of a millisecond at 48 kHz). */
const voice = (call: Voiced, rate: number, random: () => number): Float32Array<ArrayBuffer> => {
  const n = Math.max(1, Math.round(call.seconds * rate)), out = new Float32Array(n)
  const tracks = [0, 1, 2, 3].map((k) => call.formants.map(([t, f]) => [t, f[k]!] as const))
  // Each formant's two-pole resonator (Klatt 1980): y = a·x + b·y1 + c·y2, unity gain at DC.
  const y1 = new Float64Array(4), y2 = new Float64Array(4), a = new Float64Array(4), b = new Float64Array(4), c = new Float64Array(4)
  const lowpass = 1 - Math.exp((-2 * Math.PI * NASAL_HZ) / rate), closing = call.closing ?? 0.24
  let phase = 0, last = 0, pulse = 1, period = 0, low = 0, jittered = 1, f0 = 0, amp = 0, nasal = 0
  for (let i = 0; i < n; i++) {
    if (i % BLOCK === 0) {
      const t = i / n
      f0 = at(call.f0, t)
      amp = at(call.amp, t)
      nasal = call.nasal === undefined ? 0 : at(call.nasal, t)
      for (let k = 0; k < 4; k++) {
        const hz = Math.min(0.45 * rate, at(tracks[k]!, t)), r = Math.exp((-Math.PI * call.bandwidths[k]!) / rate)
        c[k] = -r * r
        b[k] = 2 * r * Math.cos((2 * Math.PI * hz) / rate)
        a[k] = 1 - b[k]! - c[k]!
      }
    }
    const vibrato = call.vibrato === undefined ? 1 : 1 + call.vibrato[0] * Math.sin(2 * Math.PI * call.vibrato[1] * (i / rate))
    const step = (f0 * vibrato * jittered) / rate
    phase += step
    if (phase >= 1) {
      // A new period: its own small change of length and loudness, and every other one weaker when the voice doubles.
      phase -= Math.floor(phase)
      period++
      jittered = 1 + call.jitter * (2 * random() - 1)
      pulse = (1 + call.shimmer * (2 * random() - 1)) * (period % 2 === 1 ? 1 - (call.doubling ?? 0) : 1)
    }
    // The flow's slope per unit of phase (the lips radiate its derivative), so the drive does not grow with the pitch.
    const u = flow(phase, closing), du = ((u - last) / step) * DRIVE * pulse
    last = u
    // Breath noise pulses with the open glottis.
    let x = du + call.breath * (2 * random() - 1) * (0.25 + u) * 0.1
    for (let k = 0; k < 4; k++) {
      const y = a[k]! * x + b[k]! * y1[k]! + c[k]! * y2[k]!
      y2[k] = y1[k]!
      y1[k] = y
      x = y
    }
    low += lowpass * (x - low)
    out[i] = ((1 - nasal) * x + nasal * low) * amp
  }
  return out
}

/** Noise through `formants` (wide bands), shaped by `amp`: breath with no voice. */
const breathe = (seconds: number, amp: Contour, formants: Formants, bandwidths: Formants, rate: number, random: () => number): Float32Array<ArrayBuffer> => {
  const n = Math.max(1, Math.round(seconds * rate)), out = new Float32Array(n)
  // Parallel band resonators, so each band adds its own share of the noise.
  const bands = formants.map((hz, k) => {
    const r = Math.exp((-Math.PI * bandwidths[k]!) / rate), freq = Math.min(0.45 * rate, hz)
    return { b: 2 * r * Math.cos((2 * Math.PI * freq) / rate), c: -r * r, gain: 1 - r, y1: 0, y2: 0 }
  })
  for (let i = 0; i < n; i++) {
    const x = 2 * random() - 1
    let sum = 0
    for (const band of bands) {
      const y = band.gain * x + band.b * band.y1 + band.c * band.y2
      band.y2 = band.y1
      band.y1 = y
      sum += y
    }
    out[i] = sum * at(amp, i / n)
  }
  return out
}

/** `parts` laid end to end, each starting `starts[i]` s in, summed. */
const sequence = (parts: ReadonlyArray<Float32Array>, starts: ReadonlyArray<number>, rate: number): Float32Array<ArrayBuffer> => {
  const offsets = starts.map((start) => Math.round(start * rate))
  const out = new Float32Array(Math.max(...parts.map((part, i) => offsets[i]! + part.length)))
  parts.forEach((part, i) => part.forEach((v, j) => (out[offsets[i]! + j]! += v)))
  return out
}

/** Scales `samples` in place to peak at `peak`. */
const peaking = (samples: Float32Array<ArrayBuffer>, peak: number): Float32Array<ArrayBuffer> => {
  let top = 0
  for (const v of samples) top = Math.max(top, Math.abs(v))
  if (top > 0) for (let i = 0; i < samples.length; i++) samples[i]! *= peak / top
  return samples
}

/** A cow's tract, about 0.42 m long (estimate for a 600 kg cow), and her open "ooo": the tube's F2 lowered by rounded lips. */
const COW = tube(0.42)
/** A pig's (0.25 m), a dog's (0.15 m) tract, estimates by body size. */
const PIG = tube(0.25), DOG = tube(0.15)
/** A cat's vowels, twice a man's (Peterson and Barney 1952): her tract is about half his length. */
const CAT = { i: times([270, 2290, 3010, 4000], 2), a: times([730, 1090, 2440, 3500], 2), u: times([300, 870, 2240, 3300], 2) } as const

/** What a call renders: the animal's size, the rate, the random source. */
type Render = (size: number, rate: number, random: () => number) => Float32Array<ArrayBuffer>

/** Each call by kind; the cat's yowl apart from its meow. */
const CALLS = {
  moo: (size, rate, random) => {
    const k = 1 / size, f0 = between(random, 125, 150) * k, ooo = times([COW[0] * 1.15, COW[1] * 0.95, COW[2], COW[3]], k)
    return peaking(voice({
      seconds: between(random, 1, 2),
      f0: [[0, f0 * 0.75], [0.25, f0], [0.7, f0 * 0.95], [1, f0 * 0.7]],
      amp: [[0, 0], [0.06, 0.3], [0.22, 0.45], [0.35, 1], [0.75, 0.9], [0.92, 0.35], [1, 0]],
      formants: [[0, times(COW, k * 0.85)], [0.2, times(COW, k * 0.85)], [0.38, ooo], [0.8, times(ooo, 0.92)], [1, times(COW, k * 0.85)]],
      bandwidths: [70, 90, 140, 200],
      nasal: [[0, 1], [0.2, 0.9], [0.38, 0.1], [0.8, 0.2], [1, 0.8]],
      jitter: 0.012, shimmer: 0.06, breath: 0.4
    }, rate, random), PEAK)
  },
  grunt: (size, rate, random) => {
    const k = 1 / size, count = 1 + Math.floor(random() * 3), parts: Array<Float32Array> = [], starts: Array<number> = []
    for (let g = 0, t = 0; g < count; g++, t += between(random, 0.3, 0.45)) {
      const f0 = between(random, 75, 110) * k
      parts.push(voice({
        seconds: between(random, 0.15, 0.3),
        f0: [[0, f0 * 1.15], [0.3, f0], [1, f0 * 0.8]],
        amp: [[0, 0], [0.1, 1], [0.6, 0.7], [1, 0]],
        formants: [[0, times(PIG, k)], [1, times(PIG, k * 0.9)]],
        bandwidths: [120, 200, 300, 400],
        nasal: [[0, 0.7], [1, 0.8]],
        jitter: 0.1, shimmer: 0.25, breath: 1.2, doubling: 0.4
      }, rate, random))
      starts.push(t)
    }
    return peaking(sequence(parts, starts, rate), PEAK)
  },
  squeal: (size, rate, random) => {
    const k = 1 / size, f0 = between(random, 850, 1100) * k
    return peaking(voice({
      seconds: between(random, 1, 1.5),
      f0: [[0, f0 * 0.8], [0.15, f0 * 1.2], [0.6, f0 * 1.1], [1, f0 * 0.85]],
      amp: [[0, 0], [0.03, 1], [0.5, 0.85], [0.85, 0.75], [1, 0]],
      formants: [[0, times([1000, 2100, 3300, 4600], k)], [1, times([900, 1900, 3100, 4400], k)]],
      bandwidths: [200, 250, 350, 450],
      jitter: 0.06, shimmer: 0.2, breath: 2.5, doubling: 0.45, vibrato: [0.04, 11], closing: 0.08
    }, rate, random), PEAK)
  },
  yelp: (size, rate, random) => {
    const k = 1 / size, count = 2 + Math.floor(random() * 3), parts: Array<Float32Array> = [], starts: Array<number> = []
    for (let y = 0, t = 0; y < count; y++, t += between(random, 0.22, 0.32)) {
      const f0 = between(random, 900, 1100) * k * 0.93 ** y
      parts.push(voice({
        seconds: between(random, 0.12, 0.22),
        f0: [[0, f0 * 0.7], [0.25, f0 * 1.1], [1, f0 * 0.6]],
        amp: [[0, 0], [0.12, 1], [0.6, 0.6], [1, 0]],
        formants: [[0, times(DOG, k * 1.1)], [1, times(DOG, k * 0.85)]],
        bandwidths: [150, 200, 300, 400],
        jitter: 0.02, shimmer: 0.08, breath: 0.8
      }, rate, random))
      starts.push(t)
    }
    return peaking(sequence(parts, starts, rate), PEAK)
  },
  meow: (size, rate, random) => {
    const k = 1 / size, f0 = between(random, 500, 560) * k
    return peaking(voice({
      seconds: between(random, 0.5, 1),
      f0: [[0, f0], [0.45, f0 * 1.45], [1, f0 * 1.05]],
      amp: [[0, 0], [0.1, 0.8], [0.45, 1], [0.85, 0.6], [1, 0]],
      formants: [[0, times(CAT.i, k)], [0.45, times(CAT.a, k)], [1, times(CAT.u, k)]],
      bandwidths: [120, 180, 260, 350],
      nasal: [[0, 0.6], [0.2, 0], [1, 0.2]],
      jitter: 0.01, shimmer: 0.05, breath: 0.6
    }, rate, random), PEAK * 10 ** (-MEOW_QUIET / 20))
  },
  yowl: (size, rate, random) => {
    const k = 1 / size, f0 = between(random, 380, 460) * k
    return peaking(voice({
      seconds: between(random, 1.2, 2),
      f0: [[0, f0], [0.3, f0 * 1.7], [0.7, f0 * 1.5], [1, f0 * 1.1]],
      amp: [[0, 0], [0.08, 0.7], [0.3, 1], [0.8, 0.8], [1, 0]],
      formants: [[0, times(CAT.a, k * 0.9)], [0.5, times(CAT.a, k)], [1, times(CAT.u, k)]],
      bandwidths: [150, 220, 300, 400],
      jitter: 0.04, shimmer: 0.15, breath: 1.5, doubling: 0.25, vibrato: [0.05, 6]
    }, rate, random), PEAK)
  },
  hiss: (size, rate, random) => {
    const k = 1 / size
    return peaking(breathe(between(random, 0.5, 1), [[0, 0], [0.02, 1], [0.12, 0.7], [0.8, 0.5], [1, 0]], times([2800, 4200, 5800, 7500], k), [1200, 1600, 2000, 2500], rate, random), PEAK)
  }
} as const satisfies Record<AnimalCall["kind"] | "yowl", Render>

/** Renders `sound` at `rate` Hz with `random` (every draw of the call: its length, pitch, jitter, noise). */
export const renderAnimal = (sound: AnimalCall, rate: number, random: () => number): Float32Array<ArrayBuffer> =>
  CALLS[sound.kind === "meow" && sound.yowl ? "yowl" : sound.kind](sound.size, rate, random)

/** How far (dB) a call plays under its nominal peak, so masking counts the level played: a plain meow under a yowl. */
export const animalQuiet = (sound: AnimalCall): number => (sound.kind === "meow" && !sound.yowl ? MEOW_QUIET : 0)

/** The rate a call renders at on `ctx`, Hz: at most 48 kHz (a cat's highest formants sit under 12 kHz). */
const rateOf = (ctx: BaseAudioContext): number => Math.min(ctx.sampleRate, 48000)

/** The shot of a call: rendered at its first play (a few ms) and kept per params object, so the director's echoes replay it. */
const call = <K extends AnimalCall["kind"]>(): Shot<Extract<AnimalCall, { readonly kind: K }>> => {
  const renders = new WeakMap<AnimalCall, AudioBuffer>()
  return {
    play: (io, sound, when) => {
      let buffer = renders.get(sound)
      if (buffer === undefined) renders.set(sound, (buffer = bufferOf(io.ctx, renderAnimal(sound, rateOf(io.ctx), Math.random), rateOf(io.ctx))))
      return playBuffer(io, buffer, when)
    }
  }
}

/** A cow's moo. */
export const moo = call<"moo">()
/** A pig's grunts. */
export const grunt = call<"grunt">()
/** A scared pig's squeal. */
export const squeal = call<"squeal">()
/** A dog's yelps. */
export const yelp = call<"yelp">()
/** A cat's meow or yowl. */
export const meow = call<"meow">()
/** A cat's hiss. */
export const hiss = call<"hiss">()
