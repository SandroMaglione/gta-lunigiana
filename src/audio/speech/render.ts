/**
 * The speech synth: a Klatt-style cascade/parallel formant synthesiser (Klatt 1980, JASA 67
 * "Software for a cascade/parallel formant synthesizer") in pure TypeScript, rendering a `Plan`
 * into samples. A glottal pulse (KLGLOTT88's polynomial flow, Klatt & Klatt 1990) with jitter,
 * shimmer and flutter, tilted by effort, plus aspiration riding on it, excites a nasal pole/zero
 * pair and five formant resonators in cascade; frication and release bursts go through a parallel
 * band filter; the trill dips the amplitude at each tongue contact. Formants update every 5 ms
 * frame as Klatt's did; source amplitudes glide per sample and the noise band follows the
 * targets, so bursts stay sharp and in their own band.
 *
 * @module audio/speech/render
 */
import type { Band } from "./phonemes.ts"
import { planLine, type Plan, type Target } from "./plan.ts"
import type { Speech } from "./types.ts"

/** Formant update frame, s (Klatt 1980's 5 ms). */
const FRAME = 0.005
/** Half-width of a formant glide across a boundary, s (CV transitions last ≈ 40–60 ms: Kewley-Port 1982, JASA 72). */
const GLIDE = 0.025
/** Half-width of an amplitude glide, s: quick, so closures and bursts stay crisp. */
const RAMP = 0.006
/** Formant bandwidths B1–B4, Hz (Klatt 1980's defaults, rounded), and F5 with its bandwidth for an adult male tract. */
const BANDWIDTHS = [70, 100, 150, 220] as const, F5 = 4500, B5 = 300
/** TUNED: aspiration (`ah`: /h/, a stop's VOT), breath noise on voicing, and frication levels re the voicing, so /s/ sits ≈ 10–15 dB under the vowels as in speech (measured in render.test.ts). */
const ASPIRATION = 0.3, BREATH = 0.09, FRICATION = 2
/** Amplitude left at a trill's tongue contact, and the contact's half-length, s (a contact closes ≈ 40 % of a 40 ms cycle). */
const CONTACT_FLOOR = 0.2, CONTACT = 0.008
/** Fade over the outer samples of the silent pads, s: whatever the tract still rings at the buffer's last sample ends at 0. */
const FADE = 0.005
/** Every render peaks here (−6 dBFS, like every synth: `src/audio/types.ts`); the director sets loudness by level. */
const PEAK = 0.5

/** A two-pole resonator (Klatt 1980 eq. 2), unity gain at DC: the cascade's formants and nasal pole. */
interface Resonator {
  a: number
  b: number
  c: number
  y1: number
  y2: number
}
const resonator = (): Resonator => ({ a: 1, b: 0, c: 0, y1: 0, y2: 0 })
/** Sets `r` to frequency `f` and bandwidth `bw`, Hz, at `rate`. */
const tune = (r: Resonator, f: number, bw: number, rate: number): void => {
  const radius = Math.exp((-Math.PI * Math.min(bw, rate / 4)) / rate), hz = Math.min(f, 0.45 * rate)
  r.c = -radius * radius
  r.b = 2 * radius * Math.cos((2 * Math.PI * hz) / rate)
  r.a = 1 - r.b - r.c
}
const resonate = (r: Resonator, x: number): number => {
  const y = r.a * x + r.b * r.y1 + r.c * r.y2
  r.y2 = r.y1
  r.y1 = y
  return y
}
/** The antiresonator (Klatt 1980 eq. 3): the inverse of a resonator tuned the same, for the nasal zero. */
const antiresonate = (r: Resonator, x: number): number => {
  // Here y1, y2 hold past inputs.
  const y = (x - r.b * r.y1 - r.c * r.y2) / r.a
  r.y2 = r.y1
  r.y1 = x
  return y
}

/** A constant 0 dB-peak band-pass (RBJ cookbook): the parallel branch, so a band's gain is its level. */
interface Bandpass {
  b0: number
  a1: number
  a2: number
  x1: number
  x2: number
  y1: number
  y2: number
}
const setBand = (f: Bandpass, hz: number, bw: number, rate: number): void => {
  const w = (2 * Math.PI * Math.min(hz, 0.45 * rate)) / rate, alpha = Math.sin(w) / (2 * (Math.min(hz, 0.45 * rate) / bw)), a0 = 1 + alpha
  f.b0 = alpha / a0
  f.a1 = (-2 * Math.cos(w)) / a0
  f.a2 = (1 - alpha) / a0
}
const bandpass = (f: Bandpass, x: number): number => {
  const y = f.b0 * (x - f.x2) - f.a1 * f.y1 - f.a2 * f.y2
  f.x2 = f.x1
  f.x1 = x
  f.y2 = f.y1
  f.y1 = y
  return y
}

