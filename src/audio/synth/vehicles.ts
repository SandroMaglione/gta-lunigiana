/**
 * Every vehicle sound kind and its synth: the speaker's `Voices` and `Shots` tables spread these in
 * beside the world's, so a vehicle kind without a synth fails to compile.
 *
 * @module audio/synth/vehicles
 */
import type { Shots, Voices } from "../types.ts"
import { crash } from "./crash/index.ts"
import { engine } from "./engine.ts"
import { explosion } from "./explosion.ts"
import { fire } from "./fire.ts"
import { beeper, honk, horn, siren } from "./horns.ts"
import { clunk, door, ignition, thud } from "./impacts.ts"
import { scrape } from "./scrape.ts"
import { tyres } from "./tyres.ts"

/** Continuous vehicle sounds. */
export const VEHICLE_VOICES = { engine, tyres, scrape, horn, siren, beeper, fire } satisfies Pick<
  Voices,
  "engine" | "tyres" | "scrape" | "horn" | "siren" | "beeper" | "fire"
>

/** One-shot vehicle sounds. */
export const VEHICLE_SHOTS = { crash, explosion, thud, clunk, door, ignition, honk } satisfies Pick<
  Shots,
  "crash" | "explosion" | "thud" | "clunk" | "door" | "ignition" | "honk"
>
