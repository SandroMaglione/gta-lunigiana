import assert from "node:assert/strict"
import { test } from "node:test"

import { locationAt } from "../location.ts"

test("the Carabinieri station is on Via Cesare Battisti, by the station", () => {
  assert.deepEqual(locationAt(-414.4, 433.1), { road: "Via Cesare Battisti", district: "Monzone (Stazione)" })
})

test("deep in the woods there is no road", () => {
  assert.equal(locationAt(300, -300).road, undefined)
})

// Regression: only named roads were searched, so on an unnamed road the HUD showed a side street within 15 m.
test("on an unnamed road, the side street beside it is not named", () => {
  assert.equal(locationAt(-689, 852).road, undefined)
})
