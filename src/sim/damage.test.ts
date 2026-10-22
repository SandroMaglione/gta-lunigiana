import assert from "node:assert/strict"
import { test } from "node:test"

import { Random, Vec2 } from "@typeonce/ritmo-math"

import { overturned, settle } from "./chassis.ts"
import { afterHit, crashDamage, DURABILITY, groundHit, misfires, stageOf, UNDAMAGED, wornTorque } from "./damage.ts"
import { endNode, laneOf, lanePoint, laneSide, nextTrafficEdge } from "./route.ts"
import { CarInput, Chassis, Damage, Game, Motion, Pose, PrevPose, SetHandling, Vehicle } from "./schema.ts"
import { parkedCar, pedestrian, trafficCar } from "./spawning.ts"
import { BATTISTI, door, drive, facing, FAR, forward, ON_BATTISTI, press, rolling, start, straightOn, teleport, TOWARD, wear } from "./testing.ts"
import { VEHICLE_MODELS, VEHICLES, type VehicleModel } from "./vehicles.ts"

const LOOK = { skin: 0xc68e6a, hair: 0x2b1d14, shirt: 0xb8312b, pants: 0x1d2b4f }

test("damage law: a scuff is free, a hit at a model's durability destroys it, and what wrecks a Panda only dents the truck", () => {
  for (const model of VEHICLE_MODELS) {
    assert.equal(crashDamage(model, 3), 0, `${model}: a 3 m/s scuff`)
    assert.equal(crashDamage(model, DURABILITY[model]), 1, `${model}: a hit at its durability`)
  }
  assert.ok(crashDamage("truck", DURABILITY.panda) < 0.6)
  assert.ok(crashDamage("ape", 14) > crashDamage("panda", 14) && crashDamage("panda", 14) > crashDamage("carabinieri", 14))
  assert.deepEqual([0, 0.39, 0.4, 0.69, 0.7, 0.99, 1].map(stageOf), ["light", "light", "medium", "medium", "severe", "severe", "destroyed"])
})

test("damage law: one crash costs its hardest hit, however many contacts it makes with the same thing; another thing or a later crash costs its own", () => {
  const first = afterHit("panda", UNDAMAGED, 15, 100, -1)
  assert.equal(first.amount, crashDamage("panda", 15))
  assert.equal(afterHit("panda", first, 9, 103, -1), first, "the rebound off the same wall adds nothing")
  assert.equal(afterHit("panda", first, 20, 105, -1).amount, crashDamage("panda", 20), "a harder contact of it adds only the difference")
  assert.equal(afterHit("panda", first, 9, 103, 7).amount, crashDamage("panda", 15) + crashDamage("panda", 9), "shunted into another car")
  assert.equal(afterHit("panda", first, 9, 160, -1).amount, crashDamage("panda", 15) + crashDamage("panda", 9), "a second crash 1 s on")
  assert.equal(afterHit("panda", first, 3, 160, -1), first, "a scuff starts no crash")
  const wreck = afterHit("panda", { ...UNDAMAGED, amount: 0.9 }, 39, 0, -1)
  assert.equal(wreck.amount, 1, "never past destroyed")
  assert.equal(afterHit("panda", wreck, 30, 200, -1), wreck, "and a wreck stays as it is")
})

test("damage law: a landing on the wheels costs only past the bump stops; a side or roof rolling over costs by the body's speed too", () => {
  assert.equal(groundHit("under", 5, 20), 3, "a 5 m/s landing only scuffs")
  assert.equal(groundHit("under", 12, 0), 10)
  assert.equal(groundHit("roof", 2, 24), 12, "a roof scraping down at 24 m/s")
  assert.equal(groundHit("side", 7, 4), 7)
  assert.equal(groundHit("front", 6, 30), 6, "a nose dug in counts as it struck")
})

/** A `model` rolled at `speed` (m/s) square on into the Battisti house wall: its damage once it has come to rest, and the hardest wall hit. */
const crash = (model: VehicleModel, speed: number, peds: ReadonlyArray<ReturnType<typeof pedestrian>> = []) => {
  const from = { ...facing(3 + VEHICLES[model].length / 2), angle: TOWARD }
  const { run, world, heard } = start([], [FAR, { cars: [rolling(model, from, speed, 0)], peds }])
  const id = world().vehicles[0]!.id
  run(90)
  const hardest = Math.max(...heard.impacts.filter((i) => i.car === id && i.hit === "wall").map((i) => i.speed))
  return { damage: world().vehicles.find((v) => v.id === id)!.damage.amount, hardest }
}

