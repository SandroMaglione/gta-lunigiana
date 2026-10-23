import { Clock, Decode, Descriptor, Schema } from "@typeonce/ritmo"
import { type InputCapture, Keyboard } from "@typeonce/ritmo-browser"
import { Random } from "@typeonce/ritmo-math"

import type { HandlingKey } from "./handling.ts"
import type { Surface } from "./map/surface.ts"
import { VEHICLE_MODELS, type VehicleModel } from "./vehicles.ts"

/**
 * World conventions: x = east, y = north, metres from the map origin
 * (`MAP.origin`). Angles are radians counter-clockwise from east.
 */
export const Root = Schema.defineRoot("Lunigiana")

/** The one fixed step: Clock resource, FixedLoop and replays all use it. */
export const STEP = Clock.hz(60)

const PoseCodec = Decode.struct({ x: Decode.number, y: Decode.number, angle: Decode.number })

/** Where a body is and which way it faces. */
export const Pose = Descriptor.ConstructedComponent(PoseCodec)("Lunigiana/Pose")
/** Pose at the start of the current step, for render interpolation. */
export const PrevPose = Descriptor.ConstructedComponent(PoseCodec)("Lunigiana/PrevPose")
/** A Pose (or PrevPose) value. */
export type PoseValue = Descriptor.Descriptor.Value<typeof Pose>
/** World-frame velocity (m/s) and yaw rate (rad/s). */
export const Motion = Descriptor.ConstructedComponent(
  Decode.struct({ vx: Decode.number, vy: Decode.number, spin: Decode.number }),
)("Lunigiana/Motion")

/** The one human-controlled person. */
export const Player = Descriptor.Tag("Lunigiana/Player")
/** A person's look, as sRGB hex colours. */
export const Person = Descriptor.ConstructedComponent(
  Decode.struct({
    skin: Decode.integer,
    hair: Decode.integer,
    shirt: Decode.integer,
    pants: Decode.integer,
  }),
)("Lunigiana/Person", { immutable: true })
/** A Person value. */
export type Look = Descriptor.Descriptor.Value<typeof Person>
/**
 * A non-player person: walking its route, or running along it until step
 * `until`; `blocked` counts the steps it has been getting nowhere.
 */
export const Pedestrian = Descriptor.ConstructedComponent(
  Decode.struct({
    mood: Decode.literal("walk", "flee"),
    until: Decode.integer,
    blocked: Decode.integer,
  }),
)("Lunigiana/Pedestrian")
/** Knocked to the ground until step `until` (player or pedestrian). */
export const Down = Descriptor.ConstructedComponent(Decode.struct({ until: Decode.integer }))(
  "Lunigiana/Down",
)
/** Killed at step `at` (by an explosion): lies where it fell and never gets up; the player is brought back to the start (`Respawn`). */
export const Dead = Descriptor.ConstructedComponent(Decode.struct({ at: Decode.integer }))(
  "Lunigiana/Dead",
)

/** A car, van or truck of one model and paint colour. */
export const Vehicle = Descriptor.ConstructedComponent(
  Decode.struct({ model: Decode.literal(...VEHICLE_MODELS), color: Decode.integer }),
)("Lunigiana/Vehicle", { immutable: true })
/** What the vehicle's driver is doing this step: throttle and steer in [-1, 1]. */
export const CarInput = Descriptor.ConstructedComponent(
  Decode.struct({ throttle: Decode.number, steer: Decode.number, handbrake: Decode.boolean }),
)("Lunigiana/CarInput")
/**
 * A vehicle's body beyond its planar Pose and Motion: the elevation of its centre of mass (m a.s.l.)
 * and vertical speed, pitch (nose up +) and roll (left side up +) with their rates (rad, rad/s; the
 * body turns yaw, then pitch, then roll), the road wheels' steering angle (rad, left +), the gear
 * (index into the gearbox's ratios; −1 reverse) and the step at which the current shift ends.
 */
