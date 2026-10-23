/**
 * Crash damage: how much of a vehicle's durability each crash uses up, the stages a player sees and
 * hears it pass (white smoke, black smoke, fire), and what it costs the engine: less torque once it
 * smokes, misfires once the smoke turns black, nothing at all once it is destroyed. The
 * `CrashDamage` system (`systems/damage.ts`) adds the crashes up in the `Damage` component and
 * `Explode` (`systems/explosions.ts`) blows a burning wreck up; the drivetrain (`engineRevs`,
 * `driveForce`) wears the engine, and the render and the audio show the stage.
 *
 * @module damage
 */
import { Clock } from "@typeonce/ritmo"
import { Random } from "@typeonce/ritmo-math"

import { type DamageValue, STEP } from "./schema.ts"
import type { VehicleModel } from "./vehicles.ts"

/** A crash's barrier-equivalent speed (m/s) up to which it only scuffs: the covers and clips take it (the crash sounds' first cracks). */
const SCUFF = 3
/**
 * Each model's durability: the barrier-equivalent speed (m/s) of the one crash that destroys it outright, nose first into a wall
 * at 144 km/h for a Panda. The Ape's thin cab gives out first, the Giulia takes a little more than a Panda and the laden truck's
 * frame the most.
 */
export const DURABILITY = {
  panda: 40,
  ape: 26,
  truck: 60,
  carabinieri: 46,
} as const satisfies Record<VehicleModel, number>

/** The stages of damage, in order: no smoke, white smoke, black smoke, fire. */
const DAMAGE_STAGES = ["light", "medium", "severe", "destroyed"] as const
/** One stage of damage. */
export type DamageStage = (typeof DAMAGE_STAGES)[number]
/** The damage from which each stage begins. */
export const STAGE_FROM = {
  light: 0,
  medium: 0.4,
  severe: 0.7,
  destroyed: 1,
} as const satisfies Record<DamageStage, number>

/** The stage of a vehicle with `damage`. */
export const stageOf = (damage: number): DamageStage =>
  damage >= STAGE_FROM.destroyed
    ? "destroyed"
    : damage >= STAGE_FROM.severe
      ? "severe"
      : damage >= STAGE_FROM.medium
        ? "medium"
        : "light"

/** Whether a vehicle with `damage` is destroyed: its engine is dead, it burns until it blows up, and nobody gets in. */
export const destroyed = (damage: number): boolean => damage >= STAGE_FROM.destroyed

/** Whether a vehicle is on fire: destroyed and not yet blown up (`Explode` then leaves a charred shell). */
export const burning = (damage: DamageValue): boolean =>
  destroyed(damage.amount) && !damage.exploded

/**
 * The share of a `model`'s durability a crash at barrier-equivalent `speed` (m/s) uses up: ((speed − SCUFF) / (durability −
 * SCUFF))^1.5, growing faster than the speed but slower than the energy, so a hit at the durability destroys it while one
 * ordinary fast crash rarely skips a stage.
 */
export const crashDamage = (model: VehicleModel, speed: number): number => {
  const past = Math.max(0, speed - SCUFF) / (DURABILITY[model] - SCUFF)
  return past * Math.sqrt(past)
}

/**
 * The barrier-equivalent speeds of two bodies of masses `a` and `b` closing at `closing` (m/s): each one's velocity change over
 * the same restitution as a wall's, so the lighter takes the harder hit (a Panda into the laden truck nearly all of it).
 */
export const barrierSpeeds = (closing: number, a: number, b: number): readonly [number, number] => [
  (closing * b) / (a + b),
  (closing * a) / (a + b),
]

/** A landing on the wheels: the bump stops take this much of the speed into the ground (m/s), so one up to 5 m/s only scuffs. */
const BUMP_STOPS = 2
/** Rolling over, a side or the roof takes blows at this share of the body's speed over the ground, besides the speed it drops at. */
const TUMBLING = 0.5

/**
 * The barrier-equivalent speed of a ground hit on `face` at `speed` into the ground (m/s), by a body moving at `planar` (m/s)
 * over it: a landing on the wheels less what the bump stops take, a side or the roof at least TUMBLING of its speed as it
 * rolls over, the nose or the tail as it struck.
 */
export const groundHit = (
  face: "under" | "roof" | "side" | "front" | "rear",
  speed: number,
  planar: number,
): number =>
  face === "under"
    ? speed - BUMP_STOPS
    : face === "roof" || face === "side"
      ? Math.max(speed, TUMBLING * planar)
      : speed

/** A vehicle as new. */
export const UNDAMAGED: DamageValue = {
  amount: 0,
  crash: 0,
  since: 0,
  struck: -1,
  fuse: 0,
  exploded: false,
}

/** Hits on the same thing within this long of a crash's first one are the same crash: the body still pressing into it, a rebound. */
const ONE_CRASH = Clock.steps(Clock.duration(STEP, 0.2))

/**
 * `damage` after a hit at barrier-equivalent `speed` (m/s) on a `model` at `step` against `struck` (another vehicle's entity id;
 * −1 for a wall or the ground): a new crash costs `crashDamage` at its speed, a further hit of the same crash (on the same thing,
 * within ONE_CRASH) only what its being harder adds, so a crash costs what its hardest hit does however many contacts it makes.
 * A scuff starts no crash, and a destroyed vehicle stays as it is.
 */
export const afterHit = (
  model: VehicleModel,
  damage: DamageValue,
  speed: number,
  step: number,
  struck: number,
): DamageValue => {
  if (speed <= SCUFF || destroyed(damage.amount)) return damage
  const same = damage.crash > 0 && damage.struck === struck && step - damage.since < ONE_CRASH,
    was = same ? damage.crash : 0
  if (speed <= was) return damage
  const amount = Math.min(
    STAGE_FROM.destroyed,
    damage.amount + crashDamage(model, speed) - crashDamage(model, was),
  )
  return { ...damage, amount, crash: speed, since: same ? damage.since : step, struck }
}

/** A worn engine: the vehicle's damage and the seed of its misfires (its entity id, so no two engines misfire together). */
export interface Wear {
  readonly damage: number
  readonly seed: number
}
/** An engine as new. */
export const NEW_ENGINE: Wear = { damage: 0, seed: 0 }

/** Share of its torque a worn engine still gives just short of destroyed, falling in a straight line from all of it as it starts to smoke. */
const LAST_TORQUE = 0.6
/** A misfire cuts the drive for this many steps (a cough); at the brink of destruction this share of them misfire, none until the smoke is black. */
const MISFIRE_STEPS = Clock.steps(Clock.duration(STEP, 0.25))
const MISFIRING = 0.2

/** The share of its full-load torque an engine with `damage` gives when it fires: all of it until it smokes, LAST_TORQUE at the brink. */
export const wornTorque = (damage: number): number =>
  1 -
  (1 - LAST_TORQUE) *
    Math.min(
      1,
      Math.max(0, (damage - STAGE_FROM.medium) / (STAGE_FROM.destroyed - STAGE_FROM.medium)),
    )

/** Whether a worn engine misfires at `step`: from the severe stage on, in a share of 0.25 s windows growing to MISFIRING. */
export const misfires = (wear: Wear, step: number): boolean => {
  const share =
    (MISFIRING * (wear.damage - STAGE_FROM.severe)) / (STAGE_FROM.destroyed - STAGE_FROM.severe)
  return (
    share > 0 &&
    !destroyed(wear.damage) &&
    Random.make(Math.imul(wear.seed + 1, 0x9e3779b1) + Math.floor(step / MISFIRE_STEPS)).next() <
      share
  )
}
