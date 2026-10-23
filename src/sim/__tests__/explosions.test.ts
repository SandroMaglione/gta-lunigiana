import assert from "node:assert/strict"
import { test } from "node:test"

import { Clock } from "@typeonce/ritmo"
import { Vec2 } from "@typeonce/ritmo-math"

import { stageOf } from "../damage.ts"
import { MAP } from "../map/index.ts"
import { laneOf, lanePoint, laneSide, walkIndex } from "../route.ts"
import { Game } from "../schema.ts"
import { parkedCar, pedestrian } from "../spawning.ts"
import { WASTED } from "../systems/explosions.ts"
import {
  BATTISTI,
  battistiTraffic,
  burning,
  door,
  ON_BATTISTI,
  press,
  start,
  teleport,
  wear,
} from "../testing.ts"

const LOOK = { skin: 0xc68e6a, hair: 0x2b1d14, shirt: 0xb8312b, pants: 0x1d2b4f }
const lane = laneOf(BATTISTI.edge, BATTISTI.forward)
/** A spot `along` m down the Battisti lane, `out` m to its left (toward the north verge). */
const on = (along: number, out = 0) => {
  const p = lanePoint(lane, along, laneSide(BATTISTI, "panda")),
    left = { x: -lane.dy, y: lane.dx }
  return { x: p.x + left.x * out, y: p.y + left.y * out, angle: ON_BATTISTI.angle }
}
/** A pedestrian standing `out` m to the side of the wreck at `along` m, on the nearest walk edge. */
const bystander = (along: number, out: number) => {
  const at = on(along, out)
  return pedestrian(
    LOOK,
    at,
    { edge: walkIndex.nearest(at.x, at.y), forward: true, side: 0 },
    { mood: "walk", until: 0 },
  )
}

test("explosions: a wreck's fuse is lit the step after it catches fire and burns 5–10 s, and it blows up once when it burns down, leaping as a charred shell", () => {
  const { runtime, run, world, heard } = start(
    [],
    [door(on(30)), { cars: [parkedCar("panda", 0x3d6155, on(30))] }],
  )
  const id = world().vehicles[0]!.id
  assert.ok(runtime.tick(wear(1)).ok)
  run(2)
  const lit = world().vehicles.find((v) => v.id === id)!.damage.fuse
  assert.ok(lit >= 2 + 300 - 2 && lit <= 2 + 600, `fuse at step ${lit}`)
  let blew = -1,
    leap = 0
  run(660, (frame) => {
    if (blew < 0 && heard.explosions.length > 0) {
      blew = frame
      leap = world().vehicles.find((v) => v.id === id)!.chassis.vz
    }
  })
  assert.deepEqual(
    heard.explosions.map((e) => e.car),
    [id],
    "once",
  )
  assert.ok(Math.abs(blew + 3 - lit) <= 2, `blew at frame ${blew}, fuse ${lit}`)
  assert.ok(leap > 1, `leaps at ${leap} m/s`)
  const shell = world().vehicles.find((v) => v.id === id)!.damage
  assert.equal(shell.exploded, true)
  assert.equal(stageOf(shell.amount), "destroyed")
})

test("explosions: the blast destroys the car beside it, which burns and blows up in turn, dents one farther off, and barely the laden truck", () => {
  // Bumper to bumper (0.8 m apart), 6.3 m off, and the truck 2.35 m behind.
  const cast = [
    burning("panda", on(30), 10),
    parkedCar("panda", 0xb8312b, on(34.5)),
    parkedCar("panda", 0xf2efe6, on(40)),
    parkedCar("truck", 0xd4a85e, on(22)),
  ]
  const { run, world, heard } = start([], [door(on(80)), { cars: cast }])
  const [wreck, beside, farther, truck] = world().vehicles.map((v) => v.id)
  const at = (id: number) => world().vehicles.find((v) => v.id === id)!
  run(12)
  assert.equal(heard.explosions.length, 1)
  assert.equal(stageOf(at(beside!).damage.amount), "destroyed", "the car beside it catches fire")
  assert.ok(
    at(farther!).damage.amount > 0 && stageOf(at(farther!).damage.amount) === "light",
    `6.3 m off: ${at(farther!).damage.amount}`,
  )
  assert.ok(
    at(truck!).damage.amount < at(beside!).damage.amount,
    `the truck: ${at(truck!).damage.amount}`,
  )
  assert.ok(Vec2.distance(at(beside!), on(34.5)) > 0.1, "and is shoved away")
  run(620)
  assert.deepEqual(
    heard.explosions.map((e) => e.car),
    [wreck, beside],
    "a chain: the car beside it blows up 5–10 s later",
  )
})

test("explosions: people on foot die near the blast and stay down, those farther are knocked down and get up, walkers around run", () => {
  const cast = {
    cars: [burning("panda", on(30), 10)],
    peds: [bystander(32, 2.5), bystander(37, 3), bystander(50, 3), bystander(80, 3)],
  }
  const { run, world } = start([], [door(on(120)), cast])
  const [killed, knocked, scared, unmoved] = world().peds.map((p) => p.id)
  const ped = (id: number) => world().peds.find((p) => p.id === id)!
  run(12)
  assert.deepEqual(
    [ped(killed!).dead, ped(knocked!).dead, ped(knocked!).down, ped(scared!).down],
    [true, false, true, false],
  )
  assert.equal(ped(scared!).mood, "flee")
  assert.equal(ped(unmoved!).mood, "walk", "80 m off nobody runs")
  assert.deepEqual(
    [ped(killed!).mood, ped(knocked!).mood],
    ["walk", "walk"],
    "the dead and the fallen do not run (nor cry out) until they get up",
  )
  run(240)
  assert.ok(Vec2.distance(ped(killed!), on(32, 2.5)) > 1, "the blast throws the dead")
  assert.deepEqual(
    [ped(killed!).dead, ped(killed!).down, ped(knocked!).down],
    [true, true, false],
    "the dead stay down; the knocked get up",
  )
  assert.equal(ped(killed!).mood, "walk", "the dead never flee")
})

