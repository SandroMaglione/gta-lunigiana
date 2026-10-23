/**
 * The crash renderer's primitives, pure TypeScript (no Web Audio): random draws, struck modes, and a
 * noise engine of ten octave bands. Every noise layer (the crunch, glass, grit, debris, rustle) only
 * adds power to the bands' envelopes, held at a control rate; one pass at the end multiplies each
 * band's precomputed noise loop by its envelope. So a render costs ten multiply-adds a sample however
 * many noise layers it has, and a mode costs one recurrence step a sample until it falls 60 dB.
 *
 * @module audio/synth/crash/dsp
 */

/** Octave band centres of the noise engine, Hz. */
export const BANDS = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const
/** One value per band: a power gain, or a level in dB. */
export type Spectrum = ReadonlyArray<number>

/** Control step of the band envelopes, samples (0.17 ms at 48 kHz). */
const STEP = 8
/** Length of each band's noise loop, samples (2.7 s at 48 kHz); played forth and back, it repeats only after 5.5 s, longer than any render. */
const SIZE = 1 << 17

/** `lo` … `hi`, uniformly. */
export const between = (random: () => number, lo: number, hi: number): number => lo + (hi - lo) * random()
/** A Rayleigh draw of mean ≈ 1.25: a mode's shape at a random contact point. */
export const rayleigh = (random: () => number): number => Math.sqrt(-2 * Math.log(1 - 0.999 * random()))
/** p(E) ∝ E^−alpha on [lo, hi], by inverse CDF (alpha ≠ 1). */
export const powerLaw = (u: number, alpha: number, lo: number, hi: number): number => {
  const a = lo ** (1 - alpha), b = hi ** (1 - alpha)
  return (a + u * (b - a)) ** (1 / (1 - alpha))
}
/** Power gains from levels in dB; −60 dB or less is none (the band is skipped). */
export const power = (db: Spectrum): Spectrum => db.map((level) => (level <= -60 ? 0 : 10 ** (level / 10)))
/** The spectrum of a half-sine contact force `tau` s long at `hz`, 1 at DC: −6 dB at 0.83/τ, falling as f^−2 past 1.5/τ. */
export const halfSine = (hz: number, tau: number): number => {
  const x = 2 * hz * tau
  return Math.abs(1 - x * x) < 1e-6 ? Math.PI / 4 : Math.abs(Math.cos(Math.PI * hz * tau) / (1 - x * x))
}

/** In-place radix-2 FFT (forward); `re.length` is a power of two. */
export const fft = (re: Float64Array, im: Float64Array): void => {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const r = re[i]!, m = im[i]!
      re[i] = re[j]!
      im[i] = im[j]!
      re[j] = r
      im[j] = m
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1, wr = Math.cos((-2 * Math.PI) / size), wi = Math.sin((-2 * Math.PI) / size)
    for (let start = 0; start < n; start += size) {
      let cr = 1, ci = 0
      for (let k = 0; k < half; k++) {
        const a = start + k, b = a + half
        const tr = re[b]! * cr - im[b]! * ci, ti = re[b]! * ci + im[b]! * cr
        re[b] = re[a]! - tr
        im[b] = im[a]! - ti
        re[a] = re[a]! + tr
        im[a] = im[a]! + ti
        const next = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = next
      }
    }
  }
}

/** Band `b`'s amplitude weight at `hz`: cos² crossovers an octave wide, so the squares sum to 1 from 20 Hz to 16 kHz; the top band rolls off above. */
const weight = (b: number, hz: number): number => {
  const x = Math.log2(hz / BANDS[b]!)
  if (b === 0 && x < 0) return hz >= 20 ? 1 : 0
  return Math.abs(x) < 1 ? Math.cos((Math.PI * x) / 2) : 0
}

/** A generator of uniform draws in [0, 1) from `seed` (mulberry32): the noise loops are the same every session, a thunder the same for its flash. */
export const seeded = (seed: number) => (): number => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const loops = new Map<number, ReadonlyArray<Float32Array>>()

