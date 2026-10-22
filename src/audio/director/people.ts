/**
 * People on foot: footsteps on whatever is underfoot, at the cadence of their speed, and their
 * voices when they take fright. Steps follow the distance a person actually moved (positions, not
 * velocity), so a teleport or getting out of a car fires no burst; the listener's own steps come
 * from right under the ears.
 *
 * @module audio/director/people
 */
import { surfaceAt } from "../../sim/map/surface.ts"
import { hash01 } from "../../tools/geometry.ts"
import { EAR_HEIGHT } from "../acoustics.ts"
import { stepRate, WALK_DB } from "../synth/steps.ts"
import type { HeardPerson } from "../types.ts"
import { type Frame, groundAt } from "./frame.ts"
import { HEIGHT, LEVELS } from "./levels.ts"

/** A frame's move longer than this (m) is a jump, not walking. */
const JUMP = 3
/** Running from this speed, m/s (it also sets the dogs off). */
export const RUN = 3.5
/** The cadence of slower movers is taken at this speed, m/s (shuffling). */
const SHUFFLE = 0.5
/** A carjacked driver this near the listener (m) shouts at them; one voice cue per person per `CUE_GAP` s. */
const SHOUT_NEAR = 15, CUE_GAP = 4
/** Under this voice a fleeing pedestrian screams, else shouts. */
const SCREAMER = 0.45

interface Walker {
  x: number
  y: number
  /** Steps due, as a fraction of a stride: one plays at each whole. */
  phase: number
  fleeing: boolean
  /** When the last voice cue played. */
  cue: number
  seen: number
}

/** The people part of the director, with a step phase and the last mood of everyone in earshot. */
export const makePeople = () => {
  const walkers = new Map<number, Walker>()
  let frames = 0

  return {
    hear: (frame: Frame): void => {
      const { heard, ears, now } = frame
      frames++
      const cue = (p: HeardPerson, walker: Walker, kind: "scream" | "shout") => {
        if (now - walker.cue < CUE_GAP) return
        walker.cue = now
        frame.play({ kind, voice: hash01(p.id) }, frame.path(`person:${p.id}`, { x: p.x, y: p.y, z: groundAt(p.x, p.y) + HEIGHT.person }, LEVELS[kind]))
      }
      for (const p of heard.people) {
        const walker = walkers.get(p.id)
        if (walker === undefined) {
          const fresh = { x: p.x, y: p.y, phase: 0, fleeing: p.fleeing, cue: -Infinity, seen: frames }
          walkers.set(p.id, fresh)
          // Already running off when first heard: the driver just pulled out of their car.
          if (p.fleeing && Math.hypot(p.x - ears.x, p.y - ears.y) < SHOUT_NEAR) cue(p, fresh, "shout")
          continue
        }
        const moved = Math.hypot(p.x - walker.x, p.y - walker.y)
        walker.x = p.x
        walker.y = p.y
        walker.seen = frames
        if (p.fleeing && !walker.fleeing) cue(p, walker, hash01(p.id) < SCREAMER ? "scream" : "shout")
        walker.fleeing = p.fleeing
        if (p.down || moved > JUMP) continue
        const speed = Math.hypot(p.vx, p.vy)
        walker.phase += (moved * stepRate(speed)) / Math.max(SHUFFLE, speed)
        if (walker.phase < 1) continue
        walker.phase %= 1
        const run = speed > RUN
        const at = p.player ? { x: ears.x, y: ears.y, z: ears.z - EAR_HEIGHT } : { x: p.x, y: p.y, z: groundAt(p.x, p.y) + HEIGHT.person }
        const sound = { kind: "step", surface: surfaceAt(p.x, p.y), run } as const
        frame.play(sound, frame.path(p.player ? undefined : `person:${p.id}`, at, LEVELS.step, { quiet: run ? 0 : WALK_DB }))
      }
      // Gone (despawned, or the listener in a car): a person seen again starts afresh.
      for (const [id, walker] of walkers) if (walker.seen !== frames) walkers.delete(id)
    }
  }
}
