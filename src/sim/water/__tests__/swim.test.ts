import assert from "node:assert/strict"
import { test } from "node:test"

import { personBuild } from "../../systems/water.ts"
import { footingOf, personMass, swept, wadeShare } from "../swim.ts"

const still = (depth: number, speed = 0) => ({
  depth,
  level: depth,
  vx: speed,
  vy: 0,
  bankX: 0,
  bankY: 1,
})

test("footing: an adult stands to a depth × speed of 1.2 m²/s, a 1.2 m child to 0.4, as Cox et al. (2010) find", () => {
  assert.ok(Math.abs(footingOf(1.75, 75) - 1.2) < 1e-9)
  assert.ok(Math.abs(personBuild(1.2).footing - 0.4) < 0.02, `${personBuild(1.2).footing}`)
  assert.equal(footingOf(1.4, 600), 1.2, "no body stands more than an adult")
  assert.ok(Math.abs(personMass(1.75) - 75) < 0.1)
})

test("swept: off its feet at its chest or past its footing, back on them a little under either", () => {
  const adult = personBuild(1.75)
  assert.ok(!swept(still(1.1), adult, false))
  assert.ok(swept(still(1.3), adult, false), "the water at the chest lifts it")
  assert.ok(swept(still(0.5, 2.6), adult, false), "1.3 m²/s takes its feet")
  assert.ok(swept(still(1.15), adult, true), "swimming, it stands again only lower down")
  assert.ok(!swept(still(1), adult, true))
})

test("wading: walking pace falls by about two fifths in knee-deep water (0.35 m), more for a child", () => {
  assert.ok(Math.abs(wadeShare(0.35, 1.75) - 0.6) < 0.01)
  assert.ok(wadeShare(0.35, 1.2) < wadeShare(0.35, 1.75))
  assert.equal(wadeShare(2, 1.75), 0.25, "never below a quarter")
})