/**
 * One seamless loop of unit-RMS noise per band at `sampleRate`, made once (a fixed seed, so renders
 * stay deterministic). Built in the frequency domain: every bin at its band's weight with a random
 * quadrant phase (Gaussian in time by the central limit), two bands per FFT (one in the real part,
 * one in the imaginary), so the loops wrap without a seam. Each band has unit power, so a Spectrum is
 * power per octave band and all ones is pink noise. A band at or above Nyquist is silent.
 */
export const bandLoops = (sampleRate: number): ReadonlyArray<Float32Array> => {
  const known = loops.get(sampleRate)
  if (known !== undefined) return known
  const random = seeded(0x5eed), made: Array<Float32Array> = [], sign = () => (random() < 0.5 ? -1 : 1)
  for (let b = 0; b < BANDS.length; b += 2) {
    const re = new Float64Array(SIZE), im = new Float64Array(SIZE)
    // Only the bins either band reaches: an octave below the lower one's centre to an octave above the upper one's.
    const k0 = Math.max(1, Math.floor((BANDS[b]! / 2) * (SIZE / sampleRate))), k1 = b + 2 >= BANDS.length ? SIZE / 2 : Math.ceil(BANDS[b + 1]! * 2 * (SIZE / sampleRate))
    for (let k = k0; k < Math.min(k1, SIZE / 2); k++) {
      const hz = (k * sampleRate) / SIZE, wa = weight(b, hz), wb = weight(b + 1, hz)
      const ar = wa * sign(), ai = wa * sign(), br = wb * sign(), bi = wb * sign()
      // X = A + iB with A and B Hermitian: the transform's real part is band b, its imaginary part band b + 1.
      re[k] = ar - bi
      im[k] = ai + br
      re[SIZE - k] = ar + bi
      im[SIZE - k] = br - ai
    }
    fft(re, im)
    for (const part of [re, im]) {
      let energy = 0
      for (let i = 0; i < SIZE; i++) energy += part[i]! * part[i]!
      // A band with no bins under Nyquist holds only rounding residue: silence, not noise scaled up to unit power (or NaN).
      const scale = energy > 1e-12 * SIZE ? 1 / Math.sqrt(energy / SIZE) : 0, loop = new Float32Array(SIZE)
      for (let i = 0; i < SIZE; i++) loop[i] = part[i]! * scale
      made.push(loop)
    }
  }
  loops.set(sampleRate, made)
  return made
}

/** The noise layers of one render: each band's power envelope, at `rate` control points a second. */
export interface Noise {
  readonly power: ReadonlyArray<Float32Array>
  readonly rate: number
}

/** Empty envelopes for `n` samples at `sampleRate`. */
export const noiseFor = (n: number, sampleRate: number): Noise => ({
  power: BANDS.map(() => new Float32Array(Math.ceil(n / STEP) + 2)),
  rate: sampleRate / STEP
})

/** Adds a burst at `t0` s: each band's power ramps over `rise` s to `peak`·`spectrum`, then decays with time constant `tau` s. */
const burst = (noise: Noise, t0: number, rise: number, tau: number, peak: number, spectrum: Spectrum): void => {
  const { power: bands, rate } = noise, length = bands[0]!.length, c0 = Math.max(0, Math.round(t0 * rate))
  const up = Math.max(1, Math.round(rise * rate)), fall = Math.exp(-1 / (tau * rate)), end = Math.min(length, c0 + up + Math.ceil(14 * tau * rate))
  for (let b = 0; b < bands.length; b++) {
    const top = peak * spectrum[b]!, env = bands[b]!
    if (!(top > 0)) continue
    let level = top
    for (let c = c0; c < end; c++) {
      if (c - c0 < up) env[c]! += (top * (c - c0 + 1)) / up
      else {
        env[c]! += level
        level *= fall
      }
    }
  }
}

/** Adds `drive` (power, one value per control point) ringing through a dense modal field: per band, `spectrum`× the drive, held as it falls by a decay of `t60` s. */
export const excite = (noise: Noise, drive: Float32Array, spectrum: Spectrum, t60: Spectrum): void => {
  const { power: bands, rate } = noise
  for (let b = 0; b < bands.length; b++) {
    const gain = spectrum[b]!, env = bands[b]!, hold = 10 ** (-6 / (t60[b]! * rate))
    if (!(gain > 0)) continue
    let level = 0
    for (let c = 0; c < drive.length; c++) {
      level = Math.max(gain * drive[c]!, level * hold)
      env[c]! += level
    }
  }
}

