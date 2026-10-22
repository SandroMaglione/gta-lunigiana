import assert from "node:assert/strict"
import { test } from "node:test"

import { overturned } from "./chassis.ts"
import type { Ground } from "./dynamics.ts"
import { clampKnob, DEFAULT_HANDLING, HANDLING, HANDLING_KEYS, type HandlingKey, REAL_HANDLING } from "./handling.ts"
import type { Surface } from "./map/surface.ts"
import { Game, SetHandling } from "./schema.ts"
import { drive, forward, ON_BATTISTI, rolling, start } from "./testing.ts"
import type { VehicleModel } from "./vehicles.ts"

/** `REAL_HANDLING` with `knobs` changed. */
const With = (knobs: Partial<Record<HandlingKey, number>>) => ({ ...REAL_HANDLING, ...knobs })
const coast = { throttle: 0, steer: 0, handbrake: false }
const full = { throttle: 1, steer: 0, handbrake: false }

/** Metres a `model` takes to stop from `speed` m/s on `surface` with the pedal floored backwards. */
const stopping = (model: VehicleModel, speed: number, surface: Surface, knobs: Partial<Record<HandlingKey, number>>) => {
  let stopped: number | undefined
  drive(model, 600, () => ({ throttle: -1, steer: 0, handbrake: false }), {
    speed, surface, handling: With(knobs), each: (_, s) => {
      if (stopped === undefined && forward(s) <= 0.1) stopped = s.pose.x
    }
  })
  return stopped ?? Infinity
}

test("knobs: each has a group, a name, a description of its effect, a range holding its real value, and a step", () => {
  assert.deepEqual([...HANDLING_KEYS].sort(), Object.keys(REAL_HANDLING).sort(), "a real value for every knob")
  for (const key of HANDLING_KEYS) {
    const { group, label, description, kind, min, max, step } = HANDLING[key]
    assert.ok(group.length > 0 && label.length > 0, key)
    assert.ok(description.length >= 60 && description.endsWith("."), `${key}: describe what changing it does`)
    assert.ok(min <= REAL_HANDLING[key] && REAL_HANDLING[key] <= max && step > 0, `${key}: the real value inside its range`)
    assert.equal(clampKnob(key, DEFAULT_HANDLING[key]), DEFAULT_HANDLING[key], `${key}: the default inside its range`)
    if (kind === "switch") assert.deepEqual([min, max, step], [0, 1, 1], key)
  }
})

test("a new game starts at the default handling: real, but off-road grip loss at half", () => {
  assert.deepEqual(start().world().handling, DEFAULT_HANDLING)
  assert.deepEqual(DEFAULT_HANDLING, { ...REAL_HANDLING, looseGround: 0.5 })
})

test("knobs: a value is kept inside its knob's range, a switch is on or off, and a non-number is dropped", () => {
  assert.equal(clampKnob("grip", 5), HANDLING.grip.max)
  assert.equal(clampKnob("grip", -1), HANDLING.grip.min)
  assert.equal(clampKnob("grip", 1.3), 1.3)
  assert.equal(clampKnob("abs", 0.7), 1)
  assert.equal(clampKnob("abs", 0.2), 0)
  assert.equal(clampKnob("power", Number.NaN), undefined)
  assert.equal(clampKnob("power", Infinity), undefined)
})

test("grip: more grip stops a Panda shorter on gravel", () => {
  const real = stopping("panda", 100 / 3.6, "gravel", {}), more = stopping("panda", 100 / 3.6, "gravel", { grip: 1.5 })
  assert.ok(more < real * 0.8, `${more} m against ${real} m`)
})

