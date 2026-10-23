/**
 * The crash research's analysis tools, ported for the crash tests (features.ts, burst.ts and track.ts
 * in /tmp/crash-research), so a render is read on the same columns as the reference recordings.
 * Times are in ms from the onset; levels in dB. Imported only by tests.
 *
 * @module audio/synth/crash/testing
 */
import { fft, type Mix, noiseFor, playNoise } from "./dsp.ts"

/** Octave band centres the levels are given at, Hz. */
const OCTAVES = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const

const db = (p: number): number => 10 * Math.log10(Math.max(p, 1e-30))
const pow2 = (n: number): number => 2 ** Math.ceil(Math.log2(Math.max(2, n)))
const median = (values: ReadonlyArray<number>): number =>
  [...values].sort((a, b) => a - b)[values.length >> 1]!

/** Power spectrum of x[from, to), Hann or Tukey (1 ms tapers) windowed, zero-padded to `size`. */
const spectrum = (
  x: Float32Array,
  from: number,
  to: number,
  sr: number,
  hann: boolean,
  size?: number,
) => {
  const len = Math.max(0, Math.min(to, x.length) - from),
    n = size ?? pow2(len)
  const re = new Float64Array(n),
    im = new Float64Array(n),
    taper = Math.min(Math.round(sr / 1000), Math.floor(len / 4))
  for (let i = 0; i < len; i++) {
    const w = hann
      ? 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / len)
      : i < taper
        ? 0.5 - 0.5 * Math.cos((Math.PI * (i + 0.5)) / taper)
        : i >= len - taper
          ? 0.5 - 0.5 * Math.cos((Math.PI * (len - i - 0.5)) / taper)
          : 1
    re[i] = x[from + i]! * w
  }
  fft(re, im)
  const power = new Float64Array(n / 2 + 1)
  for (let k = 0; k <= n / 2; k++) power[k] = re[k]! * re[k]! + im[k]! * im[k]!
  return { power, binHz: sr / n }
}
type Spec = ReturnType<typeof spectrum>

const bandPower = (s: Spec, lo: number, hi: number): number => {
  let sum = 0
  for (
    let k = Math.max(1, Math.ceil(lo / s.binHz));
    k <= Math.min(s.power.length - 1, Math.floor(hi / s.binHz));
    k++
  )
    sum += s.power[k]!
  return sum
}
const flatness = (s: Spec, lo: number, hi: number): number => {
  const a = Math.max(1, Math.ceil(lo / s.binHz)),
    b = Math.min(s.power.length - 1, Math.floor(hi / s.binHz))
  let logs = 0,
    sum = 0
  for (let k = a; k <= b; k++) {
    logs += Math.log(s.power[k]! + 1e-30)
    sum += s.power[k]!
  }
  return sum > 0 ? Math.exp(logs / (b - a + 1)) / (sum / (b - a + 1)) : 0
}

/** One phase of a render: octave levels re the loudest band, the energy-weighted flatness inside each octave 250 Hz–8 kHz (≈ 0.56 for noise, near 0 for ringing modes), the magnitude-weighted centroid. */
export interface Phase {
  readonly octaves: ReadonlyArray<number>
  readonly bandFlatness: number
  readonly centroid: number
}

const phaseOf = (s: Spec): Phase => {
  const p = OCTAVES.map((fc) => bandPower(s, fc / Math.SQRT2, fc * Math.SQRT2)),
    top = Math.max(...p)
  let num = 0,
    den = 0,
    cn = 0,
    cd = 0
  for (const fc of [250, 500, 1000, 2000, 4000, 8000]) {
    const e = bandPower(s, fc / Math.SQRT2, fc * Math.SQRT2)
    num += flatness(s, fc / Math.SQRT2, fc * Math.SQRT2) * e
    den += e
  }
  for (let k = 1; k < s.power.length; k++) {
    const m = Math.sqrt(s.power[k]!)
    cn += k * s.binHz * m
    cd += m
  }
  return {
    octaves: p.map((v) => Math.round((db(v) - db(top)) * 10) / 10),
    bandFlatness: den > 0 ? num / den : 0,
    centroid: cd > 0 ? cn / cd : 0,
  }
}

