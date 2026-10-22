/**
 * The synths for everything in the valley that is not a vehicle: people (footsteps, speech,
 * voices), animals (cows, pigs, cats, dogs), nature (wind, crickets, birds, farm dogs, bells) and
 * water. The speaker merges these tables with the vehicles' into its `Voices` and `Shots`.
 *
 * @module audio/synth/world
 */
import { speechShot } from "../speech/index.ts"
import type { Shots, Voices } from "../types.ts"
import { grunt, hiss, meow, moo, squeal, yelp } from "./animals.ts"
import { bark, bell, bird, crickets, wind } from "./nature.ts"
import { step } from "./steps.ts"
import { groan, scream } from "./voices.ts"
import { water } from "./water.ts"

/** Continuous world sounds. */
export const WORLD_VOICES = { water, wind, crickets } satisfies Pick<Voices, "water" | "wind" | "crickets">

/** One-shot world sounds: a line said and a line yelled play the same speech, quiet and loud. */
export const WORLD_SHOTS = {
  step, talk: speechShot(false), yell: speechShot(true), scream, groan, bell, bird, bark, moo, grunt, squeal, yelp, meow, hiss
} satisfies Pick<Shots, "step" | "talk" | "yell" | "scream" | "groan" | "bell" | "bird" | "bark" | "moo" | "grunt" | "squeal" | "yelp" | "meow" | "hiss">
