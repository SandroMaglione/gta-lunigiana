/**
 * Vehicle handling: the knobs that make driving easier or harder, for every vehicle on the map,
 * traffic included. Each knob scales or switches one part of the drive physics away from the
 * vehicle's real data; at its real value (`REAL_HANDLING`) a vehicle drives as its spec says.
 * `HANDLING_PRESETS` are the sets a player picks in the settings (simulation, balanced, arcade); a new
 * game starts on balanced (`DEFAULT_HANDLING`). `HANDLING` names and explains each knob for the
 * debug menu; `tuned` applies the ones that are part of a vehicle's spec.
 *
 * @module handling
 */
import type { VehicleSpec } from "./vehicles.ts"

/** How a knob reads: a multiplier of the real value (×), a share from 0 (none) to 1 (real), or an on/off switch. */
type KnobKind = "scale" | "share" | "switch"

/** One knob: its menu group, name, what changing it does, its kind, and its range and step. */
export interface Knob {
  readonly group: string
  readonly label: string
  readonly description: string
  readonly kind: KnobKind
  readonly min: number
  readonly max: number
  readonly step: number
}

/** Every handling knob, in menu order. */
export const HANDLING = {
  grip: {
    group: "Tyres",
    label: "Tyre grip",
    kind: "scale",
    min: 0.5,
    max: 2.5,
    step: 0.05,
    description:
      "Multiplies every tyre's grip on every surface. Higher corners faster, stops shorter and slides less, but lets a tall vehicle corner hard enough to roll over (from ×1.1 a Panda held at full lock tips from about 36 km/h): lower the weight transfer with it. Lower slides and spins sooner.",
  },
  looseGround: {
    group: "Tyres",
    label: "Off-road grip loss",
    kind: "share",
    min: 0,
    max: 1,
    step: 0.05,
    description:
      "How much stone, gravel, dirt, grass and leaves differ from asphalt in grip, sliding and rolling drag. 1 is real; 0 drives every surface like asphalt.",
  },
  weatherGrip: {
    group: "Tyres",
    label: "Weather grip loss",
    kind: "share",
    min: 0,
    max: 1,
    step: 0.05,
    description:
      "How much wet ground and snow cover take away from the tyres' grip. 1 is real: a wet road keeps about 0.72 of its dry grip and packed snow about 0.27, so stops are longer and corners slower; 0 drives as on a dry day whatever the weather.",
  },
  power: {
    group: "Engine and brakes",
    label: "Engine power",
    kind: "scale",
    min: 0.5,
    max: 4,
    step: 0.05,
    description:
      "Multiplies every engine's torque and power. Higher accelerates harder where the tyres can take it (else the driven wheels spin), climbs steeper hills and reaches a higher top speed; the truck's limiter still holds it to 90 km/h.",
  },
  brakes: {
    group: "Engine and brakes",
    label: "Brake power",
    kind: "scale",
    min: 0.5,
    max: 4,
    step: 0.05,
    description:
      "Multiplies the brakes' force. Higher stops shorter until the tyres' grip runs out; lower stops longer.",
  },
  drag: {
    group: "Engine and brakes",
    label: "Air drag",
    kind: "scale",
    min: 0,
    max: 2,
    step: 0.05,
    description:
      "Multiplies air resistance. Lower raises the top speed and coasts further; higher holds a vehicle back at speed.",
  },
  abs: {
    group: "Driving aids",
    label: "ABS on every vehicle",
    kind: "switch",
    min: 0,
    max: 1,
    step: 1,
    description:
      "On: no vehicle's brakes lock its wheels, so it still steers while braking hard (the Ape has no ABS of its own). The handbrake still locks the rear wheels.",
  },
  stability: {
    group: "Driving aids",
    label: "Stability assist",
    kind: "share",
    min: 0,
    max: 1,
    step: 0.05,
    description:
      "How hard an assist no real car has turns a sliding car back to where it is steered (as fast as the tyres' grip can turn it) and damps its rear's slide. 0 is off (real); at 1 a car holds the line it steers and does not spin, except while the handbrake is held, so a handbrake turn still swings it round.",
  },
  selfRighting: {
    group: "Driving aids",
    label: "Self-righting",
    kind: "switch",
    min: 0,
    max: 1,
    step: 1,
    description:
      "On: a vehicle lying on its side or roof that has nearly stopped rolls back onto its wheels by itself, from a side within half a second and from its roof within about a second, ready to drive again (a wreck, burning or burnt out, stays where it lies). Off (real): it stays there.",
  },
  traction: {
    group: "Driving aids",
    label: "Traction control on every vehicle",
    kind: "switch",
    min: 0,
    max: 1,
    step: 1,
    description:
      "On: no vehicle spins its driven wheels; the engine gives only what the tyres can take and leaves them grip to corner (only the truck and the Giulia have it of their own).",
  },
  steering: {
    group: "Steering",
    label: "Steering at speed",
    kind: "scale",
    min: 0.5,
    max: 2.5,
    step: 0.05,
    description:
      "Multiplies how far the wheels turn at speed, where the lock shrinks to what the tyres' grip and the vehicle's tipping point allow. Higher turns tighter but slides or tips sooner; lower is steadier.",
  },
  steeringRate: {
    group: "Steering",
    label: "Steering speed",
    kind: "scale",
    min: 0.5,
    max: 4,
    step: 0.05,
    description:
      "Multiplies how fast the wheels turn toward the keys and back to straight. Higher reacts at once but is twitchy; lower is smoother but slower.",
  },
  weightTransfer: {
    group: "Body and suspension",
    label: "Weight transfer",
    kind: "share",
    min: 0,
    max: 1,
    step: 0.05,
    description:
      "How much cornering, braking, accelerating and a crash's sideways shove tilt the body onto its outer, front or rear wheels. 1 is real; lower keeps the body flatter and the grip even, and at 0 none of them tips a vehicle over, though a jump or a side slope still can, and a side slope leans it further.",
  },
  antiRoll: {
    group: "Body and suspension",
    label: "Anti-roll bars",
    kind: "scale",
    min: 0,
    max: 3,
    step: 0.05,
    description:
      "Multiplies the bars that share the load between an axle's left and right wheels. Stiffer leans less in corners and, on four wheels, resists tipping (the three-wheeled Ape's only bar is at the rear, and stiffer tips it a little sooner); softer leans more and keeps the wheels on the ground over bumps.",
  },
  stiffness: {
    group: "Body and suspension",
    label: "Suspension stiffness",
    kind: "scale",
    min: 0.5,
    max: 2,
    step: 0.05,
    description:
      "Multiplies the springs' stiffness. Stiffer leans and dives less and bottoms out less on landings; softer soaks up bumps but wallows and dives.",
  },
  damping: {
    group: "Body and suspension",
    label: "Suspension damping",
    kind: "scale",
    min: 0.3,
    max: 2,
    step: 0.05,
    description:
      "Multiplies the dampers. Higher settles the body at once after a bump or a landing; lower lets it bounce.",
  },
} as const satisfies Record<string, Knob>