/** The columns of the reference table for one render. */
export interface Features {
  /** Samples to the onset: the start of the rise to the loudest peak. */
  readonly onset: number
  /** 10 → 90 % rise of the first event (the loudest peak envelope inside 50 ms), ms. */
  readonly rise: number
  /** First time the 10 ms RMS falls 10 / 20 dB under its maximum, after it (null: never). */
  readonly db10: number | null
  readonly db20: number | null
  /** RMS of the first 300 ms, dBFS, and the sample peak re it, dB. */
  readonly rms: number
  readonly crest: number
  /** 0–30, 30–150, 150–600 and 600–3000 ms. */
  readonly phases: ReadonlyArray<Phase>
  /** Share of the energy below 200 Hz over 0–3 s. */
  readonly below200: number
  /** Median kurtosis of the 1–8 kHz band in 20 ms frames over 0–300 ms (Gaussian noise 3, clicks ≫ 3). */
  readonly kurtosis: number
}

/** Measures a render `x` at `sr`. */
export const features = (x: Float32Array, sr: number): Features => {
  const release = Math.exp(-1 / (0.01 * sr)),
    penv = new Float32Array(x.length)
  let peak = 0
  for (let i = 0, e = 0; i < x.length; i++) {
    const a = Math.abs(x[i]!)
    e = Math.max(a, e * release)
    penv[i] = e
    peak = Math.max(peak, a)
  }
  let n90 = 0
  while (penv[n90]! < 0.9 * peak) n90++
  let onset = n90
  while (onset > 0 && penv[onset - 1]! >= 0.1 * peak) onset--
  // The first event: the loudest peak envelope within 50 ms of the onset, and its own 10 → 90 % rise.
  let local = 0
  for (let i = onset; i < Math.min(x.length, onset + 0.05 * sr); i++)
    local = Math.max(local, penv[i]!)
  let e90 = onset
  while (penv[e90]! < 0.9 * local) e90++
  let e10 = e90
  while (e10 > 0 && penv[e10 - 1]! >= 0.1 * local) e10--

  const win = Math.round(sr / 100),
    hop = Math.round(sr / 1000),
    env: Array<number> = []
  for (let i = 0; i + win <= x.length; i += hop) {
    let s = 0
    for (let j = i; j < i + win; j++) s += x[j]! * x[j]!
    env.push(db(s / win))
  }
  const top = Math.max(...env),
    at = env.indexOf(top),
    onsetHop = Math.round(onset / hop)
  const drop = (n: number): number | null => {
    for (let h = at; h < env.length; h++) if (env[h]! < top - n) return h - onsetHop + 5
    return null
  }
  const ms = (t: number) => onset + Math.round((t * sr) / 1000)
  let s300 = 0
  for (let i = onset; i < Math.min(x.length, ms(300)); i++) s300 += x[i]! * x[i]!
  const phases = [
    [0, 30],
    [30, 150],
    [150, 600],
    [600, 3000],
  ].map(([a, b]) => phaseOf(spectrum(x, ms(a!), Math.min(ms(b!), x.length), sr, false)))
  const whole = spectrum(x, onset, Math.min(ms(3000), x.length), sr, false)
  return {
    onset,
    rise: ((e90 - e10) * 1000) / sr,
    db10: drop(10),
    db20: drop(20),
    rms: db(s300 / (ms(300) - onset)),
    crest: db(peak * peak) - db(s300 / (ms(300) - onset)),
    phases,
    below200: bandPower(whole, 1, 200) / bandPower(whole, 1, Infinity),
    kurtosis: kurtosisOf(x, sr, onset),
  }
}

/** burst.ts: the 1–8 kHz band (an FFT brick wall over 400 ms from the onset), kurtosis in 20 ms frames over 0–300 ms. */
const kurtosisOf = (x: Float32Array, sr: number, onset: number) => {
  const len = Math.round(0.4 * sr),
    n = pow2(len),
    re = new Float64Array(n),
    im = new Float64Array(n)
  for (let i = 0; i < len && onset + i < x.length; i++) re[i] = x[onset + i]!
  fft(re, im)
  const lo = Math.round((1000 * n) / sr),
    hi = Math.round((8000 * n) / sr)
  for (let k = 0; k < n; k++) {
    const kk = Math.min(k, n - k)
    if (kk < lo || kk > hi) re[k] = im[k] = 0
    im[k] = -im[k]!
  }
  fft(re, im)
  const frame = Math.round(0.02 * sr),
    values: Array<number> = []
  for (let a = 0; a + frame <= Math.round(0.3 * sr); a += frame) {
    let m2 = 0,
      m4 = 0
    for (let i = a; i < a + frame; i++) {
      const y2 = re[i]! * re[i]!
      m2 += y2
      m4 += y2 * y2
    }
    values.push(m2 > 0 ? m4 / frame / (m2 / frame) ** 2 : 3)
  }
  return median(values)
}