const smooth = (x: number): number => x * x * (3 - 2 * x)

/** A glide across a target boundary: from target `from` to `to` by weight `w` (`from` alone, `w` 0, away from a boundary). */
interface Blend {
  from: Target
  to: Target
  w: number
}

/** Sets `blend` to where `t` sits in `targets[i]`, glided over `width` s each side of a boundary (never past half of either stretch). */
const across = (blend: Blend, targets: ReadonlyArray<Target>, i: number, t: number, width: number): Blend => {
  const cur = targets[i]!, prev = targets[i - 1], next = targets[i + 1]
  blend.from = blend.to = cur
  blend.w = 0
  if (next !== undefined) {
    const w = Math.min(width, (cur.end - cur.start) / 2, (next.end - next.start) / 2)
    if (cur.end - t < w) {
      blend.to = next
      blend.w = smooth((t - (cur.end - w)) / (2 * w))
      return blend
    }
  }
  if (prev !== undefined) {
    const w = Math.min(width, (cur.end - cur.start) / 2, (prev.end - prev.start) / 2)
    if (t - cur.start < w) {
      blend.from = prev
      blend.w = smooth((t - (cur.start - w)) / (2 * w))
    }
  }
  return blend
}

/** `get` of `blend`'s targets, weighed. */
const mix = ({ from, to, w }: Blend, get: (target: Target) => number): number => get(from) + (get(to) - get(from)) * w

/**
 * The band the frication at `t` goes through: `targets[i]`'s own when it hisses, else that of a neighbour whose frication
 * ramps across the boundary into it (`width` s each side, as `glide`), so a burst's onset and tail keep its band.
 */
const noiseAt = (targets: ReadonlyArray<Target>, i: number, t: number, width: number): Band => {
  const cur = targets[i]!, prev = targets[i - 1], next = targets[i + 1], half = (x: Target) => (x.end - x.start) / 2
  if (cur.af > 0) return cur.noise
  if (next !== undefined && next.af > 0 && cur.end - t < Math.min(width, half(cur), half(next))) return next.noise
  if (prev !== undefined && prev.af > 0 && t - cur.start < Math.min(width, half(cur), half(prev))) return prev.noise
  return cur.noise
}

/** The F0 of `pitch` at `t`, Hz. */
const pitchAt = (pitch: Plan["pitch"], t: number): number => {
  if (t <= pitch[0]![0]) return pitch[0]![1]
  for (let k = 1; k < pitch.length; k++) {
    const [t1, f1] = pitch[k]!
    if (t <= t1) {
      const [t0, f00] = pitch[k - 1]!
      return t1 > t0 ? f00 + ((f1 - f00) * (t - t0)) / (t1 - t0) : f1
    }
  }
  return pitch[pitch.length - 1]![1]
}

