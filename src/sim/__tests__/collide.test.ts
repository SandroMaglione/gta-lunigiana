import assert from "node:assert/strict"
import { test } from "node:test"

import { Vec2 } from "@typeonce/ritmo-math"

import { carCircles, carRadius, clearOf } from "../body.ts"
import { moveCircles, pushOutSegments } from "../collide.ts"
import { VEHICLE_MODELS, VEHICLES } from "../vehicles.ts"

test("moveCircles: no tunnelling, sliding, a 3-circle car stops at the wall", () => {
  const long = { ax: 5, ay: -50, bx: 5, by: 50 }
  const fast = moveCircles({ x: 0, y: 0 }, [{ x: 0, y: 0 }], { x: 1000, y: 0 }, 0.5, [long])
  assert.ok(fast.blocked && fast.position.x < 4.5)
  const slid = moveCircles({ x: 0, y: 0 }, [{ x: 0, y: 0 }], { x: 10, y: 10 }, 0.5, [
    { ax: 0, ay: 10, bx: 10, by: 0 },
  ])
  assert.ok(
    slid.blocked && slid.position.x + slid.position.y < 10 - 0.5 * Math.SQRT2 + 0.05,
    JSON.stringify(slid),
  )
  const car = moveCircles(
    { x: 0, y: 0 },
    [
      { x: -1.4, y: 0 },
      { x: 0, y: 0 },
      { x: 1.4, y: 0 },
    ],
    { x: 10, y: 0 },
    0.9,
    [long],
  )
  assert.ok(Math.abs(car.position.x - (5 - 0.9 - 1.4)) < 0.02, JSON.stringify(car))
})

// Regression: one push-out pass left circles inside the other wall of a narrow V (traffic wedged in corners).
test("push-out frees a circle caught in an acute corner of two walls", () => {
  const vee = [
    { ax: 0, ay: 0, bx: 10, by: 5 },
    { ax: 0, ay: 0, bx: 10, by: -5 },
  ]
  const out = pushOutSegments({ x: 0.9, y: 0.1 }, 0.5, vee)
  assert.ok(clearOf(vee, out.x, out.y, 0.5, 0.001), JSON.stringify(out))
  const moved = moveCircles({ x: 0.9, y: 0.1 }, [{ x: 0, y: 0 }], { x: -1, y: 0 }, 0.5, vee)
  assert.ok(clearOf(vee, moved.position.x, moved.position.y, 0.5, 0.001), JSON.stringify(moved))
})

// Regression: the truck's three circles did not touch, leaving 1.2 m deep notches that people, trunks and cars sat in.
test("vehicle bodies: the circles fill the drawn body to within 0.15 m all along its sides", () => {
  for (const model of VEHICLE_MODELS) {
    const { length, width } = VEHICLES[model]
    const k = length / 2 - width / 2,
      r = carRadius(model),
      side = width / 2 - 0.15
    const circles = carCircles(model, 0)
    for (let along = -k; along <= k; along += 0.05) {
      assert.ok(
        circles.some((c) => Vec2.distance({ x: along, y: side }, c) <= r),
        `${model}: a notch at ${along.toFixed(2)} m`,
      )
    }
  }
})