export const Chassis = Descriptor.ConstructedComponent(
  Decode.struct({
    z: Decode.number,
    vz: Decode.number,
    pitch: Decode.number,
    pitchRate: Decode.number,
    roll: Decode.number,
    rollRate: Decode.number,
    steer: Decode.number,
    gear: Decode.integer,
    shiftUntil: Decode.integer,
  }),
)("Lunigiana/Chassis")
/** A Chassis value. */
export type ChassisValue = Descriptor.Descriptor.Value<typeof Chassis>
/**
 * How wrecked a vehicle is: the share of its durability its crashes have used up (`amount`, from 0 as new to 1 destroyed: the
 * engine is dead and it burns); its latest crash: the barrier-equivalent speed of its hardest hit (m/s; 0 before any), the step of
 * its first and what it struck (another vehicle's entity id, −1 a wall or the ground), so the further contacts of one crash cost
 * only what a harder hit adds; and its fire: the step it blows up (`fuse`, 0 until it burns) and whether it has (`exploded`: a
 * charred shell). Stages, durability and what damage costs the engine are in damage.ts.
 */
export const Damage = Descriptor.ConstructedComponent(
  Decode.struct({
    amount: Decode.number,
    crash: Decode.number,
    since: Decode.integer,
    struck: Decode.integer,
    fuse: Decode.integer,
    exploded: Decode.boolean,
  }),
)("Lunigiana/Damage")
/** A Damage value. */
export type DamageValue = Descriptor.Descriptor.Value<typeof Damage>
/** An AI-driven vehicle (it follows its Route). */
export const Traffic = Descriptor.Tag("Lunigiana/Traffic")
/**
 * Progress along the map graph (`graph` in ./map/index.ts): the current edge,
 * the travel direction (a -> b when `forward`), and the lateral offset from the
 * centreline in metres (positive = right of travel).
 */
export const Route = Descriptor.ConstructedComponent(
  Decode.struct({ edge: Decode.integer, forward: Decode.boolean, side: Decode.number }),
)("Lunigiana/Route")
/** A Route value. */
export type RouteValue = Descriptor.Descriptor.Value<typeof Route>
/**
 * An AI driver's plan beyond its Route: the edge it takes after the current
 * one (a -> b when `nextForward`), the steps it has been stuck, the step
 * until which it reverses to get unstuck, and how many times it has had to.
 */
export const Autopilot = Descriptor.ConstructedComponent(
  Decode.struct({
    next: Decode.integer,
    nextForward: Decode.boolean,
    stuck: Decode.integer,
    reverseUntil: Decode.integer,
    tries: Decode.integer,
  }),
)("Lunigiana/Autopilot")
/** A vehicle the player has already entered once (it scored a theft). */
export const Stolen = Descriptor.Tag("Lunigiana/Stolen")
/** The player is in this vehicle. */
export const Driving = Descriptor.ConstructedComponent(
  Decode.struct({ vehicle: Decode.handle(Root, Vehicle) }),
)("Lunigiana/Driving")

/** Simulation time. */
export const Time = Clock.resource("Lunigiana/Time", STEP)
/** The world's random stream (saved, so runs replay). */
export const Rng = Descriptor.ConstructedResource(Random)("Lunigiana/Rng")
/** Counters shown on the HUD. */
export const Score = Descriptor.ConstructedResource(
  Decode.struct({ stolen: Decode.integer, knocked: Decode.integer }),
)("Lunigiana/Score")
/**
 * Net quarter turns of the camera to the left of its home seat (any integer, mod 4 is the heading;
 * see `screenAxes`). Saved: the on-foot keys depend on it.
 */
export const View = Descriptor.ConstructedResource(Decode.struct({ turns: Decode.integer }))(
  "Lunigiana/View",
)
/**
 * Every vehicle's handling knobs (`HANDLING` in handling.ts): multipliers, shares and switches over the
 * vehicles' real data, at `DEFAULT_HANDLING` in a new game. Saved, so a run replays with the handling
 * it was played with; set only through `SetHandling`.
 */
export const Handling = Descriptor.ConstructedResource(
  Decode.struct({
    grip: Decode.number,
    looseGround: Decode.number,
    power: Decode.number,
    brakes: Decode.number,
    drag: Decode.number,
    abs: Decode.number,
    stability: Decode.number,
    selfRighting: Decode.number,
    traction: Decode.number,
    steering: Decode.number,
    steeringRate: Decode.number,
    weightTransfer: Decode.number,
    antiRoll: Decode.number,
    stiffness: Decode.number,
    damping: Decode.number,
  } satisfies Record<HandlingKey, typeof Decode.number>),
)("Lunigiana/Handling")
/** A request to set one handling knob, sent by the host's handling store (the settings, the dev debug menu); `ApplyHandling` keeps it in range. Not saved. */
export const SetHandling = Descriptor.Event<{
  readonly key: HandlingKey
  readonly value: number
}>()("Lunigiana/SetHandling")

