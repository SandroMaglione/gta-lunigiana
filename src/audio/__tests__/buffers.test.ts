import assert from "node:assert/strict"
import { test } from "node:test"

import { crackleSamples, gustSamples, noiseSamples, smoothstep } from "../buffers.ts"

/** A small deterministic random source, so the checks never flake. */
const seeded = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)

test("noise loops without a click: the seam step is no bigger than a typical step", () => {
  for (const colour of ["white", "pink", "brown"] as const) {
    const s = noiseSamples(colour, 48000, 48000, seeded(7))
    let sum = 0
    for (let i = 1; i < s.length; i++) sum += Math.abs(s[i]! - s[i - 1]!)
    const typical = sum / (s.length - 1)
    assert.ok(Math.abs(s[0]! - s[s.length - 1]!) < typical * 6, colour)
    assert.ok(s.every((v) => Number.isFinite(v) && Math.abs(v) <= 1.5), colour)
  }
})

test("grains and gusts stay in range", () => {
  assert.ok(crackleSamples(48000, 48000, 400, seeded(3)).some((v) => v !== 0))
  // Regression: normalised by the unrounded peak, one seed in ten stored a peak an ulp off ±1.
  for (let seed = 0; seed < 100; seed++) assert.equal(Math.max(...gustSamples(8000, seeded(seed)).map(Math.abs)), 1, `seed ${seed}`)
})

test("the gust signal is its sines' sum, normalised: the per-sample rotation does not drift", () => {
  const n = 512000, random = seeded(5), g = gustSamples(n, seeded(5))
  const parts = [2, 5, 9, 17, 31].map((k) => ({ a: 1 / Math.sqrt(k), w: (2 * Math.PI * k) / n, phase: random() * 2 * Math.PI }))
  const exact = Array.from({ length: n }, (_, i) => parts.reduce((v, p) => v + p.a * Math.sin(p.w * i + p.phase), 0))
  const peak = exact.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
  let worst = 0
  for (let i = 0; i < n; i++) worst = Math.max(worst, Math.abs(g[i]! - exact[i]! / peak))
  assert.ok(worst < 1e-6, `off by ${worst}`)
})

test("smoothstep clamps and eases", () => {
  assert.equal(smoothstep(0, 1, -1), 0)
  assert.equal(smoothstep(0, 1, 2), 1)
  assert.equal(smoothstep(0, 1, 0.5), 0.5)
})
