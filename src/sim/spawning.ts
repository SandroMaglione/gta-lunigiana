/**
 * Entity drafts shared by the systems that spawn: parked and traffic
 * vehicles, pedestrians, and their random looks. Every draft sets
 * PrevPose = Pose so the first rendered frame does not smear.
 *
 * @module spawning
 */
import { Ops, type Random } from "@typeonce/ritmo-math"

import { settle } from "./chassis.ts"
import { UNDAMAGED } from "./damage.ts"
import { gearFor } from "./drivetrain.ts"
import { groundZ, roadLevel } from "./map/ground.ts"
import { roadOf, type Step } from "./route.ts"
import {
  Autopilot,
  CarInput,
  Chassis,
  Damage,
  Game,
  type Look,
  Motion,
  Pedestrian,
  Person,
  Pose,
  type PoseValue,
  PrevPose,
  Route,
  type RouteValue,
  Traffic,
  Vehicle,
} from "./schema.ts"
import { CAR_COLORS, type VehicleModel, VEHICLES } from "./vehicles.ts"

const SKINS = [0xe7b896, 0xc68e6a, 0xa8704f, 0x6b4630] as const
const HAIRS = [0x2b1d14, 0x4a3222, 0x17161a, 0x5f5a51, 0x8b8b88, 0xcfccc0, 0xd4a85e] as const
// Shirts and trousers from the Monzone palette (.research/monzone-reference.md §2).
const SHIRTS = [
  0xb8312b, 0x3d6155, 0xf2efe6, 0xf0c93c, 0xd4a85e, 0x1d2b4f, 0xd8a18c, 0x8b8170, 0x8db4b0,
  0xb0664b,
] as const
const PANTS = [0x1d2b4f, 0x4a3222, 0x4b4d50, 0x5f5a51, 0x8f7a58, 0x17161a, 0xcfccc0] as const

const pick = <A>(random: Random.Random, items: readonly [A, ...ReadonlyArray<A>]): A =>
  random.pick(items) ?? items[0]

/** A random civilian look. */
export const randomLook = (random: Random.Random): Look => ({
  skin: pick(random, SKINS),
  hair: pick(random, HAIRS),
  shirt: pick(random, SHIRTS),
  pants: pick(random, PANTS),
})

/** A random civilian paint colour. */
export const randomColor = (random: Random.Random): number => pick(random, CAR_COLORS)

/** A vehicle at rest at `pose`: no driver, handbrake on. */
export const parkedCar = (model: VehicleModel, color: number, pose: PoseValue) =>
  Game.Command.spawn(
    [Vehicle, { model, color }],
    [Pose, pose],
    [PrevPose, pose],
    [Motion, { vx: 0, vy: 0, spin: 0 }],
    [CarInput, { throttle: 0, steer: 0, handbrake: true }],
    [Chassis, settle(model, pose)],
    [Damage, UNDAMAGED],
  )

/**
 * A vehicle of `model` on its springs at `pose`, rolling at `speed` (m/s) along its heading, in the gear for that speed: on the
 * level `level` (m a.s.l., its road's: a deck, a tunnel's floor), or at grade.
 */
export const rollingChassis = (
  model: VehicleModel,
  pose: PoseValue,
  speed: number,
  level?: number,
) => ({
  ...settle(model, pose, level === undefined ? undefined : (x, y) => groundZ(x, y, level)),
  gear: gearFor(VEHICLES[model], speed),
})

/** An AI vehicle on `edge` (travelled a -> b when `forward`) moving at `speed` along its heading. */
export const trafficCar = (
  model: VehicleModel,
  color: number,
  pose: PoseValue,
  speed: number,
  route: RouteValue,
  next: Step,
) =>
  Game.Command.spawn(
    [Vehicle, { model, color }],
    [Pose, pose],
    [PrevPose, pose],
    [Motion, { vx: Ops.cos(pose.angle) * speed, vy: Ops.sin(pose.angle) * speed, spin: 0 }],
    [CarInput, { throttle: 0, steer: 0, handbrake: false }],
    [Chassis, rollingChassis(model, pose, speed, roadLevel(roadOf(route.edge), pose.x, pose.y))],
    [Damage, UNDAMAGED],
    [Traffic, {}],
    [Route, route],
    [
      Autopilot,
      { next: next.edge, nextForward: next.forward, stuck: 0, reverseUntil: 0, tries: 0 },
    ],
  )

/** A pedestrian on `route`, walking, or fleeing until step `until`. */
export const pedestrian = (
  look: Look,
  pose: PoseValue,
  route: RouteValue,
  mood: { readonly mood: "walk" | "flee"; readonly until: number },
) =>
  Game.Command.spawn(
    [Pedestrian, { ...mood, blocked: 0 }],
    [Person, look],
    [Pose, pose],
    [PrevPose, pose],
    [Motion, { vx: 0, vy: 0, spin: 0 }],
    [Route, route],
  )
