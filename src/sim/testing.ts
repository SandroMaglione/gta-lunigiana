/**
 * Headless test kit for the simulation tests: a world inspector, a staging
 * schedule that clears the map and places exactly what a test needs, and a
 * runner over scripted keys that also collects the events the systems emit.
 *
 * @module testing
 */
import assert from "node:assert/strict"

import type { Descriptor } from "@typeonce/ritmo"
import { Keyboard } from "@typeonce/ritmo-browser"
import { Ops, Random } from "@typeonce/ritmo-math"

import { clearOf, wallsAlong } from "./body.ts"
import {
  Autopilot, bindings, CarInput, Chassis, Down, Game, Honk, Impact, KeyboardInput, makeRuntime, Motion, Pedestrian, Person, Player, PlayerView, Pose,
  type PoseValue, PrevPose, Route, Score, setup, Stolen, Traffic, update, Vehicle
} from "./index.ts"
import { graph } from "./map/index.ts"
import { edgeIndex, endNode, facesForward, laneOf, lanePoint, laneSide, nextTrafficEdge, roadOf, type Step } from "./route.ts"
import { type parkedCar, type pedestrian, rollingChassis, trafficCar } from "./spawning.ts"
import { PERSON_RADIUS } from "./tuning.ts"
import { VEHICLES, type VehicleModel } from "./vehicles.ts"

/** Scripted keys, frame by frame. */
export type Timeline = Keyboard.Timeline<typeof bindings>

/** Everything a test asserts on, as plain data. */
export const World = Game.Inspector("Test/World", {
  queries: {
    vehicles: Game.Query({
      selection: {
        pose: Game.Query.read(Pose),
        motion: Game.Query.read(Motion),
        vehicle: Game.Query.read(Vehicle),
        input: Game.Query.read(CarInput),
        chassis: Game.Query.read(Chassis),
        traffic: Game.Query.optional(Traffic),
        stolen: Game.Query.optional(Stolen),
        route: Game.Query.optional(Route),
        pilot: Game.Query.optional(Autopilot)
      }
    }),
    peds: Game.Query({ selection: { pose: Game.Query.read(Pose), ped: Game.Query.read(Pedestrian), down: Game.Query.optional(Down) } })
  },
  resources: { score: Game.System.readResource(Score) }
}, ({ queries, resources }) => ({
  vehicles: queries.vehicles.each().map(({ entity, data }) => ({
    id: entity.id, ...data.pose.get(), ...data.motion.get(), ...data.vehicle.get(), input: data.input.get(), chassis: data.chassis.get(), traffic: data.traffic.present,
    stolen: data.stolen.present, route: data.route.value(), pilot: data.pilot.value()
  })),
  peds: queries.peds.each().map(({ entity, data }) => ({ id: entity.id, ...data.pose.get(), ...data.ped.get(), down: data.down.present })),
  score: resources.score.get()
}))

/** What a test puts on the cleared map. */
interface Cast {
  readonly cars?: ReadonlyArray<ReturnType<typeof parkedCar>>
  readonly traffic?: ReadonlyArray<ReturnType<typeof trafficCar>>
  readonly peds?: ReadonlyArray<ReturnType<typeof pedestrian>>
}

/** Moves the player (on foot) to `at`. */
export const teleport = (at: PoseValue) =>
  Game.System("Test/Teleport", {
    queries: { player: Game.Query({ selection: { pose: Game.Query.write(Pose), prev: Game.Query.write(PrevPose) }, with: [Player] }) }
  }, ({ queries }) => {
    for (const { data } of queries.player.each()) {
      data.pose.set(at)
      data.prev.set(at)
    }
  })

/** Test setup: no other vehicles or pedestrians, the player at `at`, plus the `cast`. */
export const stage = (at: PoseValue, cast: Cast = {}) =>
  Game.Schedule(
    Game.System("Test/Clear", {
      queries: {
        vehicles: Game.Query({ selection: { vehicle: Game.Query.read(Vehicle) } }),
        peds: Game.Query({ selection: { ped: Game.Query.read(Pedestrian) } })
      },
      commands: Game.System.commands(Game.System.despawns(Vehicle, Pedestrian))
    }, ({ queries, commands }) => {
      for (const { entity } of queries.vehicles.each()) commands.despawn(entity)
      for (const { entity } of queries.peds.each()) commands.despawn(entity)
    }),
    teleport(at),
    Game.Schedule.applyDeferred(),
    Game.System("Test/Spawn", {
      commands: Game.System.commands(Game.System.spawns(Vehicle, Pose, PrevPose, Motion, CarInput, Traffic, Route, Autopilot, Pedestrian, Person))
    }, ({ commands }) => {
      for (const car of cast.cars ?? []) commands.spawn(car)
      for (const car of cast.traffic ?? []) commands.spawn(car)
      for (const ped of cast.peds ?? []) commands.spawn(ped)
    }),
    Game.Schedule.applyDeferred()
  )

