import assert from "node:assert/strict"
import { test } from "node:test"

import { SPRINT_SPEED, WALK_SPEED } from "../../../sim/tuning.ts"
import { unit } from "../graph.ts"
import { cricketsQuiet, echemeRate } from "../nature.ts"
import { stepRate } from "../steps.ts"
import { WORLD_SHOTS, WORLD_VOICES } from "../world.ts"

test("the world synths load in Node: no Web Audio at module top level", () => {
  assert.deepEqual(Object.keys(WORLD_VOICES).sort(), ["crickets", "water", "wind"])
  assert.deepEqual(Object.keys(WORLD_SHOTS).sort(), ["bark", "bell", "bird", "groan", "scream", "shout", "step"])
})

test("footsteps fall twice a second at a walk and three times at a sprint", () => {
  assert.equal(stepRate(WALK_SPEED), 2)
  assert.ok(Math.abs(stepRate(SPRINT_SPEED) - 3) < 1e-9)
  assert.ok(stepRate(0.5) < stepRate(WALK_SPEED))
  assert.equal(stepRate(20), 3.4)
})

test("synth params clamp to 0…1, NaN to silence rather than a throwing AudioParam", () => {
  assert.deepEqual([-1, 0.3, 2, Number.NaN].map(unit), [0, 0.3, 1, 0])
})

test("the crickets' masking law follows the voice: 0 dB under at full density, about 12 dB under at the sparsest", () => {
  assert.equal(cricketsQuiet(1), 0)
  assert.ok(Math.abs(cricketsQuiet(0.5) - 4.9) < 0.1 && Math.abs(cricketsQuiet(0.1) - 11.7) < 0.1, `${cricketsQuiet(0.5)} ${cricketsQuiet(0.1)}`)
  assert.ok(cricketsQuiet(0.01) < 12.2)
})

test("tree crickets chirp once a second at 22 °C, slower in the October afternoon, not at all in the cold", () => {
  assert.ok(Math.abs(echemeRate(22) - 1) < 1e-9)
  assert.ok(echemeRate(15) > 0 && echemeRate(15) < 1)
  assert.equal(echemeRate(9), 0)
})
