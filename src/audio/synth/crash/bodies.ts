/**
 * The game's vehicles as crash sound sources (synthesis.md §6.5; critique §5.2; physics.md §4.8).
 * Masses are the sim's (`VEHICLES`); stiffnesses, damping and the rest are the research's estimates.
 *
 * @module audio/synth/crash/bodies
 */
import type { VehicleModel } from "../../../sim/vehicles.ts"
import type { Spectrum } from "./dsp.ts"

/** One model's crash character. */
export interface BodySpec {
  /** Crush stiffness of its structure re the Panda's: the softer body of a pair takes more of the crush (share = k_other / (k + k_other)). */
  readonly stiffness: number
  /** Its crunch's offset from the common spectrum, dB per octave band 31.5 Hz–16 kHz. */
  readonly colour: Spectrum
  /** Loss factor range of the crushed body's dense modal field (T60 = 2.2 / (f·η)). */
  readonly field: readonly [number, number]
  /** Long partials (stiff parts ringing through the crunch): how many, where (Hz), how long they ring (T60, s). */
  readonly partials: {
    readonly count: readonly [number, number]
    readonly hz: readonly [number, number]
    readonly t60: readonly [number, number]
  }
  /** Panel modes a buckle excites (Hz) and their loss factor. */
  readonly panels: readonly [number, number]
  readonly panelEta: number
  /** Its front and rear: a PP cover over foam (a dull 3–8 ms contact, a thock, cracks and clip pops) or bare steel (0.3–1 ms, a clang). */
  readonly bumper: "plastic" | "steel"
  /** A steel bumper's clang, amplitude re the crunch (0 for a PP cover). */
  readonly clang: number
  /** Side window sill, m: how far its glass falls. */
  readonly sill: number
  readonly airbag: boolean
  /** How much loose stuff rattles after a hit (1: a car's trim). */
  readonly rattle: number
}

export const BODIES = {
  // The reference crunch: steel 0.7–0.8 mm, plastic trim, hubcaps.
  panda: {
    stiffness: 1,
    colour: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    field: [0.025, 0.045],
    partials: { count: [1, 2], hz: [700, 3500], t60: [0.3, 0.8] },
    panels: [350, 3000],
    panelEta: 0.012,
    bumper: "plastic",
    clang: 0,
    sill: 0.95,
    airbag: true,
    rattle: 1,
  },
  // A thin, barely damped cab with no crush structure: tinny, rattly, ringing longer, little boom.
  ape: {
    stiffness: 0.5,
    colour: [-7, -6, -3, -1, 0, 1, 2, 2, 1, 0],
    field: [0.015, 0.03],
    partials: { count: [2, 3], hz: [800, 4300], t60: [0.4, 0.9] },
    panels: [450, 3800],
    panelEta: 0.007,
    bumper: "steel",
    clang: 0.06,
    sill: 0.9,
    airbag: false,
    rattle: 2.5,
  },
  // Steel cab 1.0–1.5 mm, a heavy steel bumper bar on a ladder frame (its clang the truck's identity, clear of the crunch), marble in the bed: deeper, heavy clanks.
  truck: {
    stiffness: 3,
    colour: [1, 2, 2, 1, 0, -1, -1, -2, -3, -3],
    field: [0.02, 0.04],
    partials: { count: [1, 2], hz: [600, 2500], t60: [0.35, 0.9] },
    panels: [250, 2200],
    panelEta: 0.006,
    bumper: "steel",
    clang: 0.6,
    sill: 1.5,
    airbag: true,
    rattle: 1.5,
  },
  // Aluminium doors and wings: brighter and louder per newton; a light bar; laminated windscreen.
  carabinieri: {
    stiffness: 1.3,
    colour: [0, 0, 0, 0, 0, 0, 1, 2, 2, 1],
    field: [0.025, 0.045],
    partials: { count: [1, 2], hz: [900, 4300], t60: [0.3, 0.7] },
    panels: [400, 3500],
    panelEta: 0.012,
    bumper: "plastic",
    clang: 0,
    sill: 1,
    airbag: true,
    rattle: 1,
  },
} as const satisfies Record<VehicleModel, BodySpec>
