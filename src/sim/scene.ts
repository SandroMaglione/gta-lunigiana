/**
 * Scenes on Via Cesare Battisti for the reaction tests: spots along its lane, walkers on its verges, and a scene run on a seed of
 * the test's choosing, so a rule that rolls dice is checked over several rolls rather than the one seed 1 happens to give.
 *
 * @module scene
 */
import assert from "node:assert/strict"

import { Ops, Random, type Vec2 } from "@typeonce/ritmo-math"

import { Game, type Look, type Mood, Rng } from "./index.ts"
import { laneOf, lanePoint, laneSide, roadOf, walkSide } from "./route.ts"
import { pedestrian } from "./spawning.ts"
import { BATTISTI, LOOK, start, walkClear } from "./testing.ts"

// Via Cesare Battisti by the Carabinieri: ~40 m of straight street, both verges walkable.
/** Battisti's lane, eastbound. */
export const lane = laneOf(BATTISTI.edge, BATTISTI.forward)
/** The lane's heading, rad. */
export const HEADING = Ops.atan2(lane.dy, lane.dx)
/** The walkers' verge: this many metres right of the centreline. */
export const VERGE = walkSide(roadOf(BATTISTI.edge))
/** A Panda's lane's offset from the centreline. */
export const LANE = laneSide(BATTISTI, "panda")
/** How far along the lane `p` lies, m. */
export const along = (p: Vec2.Vec2) => (p.x - lane.x) * lane.dx + (p.y - lane.y) * lane.dy
/** A pose `at` m along the lane, `side` m right of its centreline, heading along it (or back, when `back`). */
export const spot = (at: number, side: number, back = false) => ({ ...lanePoint(lane, at, side), angle: HEADING + (back ? Math.PI : 0) })
/** The player out of the way: 100 m off, standing still. */
export const away = { x: lanePoint(lane, 20, 0).x + 100, y: lanePoint(lane, 20, 0).y, angle: 0 }
/** Nobody else comes: the scenes play out without traffic or passers-by. */
export const ALONE = { alone: true } as const
/** A child's look. */
export const KID: Look = { ...LOOK, age: "kid", height: 1.2, outfit: "shorts" }
/** An old woman's look. */
export const ELDER: Look = { ...LOOK, age: "elder", female: true, height: 1.6, outfit: "skirt", hairdo: "bun" }

/** Someone `at` m along the lane on the right verge (`side` −1: the left), walking with the lane (or against it, when `back`). */
export const walker = (at: number, options: { side?: number; back?: boolean; look?: Look; mood?: Mood; until?: number; fx?: number; fy?: number } = {}) => {
  const side = (options.side ?? 1) * VERGE, back = options.back ?? false
  const pose = spot(at, side, back)
  assert.ok(walkClear(pose), `a clear verge at ${at} m`)
  return pedestrian(options.look ?? LOOK, pose, { ...BATTISTI, forward: back ? !BATTISTI.forward : BATTISTI.forward, side: back ? -side : side }, {
    mood: options.mood ?? "walk", until: options.until ?? 0, fx: options.fx ?? 0, fy: options.fy ?? 0
  })
}

/** Sets the world's random state to `seed`'s. */
const reseed = (seed: number) =>
  Game.Schedule(Game.System("Test/Reseed", { resources: { rng: Game.System.writeResource(Rng) } }, ({ resources }) => resources.rng.set(Random.seed(seed))))

/** `start` on `staging`, drawing its dice from `seed` once the cast is placed. */
export const seeded = (seed: number, staging: NonNullable<Parameters<typeof start>[1]>, options: Parameters<typeof start>[2] = {}) => {
  const run = start([], staging, options)
  assert.ok(run.runtime.tick(reseed(seed)).ok)
  return run
}
