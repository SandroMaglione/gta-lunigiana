/**
 * The mix's one calibration table. Every source level is dB(A) at 1 m when its synth plays at its
 * nominal 0.5 peak (physics.md §8); `rMin` is the source's size, inside which it gets no louder.
 * Losses on the way stay physical (hearing.ts), and `mixGain` compresses only these levels, so a
 * number here moves one kind against the others and nothing else.
 *
 * Flags, by kind: vehicle voices Doppler-shift (water and the beds are static); every one-shot
 * waits its travel time past `DELAY_FROM`; `echoes` says which one-shots answer off rock faces;
 * every positional source is occluded (the listener's own car and the beds are not).
 *
 * @module audio/director/levels
 */
import type { VehicleModel } from "../../sim/vehicles.ts"
import type { Continuous, OneShot } from "../types.ts"

/** A source's calibration: dB(A) at 1 m at the synth's nominal peak, and its size, m. */
export interface Level { readonly db: number; readonly rMin: number }

/** Engines at the redline under full load (pass-by levels, physics.md §8): every engine voice peaks alike, so the model's loudness lives here. */
export const ENGINE = {
  panda: { db: 90, rMin: 2 },
  ape: { db: 92, rMin: 2 },
  truck: { db: 98, rMin: 4 },
  carabinieri: { db: 93, rMin: 2.5 }
} as const satisfies Record<VehicleModel, Level>

/**
 * The listener's own engine from the driver's seat; the voice makes the cabin tone. TUNED: the voice idles 20–22 dB (RMS)
 * under this in the Panda and the Giulia, so the cabin idles near 46–48 dB(A), as a small car's does; at full load it is quieter than a real cabin
 * (the voice's idle-to-redline range is narrower than an engine's), and well under the outside mix (physics.md §10).
 */
export const OWN_ENGINE_DB = 68

/** Every other positional kind. Tyres at their squeal-capable peak; the step is a running step on stone. */
export const LEVELS = {
  tyres: { db: 98, rMin: 2 },
  scrape: { db: 105, rMin: 2 },
  horn: { db: 116, rMin: 2 },
  siren: { db: 117, rMin: 2.5 },
  beeper: { db: 100, rMin: 2 },
  crash: { db: 115, rMin: 2 },
  thud: { db: 85, rMin: 1 },
  // TUNED (estimated, no recording measured): a car slamming its bump stops at 5 m/s, 20 dB under a Panda's crash at that speed (105).
  clunk: { db: 85, rMin: 1.5 },
  door: { db: 82, rMin: 1 },
  ignition: { db: 85, rMin: 1 },
  honk: { db: 116, rMin: 2 },
  step: { db: 62, rMin: 0.5 },
  scream: { db: 100, rMin: 1 },
  shout: { db: 88, rMin: 1 },
  groan: { db: 72, rMin: 1 },
  bird: { db: 85, rMin: 1 },
  bark: { db: 96, rMin: 1 },
  bell: { db: 118, rMin: 5 }
} as const satisfies Record<Exclude<Continuous["kind"] | OneShot["kind"], "engine" | "water" | "wind" | "crickets">, Level>

/**
 * TUNED: a crash's direct sound plays at most this many dB over gain 1, where the master limiter takes
 * a few dB of a 15 m/s crash's peak. Nearer (the listener's own crash comes about 25 dB over), it took
 * 20 dB off the hit and, released 0.25 s later, gave the crunch's sub-hits back nearly as loud as the
 * hit: an echo.
 */
export const CRASH_MOST_DB = 8

/** Water's level comes from places (the line source at the listener); its size is the 1 m that level is clamped at. */
export const WATER_R_MIN = 1

/** The beds, dB(A) at the listener at full strength / density (the voices scale themselves below that). */
export const BEDS = { wind: 60, crickets: 42 } as const

/** The wind voice (body and leaves) follows strength², so its level falls 40 dB per decade of strength. */
export const windDb = (strength: number): number => BEDS.wind + 40 * Math.log10(Math.max(0.05, strength))

/** Source heights above their ground, m: a vehicle's body, a person (feet to mouth), and water lifted out of its carved bed. */
export const HEIGHT = { vehicle: 0.8, person: 1, water: 2 } as const

/** At most this many voices of each kind play; the loudest at the listener win. */
export const CAPS = {
  engine: 8, tyres: 4, scrape: 2, horn: 3, siren: 2, beeper: 2, water: 4, wind: 1, crickets: 1
} as const satisfies Record<Continuous["kind"], number>

/** A voice that played last frame keeps its place under the cap until a newcomer is this many dB louder: near-equals do not swap every frame. */
export const KEEP_DB = 3

/** At most this many bell towers ring the hour, the loudest at the listener: up to a dozen are within earshot of a hillside, far under the nearest. */
export const TOWERS = 4

/** One-shots nearer than this (m) play at once: a lag under ~120 ms goes unnoticed (physics.md §6). */
export const DELAY_FROM = 40

/**
 * The reverb send, on a mixer whose full send returns 12 dB under dry. None in the open, where nothing
 * scatters sound back (an open field's late energy is 15 dB and more under the direct sound), nor in
 * the woods (a known limit: docs/audio.md). In a street, street² of `db` dB at `ref` m (the tail
 * leaks out of every gap in the facades), 3 dB wetter per doubling of distance from `near` to `far` m:
 * along a street the reverberant field falls like a line source's, the direct sound like a point's
 * (Thomas et al. 2013). `cabin`× inside a vehicle, whose own noise masks the tail.
 */
export const REVERB = { db: 8, ref: 10, near: 2.5, far: 40, cabin: 0.25 } as const

/** An echo plays at least this many dB under the direct sound: a rock face's own reflection loss (places.ts). */
export const ECHO_MIN_DB = 10

/** Loud impulsive one-shots answer off rock faces: a crash from 6 m/s, honks, barks, voices and bells (physics.md §7). */
export const echoes = (sound: OneShot): boolean =>
  sound.kind === "crash" ? sound.speed >= 6 : sound.kind === "honk" || sound.kind === "bark" || sound.kind === "shout" || sound.kind === "scream" || sound.kind === "bell"
