/**
 * Vehicle handling: the knobs that make driving easier or harder, for every vehicle on the map,
 * traffic included. Each knob scales or switches one part of the drive physics away from the
 * vehicle's real data; at its real value (`REAL_HANDLING`) a vehicle drives as its spec says. A new
 * game starts at `DEFAULT_HANDLING`.
 * `HANDLING` names and explains each knob for the debug menu; `tuned` applies the ones that are
 * part of a vehicle's spec.
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
    group: "Tyres", label: "Tyre grip", kind: "scale", min: 0.5, max: 2, step: 0.05,
    description: "Multiplies every tyre's grip on every surface. Higher corners faster, stops shorter and slides less, but lets a tall vehicle corner hard enough to roll over (from ×1.1 a Panda held at full lock tips from about 36 km/h): lower the weight transfer with it. Lower slides and spins sooner."
  },
  looseGround: {
    group: "Tyres", label: "Off-road grip loss", kind: "share", min: 0, max: 1, step: 0.05,
    description: "How much stone, gravel, dirt, grass and leaves differ from asphalt in grip, sliding and rolling drag. 1 is real; 0 drives every surface like asphalt."
  },
  power: {
    group: "Engine and brakes", label: "Engine power", kind: "scale", min: 0.5, max: 3, step: 0.05,
    description: "Multiplies every engine's torque and power. Higher accelerates harder where the tyres can take it (else the driven wheels spin), climbs steeper hills and reaches a higher top speed; the truck's limiter still holds it to 90 km/h."
  },
  brakes: {
    group: "Engine and brakes", label: "Brake power", kind: "scale", min: 0.5, max: 3, step: 0.05,
    description: "Multiplies the brakes' force. Higher stops shorter until the tyres' grip runs out; lower stops longer."
  },
  drag: {
    group: "Engine and brakes", label: "Air drag", kind: "scale", min: 0, max: 2, step: 0.05,
    description: "Multiplies air resistance. Lower raises the top speed and coasts further; higher holds a vehicle back at speed."
  },
  abs: {
    group: "Driving aids", label: "ABS on every vehicle", kind: "switch", min: 0, max: 1, step: 1,
    description: "On: no vehicle's brakes lock its wheels, so it still steers while braking hard (the Ape has no ABS of its own). The handbrake still locks the rear wheels."
  },
  traction: {
    group: "Driving aids", label: "Traction control on every vehicle", kind: "switch", min: 0, max: 1, step: 1,
    description: "On: no vehicle spins its driven wheels; the engine gives only what the tyres can take and leaves them grip to corner (only the truck and the Giulia have it of their own)."
  },
  steering: {
    group: "Steering", label: "Steering at speed", kind: "scale", min: 0.5, max: 2, step: 0.05,
    description: "Multiplies how far the wheels turn at speed, where the lock shrinks to what the tyres' grip and the vehicle's tipping point allow. Higher turns tighter but slides or tips sooner; lower is steadier."
  },
  steeringRate: {
    group: "Steering", label: "Steering speed", kind: "scale", min: 0.5, max: 3, step: 0.05,
    description: "Multiplies how fast the wheels turn toward the keys and back to straight. Higher reacts at once but is twitchy; lower is smoother but slower."
  },
  weightTransfer: {
    group: "Body and suspension", label: "Weight transfer", kind: "share", min: 0, max: 1, step: 0.05,
    description: "How much cornering, braking, accelerating and a crash's sideways shove tilt the body onto its outer, front or rear wheels. 1 is real; lower keeps the body flatter and the grip even, and at 0 none of them tips a vehicle over, though a jump or a side slope still can, and a side slope leans it further."
  },
  antiRoll: {
    group: "Body and suspension", label: "Anti-roll bars", kind: "scale", min: 0, max: 3, step: 0.05,
    description: "Multiplies the bars that share the load between an axle's left and right wheels. Stiffer leans less in corners and, on four wheels, resists tipping (the three-wheeled Ape's only bar is at the rear, and stiffer tips it a little sooner); softer leans more and keeps the wheels on the ground over bumps."
  },
  stiffness: {
    group: "Body and suspension", label: "Suspension stiffness", kind: "scale", min: 0.5, max: 2, step: 0.05,
    description: "Multiplies the springs' stiffness. Stiffer leans and dives less and bottoms out less on landings; softer soaks up bumps but wallows and dives."
  },
  damping: {
    group: "Body and suspension", label: "Suspension damping", kind: "scale", min: 0.3, max: 2, step: 0.05,
    description: "Multiplies the dampers. Higher settles the body at once after a bump or a landing; lower lets it bounce."
  }
} as const satisfies Record<string, Knob>

/** A handling knob's name. */
export type HandlingKey = keyof typeof HANDLING
/** A value for every knob. */
export type HandlingValue = Readonly<Record<HandlingKey, number>>

/** Every vehicle as its data says: multipliers and shares at 1, the aids each vehicle's own (off). */
export const REAL_HANDLING = {
  grip: 1, looseGround: 1, power: 1, brakes: 1, drag: 1, abs: 0, traction: 0,
  steering: 1, steeringRate: 1, weightTransfer: 1, antiRoll: 1, stiffness: 1, damping: 1
} as const satisfies HandlingValue

/** A new game's handling: real but for off-road grip loss at half, so loose ground and setts cost half their real grip against asphalt. */
export const DEFAULT_HANDLING = { ...REAL_HANDLING, looseGround: 0.5 } as const satisfies HandlingValue

/** Whether `key` names a knob. */
const isKnob = (key: string): key is HandlingKey => key in HANDLING

/** The knobs' names, in menu order. */
export const HANDLING_KEYS: ReadonlyArray<HandlingKey> = Object.keys(HANDLING).filter(isKnob)

/** `value` made valid for knob `key`: inside its range, a switch either 0 or 1; undefined when it is not a finite number. */
export const clampKnob = (key: HandlingKey, value: number): number | undefined => {
  if (!Number.isFinite(value)) return undefined
  const { min, max, kind } = HANDLING[key], inside = Math.max(min, Math.min(max, value))
  return kind === "switch" ? Math.round(inside) : inside
}

/** `spec` with `handling`'s knobs that are part of a vehicle's data applied: tyres, engine, brakes, aids, drag and suspension. */
export const tuned = (spec: VehicleSpec, handling: HandlingValue): VehicleSpec => ({
  ...spec,
  tyres: { ...spec.tyres, grip: spec.tyres.grip * handling.grip },
  engine: { ...spec.engine, torque: spec.engine.torque * handling.power, power: spec.engine.power * handling.power },
  brakes: { ...spec.brakes, decel: spec.brakes.decel * handling.brakes, abs: spec.brakes.abs || handling.abs === 1 },
  traction: spec.traction || handling.traction === 1,
  drag: spec.drag * handling.drag,
  ride: {
    // Stiffness goes as the ride frequency squared.
    hz: spec.ride.hz * Math.sqrt(handling.stiffness), damping: spec.ride.damping * handling.damping,
    antiRoll: [spec.ride.antiRoll[0] * handling.antiRoll, spec.ride.antiRoll[1] * handling.antiRoll]
  }
})