/** A handling knob's name. */
export type HandlingKey = keyof typeof HANDLING
/** A value for every knob. */
export type HandlingValue = Readonly<Record<HandlingKey, number>>

/** Every vehicle as its data says: multipliers and shares at 1, the aids each vehicle's own (off), no assist a real car lacks. */
export const REAL_HANDLING = {
  grip: 1,
  looseGround: 1,
  weatherGrip: 1,
  power: 1,
  brakes: 1,
  drag: 1,
  abs: 0,
  stability: 0,
  selfRighting: 0,
  traction: 0,
  steering: 1,
  steeringRate: 1,
  weightTransfer: 1,
  antiRoll: 1,
  stiffness: 1,
  damping: 1,
} as const satisfies HandlingValue

/** A handling preset: its name in the menus, what driving with it is like, and its knobs. */
export interface Preset {
  readonly label: string
  readonly description: string
  readonly values: HandlingValue
}

/** The vehicle physics a player picks in the settings, from the real data to plain fun. */
export const HANDLING_PRESETS = {
  simulation: {
    label: "Simulation",
    description:
      "Every vehicle as its real data says. Cars slide on gravel, grass, wet roads and snow, wheels lock and spin without driver aids, and the Ape and the laden truck roll over in sharp turns.",
    values: REAL_HANDLING,
  },
  balanced: {
    label: "Balanced",
    description:
      "Realistic with the rough edges filed off: a little more grip, power and braking, ABS and traction control on every vehicle, half the grip lost off the road and a little more than half lost in the wet and on snow. Cars stay upright in corners; the Ape still tips in a hard handbrake turn, and the laden truck at full lock from about 84 km/h.",
    values: {
      grip: 1.1,
      looseGround: 0.5,
      weatherGrip: 0.6,
      power: 1.15,
      brakes: 1.15,
      drag: 0.9,
      abs: 1,
      stability: 0,
      selfRighting: 0,
      traction: 1,
      steering: 1,
      steeringRate: 1.4,
      weightTransfer: 0.8,
      antiRoll: 1.3,
      stiffness: 1.1,
      damping: 1.2,
    },
  },
  arcade: {
    label: "Arcade",
    description:
      "Pure fun: huge grip everywhere, off the road too, rain and snow taking little of it, rocket acceleration, very short stops and razor-sharp steering, with a stability assist that keeps you pointed where you steer (a handbrake turn still swings you round). Nothing rolls over in a corner, and a vehicle left on its side or roof rolls back onto its wheels.",
    values: {
      grip: 2,
      looseGround: 0,
      weatherGrip: 0.3,
      power: 2.5,
      brakes: 2.5,
      drag: 0.6,
      abs: 1,
      stability: 1,
      selfRighting: 1,
      traction: 1,
      steering: 2,
      steeringRate: 3,
      weightTransfer: 0.4,
      antiRoll: 2.5,
      stiffness: 1.5,
      damping: 1.8,
    },
  },
} as const satisfies Record<string, Preset>

