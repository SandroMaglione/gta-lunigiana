/**
 * The synths for everything in the valley that is not a vehicle: people (footsteps, voices),
 * nature (wind, crickets, birds, dogs, bells), water, and the weather (rain, its drumming on the
 * roof of the car the listener sits in, thunder). The speaker merges these tables with the
 * vehicles' into its `Voices` and `Shots`.
 *
 * @module audio/synth/world
 */
import type { Shots, Voices } from "../types.ts"
import { bark, bell, bird, crickets, wind } from "./nature.ts"
import { rain, roof } from "./rain.ts"
import { step } from "./steps.ts"
import { thunder } from "./thunder.ts"
import { groan, scream, shout } from "./voices.ts"
import { water } from "./water.ts"

/** Continuous world sounds. */
export const WORLD_VOICES = { water, wind, crickets, rain, roof } satisfies Pick<Voices, "water" | "wind" | "crickets" | "rain" | "roof">

/** One-shot world sounds. */
export const WORLD_SHOTS = { step, scream, shout, groan, bell, bird, bark, thunder } satisfies Pick<Shots, "step" | "scream" | "shout" | "groan" | "bell" | "bird" | "bark" | "thunder">
