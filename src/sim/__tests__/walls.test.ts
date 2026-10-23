import assert from "node:assert/strict"
import { test } from "node:test"

import { Ops, Vec2 } from "@typeonce/ritmo-math"

import { carClear, crossesAny, moveCar, wallsAlong } from "../body.ts"
import { settle, tiltOf, turn } from "../chassis.ts"
import { UNDAMAGED } from "../damage.ts"
import { groundZ } from "../map/ground.ts"
import { graph, MAP, wallsNear } from "../map/index.ts"
import { pushTrunk } from "../map/kinds.ts"
import {
  edgeIndex,
  facesForward,
  laneOf,
  lanePoint,
  laneSide,
  roadOf,
  walkIndex,
  walkSide,
} from "../route.ts"
import { CarInput, Chassis, Damage, Game, Motion, Pose, PrevPose, Vehicle } from "../schema.ts"
import { parkedCar, pedestrian } from "../spawning.ts"
import { HONK_STEPS } from "../systems/traffic.ts"
import {
  BATTISTI,
  battistiTraffic,
  BESIDE,
  depth,
  door,
  facing,
  FAR,
  INTO,
  MID,
  ON_BATTISTI,
  press,
  rolling,
  start,
  TOWARD,
  walkClear,
} from "../testing.ts"
import { PERSON_RADIUS } from "../tuning.ts"
import { VEHICLES } from "../vehicles.ts"

// Trees are indexed as points and their trunk squares made on query: the broad phase must still return them.
test("wallsNear: a box touching only the corner of a tree's trunk square returns its four edges", () => {
  const trees = MAP.trees.length / 3
  assert.ok(trees > 1000, `${trees} trees`)
  const square: Array<number> = []
  pushTrunk(square, 0, 0)
  const reach = Math.max(...square)
  // Every tenth tree: hundreds of them have a corner box in a grid cell the tree is not in.
  for (let i = 0; i < trees; i += 10) {
    const x = MAP.trees[3 * i]!,
      y = MAP.trees[3 * i + 1]!
    square.length = 0
    pushTrunk(square, x, y)
    for (const [minX, minY, maxX, maxY] of [
      [x + reach, y + reach, x + reach + 0.5, y + reach + 0.5],
      [x - reach - 0.5, y - reach - 0.5, x - reach, y - reach],
    ] as const) {
      for (const kind of ["walk", "drive"] as const) {
        let edges = 0 // one bit per edge of the square
        for (const s of wallsNear(kind, minX, minY, maxX, maxY)) {
          for (let k = 0; k < 16; k += 4)
            if (
              s.ax === square[k] &&
              s.ay === square[k + 1] &&
              s.bx === square[k + 2] &&
              s.by === square[k + 3]
            )
              edges |= 1 << (k / 4)
        }
        assert.equal(edges, 0b1111, `${kind}: tree ${i} at ${x},${y}`)
      }
    }
  }
})

// Regressions: nothing (pushed, thrown, shoved, getting out, turning) ends up inside a building.

const LOOK = { skin: 0xc68e6a, hair: 0x2b1d14, shirt: 0xb8312b, pants: 0x1d2b4f }

test("contacts: a car pushing or knocking a pedestrian against a house wall never puts them through it", () => {
  for (const speed of [2.5, 8]) {
    const at = { ...facing(0.4), angle: 0 }
    const walker = pedestrian(
      LOOK,
      at,
      { edge: walkIndex.nearest(at.x, at.y), forward: true, side: 0 },
      { mood: "walk", until: 0 },
    )
    const { run, world } = start(
      [],
      [
        FAR,
        {
          cars: [rolling("panda", { ...facing(4), angle: TOWARD }, speed, speed > 5 ? 1 : 0.3)],
          peds: [walker],
        },
      ],
    )
    const {
      peds: [walking],
      vehicles: [car],
    } = world()
    const pedId = walking!.id,
      carId = car!.id
    const ped = () => world().peds.find((p) => p.id === pedId)!
    run(120, () => {
      assert.ok(
        depth(ped()) < -PERSON_RADIUS + 0.02 && walkClear(ped()),
        `${speed} m/s: pedestrian at ${depth(ped())}`,
      )
      assert.ok(
        carClear(
          "panda",
          world().vehicles.find((v) => v.id === carId)!,
          0.1,
        ),
      )
    })
    if (speed > 5) assert.ok(ped().down, "knocked down")
  }
})

// Regression: the pin stops the car in the step it knocks the person down; the Impact still has the speed it hit at.
test("contacts: a car pinning the player against a house wall is a person Impact as fast as the car was", () => {
  const { run, world, heard } = start(
    [],
    [
      { ...facing(0.36), angle: 0 },
      { cars: [rolling("panda", { ...facing(4), angle: TOWARD }, 8, 1)] },
    ],
  )
  const car = world().vehicles[0]!.id
  run(60)
  const hits = heard.impacts.filter((i) => i.hit === "person")
  assert.deepEqual(
    hits.map((i) => i.car),
    [car],
  )
  assert.ok(hits[0]!.speed > 8, `hit at ${hits[0]!.speed} m/s`)
})

