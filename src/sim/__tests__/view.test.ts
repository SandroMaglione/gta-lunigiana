import assert from "node:assert/strict"
import { test } from "node:test"

import { Ops } from "@typeonce/ritmo-math"

import { axesAt, followYaw, nearestSeat, QUARTER, restAxes, screenAxes } from "../view.ts"

const near = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.abs(a.x - b.x) < 1e-12 && Math.abs(a.y - b.y) < 1e-12

test("at any quarter turn a view turned by yaw has the quarter turn's screen axes", () => {
  for (const turns of [0, 1, 2, 3, -1, 6]) {
    const turned = axesAt(turns * QUARTER),
      seat = screenAxes(turns)
    assert.ok(near(turned.up, seat.up) && near(turned.right, seat.right), `turns ${turns}`)
  }
})

test("the driving view's screen-up points along the car's heading, screen-right a quarter clockwise of it", () => {
  for (const heading of [0, 1, -2.5, Math.PI, 7]) {
    const { up, right } = restAxes(0, heading)
    assert.ok(near(up, { x: Ops.cos(heading), y: Ops.sin(heading) }), `up at ${heading}`)
    assert.ok(near(right, { x: Ops.sin(heading), y: -Ops.cos(heading) }), `right at ${heading}`)
  }
  assert.equal(restAxes(3, undefined), screenAxes(3), "on foot, the seat's own axes")
})

test("the nearest seat is counted on from the last count, so it winds with the view instead of jumping a whole turn", () => {
  assert.equal(
    nearestSeat(0, followYaw(-Math.PI / 4)),
    0,
    "a car heading south-east: the home seat",
  )
  assert.equal(nearestSeat(0, 0.7), 0)
  assert.equal(nearestSeat(0, 0.9), 1)
  assert.equal(nearestSeat(4, 0), 4, "seat 0, counted a whole turn on")
  assert.equal(nearestSeat(-1, 2 * Math.PI - 0.1), 0, "a whole turn more of yaw is the same seat")
  assert.equal(nearestSeat(7, 3 * QUARTER), 7)
  assert.equal(nearestSeat(7, 2 * QUARTER), 6)
})