test("grip: at ×1.5 a Panda held at full lock at 10 m/s rolls over; halving the weight transfer keeps it upright", () => {
  const tips = (knobs: Partial<Record<HandlingKey, number>>) => {
    let over = false
    drive("panda", 300, (frame, s) => ({ throttle: Math.max(-1, Math.min(1, (10 - forward(s)) * 0.5)), steer: frame > 30 ? 1 : 0, handbrake: false }), {
      speed: 10, handling: With(knobs), each: (_, s) => {
        over ||= overturned(s.chassis)
      }
    })
    return over
  }
  assert.equal(tips({}), false, "real: it stays up")
  assert.equal(tips({ grip: 1.5 }), true)
  assert.equal(tips({ grip: 1.5, weightTransfer: 0.5 }), false)
})

test("off-road grip loss: at 0 a Panda climbs a 15% grass bank as on asphalt", () => {
  const bank: Ground = (x) => 100 + 0.15 * x
  const climb = (looseGround: number) => forward(drive("panda", 600, () => full, { ground: bank, surface: "grass", handling: With({ looseGround }) }))
  assert.ok(climb(1) < 2, `real: ${climb(1)} m/s`)
  assert.ok(climb(0) > 12, `none: ${climb(0)} m/s`)
})

test("engine power: doubled, a Panda floored from 20 m/s is faster 5 s on", () => {
  const after = (power: number) => forward(drive("panda", 300, () => full, { speed: 20, handling: With({ power }) }))
  assert.ok(after(2) > after(1) + 3, `${after(2)} against ${after(1)} m/s`)
})

test("brake power: halved, a Panda stops longer from 100 km/h", () => {
  const real = stopping("panda", 100 / 3.6, "asphalt", {}), weak = stopping("panda", 100 / 3.6, "asphalt", { brakes: 0.5 })
  assert.ok(weak > real * 1.5, `${weak} m against ${real} m`)
})

test("air drag: without it a Panda coasting from 30 m/s keeps more speed", () => {
  const after = (drag: number) => forward(drive("panda", 300, () => coast, { speed: 30, handling: With({ drag }) }))
  assert.ok(after(0) > after(1) + 1, `${after(0)} against ${after(1)} m/s`)
})

test("ABS on every vehicle: the Ape brakes hard without locking its wheels", () => {
  const locked = (abs: number) => {
    let frames = 0
    drive("ape", 120, () => ({ throttle: -1, steer: 0, handbrake: false }), {
      speed: 11, handling: With({ abs }), each: (_, __, r) => {
        if (r.skids.some((skid) => skid.amount === 1)) frames++
      }
    })
    return frames
  }
  assert.ok(locked(0) > 10, `real: ${locked(0)} locked frames`)
  assert.equal(locked(1), 0)
})

test("traction control on every vehicle: a Panda floored on gravel does not spin its wheels", () => {
  const spinning = (traction: number) => {
    let frames = 0
    drive("panda", 120, () => full, {
      surface: "gravel", handling: With({ traction }), each: (_, __, r) => {
        if (r.skids.some((skid) => skid.amount > 0.5)) frames++
      }
    })
    return frames
  }
  assert.ok(spinning(0) > 60, `real: ${spinning(0)} frames`)
  assert.equal(spinning(1), 0)
})

test("steering at speed: doubled, a Panda at 20 m/s turns its wheels further", () => {
  const lock = (steering: number) => drive("panda", 60, () => ({ throttle: 0, steer: 1, handbrake: false }), { speed: 20, handling: With({ steering }) }).chassis.steer
  assert.ok(lock(2) > lock(1) * 1.5, `${lock(2)} against ${lock(1)} rad`)
})

test("steering speed: doubled, the wheels turn twice as far in the first steps", () => {
  const turned = (steeringRate: number) => drive("panda", 5, () => ({ throttle: 0, steer: 1, handbrake: false }), { handling: With({ steeringRate }) }).chassis.steer
  assert.ok(Math.abs(turned(2) - 2 * turned(1)) < 1e-9, `${turned(2)} against ${turned(1)} rad`)
})

test("weight transfer: at 0 an Ape's handbrake turn at 11.5 m/s no longer tips it over", () => {
  const tips = (weightTransfer: number) => {
    let over = false
    drive("ape", 240, (frame) => ({ throttle: 0, steer: frame > 10 ? 1 : 0, handbrake: frame > 10 }), {
      speed: 11.5, handling: With({ weightTransfer }), each: (_, s) => {
        over ||= overturned(s.chassis)
      }
    })
    return over
  }
  assert.equal(tips(1), true, "real: it tips")
  assert.equal(tips(0), false)
})

