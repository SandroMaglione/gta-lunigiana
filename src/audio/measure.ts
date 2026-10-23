/**
 * Numbers for a rendered sound, for the audition page's checks: its peak, RMS level, spectral
 * centroid (how bright it is) and whether any sample went non-finite.
 *
 * @module audio/measure
 */
import { SILENCE_DB } from "./mixer.ts"

/** What a render measures. */
interface Measure {
  /** The largest finite |sample|. */
  readonly peak: number
  /** RMS over every channel, dBFS (`SILENCE_DB` when silent). */
  readonly rms: number
  /** Magnitude-weighted mean frequency, Hz (0 when silent). */
  readonly centroid: number
  /** Some sample is NaN or infinite (counted as 0 in the other numbers). */
  readonly nan: boolean
}

/** Frame length of the spectrum, samples (a power of two: 43 ms at 48 kHz). */
const FRAME = 2048

/** In-place radix-2 FFT of (re, im), length FRAME; `cos`/`sin` hold the FRAME/2 twiddles. */
const fft = (re: Float64Array, im: Float64Array, cos: Float64Array, sin: Float64Array): void => {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const r = re[i]!,
        m = im[i]!
      re[i] = re[j]!
      im[i] = im[j]!
      re[j] = r
      im[j] = m
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size / 2,
      stride = n / size
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const a = start + k,
          b = a + half,
          wr = cos[k * stride]!,
          wi = sin[k * stride]!
        const tr = re[b]! * wr - im[b]! * wi,
          ti = re[b]! * wi + im[b]! * wr
        re[b] = re[a]! - tr
        im[b] = im[a]! - ti
        re[a] = re[a]! + tr
        im[a] = im[a]! + ti
      }
    }
  }
}

/** Measures `channels` sampled at `sampleRate`; the spectrum sums the Hann-windowed frames of every channel. */
export const measure = (channels: ReadonlyArray<Float32Array>, sampleRate: number): Measure => {
  const cos = Float64Array.from({ length: FRAME / 2 }, (_, k) =>
    Math.cos((-2 * Math.PI * k) / FRAME),
  )
  const sin = Float64Array.from({ length: FRAME / 2 }, (_, k) =>
    Math.sin((-2 * Math.PI * k) / FRAME),
  )
  const magnitude = new Float64Array(FRAME / 2 + 1),
    re = new Float64Array(FRAME),
    im = new Float64Array(FRAME)
  let peak = 0,
    energy = 0,
    count = 0,
    nan = false
  for (const samples of channels) {
    count += samples.length
    for (let start = 0; start < samples.length; start += FRAME) {
      // A short last frame gets a window of its own length, zero-padded: cutting it off mid-sound would smear it into a click.
      const length = Math.min(FRAME, samples.length - start)
      re.fill(0)
      im.fill(0)
      for (let i = 0; i < length; i++) {
        let v = samples[start + i]!
        if (!Number.isFinite(v)) [nan, v] = [true, 0]
        peak = Math.max(peak, Math.abs(v))
        energy += v * v
        re[i] = v * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / length))
      }
      fft(re, im, cos, sin)
      for (let k = 0; k <= FRAME / 2; k++) magnitude[k]! += Math.hypot(re[k]!, im[k]!)
    }
  }
  let weighted = 0,
    total = 0
  for (let k = 0; k <= FRAME / 2; k++) {
    weighted += ((k * sampleRate) / FRAME) * magnitude[k]!
    total += magnitude[k]!
  }
  return {
    peak,
    rms: energy > 0 ? Math.max(SILENCE_DB, 10 * Math.log10(energy / count)) : SILENCE_DB,
    centroid: total > 0 ? weighted / total : 0,
    nan,
  }
}