/** A handling preset's name. */
export type PresetId = keyof typeof HANDLING_PRESETS

/** A new game's handling: the balanced preset. */
export const DEFAULT_HANDLING: HandlingValue = HANDLING_PRESETS.balanced.values

/** Whether `key` names a knob. */
const isKnob = (key: string): key is HandlingKey => key in HANDLING

/** The knobs' names, in menu order. */
export const HANDLING_KEYS: ReadonlyArray<HandlingKey> = Object.keys(HANDLING).filter(isKnob)

/** Whether `key` names a preset. */
const isPreset = (key: string): key is PresetId => key in HANDLING_PRESETS

/** The presets' names, in menu order. */
export const PRESET_IDS: ReadonlyArray<PresetId> = Object.keys(HANDLING_PRESETS).filter(isPreset)

/** The preset whose knobs `handling` holds exactly, or undefined when a knob is off every preset (set by hand). */
export const presetOf = (handling: HandlingValue): PresetId | undefined =>
  PRESET_IDS.find((id) =>
    HANDLING_KEYS.every((key) => HANDLING_PRESETS[id].values[key] === handling[key]),
  )

/** `value` made valid for knob `key`: inside its range, a switch either 0 or 1; undefined when it is not a finite number. */
export const clampKnob = (key: HandlingKey, value: number): number | undefined => {
  if (!Number.isFinite(value)) return undefined
  const { min, max, kind } = HANDLING[key],
    inside = Math.max(min, Math.min(max, value))
  return kind === "switch" ? Math.round(inside) : inside
}

/** `spec` with `handling`'s knobs that are part of a vehicle's data applied: tyres, engine, brakes, aids, drag and suspension. */
export const tuned = (spec: VehicleSpec, handling: HandlingValue): VehicleSpec => ({
  ...spec,
  tyres: { ...spec.tyres, grip: spec.tyres.grip * handling.grip },
  engine: {
    ...spec.engine,
    torque: spec.engine.torque * handling.power,
    power: spec.engine.power * handling.power,
  },
  brakes: {
    ...spec.brakes,
    decel: spec.brakes.decel * handling.brakes,
    abs: spec.brakes.abs || handling.abs === 1,
  },
  traction: spec.traction || handling.traction === 1,
  drag: spec.drag * handling.drag,
  ride: {
    // Stiffness goes as the ride frequency squared.
    hz: spec.ride.hz * Math.sqrt(handling.stiffness),
    damping: spec.ride.damping * handling.damping,
    antiRoll: [
      spec.ride.antiRoll[0] * handling.antiRoll,
      spec.ride.antiRoll[1] * handling.antiRoll,
    ],
  },
})