/** Adds the noise into `out`: each band's loop, from a random offset, forth and back, times the square root of its power envelope (skipped under amplitude `floor`). */
export const playNoise = (out: Float32Array, noise: Noise, random: () => number, floor: number): void => {
  const bands = bandLoops(noise.rate * STEP), mask = 2 * SIZE - 1
  noise.power.forEach((env, b) => {
    const loop = bands[b]!, offset = Math.floor(random() * 2 * SIZE)
    let from = Math.sqrt(env[0]!)
    for (let c = 0; c + 1 < env.length; c++) {
      const to = Math.sqrt(env[c + 1]!), i0 = c * STEP, i1 = Math.min(out.length, i0 + STEP)
      if (from + to > floor) {
        const slope = (to - from) / STEP
        let a = from
        for (let i = i0; i < i1; i++) {
          // Reversed, the loop is other noise of the same spectrum; the turn is seamless (the same sample twice).
          const k = (offset + i) & mask
          out[i]! += a * loop[k < SIZE ? k : mask - k]!
          a += slope
        }
      }
      from = to
    }
  })
}

/**
 * A mode at `hz` struck at `t0` s with amplitude `amp`, its loss factor `eta` (T60 = 2.2 / (f·η)),
 * added into `out` by the damped sine's two-term recurrence until it falls 60 dB, or under `floor`;
 * driven up over `attack` s (a force building, as a guard rail's while it deflects).
 */
const ring = (out: Float32Array, sampleRate: number, t0: number, hz: number, eta: number, amp: number, floor: number, attack = 0): void => {
  const size = Math.abs(amp), stop = Math.max(floor, size * 1e-3)
  if (hz >= 0.45 * sampleRate || hz <= 0 || !(size > stop)) return
  const decay = Math.PI * hz * eta, r = Math.exp(-decay / sampleRate), w = (2 * Math.PI * hz) / sampleRate
  const i0 = Math.max(0, Math.round(t0 * sampleRate)), n = Math.min(out.length - i0, Math.ceil((Math.log(size / stop) / decay) * sampleRate))
  const c1 = 2 * r * Math.cos(w), c2 = -r * r
  // y[k] = amp·r^k·sin((k + 1)w): it starts from zero, so no click.
  let y2 = 0, y1 = amp * Math.sin(w), i = i0
  for (const rise = Math.min(n, Math.round(attack * sampleRate)); i < i0 + rise; i++) {
    out[i]! += (y1 * (i - i0 + 1)) / rise
    const y = c1 * y1 + c2 * y2
    y2 = y1
    y1 = y
  }
  for (; i < i0 + n; i++) {
    out[i]! += y1
    const y = c1 * y1 + c2 * y2
    y2 = y1
    y1 = y
  }
}

/** What a render's layers write into: modes into `out`, noise into the band envelopes. */
export interface Mix {
  readonly out: Float32Array
  readonly noise: Noise
  readonly sampleRate: number
  readonly random: () => number
  /** Amplitude under which a mode stops (it also stops 60 dB under its strike). */
  readonly floor: number
}

/** `spectrum` (power) tilted by `db` per band. */
export const tint = (spectrum: Spectrum, db: Spectrum): Spectrum => spectrum.map((p, b) => p * 10 ** (db[b]! / 10))

/** A mode struck into the mix (driven up over `attack` s). */
export const strike = (mix: Mix, t0: number, hz: number, eta: number, amp: number, attack = 0): void =>
  ring(mix.out, mix.sampleRate, t0, hz, eta, amp, mix.floor, attack)

/** A noise burst into the mix (`spectrum` in power). */
export const puff = (mix: Mix, t0: number, rise: number, tau: number, peak: number, spectrum: Spectrum): void =>
  burst(mix.noise, t0, rise, tau, peak, spectrum)