test("contacts: a car rammed sideways into a house wall stays out of it", () => {
  const parked = { ...facing(VEHICLES.panda.width / 2 + 0.1), angle: BESIDE }
  const ram = { ...facing(VEHICLES.panda.width / 2 + 6), angle: TOWARD }
  const { run, world } = start(
    [],
    [FAR, { cars: [parkedCar("panda", 0xf2efe6, parked), rolling("panda", ram, 10, 1)] }],
  )
  const ids = new Set(world().vehicles.map((car) => car.id))
  const ours = () => world().vehicles.filter((car) => ids.has(car.id))
  run(120, () => {
    for (const car of ours())
      assert.ok(carClear("panda", car, 0.1) && depth(car) < 0, JSON.stringify(car))
  })
  assert.ok(
    ours().some((car) => Vec2.distance(car, parked) > 0.05),
    "the parked car was shoved",
  )
})

test("physics: steering into a wall alongside never wedges the car in it", () => {
  const car = { ...facing(VEHICLES.panda.width / 2 + 0.05), angle: BESIDE }
  const { run, world } = start([], [FAR, { cars: [rolling("panda", car, 8, 1, 1)] }])
  const id = world().vehicles[0]!.id
  let last = world().vehicles[0]!
  run(90, () => {
    const now = world().vehicles.find((v) => v.id === id)!
    assert.ok(carClear("panda", now, 0.1), JSON.stringify(now))
    assert.ok(
      !crossesAny(wallsAlong("drive", now.x, now.y, last.x - now.x, last.y - now.y, 1), last, now),
      "no jump through a wall",
    )
    last = now
  })
})

// Regression: a tumble's angles fold past vertical (heading + π, pitch π − pitch, roll + π); when the wall undid that step's turn, the
// old heading was kept with the folded pitch and roll, and the body flipped over.
test("physics: a car tumbling end over end in a tight spot turns on smoothly as its angles fold", () => {
  // Between house walls by Monzone station, facing north: a turn of 0.2 rad to the left does not fit, standing still does.
  const pose = { x: -462, y: 445, angle: Math.PI / 2 },
    walls = wallsAlong("drive", pose.x, pose.y, 0, 0, 2.9)
  assert.equal(
    moveCar("panda", pose, pose.angle + 0.2, { x: 0, y: 0 }, walls),
    undefined,
    "the turn is undone",
  )
  assert.notEqual(
    moveCar("panda", pose, pose.angle, { x: 0, y: 0 }, walls),
    undefined,
    "standing still fits",
  )
  // In the air, swinging left at 12 rad/s and pitching past vertical within the step.
  const chassis = {
    ...settle("panda", pose),
    z: groundZ(pose.x, pose.y) + 2.5,
    pitch: 1.55,
    pitchRate: 6,
  }
  const car = Game.Command.spawn(
    [Vehicle, { model: "panda", color: 0xf2efe6 }],
    [Pose, pose],
    [PrevPose, pose],
    [Motion, { vx: 0, vy: 0, spin: 12 }],
    [CarInput, { throttle: 0, steer: 0, handbrake: false }],
    [Chassis, chassis],
    [Damage, UNDAMAGED],
  )
  const { run, world } = start([], [FAR, { cars: [car] }])
  /** The body's up axis in the world. */
  const up = () => {
    const v = world().vehicles[0]!,
      t = turn({ f: 0, l: 0, u: 1 }, tiltOf(v.chassis.pitch, v.chassis.roll)),
      c = Ops.cos(v.angle),
      s = Ops.sin(v.angle)
    return { x: t.f * c - t.l * s, y: t.f * s + t.l * c, z: t.u }
  }
  let last = up()
  run(3, (frame) => {
    const now = up(),
      turned = Ops.acos(Math.min(1, now.x * last.x + now.y * last.y + now.z * last.z))
    assert.ok(turned < 0.3, `step ${frame}: the body turned ${turned} rad`)
    last = now
  })
})

test("exit: with a house wall at the driver's door, the player gets out of the right door", () => {
  const car = { ...facing(0.9), angle: BESIDE }
  const { run, view, world } = start(
    [...press(0, "action"), ...press(10, "action")],
    [door(car, -1), { cars: [parkedCar("panda", 0xb8312b, car)] }],
  )
  run(1)
  assert.equal(view()?.mode, "driving")
  run(10)
  const me = view()!
  const parked = world().vehicles.find((v) => !v.traffic)
  assert.equal(me.mode, "foot")
  assert.ok(
    depth(me.pose) < -PERSON_RADIUS && walkClear(me.pose),
    `outside the house: ${depth(me.pose)}`,
  )
  assert.ok(
    (me.pose.x - parked!.x) * INTO.x + (me.pose.y - parked!.y) * INTO.y < 0,
    "on the car's right",
  )
  assert.ok(
    !crossesAny(
      wallsAlong("walk", parked!.x, parked!.y, me.pose.x - parked!.x, me.pose.y - parked!.y, 1),
      parked!,
      me.pose,
    ),
  )
})