test("anti-roll bars: stiffer, a Panda leans less in a steady corner", () => {
  const lean = (antiRoll: number) => Math.abs(drive("panda", 180, (frame, s) => ({ throttle: Math.max(-1, Math.min(1, (14 - forward(s)) * 0.5)), steer: frame > 30 ? 0.6 : 0, handbrake: false }), {
    speed: 14, handling: With({ antiRoll })
  }).chassis.roll)
  assert.ok(lean(3) < lean(1) * 0.8, `${lean(3)} against ${lean(1)} rad`)
})

test("suspension stiffness: stiffer, a Panda braking hard from 20 m/s dives less", () => {
  const dive = (stiffness: number) => {
    let most = 0
    drive("panda", 90, () => ({ throttle: -1, steer: 0, handbrake: false }), {
      speed: 20, handling: With({ stiffness }), each: (_, s) => {
        most = Math.max(most, Math.abs(s.chassis.pitch))
      }
    })
    return most
  }
  assert.ok(dive(2) < dive(1) * 0.8, `${dive(2)} against ${dive(1)} rad`)
})

test("suspension damping: doubled, a Panda dropped 0.3 m stops bouncing sooner", () => {
  const bounce = (damping: number) => {
    let moving = 0
    drive("panda", 120, () => coast, {
      chassis: { z: 100 + 0.56 + 0.3 }, handling: With({ damping }), each: (frame, s) => {
        if (frame >= 40) moving += Math.abs(s.chassis.vz)
      }
    })
    return moving
  }
  assert.ok(bounce(2) < bounce(1) * 0.6, `${bounce(2)} against ${bounce(1)}`)
})

test("SetHandling: the request sets its knob in range for every vehicle the physics moves, and a save keeps it", () => {
  // A car braking from 15 m/s along Via Cesare Battisti, with the brakes as they are or halved.
  const stops = (brakes?: number) => {
    const { runtime, run, world } = start([], [ON_BATTISTI, { cars: [rolling("panda", ON_BATTISTI, 15, -1)] }])
    if (brakes !== undefined) runtime.send(SetHandling, { key: "brakes", value: brakes })
    run(120)
    const car = world().vehicles[0]!
    return { travelled: Math.sqrt((car.x - ON_BATTISTI.x) ** 2 + (car.y - ON_BATTISTI.y) ** 2), handling: world().handling }
  }
  const real = stops(), weak = stops(0.5)
  assert.equal(weak.handling.brakes, 0.5)
  assert.ok(weak.travelled > real.travelled * 1.3, `${weak.travelled} against ${real.travelled} m`)
  const clamped = start()
  clamped.runtime.send(SetHandling, { key: "grip", value: 9 })
  clamped.runtime.send(SetHandling, { key: "abs", value: 0.6 })
  clamped.run(1)
  assert.deepEqual(clamped.world().handling, { ...DEFAULT_HANDLING, grip: HANDLING.grip.max, abs: 1 })
  const restored = start()
  assert.ok(restored.runtime.restore(JSON.parse(JSON.stringify(clamped.runtime.snapshot()))).ok)
  assert.deepEqual(restored.world().handling, clamped.world().handling)
})

// Regression: the debug menu re-sends the stored knobs as the page loads; one sent before the first update, with a render tick in
// between, was dropped, as ApplyHandling only started listening on its first run.
test("SetHandling: a request sent before the first update still applies after another schedule ticks first", () => {
  const { runtime, run, world } = start()
  runtime.send(SetHandling, { key: "grip", value: 1.5 })
  assert.ok(runtime.tick(Game.Schedule(Game.System("Test/Draw", {}, () => {}))).ok)
  run(1)
  assert.equal(world().handling.grip, 1.5)
})