/**
 * A vehicle hit something this step: a wall, another vehicle, a person (`other`, their entity ids)
 * or the ground (landing hard, rolling over), where (the contact point on a wall, between two
 * vehicles or on the ground, the person's position), how hard (the closing speed at contact, m/s)
 * and with how much mass behind it (tonnes). A ground hit names the `face` of the body that struck:
 * the wheels bottoming out, the roof, a side, the nose or the tail. Not saved; the audio schedule
 * plays it.
 */
export const Impact = Descriptor.Event<{
  readonly hit: "wall" | "car" | "person" | "ground"
  readonly x: number
  readonly y: number
  readonly speed: number
  readonly mass: number
  readonly car: number
  readonly other?: number
  readonly face?: "under" | "roof" | "side" | "front" | "rear"
}>()("Lunigiana/Impact")
/**
 * A tyre slid this step: wheel `wheel` (index into the model's `wheels`) of vehicle `car`, at its
 * contact point (x, y, z m a.s.l.), sliding at `slip` m/s past the ground (sideways beyond its grip,
 * spinning or locked), `amount` 0…1 how far past its grip, on `surface`, at simulation `step`. Not
 * saved; the render lays tyre marks and smoke from it and the audio plays the squeal.
 */
export const Skid = Descriptor.Event<{
  readonly car: number
  readonly wheel: number
  readonly x: number
  readonly y: number
  readonly z: number
  readonly slip: number
  readonly amount: number
  readonly surface: Surface
  readonly step: number
}>()("Lunigiana/Skid")
/** An AI driver held up for a while sounds the horn, once per stuck episode. Not saved; the audio schedule plays it. */
export const Honk = Descriptor.Event<{
  readonly car: number
  readonly model: VehicleModel
  readonly x: number
  readonly y: number
}>()("Lunigiana/Honk")
/**
 * A burning wreck (`car`, of `model`) blew up this step at its centre of mass (x, y, and z m a.s.l.). Not saved; the render draws the
 * fireball and the debris, the audio plays the blast.
 */
export const Explosion = Descriptor.Event<{
  readonly car: number
  readonly model: VehicleModel
  readonly x: number
  readonly y: number
  readonly z: number
}>()("Lunigiana/Explosion")

/** Player controls. Keys are host detail, but they live here so `Controls` has one home. */
export const bindings = {
  up: ["ArrowUp", Keyboard.code("KeyW")],
  down: ["ArrowDown", Keyboard.code("KeyS")],
  left: ["ArrowLeft", Keyboard.code("KeyA")],
  right: ["ArrowRight", Keyboard.code("KeyD")],
  sprint: ["Shift"],
  handbrake: [Keyboard.code("Space")],
  action: [Keyboard.code("KeyF"), "Enter"],
  turnLeft: [Keyboard.code("KeyQ")],
  turnRight: [Keyboard.code("KeyE")],
  // Only the audio host hears it: no gameplay effect.
  horn: [Keyboard.code("KeyH")],
} as const
type Controls = Keyboard.Snapshot<typeof bindings>

/** This step's controls, copied from the KeyboardInput service by InputCapture. Not saved. */
export const Input = Descriptor.TransientResource<Controls>()("Lunigiana/Input")
/** Any snapshot() source of Controls: live keyboard, scripted timeline, replay playback. */
export const KeyboardInput =
  Descriptor.Service<InputCapture.Source<Controls>>()("Lunigiana/Keyboard")

export const Game = Schema.bind(
  Schema.fragment({
    components: {
      Pose,
      PrevPose,
      Motion,
      Player,
      Person,
      Pedestrian,
      Down,
      Dead,
      Vehicle,
      CarInput,
      Chassis,
      Damage,
      Traffic,
      Route,
      Driving,
      Autopilot,
      Stolen,
    },
    resources: { Time, Rng, Score, View, Handling, Input },
    events: { Impact, Honk, Skid, Explosion, SetHandling },
    requires: [
      Schema.requires(Player, Pose, PrevPose, Motion, Person),
      Schema.requires(Pedestrian, Pose, PrevPose, Motion, Person, Route),
      Schema.requires(Vehicle, Pose, PrevPose, Motion, CarInput, Chassis, Damage),
      Schema.requires(Traffic, Vehicle, Route, Autopilot),
      Schema.requires(Dead, Down),
    ],
  }),
  Root,
)