test("crashes: a Panda into a house wall at 90 km/h smokes white, at 120 black, at 150 burns; the Ape wrecks sooner and the truck later", () => {
  const stages = [25, 33, 41].map((speed) => stageOf(crash("panda", speed).damage))
  assert.deepEqual(stages, ["medium", "severe", "destroyed"])
  const panda = crash("panda", 15), ape = crash("ape", 15), truck = crash("truck", 15)
  assert.ok(Math.abs(panda.damage - crashDamage("panda", panda.hardest)) < 1e-9, "one crash, charged at its hardest hit")
  assert.ok(ape.damage > panda.damage && panda.damage > truck.damage, `ape ${ape.damage}, panda ${panda.damage}, truck ${truck.damage}`)
  assert.equal(stageOf(crash("truck", 25).damage), "light", "the laden truck into a house at its 90 km/h limit")
})

// Regression: a pedestrian pinned against the wall took the whole crash, and the car came off undamaged.
test("crashes: a car that pins a pedestrian against a wall still crashes into it", () => {
  const walker = pedestrian(LOOK, { ...facing(0.4), angle: 0 }, { edge: 0, forward: true, side: 0 }, { mood: "walk", until: 0 })
  const alone = crash("panda", 25).damage, through = crash("panda", 25, [walker]).damage
  assert.ok(stageOf(through) === "medium" && through > 0.8 * alone, `${through} through the pedestrian, ${alone} alone`)
})

test("crashes: a Panda rammed into a parked truck takes the hit, the truck hardly any; a knocked-down person costs the car nothing", () => {
  const lane = laneOf(BATTISTI.edge, BATTISTI.forward)
  const ahead = { ...lanePoint(lane, 15, laneSide(BATTISTI, "truck")), angle: ON_BATTISTI.angle }
  const { run, world } = start([], [door(ON_BATTISTI), { cars: [parkedCar("truck", 0x3d6155, ahead), rolling("panda", ON_BATTISTI, 30, 0)] }])
  run(90)
  const truck = world().vehicles.find((v) => v.model === "truck")!.damage.amount, panda = world().vehicles.find((v) => v.model === "panda")!.damage.amount
  assert.ok(stageOf(panda) !== "light", `the Panda: ${panda}`)
  assert.equal(truck, 0, "the truck barely moved")

  // A walker coming down the lane line 25 m ahead, on the next edge, as in the knockdown test.
  const next = straightOn(BATTISTI), side = laneSide(next, "panda")
  const at = { ...lanePoint(laneOf(next.edge, next.forward), 5, side), angle: ON_BATTISTI.angle + Math.PI }
  const walker = pedestrian(LOOK, at, { edge: next.edge, forward: !next.forward, side: -side }, { mood: "walk", until: 0 })
  const hit = start([], [door(ON_BATTISTI), { cars: [rolling("panda", ON_BATTISTI, 12, 0.3)], peds: [walker] }])
  hit.run(180)
  assert.ok(hit.heard.impacts.some((i) => i.hit === "person"), "knocked down")
  assert.equal(hit.world().vehicles[0]!.damage.amount, 0)
})

test("worn engine: no loss while it shows nothing, then slower and lower the worse it gets; destroyed, it does not drive at all", () => {
  /** Seconds to 100 km/h floored from rest, and the speed after 60 s (km/h). */
  const floored = (damage: number) => {
    let to100 = Infinity
    const end = drive("panda", 3600, () => ({ throttle: 1, steer: 0, handbrake: false }), {
      wear: { damage, seed: 7 }, each: (frame, state) => {
        if (to100 === Infinity && forward(state) >= 100 / 3.6) to100 = (frame + 1) / 60
      }
    })
    return { to100, top: forward(end) * 3.6 }
  }
  const [fresh, unseen, smoking, failing] = [0, 0.39, 0.55, 0.85].map(floored)
  assert.deepEqual(unseen, fresh, "light damage, no smoke: no loss either")
  assert.ok(fresh.to100 < smoking.to100 && smoking.to100 < failing.to100, `${fresh.to100} s, ${smoking.to100} s, ${failing.to100} s`)
  assert.ok(fresh.top > smoking.top && smoking.top > failing.top, `${fresh.top}, ${smoking.top}, ${failing.top} km/h`)
  assert.ok(wornTorque(0.999) > 0.6)
  const dead = drive("panda", 300, () => ({ throttle: 1, steer: 0, handbrake: false }), { wear: { damage: 1, seed: 7 } })
  assert.ok(Math.abs(forward(dead)) < 0.01, `a destroyed Panda floored for 5 s: ${forward(dead)} m/s`)
  // It still brakes: rolling at 15 m/s, braking stops it.
  const braked = drive("panda", 300, () => ({ throttle: -1, steer: 0, handbrake: false }), { speed: 15, wear: { damage: 1, seed: 7 } })
  assert.ok(Math.abs(forward(braked)) < 0.5)
})