/** A long partial: its frequency, how far it stands over the ±300 Hz median (dB), and its tracked T60 and loss factor. */
export interface Partial {
  readonly hz: number
  readonly clear: number
  readonly t60: number
  readonly eta: number
}

/**
 * peaks.ts then track.ts: spectral peaks `hzLo`–`hzHi` at least `prominence` dB over the ±300 Hz median
 * in onset + 30–230 ms (16384-point Hann), each followed in an 85 ms STFT (10 ms hop) up to 1.5 s, its
 * decay fitted from its maximum while it stays 6 dB clear. Peaks never 6 dB clear for 3 frames are left out.
 */
export const partials = (
  x: Float32Array,
  sr: number,
  onset: number,
  hzLo = 500,
  hzHi = 5000,
  prominence = 9,
): ReadonlyArray<Partial> => {
  const a = spectrum(
    x,
    onset + Math.round(0.03 * sr),
    onset + Math.round(0.23 * sr),
    sr,
    true,
    16384,
  )
  const half = Math.round(300 / a.binHz),
    found: Array<number> = []
  for (
    let k = Math.ceil(hzLo / a.binHz);
    k < Math.min(a.power.length - half, hzHi / a.binHz);
    k++
  ) {
    let isMax = true
    for (let j = k - 10; j <= k + 10; j++) if (a.power[j]! > a.power[k]!) isMax = false
    if (
      isMax &&
      db(a.power[k]!) - db(median(Array.from(a.power.subarray(k - half, k + half)))) >= prominence
    )
      found.push(k * a.binHz)
  }
  const N = 4096,
    step = Math.round(sr / 100),
    binHz = sr / N,
    around = Math.round(300 / binHz),
    frames: Array<Float64Array> = []
  for (let s = onset; s + N <= Math.min(x.length, onset + 1.5 * sr); s += step) {
    const f = spectrum(x, s, s + N, sr, true, N)
    frames.push(f.power.map(db))
  }
  return found.flatMap((hz) => {
    const k0 = Math.round(hz / binHz),
      w = Math.ceil(8 / binHz)
    const lv = frames.map((f) => Math.max(...f.subarray(k0 - w, k0 + w + 1)))
    const md = frames.map((f) => median(Array.from(f.subarray(k0 - around, k0 + around))))
    let i0 = 0
    for (let i = 0; i < Math.min(lv.length, 30); i++) if (lv[i]! > lv[i0]!) i0 = i
    let i1 = i0
    while (i1 + 1 < lv.length && lv[i1 + 1]! - md[i1 + 1]! >= 6) i1++
    if (i1 - i0 < 3) return []
    const n = i1 - i0 + 1,
      ts = Array.from({ length: n }, (_, j) => j * 0.01),
      ys = lv.slice(i0, i1 + 1)
    const mt = ts.reduce((p, q) => p + q) / n,
      my = ys.reduce((p, q) => p + q) / n
    const slope =
      -ts.reduce((s, t, j) => s + (t - mt) * (ys[j]! - my), 0) /
      ts.reduce((s, t) => s + (t - mt) ** 2, 0)
    const t60 = slope > 0 ? 60 / slope : Infinity
    return [{ hz, clear: lv[i0]! - md[i0]!, t60, eta: 2.2 / (hz * t60) }]
  })
}

/** Power of `x` in [from, to) s between `lo` and `hi` Hz (Tukey window), for band-limited comparisons. */
export const bandEnergy = (
  x: Float32Array,
  sr: number,
  from: number,
  to: number,
  lo: number,
  hi: number,
): number => bandPower(spectrum(x, Math.round(from * sr), Math.round(to * sr), sr, false), lo, hi)

/** One layer alone: `draw` writes into an empty mix `seconds` long (heard from outside), then its noise is played. */
export const layer = (
  sr: number,
  seconds: number,
  random: () => number,
  draw: (mix: Mix) => void,
): Float32Array => {
  const n = Math.ceil(seconds * sr),
    mix: Mix = {
      out: new Float32Array(n),
      noise: noiseFor(n, sr),
      sampleRate: sr,
      random,
      floor: 1e-6,
    }
  draw(mix)
  playNoise(mix.out, mix.noise, random, mix.floor)
  return mix.out
}

/** Magnitude-weighted centroid of x[from, to) s, Hz. */
export const centroidOf = (x: Float32Array, sr: number, from: number, to: number): number =>
  phaseOf(spectrum(x, Math.round(from * sr), Math.round(to * sr), sr, false)).centroid
