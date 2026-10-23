/**
 * The sky effects' seeded random draws: the same seed gives the same bolt and lays the rain and
 * snow the same way on every load and every machine.
 *
 * @module render/sky/random
 */

/** A seeded uniform stream in [0, 1) (mulberry32): 32-bit integer steps only, so every machine draws the same numbers. */
export const stream = (seed: number): (() => number) => {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