/**
 * A runtime after setup (and `staging`, if given) driven by `timeline`: run frames, inspect the world and the player's view,
 * and read every event emitted so far (`heard`, in emission order).
 */
export const start = (timeline: Timeline = [], staging?: readonly [PoseValue, Cast?]) => {
  const made = makeRuntime({ seed: 1, services: Game.Runtime.services(Game.Runtime.service(KeyboardInput, Keyboard.scripted(bindings, timeline))) })
  assert.ok(made.ok)
  const runtime = made.value
  assert.ok(runtime.tick(setup).ok)
  if (staging !== undefined) assert.ok(runtime.tick(stage(...staging)).ok)
  const heard = { impacts: new Array<Descriptor.Descriptor.Value<typeof Impact>>(), honks: new Array<Descriptor.Descriptor.Value<typeof Honk>>() }
  const listen = Game.Schedule(Game.System("Test/Listen", {
    events: { impacts: Game.System.readEvent(Impact), honks: Game.System.readEvent(Honk) }
  }, ({ events }) => {
    heard.impacts.push(...events.impacts.all())
    heard.honks.push(...events.honks.all())
  }))
  const run = (frames: number, each: (frame: number) => void = () => {}) => {
    for (let i = 0; i < frames; i++) {
      const ran = runtime.tick(update, listen)
      assert.ok(ran.ok, JSON.stringify(ran))
      each(i)
    }
  }
  return { runtime, run, heard, world: () => runtime.inspect(World), view: () => runtime.inspect(PlayerView) }
}

const battisti = graph.trafficEdges.filter((e) => roadOf(e).name === "Via Cesare Battisti")
const inFront = edgeIndex(battisti).nearest(-412, 438)
/**
 * Via Cesare Battisti eastbound in front of the Carabinieri: the traffic edge of that road nearest
 * (-412, 438), found by geometry so the fixtures survive map rebuilds. ~40 m of straight, clear road
 * with the next edge (`straightOn`), both verges walkable.
 */
export const BATTISTI: Step = { edge: inFront, forward: facesForward(inFront, 0) }
const lane = laneOf(BATTISTI.edge, BATTISTI.forward)
/** The start of the BATTISTI lane, heading along it. */
export const ON_BATTISTI = { ...lanePoint(lane, 0, laneSide(BATTISTI, "panda")), angle: Ops.atan2(lane.dy, lane.dx) }

/** The traffic edge leaving the end of `step` that carries on most nearly straight. */
export const straightOn = (step: Step): Step => {
  const node = endNode(step.edge, step.forward), here = laneOf(step.edge, step.forward)
  const along = (next: Step) => {
    const there = laneOf(next.edge, next.forward)
    return here.dx * there.dx + here.dy * there.dy
  }
  const options = graph.adjacency[node]!.filter((e) => e !== step.edge && graph.trafficEdges.includes(e)).map((e) => ({ edge: e, forward: graph.edges[e]!.a === node }))
  return options.reduce((best, next) => (along(next) > along(best) ? next : best))
}

/** The point beside a panda's left (driver's) or right door. */
export const door = (car: PoseValue, side: 1 | -1 = 1): PoseValue => {
  const off = side * (VEHICLES.panda.width / 2 + 0.6)
  return { x: car.x - Ops.sin(car.angle) * off, y: car.y + Ops.cos(car.angle) * off, angle: car.angle }
}

/** `keys` pressed on `frame` and released on the next. */
export const press = (frame: number, ...keys: Array<keyof typeof bindings>): Timeline => [{ frame, press: keys }, { frame: frame + 1, release: keys }]

/** Whether a person at `p` is clear of walk walls (2 cm of slack). */
export const walkClear = (p: { readonly x: number; readonly y: number }) => clearOf(wallsAlong("walk", p.x, p.y, 0, 0, 1), p.x, p.y, PERSON_RADIUS, 0.02)

/** An unmanned vehicle at `pose` already rolling at `speed` along its heading, its controls held at `throttle` and `steer`. */
export const rolling = (model: VehicleModel, pose: PoseValue, speed: number, throttle: number, steer = 0) =>
  Game.Command.spawn(
    [Vehicle, { model, color: 0x8b8170 }],
    [Pose, pose],
    [PrevPose, pose],
    [Motion, { vx: Ops.cos(pose.angle) * speed, vy: Ops.sin(pose.angle) * speed, spin: 0 }],
    [CarInput, { throttle, steer, handbrake: false }],
    [Chassis, rollingChassis(model, pose, speed)]
  )

/** A traffic car on Via Cesare Battisti, eastbound, standing. */
export const battistiTraffic = (color: number) => trafficCar("panda", color, ON_BATTISTI, 0,
  { ...BATTISTI, side: laneSide(BATTISTI, "panda") },
  nextTrafficEdge(endNode(BATTISTI.edge, BATTISTI.forward), BATTISTI.edge, "panda", Random.make(1)))