/** Renders `plan` at `rate` Hz, noise and perturbations drawn from `random`; peaks at 0.5. */
export const renderPlan = (plan: Plan, rate: number, random: () => number): Float32Array<ArrayBuffer> => {
  const { targets, pitch, quality } = plan, out = new Float32Array(Math.round(plan.seconds * rate))
  const gauss = () => (random() + random() + random() - 1.5) * 2
  const nasalPole = resonator(), nasalZero = resonator(), formants = [resonator(), resonator(), resonator(), resonator(), resonator()]
  // Two sections in series: 12 dB/octave skirts, so a fricative's noise stays in its band (/ʃ/ under /s/).
  const bands: Array<Bandpass> = [0, 1].map(() => ({ b0: 0, a1: 0, a2: 0, x1: 0, x2: 0, y1: 0, y2: 0 }))
  tune(nasalPole, quality.pole, 100, rate)
  tune(formants[4]!, F5 * quality.tract, B5, rate)
  const tilt = Math.exp((-2 * Math.PI * quality.tilt) / rate), dc = 1 - (2 * Math.PI * 40) / rate
  const flutterPhase = random() * 100, frameLength = Math.max(1, Math.round(FRAME * rate))
  // The formants' slow glide (per frame) and the source amplitudes' quick one (per sample), reused so the loop allocates nothing.
  const slow: Blend = { from: targets[0]!, to: targets[0]!, w: 0 }, quick: Blend = { ...slow }
  let tuned: Band | undefined, i = 0, phase = 1, f0 = pitch[0]![1], amp = 1, tilted = 0, hpIn = 0, hpOut = 0
  for (let n = 0; n < out.length; n++) {
    const t = n / rate
    while (i < targets.length - 1 && t >= targets[i]!.end) i++
    const cur = targets[i]!
    if (n % frameLength === 0) {
      const breathy = 1 + 1.5 * quality.breath, frame = across(slow, targets, i, t + FRAME / 2, GLIDE)
      for (let k = 0; k < 4; k++) tune(formants[k]!, mix(frame, (x) => x.formants[k]!), BANDWIDTHS[k]! * (k === 0 ? breathy : 1) * quality.tract ** 0.5, rate)
      tune(nasalZero, mix(frame, (x) => x.zero), 100, rate)
    }
    // The noise band follows the targets, not the 5 ms frames: a 6 ms burst would otherwise start in the closure's band.
    const noise = noiseAt(targets, i, t, RAMP)
    if (noise !== tuned) for (const band of bands) setBand(band, (tuned = noise).hz, noise.bw, rate)
    if (phase >= 1) {
      // A new glottal cycle: its F0 with flutter (Klatt & Klatt 1990: three slow sines) and jitter, its amplitude with shimmer.
      phase -= 1
      const s = t + flutterPhase, wander = (Math.sin(2 * Math.PI * 12.7 * s) + Math.sin(2 * Math.PI * 7.1 * s) + Math.sin(2 * Math.PI * 4.7 * s)) / 3
      f0 = pitchAt(pitch, t) * (1 + quality.flutter * wander) * (1 + quality.jitter * gauss())
      amp = Math.max(0, 1 + quality.shimmer * gauss())
    }
    phase += f0 / rate
    // KLGLOTT88: flow ∝ u² − u³ over the open phase u = phase / oq; its derivative (lip radiation included) excites the tract.
    const u = phase / quality.oq, open = u < 1
    const { from, to, w } = across(quick, targets, i, t, RAMP)
    const av = from.av + (to.av - from.av) * w, ah = from.ah + (to.ah - from.ah) * w, af = from.af + (to.af - from.af) * w
    const pulse = open ? 2 * u - 3 * u * u : 0
    tilted = pulse * amp * av + tilt * (tilted - pulse * amp * av)
    const breath = (random() * 2 - 1) * (ah * ASPIRATION + quality.breath * av * (open ? 1 : 0.3) * BREATH)
    let y = antiresonate(nasalZero, resonate(nasalPole, tilted + breath))
    for (const r of formants) y = resonate(r, y)
    if (cur.contacts > 0) {
      const span = (cur.end - cur.start) / cur.contacts, at = cur.start + span * (Math.floor((t - cur.start) / span) + 0.5), x = (t - at) / CONTACT
      y *= 1 - (1 - CONTACT_FLOOR) * Math.exp(-x * x)
    }
    y += bandpass(bands[1]!, bandpass(bands[0]!, random() * 2 - 1)) * af * FRICATION
    // DC blocker (≈ 40 Hz high-pass).
    hpOut = y - hpIn + dc * hpOut
    hpIn = y
    out[n] = hpOut
  }
  const fade = Math.round(FADE * rate)
  let peak = 0
  for (let n = 0; n < out.length; n++) {
    const edge = Math.min(n, out.length - 1 - n)
    if (edge < fade) out[n]! *= edge / fade
    peak = Math.max(peak, Math.abs(out[n]!))
  }
  if (peak > 0) for (let n = 0; n < out.length; n++) out[n]! *= PEAK / peak
  return out
}

/** `speech` rendered at `rate` Hz: said, or yelled when `loud`; noise and perturbations from `random`. Peaks at 0.5. */
export const renderSpeech = (speech: Speech, loud: boolean, rate: number, random: () => number): Float32Array<ArrayBuffer> =>
  renderPlan(planLine(speech.line, speech.speaker, loud), rate, random)
