import assert from "node:assert/strict"
import { test } from "node:test"

import { bubbleTexture, minnaert } from "../bubbles.ts"

/** A small deterministic random source, so the checks never flake. */
const seeded = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)

/** Power of `samples` at `hz` (Goertzel). */
const power = (samples: Float32Array, hz: number, sampleRate: number): number => {
  const c = 2 * Math.cos((2 * Math.PI * hz) / sampleRate)
  let s1 = 0, s2 = 0
  for (const v of samples) [s1, s2] = [v + c * s1 - s2, s1]
  return s1 * s1 + s2 * s2 - c * s1 * s2
}

test("bubbles of one radius ring at the Minnaert frequency 3/r", () => {
  const rate = 16000, r = 0.003, hz = minnaert(r)
  const texture = bubbleTexture(rate, 2, { rate: 200, rMin: r, rMax: r, gamma: 0, xi: 0 }, seeded(11))
  const peak = power(texture, hz, rate)
  for (const other of [0.7, 0.85, 1.2, 1.4]) assert.ok(peak > 20 * power(texture, hz * other, rate), `${hz * other} Hz`)
})

/** Mean power of `samples` over `from`…`to` Hz, every 20 Hz. */
const band = (samples: Float32Array, from: number, to: number, sampleRate: number): number => {
  let sum = 0, bins = 0
  for (let hz = from; hz <= to; hz += 20, bins++) sum += power(samples, hz, sampleRate)
  return sum / bins
}

test("a fountain's 1.5–6 mm bubbles ring between 500 Hz and 2 kHz", () => {
  const rate = 16000, texture = bubbleTexture(rate, 1, { rate: 500, rMin: 0.0015, rMax: 0.006, gamma: 0.5, xi: 0.1 }, seeded(7))
  const inside = band(texture, 500, 2000, rate)
  // Below the band only the damped sines' low skirts (about −12 dB); above it nothing rings.
  assert.ok(inside > 4 * band(texture, 100, 300, rate))
  assert.ok(inside > 1000 * band(texture, 3000, 6000, rate))
})

test("a bubble still ringing at the end of the loop carries on at its start: no seam", () => {
  const rate = 16000, r = 0.003
  // Draws (radius, depth, gap): a silent bubble at 0, a loud one 10 ms before the end, then nothing.
  const draws = [0.5, 0, 1 - Math.exp(-0.99 * 10), 0.5, 0.9]
  const texture = bubbleTexture(rate, 1, { rate: 10, rMin: r, rMax: r, gamma: 0, xi: 0 }, () => draws.shift() ?? 0.999999)
  // The damped sine's own recurrence, across the seam.
  const n = texture.length, w = (2 * Math.PI * minnaert(r)) / rate, decay = Math.exp(-(0.13 / r + 0.0072 * r ** -1.5) / rate)
  assert.ok(Math.abs(texture[0]!) > 0.01)
  assert.ok(Math.abs(texture[0]! - (2 * decay * Math.cos(w) * texture[n - 1]! - decay * decay * texture[n - 2]!)) < 1e-4)
})

test("a stream texture is RMS-normalised and finite", () => {
  const texture = bubbleTexture(16000, 1, { rate: 800, rMin: 0.0003, rMax: 0.008, gamma: 1.5, xi: 0.1 }, seeded(5))
  const rms = Math.sqrt(texture.reduce((sum, v) => sum + v * v, 0) / texture.length)
  assert.ok(Math.abs(rms - 0.2) < 1e-3)
  assert.ok(texture.every(Number.isFinite))
})
