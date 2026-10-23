import assert from "node:assert/strict"
import { test } from "node:test"

import { screenAxes } from "../../sim/view.ts"
import { airCutoff, audibility, diffraction, doppler, foliageLoss, groundLoss, lineLevel, mixGain, panOf, sumDb } from "../acoustics.ts"
import { LEVELS } from "../director/levels.ts"

const near = (actual: number, expected: number, tolerance: number, what = "") =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${what} ${actual} is not ${expected} ± ${tolerance}`)

test("a finite line source matches the exact table for a 200 m reach, opposite its midpoint", () => {
  const reach = [{ ax: -100, ay: 0, bx: 100, by: 0, lw: 0 }]
  const table = [[1, -6.1], [5, -13.2], [20, -19.6], [50, -24.5], [64, -26.0], [200, -34.3], [1000, -48.0]] as const
  for (const [d, level] of table) near(lineLevel(reach, 0, d).level, level, 0.1, `d = ${d} m:`)
  // Incoherent pieces add up to the whole, and the nearest point is on the line.
  const pieces = [{ ax: -100, ay: 0, bx: 30, by: 0, lw: 0 }, { ax: 30, ay: 0, bx: 100, by: 0, lw: 0 }]
  near(lineLevel(pieces, 10, 20).level, lineLevel(reach, 10, 20).level, 1e-9)
  assert.deepEqual(lineLevel(pieces, 10, 20), { ...lineLevel(pieces, 10, 20), x: 10, y: 0 })
  assert.equal(lineLevel([], 0, 0).level, -Infinity)
})

test("air absorption: the table's cutoffs, falling monotonically with distance, open within a few metres", () => {
  for (const [r, f] of [[10, 15100], [25, 9100], [100, 4300], [500, 1500], [2000, 315]] as const) near(airCutoff(r), f, 1, `${r} m:`)
  assert.equal(airCutoff(2), 20000)
  for (let r = 1; r < 3000; r *= 1.1) assert.ok(airCutoff(r * 1.1) <= airCutoff(r), `${r} m`)
})

test("Doppler at 42 m/s: +228 cents approaching, −201 receding, none at the source", () => {
  near(doppler(-100, 0, 42, 0, 0, 0, 0, 0), 228, 1)
  near(doppler(100, 0, 42, 0, 0, 0, 0, 0), -201, 1)
  // A listener chasing a source at its own speed hears no shift.
  near(doppler(-100, 0, 20, 0, 0, 0, 20, 0), 0, 1e-9)
  assert.equal(doppler(0, 0, 42, 0, 0.5, 0, 0, 0), 0)
})

test("a source along the screen's right axis pans right, ahead stays centred, inside the head fades out", () => {
  const { right, up } = screenAxes(0)
  assert.ok(panOf(right.x * 30, right.y * 30, right) > 0.8)
  assert.ok(panOf(-right.x * 30, -right.y * 30, right) < -0.8)
  near(panOf(up.x * 30, up.y * 30, right), 0, 1e-9)
  near(panOf(right.x * 0.5, right.y * 0.5, right), 0.85 / 4, 1e-9)
  // A quarter turn of the view to the left brings the old screen-up round to the right.
  near(panOf(up.x * 30, up.y * 30, screenAxes(1).right), 0.85, 1e-9)
})

test("diffraction: none in the clear, the table in the shadow, capped at 15 dB", () => {
  assert.deepEqual(diffraction(-1), { loss: 0, cutoff: 20000 })
  assert.deepEqual(diffraction(0.25), { loss: 10.1, cutoff: 1400 })
  assert.equal(diffraction(30).loss, 15)
  for (let d = 0; d < 2; d += 0.01) assert.ok(diffraction(d + 0.01).loss >= diffraction(d).loss)
})

test("ground, foliage and masking follow ISO 9613-2 and the culling rule", () => {
  assert.equal(groundLoss(20, 1.5), 0)
  near(groundLoss(50, 1.5), 3.4, 0.05)
  near(groundLoss(200, 10), 2.9, 0.05)
  assert.deepEqual([5, 15, 100, 500].map(foliageLoss), [0, 1, 6, 12])
  assert.deepEqual([40, 30, 25, 10].map((level) => audibility(level, 35)), [1, 1, 0.5, 0])
})

test("mix calibration: a running step on stone from 1 m plays at gain 1, levels add as energy", () => {
  near(mixGain(LEVELS.step.db, 0), 1, 1e-9)
  // Source levels are compressed 0.6 : 1, losses are not.
  near(20 * Math.log10(mixGain(106, 0) / mixGain(116, 0)), -6, 1e-9)
  near(20 * Math.log10(mixGain(116, 10) / mixGain(116, 0)), -10, 1e-9)
  near(sumDb([60, 60]), 63.01, 0.01)
})
