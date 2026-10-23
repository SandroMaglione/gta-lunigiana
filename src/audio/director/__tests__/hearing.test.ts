import assert from "node:assert/strict"
import { test } from "node:test"

import { screenAxes } from "../../../sim/view.ts"
import { CABIN, type Cabin, EAR_HEIGHT, gainToDb } from "../../acoustics.ts"
import { hear } from "../hearing.ts"

/** Ears over open, flat ground. */
const ears = { x: 0, y: 0, z: EAR_HEIGHT, vx: 0, vy: 0, right: screenAxes(0).right }

/** The reverb send of a car `metres` south, with the listener in a street `street` 0…1 and maybe a cabin. */
const wet = (metres: number, street: number, cabin?: Cabin) =>
  hear({
    ears,
    source: { x: 0, y: -metres, z: 0.8 },
    db: 90,
    rMin: 2,
    height: 1.2,
    delta: 0,
    forest: 0,
    ambient: 35,
    street,
    cabin,
  }).placement.wet

test("no reverb in the open at any distance; in a street it rises 3 dB per doubling of distance, capped, and drops with gaps and in a cabin", () => {
  for (const metres of [1, 10, 40, 300]) assert.equal(wet(metres, 0), 0, `${metres} m`)
  assert.ok(wet(5, 1) > 0)
  assert.ok(Math.abs(gainToDb(wet(20, 1) / wet(10, 1)) - 3) < 0.1)
  assert.equal(wet(40, 1), wet(200, 1), "capped")
  assert.equal(wet(1, 1), wet(2, 1), "floored")
  assert.ok(wet(20, 0.5) < wet(20, 1) / 3)
  assert.ok(wet(20, 1, CABIN.panda) < wet(20, 1))
})

test("a sound that skips the cabin (the own car's crash) plays open, but its tail comes back through the cabin like an outside sound's", () => {
  const at = (bare?: boolean) =>
    hear({
      ears,
      source: { x: 0, y: -20, z: 0.8 },
      db: 90,
      rMin: 2,
      height: 1.2,
      delta: 0,
      forest: 0,
      ambient: 35,
      street: 1,
      cabin: CABIN.panda,
      bare,
    })
  const through = at(),
    bare = at(true)
  assert.ok(
    Math.abs(gainToDb(bare.placement.gain / through.placement.gain) - CABIN.panda.loss) < 1e-9 &&
      bare.placement.cutoff > CABIN.panda.cutoff,
  )
  assert.ok(
    Math.abs(
      bare.placement.gain * bare.placement.wet - through.placement.gain * through.placement.wet,
    ) < 1e-12,
    "the same tail",
  )
  assert.equal(bare.shell, CABIN.panda)
  assert.equal(through.shell, undefined)
})
