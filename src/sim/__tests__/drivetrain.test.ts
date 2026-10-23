import assert from "node:assert/strict"
import { test } from "node:test"

import { driveForce, engineRevs, fullTorque, gearFor, shiftGear } from "../drivetrain.ts"
import { VEHICLE_MODELS, VEHICLES } from "../vehicles.ts"

test("torque curves: peak torque from its rpm, the rated power at its rpm, nothing past the redline", () => {
  for (const model of VEHICLE_MODELS) {
    const { engine } = VEHICLES[model]
    assert.equal(fullTorque(engine, engine.torqueRpm), engine.torque, model)
    const power = (fullTorque(engine, engine.powerRpm) * engine.powerRpm * 2 * Math.PI) / 60 / 1000
    assert.ok(Math.abs(power - engine.power) < 0.01 * engine.power, `${model}: ${power} kW at ${engine.powerRpm} rpm`)
    assert.ok(fullTorque(engine, engine.idle) < engine.torque && fullTorque(engine, engine.redline) === 0, model)
  }
})

test("the automatic gearbox climbs every gear under full pedal, one at a time and never back, and holds a steady speed without hunting", () => {
  for (const model of VEHICLE_MODELS) {
    const spec = VEHICLES[model]
    let chassis = { gear: 0, shiftUntil: 0 }
    const gears: Array<number> = []
    for (let step = 0, speed = 0; speed < 100; step++, speed += 0.02) {
      chassis = shiftGear(spec, chassis, speed, 1, step)
      if (gears.at(-1) !== chassis.gear) gears.push(chassis.gear)
    }
    assert.deepEqual(gears, spec.gearbox.ratios.map((_, i) => i), model)
    for (const speed of [3, 8, 15, 25]) {
      let steady = { gear: gearFor(spec, speed), shiftUntil: 0 }
      const start = steady.gear
      for (let step = 0; step < 600; step++) steady = shiftGear(spec, steady, speed, 0.4, step)
      assert.ok(Math.abs(steady.gear - start) <= 1, `${model} at ${speed} m/s settles near gear ${start}: ${steady.gear}`)
    }
  }
})

test("launch and reverse: standing, the clutch slips up to the launch revs; backing up selects reverse and drives backwards", () => {
  const spec = VEHICLES.panda
  assert.equal(engineRevs(spec, { gear: 0, shiftUntil: 0 }, 0, 1, 0).rpm, spec.gearbox.launch)
  assert.equal(engineRevs(spec, { gear: 0, shiftUntil: 0 }, 0, 0, 0).rpm, spec.engine.idle)
  const reverse = shiftGear(spec, { gear: 0, shiftUntil: 0 }, 0, -1, 0)
  assert.equal(reverse.gear, -1)
  assert.ok(driveForce(spec, reverse, 0, -1, 0) < 0)
  assert.equal(engineRevs(spec, { gear: 2, shiftUntil: 10 }, 15, 1, 5).load, 0, "a shift cuts the drive")
  // Regression: rolling back slower than the brake pedal's threshold, the throttle forward stayed in reverse and did nothing.
  const back = shiftGear(spec, { gear: -1, shiftUntil: 0 }, -0.4, 1, 0)
  assert.ok(back.gear === 0 && driveForce(spec, back, -0.4, 1, 0) > 0, "pulling forward stops a car rolling back")
  assert.equal(shiftGear(spec, { gear: -1, shiftUntil: 0 }, -2, 1, 0).gear, -1, "faster, the throttle is the brake and the gear stays")
  assert.equal(engineRevs(VEHICLES.truck, { gear: 11, shiftUntil: 0 }, 25.5, 1, 0).load, 0, "the truck's limiter")
})