// Regression: getting in ignored walls (getting out does not), so the player stepped through walls by car.
test("enter: a car on the other side of a wall cannot be entered, and the HUD offers none", () => {
  const car = { ...facing(0.9), angle: BESIDE }
  const behind = { x: MID.x + INTO.x * 0.6, y: MID.y + INTO.y * 0.6, angle: 0 }
  assert.ok(
    walkClear(behind) && depth(behind) > 0,
    "staged in the house, 1.4 m from the car's axis",
  )
  const { run, view } = start(press(0, "action"), [
    behind,
    { cars: [parkedCar("panda", 0xb8312b, car)] },
  ])
  run(1)
  assert.equal(view()?.mode, "foot")
  assert.equal(view()?.nearby, undefined)
})

test("traffic: a car held up by a car parked in its lane honks once each time it is stuck, and turns round by its second try", () => {
  const lane = laneOf(BATTISTI.edge, BATTISTI.forward)
  const blocker = { ...lanePoint(lane, 15, laneSide(BATTISTI, "panda")), angle: ON_BATTISTI.angle }
  const { run, world, heard } = start(
    [],
    [FAR, { cars: [parkedCar("panda", 0x3d6155, blocker)], traffic: [battistiTraffic(0xd4a85e)] }],
  )
  const id = world().vehicles.find((v) => v.traffic)!.id
  // Routed and pointing back down the lane; how far it gets then depends on the traffic Populate sends the other way.
  let turned = false
  // Frames of its honks and of its tries to get unstuck, until it has turned round.
  const honked: Array<number> = [],
    reversed: Array<number> = []
  run(1200, (frame) => {
    if (turned) return
    const car = world().vehicles.find((v) => v.id === id)!
    if (heard.honks.filter((h) => h.car === id).length > honked.length) honked.push(frame)
    if ((car.pilot?.tries ?? 0) > reversed.length) reversed.push(frame)
    turned =
      car.route?.forward === false &&
      Ops.cos(car.angle) * lane.dx + Ops.sin(car.angle) * lane.dy < 0
  })
  assert.ok(turned, "turned round within 20 s")
  assert.ok(reversed.length > 0)
  assert.deepEqual(
    honked,
    reversed.map((frame) => frame - HONK_STEPS),
    "one honk per stuck episode, half-way to backing up",
  )
  assert.ok(
    heard.honks
      .filter((h) => h.car === id)
      .every((h) => h.model === "panda" && Vec2.distance(h, blocker) < 10),
    "behind the blocker",
  )
})

test("pedestrians: a walker whose verge is blocked by a parked car gets past it", () => {
  // Via Cesare Battisti by the Carabinieri: both verges clear for 20 m.
  const lane = laneOf(BATTISTI.edge, BATTISTI.forward)
  const side = walkSide(roadOf(BATTISTI.edge))
  const heading = Ops.atan2(lane.dy, lane.dx)
  const at = { ...lanePoint(lane, 2, side), angle: heading }
  const blocker = { ...lanePoint(lane, 8, side), angle: heading }
  assert.ok(walkClear(at) && carClear("panda", blocker), "a clear verge to stage on")
  const walker = pedestrian(LOOK, at, { ...BATTISTI, side }, { mood: "walk", until: 0 })
  const { run, world } = start(
    [],
    [FAR, { cars: [parkedCar("panda", 0x3d6155, blocker)], peds: [walker] }],
  )
  const id = world().peds[0]!.id
  let progress = 0
  run(900, () => {
    const ped = world().peds.find((p) => p.id === id)!
    progress = Math.max(progress, (ped.x - lane.x) * lane.dx + (ped.y - lane.y) * lane.dy)
  })
  assert.ok(progress > 11, `walked ${progress} m along`)
})

// Regression: the sideways step after trying the other verge counted as progress, so a walker wedged in a house corner
// switched verge every 0.5 s on the spot for good, never turning back (and never stranded enough for Populate to take it).
test("pedestrians: a walker wedged in a house corner on its verge turns back", () => {
  // Via della Vittoria in Campiglione, southbound on the east verge: a house corner stops it 1.7 m on.
  const edge = edgeIndex(
    graph.walkEdges.filter((e) => roadOf(e).name === "Via della Vittoria"),
  ).nearest(-2202, 1574)
  const forward = !facesForward(edge, Math.PI / 2)
  const lane = laneOf(edge, forward),
    side = -walkSide(roadOf(edge))
  const at = { ...lanePoint(lane, 17, side), angle: Ops.atan2(lane.dy, lane.dx) }
  assert.ok(walkClear(at))
  // The player 100 m away: out of view, so nothing but the walls moves the walker.
  const { run, world } = start(
    [],
    [
      { x: at.x + 100, y: at.y, angle: 0 },
      { peds: [pedestrian(LOOK, at, { edge, forward, side }, { mood: "walk", until: 0 })] },
    ],
  )
  const id = world().peds[0]!.id
  let away = 0
  run(600, () => {
    const ped = world().peds.find((p) => p.id === id)
    if (ped !== undefined) away = Math.max(away, Vec2.distance(ped, at))
  })
  assert.ok(away > 3, `stayed within ${away.toFixed(2)} m`)
})
