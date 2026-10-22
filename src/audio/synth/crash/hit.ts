/**
 * What a crash is before it is heard (physics.md §1–3; critique §4.1, §4.6, §5.2): the energy it
 * dissipates and the one level law that follows from it, how the crush splits between what met, the
 * crush pulse, the main block and its sub-hits, and how long the aftermath lasts. Every random draw of
 * the timing is here; the level depends on the params alone, so masking can count it (`levelOf`).
 *
 * @module audio/synth/crash/hit
 */
import { VEHICLES, type VehicleModel } from "../../../sim/vehicles.ts"
import { smoothstep } from "../../buffers.ts"
import type { Body, Material, OneShot, Surface, Zone } from "../../types.ts"
import { BODIES, type BodySpec } from "./bodies.ts"
import { between } from "./dsp.ts"
import { TARGETS } from "./targets.ts"

/** A crash's params. */
export type Crash = Extract<OneShot, { readonly kind: "crash" }>

/** Coefficient of restitution at closing speed `v` m/s: Cipriani 2002's fit to 7 m/s (0.46 at 1 m/s, 0.26 at 5), then 0.1 (physics.md §1.2). */
const restitution = (v: number): number => (v >= 7 ? 0.1 : 0.55605 * Math.exp(-0.198 * v + 0.01533 * v * v - 0.00122 * v ** 3))

/** The reference crash's dissipated energy (a Panda nose-first into masonry at 15 m/s, ½·μ·v²·(1 − e²), μ in Panda masses): it peaks at the nominal 0.5. */
const REFERENCE = 0.5 * 15 ** 2 * (1 - 0.1 ** 2)
/** Past +6 dB the front is used up: the main block stops growing, and length, sub-hits and debris carry the severity (critique §4.6). */
const CAP_DB = 6
/** The quietest level a crash is rendered at, dB re the reference. */
const FLOOR_DB = -40

/** `model`'s mass in the crash laws' unit, the Panda's (the reference crash's car). */
const pandas = (model: VehicleModel): number => VEHICLES[model].mass / VEHICLES.panda.mass

/** The crash's mass behind it (the sim's tonnes) in Panda masses, held to what two vehicles can be: an Ape–Ape pair 0.19, a lone laden truck 25.6. */
const massOf = (sound: Crash): number => Math.min(30, Math.max(0.1, (sound.mass * 1000) / VEHICLES.panda.mass))

/** The car's share of the crush against something of `stiffness` (Infinity: rigid), springs in series: an earth bank takes 70 %, a tree 40 %. */
const shareOf = (car: number, stiffness: number): number => (stiffness === Infinity ? 1 : stiffness / (car + stiffness))

/**
 * The energy the crunch radiates from, re the reference: each body's crush, ½·share·μ·v²·(1 − e²) (all of
 * it against a wall but what the wall itself takes; two cars split it by compliance), counted at 1/√ of the
 * body's mass in Panda masses. A heavier vehicle's extra mass is mostly frame, running gear and load,
 * which do not crumple and ring like a light car's thin skins: the laden truck (25.6 Pandas) plays
 * 7 dB over a Panda at the same speed, not 14, so its 2 m/s nudge stays a nudge. (The √ also gives back
 * the masses the crashes were tuned with: Ape 0.62, Giulia 1.25, truck 5.1, where the old table had 0.6,
 * 1.3 and 4.)
 */
const severityOf = (sound: Crash): number => {
  const v = Math.max(0, sound.speed), e = restitution(v)
  const loud = splitOf(sound).reduce((sum, { body, share }) => sum + share / Math.sqrt(pandas(body.model)), 0)
  return (0.5 * massOf(sound) * v * v * (1 - e * e) * loud) / REFERENCE
}

/** The crash's level, dB re the reference crash: +6.5 dB per doubling of speed, 10·log10 μ per pair (Panda–Panda −3 dB), capped at +6. */
export const levelOf = (sound: Crash): number => Math.min(CAP_DB, Math.max(FLOOR_DB, 10 * Math.log10(severityOf(sound))))

/** One body as it crushes. */
export interface Crushed {
  readonly model: VehicleModel
  readonly spec: BodySpec
  readonly zone: Zone
  /** Its part of the crunch: all of it against a wall, k_other / (k + k_other) of two cars' (the softer crushes more). */
  readonly part: number
  /** The barrier speed that would crush it as much, m/s: what its damage thresholds read; `worn`, the hardest earlier hit's on this zone (what broke then stays broken). */
  readonly speed: number
  readonly worn: number
  /** Its velocity change, m/s: what shakes its load loose. */
  readonly dv: number
  /** How long its side of the first contact lasts, s: a PP cover over foam 3–8 ms, bare steel under 1 ms. */
  readonly contact: number
}

/** A secondary contact: when (s), how hard (power re the main block) and how long (s). */
export interface SubHit { readonly at: number; readonly level: number; readonly length: number }

/** Everything the layers render from. */
export interface Hit {
  /** Closing speed, m/s, and the speed a Panda would hit a wall at with the same energy (uncapped: past the level cap, it still lengthens the block and the tail). */
  readonly speed: number
  readonly equivalent: number
  /** The bodies: the listener's car first, else the Impact's `car` (query order, not necessarily the one that struck). */
  readonly bodies: ReadonlyArray<Crushed>
  readonly material: Material | undefined
  /** The crush pulse T, s: densest crunch, its rate falling as cos(πt/T) to maximum crush at T/2. */
  readonly pulse: number
  /** The contact's rise, s, its duration (s: the first event's brightness), and the main block's length (s: within a few dB of its start). */
  readonly rise: number
  readonly contact: number
  readonly block: number
  readonly subHits: ReadonlyArray<SubHit>
  /** How long the aftermath lasts past the block, s, and the whole render (at most 4 s: a struck tree rustles, a guard rail rings on). */
  readonly tail: number
  readonly length: number
  readonly surface: Surface
  readonly inside: boolean
}

