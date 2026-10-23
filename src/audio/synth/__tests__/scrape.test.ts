import assert from "node:assert/strict"
import { test } from "node:test"

import { LAYERS, LOOP_RMS, scrapeGain, surfaceLoop, type Texture } from "../scrape.ts"

/** A small deterministic random source, so the checks never flake. */
const seeded = (seed: number) => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32

const RATE = 8000
/** A loop is 3.2 s; `m` metres of wall pass in m / 10 m/s. */
const ms = (m: number) => (m / 10) * 1000

test("every material's surface loops without a click, finite, at its RMS", () => {
  for (const [material, { texture }] of Object.entries(LAYERS)) {
    const s = surfaceLoop(texture, RATE, seeded(7))
    assert.ok(s.every(Number.isFinite), material)
    const rms = Math.sqrt(s.reduce((sum, v) => sum + v * v, 0) / s.length)
    assert.ok(Math.abs(rms - LOOP_RMS) < 1e-3, `${material} ${rms}`)
    let steps = 0
    for (let i = 1; i < s.length; i++) steps += Math.abs(s[i]! - s[i - 1]!)
    assert.ok(Math.abs(s[0]! - s[s.length - 1]!) < (6 * steps) / (s.length - 1), material)
  }
})

test("a knock ringing past the loop's end carries on at its start", () => {
  // One loud 100 Hz mode at every 2 m post (1, 3 … 31 m): the first 0.1 s holds only the tails wrapped from the end.
  const hz = 100,
    eta = 0.01,
    posts: Texture = {
      bumps: 0,
      gamma: 1.5,
      width: [0.001, 0.001],
      grit: 0,
      knocks: [{ every: 2, regular: true, hz: [hz, hz], modes: 1, eta, level: 1e4 }],
    }
  const s = surfaceLoop(posts, RATE, seeded(3)),
    n = s.length,
    peak = Math.max(...s.map(Math.abs))
  const w = (2 * Math.PI * hz) / RATE,
    decay = Math.exp((-Math.PI * hz * eta) / RATE)
  // The damped sine's own recurrence, across the seam.
  assert.ok(
    Math.abs(s[0]! - (2 * decay * Math.cos(w) * s[n - 1]! - decay * decay * s[n - 2]!)) <
      2e-3 * peak,
  )
  assert.ok(Math.max(...s.subarray(0, RATE / 20).map(Math.abs)) > 0.3 * peak)
})

/** Circular autocorrelation of the loop's 1 ms energy envelope at `lag` ms. */
const envelopeCorrelation = (s: Float32Array, lag: number): number => {
  const frame = RATE / 1000,
    env = Array.from({ length: Math.floor(s.length / frame) }, (_, k) =>
      s.subarray(k * frame, (k + 1) * frame).reduce((e, v) => e + v * v, 0),
    )
  const mean = env.reduce((a, b) => a + b, 0) / env.length,
    d = env.map((v) => v - mean)
  let num = 0,
    den = 0
  for (let k = 0; k < d.length; k++) {
    num += d[k]! * d[(k + Math.round(lag)) % d.length]!
    den += d[k]! * d[k]!
  }
  return num / den
}

test("a stone wall's level swings at every 0.3 m stone, a guard rail thumps at every 2 m post; plaster does neither", () => {
  for (const seed of [1, 2, 3]) {
    const stone = surfaceLoop(LAYERS.stone.texture, RATE, seeded(seed)),
      masonry = surfaceLoop(LAYERS.masonry.texture, RATE, seeded(seed))
    const rail = surfaceLoop(LAYERS.rail.texture, RATE, seeded(seed))
    assert.ok(
      envelopeCorrelation(stone, ms(0.3)) > envelopeCorrelation(stone, ms(0.15)) + 0.2,
      `stone ${seed}`,
    )
    assert.ok(
      Math.abs(envelopeCorrelation(masonry, ms(0.3)) - envelopeCorrelation(masonry, ms(0.15))) <
        0.15,
      `masonry ${seed}`,
    )
    assert.ok(
      envelopeCorrelation(rail, ms(2)) > envelopeCorrelation(rail, ms(1)) + 0.1,
      `rail ${seed}`,
    )
  }
})

test("the grind rises 4.5 dB per doubling of speed up to full at 12 m/s; NaN is silence", () => {
  assert.equal(scrapeGain(12), 1)
  assert.equal(scrapeGain(40), 1)
  assert.ok(Math.abs(20 * Math.log10(scrapeGain(6)) + 4.5) < 0.05)
  assert.deepEqual([0, -3, Number.NaN].map(scrapeGain), [0, 0, 0])
})