test("explosions: the player sitting in the wreck dies with it, out of its door; 4 s later they come back on foot at the start", () => {
  const { runtime, run, view, world } = start(press(0, "action"), [
    door(on(30)),
    { cars: [parkedCar("panda", 0x3d6155, on(30))] },
  ])
  run(2)
  assert.equal(view()?.mode, "driving")
  assert.ok(runtime.tick(wear(1)).ok)
  const modes: Array<string> = []
  let died = -1
  run(900, (frame) => {
    const mode = view()!.mode
    if (modes.at(-1) !== mode) modes.push(mode)
    if (died < 0 && mode === "dead") died = frame
  })
  assert.deepEqual(modes, ["driving", "dead", "foot"])
  const me = view()!
  assert.ok(
    Vec2.distance(me.pose, MAP.spawns.player) < 1,
    `back at the start: ${JSON.stringify(me.pose)}`,
  )
  assert.equal(
    world().vehicles.some((v) => v.damage.exploded),
    true,
  )
  // Lying dead the whole of WASTED, offered nothing to do.
  const back = start(press(0, "action"), [
    door(on(30)),
    { cars: [parkedCar("panda", 0x3d6155, on(30))] },
  ])
  back.run(2)
  assert.ok(back.runtime.tick(wear(1)).ok)
  let deadFor = 0
  back.run(900, () => {
    if (back.view()!.mode === "dead") {
      deadFor++
      assert.equal(back.view()!.nearby, undefined)
    }
  })
  assert.ok(Math.abs(deadFor - Clock.steps(WASTED)) <= 1, `dead for ${deadFor} steps`)
})

test("explosions: the player on foot by a wreck dies too; inside another car they are shielded by it", () => {
  const onFoot = start([], [on(32, 3), { cars: [burning("panda", on(30), 10)] }])
  onFoot.run(12)
  assert.equal(onFoot.view()?.mode, "dead")
  const seated = start(press(0, "action"), [
    door(on(36)),
    { cars: [burning("panda", on(30), 30), parkedCar("panda", 0x3d6155, on(36))] },
  ])
  seated.run(40)
  assert.equal(seated.view()?.mode, "driving")
})

test("explosions: a body is removed once out of view", () => {
  const { runtime, run, world } = start(
    [],
    [door(on(120)), { cars: [burning("panda", on(30), 10)], peds: [bystander(32, 2.5)] }],
  )
  run(12)
  const [body] = world().peds
  assert.equal(body?.dead, true)
  assert.ok(runtime.tick(Game.Schedule(teleport({ ...ON_BATTISTI, x: ON_BATTISTI.x + 200 }))).ok)
  run(40)
  assert.equal(
    world().peds.some((p) => p.id === body?.id),
    false,
  )
})

// Regression: getting into a car on the step a wreck blew up left the player driving and dead, then pulled back into the car.
test("explosions: getting into a car beside a wreck on the step it blows up seats the player, shielded, and free to get out", () => {
  const timeline = [...press(9, "action"), ...press(40, "action")]
  const { run, view } = start(timeline, [
    door(on(34.5)),
    { cars: [burning("panda", on(30), 10), parkedCar("panda", 0x3d6155, on(34.5))] },
  ])
  const modes: Array<string> = []
  run(100, () => {
    const mode = view()!.mode
    if (modes.at(-1) !== mode) modes.push(mode)
  })
  assert.deepEqual(modes, ["foot", "driving", "foot"])
})

// Regression: a traffic car destroyed by a blast kept its AI and its driver, and honked as a burnt shell.
test("explosions: a traffic car the blast destroys is abandoned, its driver fleeing", () => {
  const { run, world } = start(
    [],
    [door(on(80)), { cars: [burning("panda", on(4.5), 10)], traffic: [battistiTraffic(0xd4a85e)] }],
  )
  const id = world().vehicles.find((v) => v.traffic)!.id
  run(12)
  const car = world().vehicles.find((v) => v.id === id)!
  assert.equal(stageOf(car.damage.amount), "destroyed")
  assert.equal(car.traffic, false)
  assert.deepEqual(car.input, { throttle: 0, steer: 0, handbrake: true })
  assert.ok(
    world().peds.some((p) => p.mood === "flee" && !p.dead),
    "its driver got out and runs",
  )
})

// Regression: the player killed in the wreck left their pedal down on it, so the shell never braked or slept.
test("explosions: the wreck the player died in is left on its handbrake", () => {
  const { runtime, run, world } = start(
    [...press(0, "action"), { frame: 3, press: ["up"] }],
    [door(on(30)), { cars: [parkedCar("panda", 0x3d6155, on(30))] }],
  )
  run(2)
  assert.ok(runtime.tick(wear(1)).ok)
  run(700)
  const shell = world().vehicles.find((v) => v.damage.exploded)!
  assert.deepEqual(shell.input, { throttle: 0, steer: 0, handbrake: true })
})