/** A body's side of the contact: its bumper on its front and rear, its door skin on a side; its floor landing on the tyres and bump stops is as dull as a PP cover. */
const contactOf = (spec: BodySpec, zone: Zone, random: () => number): number =>
  zone === "side" ? between(random, 0.0006, 0.0015) : zone === "under" || spec.bumper === "plastic" ? between(random, 0.003, 0.008) : between(random, 0.0003, 0.001)

/**
 * The bodies of `sound` (`body` first), each with its part of the crunch (all of it against a wall; two cars split it by compliance),
 * its share of the crush, and the barrier speed that would crush it as much.
 */
const splitOf = (sound: Crash): ReadonlyArray<{ readonly body: Body; readonly part: number; readonly share: number; readonly speed: number }> => {
  const v = Math.max(0, sound.speed), mu = massOf(sound), a = BODIES[sound.body.model]
  const crushes = (body: Body, part: number, share: number) => ({ body, part, share, speed: v * Math.sqrt((share * mu) / pandas(body.model)) })
  // The car takes all of a wall's crunch (the wall's share is silent, or its own layer).
  if (sound.against.kind === "wall") return [crushes(sound.body, 1, shareOf(a.stiffness, TARGETS[sound.against.material].stiffness))]
  const b = BODIES[sound.against.body.model], mine = b.stiffness / (a.stiffness + b.stiffness)
  return [crushes(sound.body, mine, mine), crushes(sound.against.body, 1 - mine, 1 - mine)]
}

/** Each body's barrier-equivalent speed, m/s (`body` first): what its damage thresholds read, so the director can remember what broke. */
export const crushSpeeds = (sound: Crash): ReadonlyArray<number> => splitOf(sound).map(({ speed }) => speed)

/** The crash `sound` describes, its timing drawn from `random`. */
export const hitOf = (sound: Crash, random: () => number): Hit => {
  const v = Math.max(0, sound.speed), e = restitution(v), mu = massOf(sound)
  const a = BODIES[sound.body.model], target = sound.against.kind === "wall" ? TARGETS[sound.against.material] : undefined
  const kOther = sound.against.kind === "car" ? BODIES[sound.against.body.model].stiffness : target!.stiffness
  const bodies = splitOf(sound).map(({ body, part, speed }): Crushed => {
    const spec = BODIES[body.model]
    return {
      model: body.model, spec, zone: body.zone, part, speed, worn: body.worn ?? 0,
      dv: (1 + e) * v * Math.min(1, mu / pandas(body.model)), contact: contactOf(spec, body.zone, random)
    }
  })
  const equivalent = 15 * Math.sqrt(severityOf(sound)), side = bodies.some((body) => body.zone === "side")
  // Springs in series: T = π·√(μ/k) scaled so a Panda into a wall lasts ~0.1 s (barrier pulses 91–106 ms); ±15 % across the pairs.
  const k = kOther === Infinity ? a.stiffness : (a.stiffness * kOther) / (a.stiffness + kOther)
  const pulse = Math.min(0.25, 0.1 * Math.sqrt(mu / k)) * between(random, 0.9, 1.1)
  // Past the level cap (equivalent ≈ 30 m/s) the severity goes on growing in time: a longer block and tail, more and later sub-hits.
  const crumples = smoothstep(2.5, 6, equivalent), wreck = smoothstep(25, 60, equivalent)
  // The main block: a bump is over in 60–75 ms, a crash holds 150–400 ms (rebound, yaw into a second contact, stiff parts ringing).
  const block = Math.max((0.06 + 0.12 * crumples + 0.12 * smoothstep(6, 30, equivalent) + 0.08 * wreck) * (side ? 1.2 : 1) * between(random, 0.85, 1.2), 0.06 + 1.2 * pulse * crumples)
  // 1–3 sub-hits at +80…600 ms, more for side hits and higher speeds; a wreck tumbles on to 1.2 s.
  const subHits: Array<SubHit> = []
  if (equivalent >= 4) {
    const count = 1 + Number(random() < 0.3 + 0.3 * Number(side) + 0.3 * smoothstep(10, 25, equivalent)) + Number(random() < 0.1 + 0.3 * Number(side) + 0.4 * smoothstep(15, 35, equivalent) + 0.3 * wreck)
    for (let i = 0, at = between(random, 0.08, 0.3); i < count && at < 0.6 + 0.6 * wreck; i++, at += between(random, 0.1, 0.3) * (1 + wreck)) {
      subHits.push({ at, level: between(random, 0.3, 0.8), length: between(random, 0.04, 0.12) })
    }
  }
  const tail = 0.5 + 2 * smoothstep(3, 30, equivalent) + wreck
  const theirs = bodies[1]?.contact ?? between(random, target!.contact[0], target!.contact[1])
  return {
    speed: v, equivalent, bodies, material: sound.against.kind === "wall" ? sound.against.material : undefined, pulse,
    rise: between(random, 0.011, 0.02) * (target?.soft ?? 1) * (side ? 0.9 : 1),
    // Springs in series again: the softer side sets the contact's length; harder hits are a little shorter (Hertz, τ ∝ v^−1/5).
    contact: Math.hypot(bodies[0]!.contact, theirs) * Math.max(0.6, Math.min(1.3, (Math.max(v, 1) / 5) ** -0.2)),
    block, subHits, tail, length: Math.min(4, block + tail + 0.8 + (target?.ringing ?? 0)), surface: sound.surface, inside: sound.inside
  }
}
