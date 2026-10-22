import assert from "node:assert/strict"
import { test } from "node:test"

import { Ops } from "@typeonce/ritmo-math"

import { lateralCurve, loaded, type TyreIn, tyreForce } from "./tyres.ts"

const tyre = (over: Partial<TyreIn>): TyreIn => ({
  load: 3000, mu: 1, slide: 0.75, roll: 0.013, peak: 0.13, vx: 20, vy: 0, drive: 0, brake: 0, locked: false, abs: false, traction: false, holdX: 0, holdY: 0, ...over
})

test("sideways, the force peaks at the peak slip angle and falls toward sliding friction past it", () => {
  assert.equal(lateralCurve(0, 0.75), 0)
  assert.equal(lateralCurve(1, 0.75), 1)
  assert.ok(lateralCurve(0.5, 0.75) < 1 && lateralCurve(2, 0.75) < 1 && lateralCurve(2, 0.75) > lateralCurve(6, 0.75))
  assert.ok(Math.abs(lateralCurve(1000, 0.75) - 0.75) < 1e-3)
  const out = tyreForce(tyre({ vy: 20 * Ops.tan(0.13) }))
  assert.ok(Math.abs(out.fy + 3000) < 1 && out.amount === 0, "at the peak: the whole grip against the slip, no skid yet")
  assert.ok(tyreForce(tyre({ vy: 8 })).amount > 0, "well past it: a skid")
})

test("along the tyre: drive inside the grip uses up the ellipse; too much spins the wheel, unless traction control holds it", () => {
  const corner = tyreForce(tyre({ vy: 1.5, drive: 2000 }))
  assert.ok(Math.abs(corner.fy) < Math.abs(tyreForce(tyre({ vy: 1.5 })).fy), "driving costs cornering grip")
  const spin = tyreForce(tyre({ drive: 4000 }))
  assert.equal(spin.amount, 1)
  assert.ok(Math.abs(spin.fx - 3000 * 0.75) < 1e-9, "a spinning tyre pushes with sliding friction")
  const held = tyreForce(tyre({ drive: 4000, traction: true }))
  assert.ok(held.amount === 0 && held.fx < 3000, "traction control keeps it gripping")
})

test("brakes: without ABS a hard stop locks the wheel and it slides along its motion; ABS holds it at the limit and leaves it some steering", () => {
  const locked = tyreForce(tyre({ brake: 5000, vy: 2 }))
  assert.equal(locked.amount, 1)
  assert.ok(Math.abs(Ops.hypot(locked.fx, locked.fy) - 3000 * 0.75) < 1e-6 && locked.fx < 0)
  const abs = tyreForce(tyre({ brake: 5000, vy: 2, abs: true }))
  assert.ok(abs.amount === 0.25 && Math.abs(abs.fy) > 300, `ABS: ${JSON.stringify(abs)}`)
  assert.equal(tyreForce(tyre({ locked: true })).amount, 1, "the handbrake locks it whatever the pedal")
})

test("standing, the tyre holds like static friction up to its grip, and the free direction only by rolling resistance", () => {
  const braked = tyreForce(tyre({ vx: 0, brake: 3000, holdX: -500, holdY: 200 }))
  assert.deepEqual([braked.fx, braked.fy], [-500, 200])
  const free = tyreForce(tyre({ vx: 0, holdX: -500 }))
  assert.ok(Math.abs(free.fx + 0.013 * 3000) < 1e-9, "rolling free: only rolling resistance against the slope")
  const steep = tyreForce(tyre({ vx: 0, brake: 3000, holdX: -4000 }))
  assert.ok(Math.abs(steep.fx + 3000) < 1e-9, "past its grip it slides")
})

test("a loaded tyre's friction coefficient falls and an unloaded one's rises, within bounds", () => {
  assert.equal(loaded(1, 3000, 3000), 1)
  assert.ok(loaded(1, 6000, 3000) < 0.9 && loaded(1, 1500, 3000) > 1)
  assert.equal(loaded(1, 100000, 3000), 0.6)
})
