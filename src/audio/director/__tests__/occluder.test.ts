import assert from "node:assert/strict"
import { test } from "node:test"

import { heightAt } from "../../../sim/map/index.ts"
import { makeOccluder } from "../occluder.ts"

/** A street with a 10.7 m building 30 m east of it, and open ground 30 m north-west. */
const at = (x: number, y: number, up: number) => ({ x, y, z: heightAt(x, y) + up })
const EARS = at(-916.6, 1706.8, 1.6),
  BEHIND = at(-886.6, 1706.8, 0.8),
  OPEN = at(-937.8, 1728, 0.8)

test("a known source keeps its last measure until a refresh 150 ms on; a new or forgotten one is measured at once", () => {
  const occluder = makeOccluder()
  assert.equal(occluder.between("car:1", EARS, OPEN, 0).delta, 0)
  // The car drove behind the building: the cache still says clear until it is refreshed.
  assert.equal(occluder.between("car:1", EARS, BEHIND, 0.05).delta, 0)
  occluder.refresh(0.1)
  assert.equal(occluder.between("car:1", EARS, BEHIND, 0.1).delta, 0)
  occluder.refresh(0.2)
  assert.ok(occluder.between("car:1", EARS, BEHIND, 0.2).delta > 1)
  assert.ok(occluder.between("car:2", EARS, BEHIND, 0.2).delta > 1)
  occluder.refresh(2.5)
  assert.equal(
    occluder.between("car:2", EARS, OPEN, 2.5).delta,
    0,
    "forgotten after 2 s unasked, so measured afresh",
  )
})