test("misfires: none until the smoke turns black, then in more 0.25 s windows the worse it gets; the same for the same vehicle and step", () => {
  const share = (damage: number, seed: number) => {
    let missed = 0
    for (let window = 0; window < 2000; window++) if (misfires({ damage, seed }, window * 15)) missed++
    return missed / 2000
  }
  assert.equal(share(0.69, 3), 0)
  const severe = share(0.85, 3), brink = share(0.999, 3)
  assert.ok(severe > 0.07 && severe < 0.13, `severe: ${severe}`)
  assert.ok(brink > severe && brink < 0.23, `at the brink ${brink}`)
  assert.equal(share(1, 3), 0, "a dead engine does not misfire: it does not fire")
  const a = Array.from({ length: 60 }, (_, step) => misfires({ damage: 0.95, seed: 3 }, step * 15))
  assert.deepEqual(a, Array.from({ length: 60 }, (_, step) => misfires({ damage: 0.95, seed: 3 }, step * 15)))
  assert.notDeepEqual(a, Array.from({ length: 60 }, (_, step) => misfires({ damage: 0.95, seed: 4 }, step * 15)), "two engines misfire apart")
})

test("destroyed traffic: rammed to destruction, the AI car is abandoned: its driver flees, it stops being traffic, its handbrake goes on", () => {
  const lane = laneOf(BATTISTI.edge, BATTISTI.forward)
  const ahead = { ...lanePoint(lane, 15, laneSide(BATTISTI, "panda")), angle: ON_BATTISTI.angle }
  const driven = trafficCar("panda", 0xd4a85e, ahead, 0, { ...BATTISTI, side: laneSide(BATTISTI, "panda") },
    nextTrafficEdge(endNode(BATTISTI.edge, BATTISTI.forward), BATTISTI.edge, "panda", Random.make(1)))
  const { runtime, run, world } = start([], [door(ON_BATTISTI), { traffic: [driven], cars: [rolling("panda", ON_BATTISTI, 22, 0)] }])
  assert.ok(runtime.tick(wear(0.95)).ok)
  const id = world().vehicles.find((v) => v.traffic)!.id
  const ai = () => world().vehicles.find((v) => v.id === id)!
  let wrecked = -1
  run(90, (frame) => {
    if (wrecked < 0 && !ai().traffic) wrecked = frame
  })
  assert.ok(wrecked >= 0, "no longer traffic")
  const wreck = ai()
  assert.equal(stageOf(wreck.damage.amount), "destroyed")
  assert.deepEqual(wreck.input, { throttle: 0, steer: 0, handbrake: true })
  // Its driver: the one person fleeing near the wreck (Populate brings walkers of its own further off).
  const fleeing = world().peds.filter((p) => p.mood === "flee" && Vec2.distance(p, wreck) < 15)
  assert.equal(fleeing.length, 1, "its driver got out and runs")

  // Out of sight, the wreck goes.
  assert.ok(runtime.tick(Game.Schedule(teleport({ ...ON_BATTISTI, x: ON_BATTISTI.x + 200 }))).ok)
  run(40)
  assert.equal(world().vehicles.some((v) => v.id === id), false, "gone once the player is 200 m off")
})

test("enter: a destroyed car cannot be entered, and the HUD offers none; the player in a car as it is destroyed still gets out", () => {
  const { runtime, run, view } = start(press(0, "action"), [door(ON_BATTISTI), { cars: [parkedCar("panda", 0x3d6155, ON_BATTISTI)] }])
  assert.ok(runtime.tick(wear(1)).ok)
  assert.equal(view()?.nearby, undefined)
  run(2)
  assert.equal(view()?.mode, "foot")

  const inside = start([...press(0, "action"), ...press(80, "action")], [door(ON_BATTISTI), { cars: [parkedCar("panda", 0x3d6155, ON_BATTISTI)] }])
  inside.run(10)
  assert.equal(inside.view()?.mode, "driving")
  assert.ok(inside.runtime.tick(wear(1)).ok)
  inside.run(80)
  assert.equal(inside.view()?.mode, "foot")
})

test("self-righting does not right a wreck: it burns where it lies", () => {
  const roof = { ...settle("panda", ON_BATTISTI), roll: Math.PI, z: settle("panda", ON_BATTISTI).z - VEHICLES.panda.cg + VEHICLES.panda.height - VEHICLES.panda.cg + 0.02 }
  const wreck = Game.Command.spawn(
    [Vehicle, { model: "panda", color: 0xb8312b }], [Pose, ON_BATTISTI], [PrevPose, ON_BATTISTI], [Motion, { vx: 0, vy: 0, spin: 0.01 }],
    [CarInput, { throttle: 0, steer: 0, handbrake: false }], [Chassis, roof], [Damage, { ...UNDAMAGED, amount: 1 }]
  )
  const { runtime, run, world } = start([], [door(ON_BATTISTI), { cars: [wreck] }])
  runtime.send(SetHandling, { key: "selfRighting", value: 1 })
  run(240)
  assert.equal(overturned(world().vehicles[0]!.chassis), true)
})
