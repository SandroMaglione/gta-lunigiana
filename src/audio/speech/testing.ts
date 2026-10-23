/**
 * Test helpers for the speech synth: a seeded random source and the measurements the tests make
 * on a render (a stretch of it, its F0 by autocorrelation).
 *
 * @module audio/speech/testing
 */

/** A small deterministic random source (mulberry32), so the checks never flake. */
export const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/** The samples of `samples` between `from` and `to` s. */
export const stretch = (
  samples: Float32Array,
  rate: number,
  from: number,
  to: number,
): Float32Array => samples.slice(Math.round(from * rate), Math.round(to * rate))

/** The F0 of `samples`, Hz: the shortest lag (60–800 Hz) whose normalised autocorrelation peaks within 15 % of the highest, so a subharmonic never wins. */
export const f0Of = (samples: Float32Array, rate: number): number => {
  const low = Math.floor(rate / 800),
    high = Math.min(Math.ceil(rate / 60), Math.floor(samples.length / 2)),
    r: Array<number> = []
  for (let l = 0; l <= high + 1; l++) {
    let sum = 0
    for (let i = 0; i + l < samples.length; i++) sum += samples[i]! * samples[i + l]!
    r.push(sum / (samples.length - l))
  }
  const best = Math.max(...r.slice(low, high + 1))
  for (let l = low; l <= high; l++)
    if (r[l]! >= 0.85 * best && r[l]! >= r[l - 1]! && r[l]! >= r[l + 1]!) return rate / l
  return rate / high
}
