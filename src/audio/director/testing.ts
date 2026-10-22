/**
 * Test helpers for the director: a recording speaker on a test clock, a seeded random source, and
 * `Heard` frames built from people, animals and a listener. Shared by the director's test files.
 *
 * @module audio/director/testing
 */
import { screenAxes } from "../../sim/view.ts"
import type { Continuous, Heard, HeardAnimal, HeardPerson, OneShot, Placement, Speaker } from "../types.ts"
import { seeded } from "../speech/testing.ts"
import { makeDirector, type WallClock } from "./index.ts"

/** One animation frame, s. */
export const FRAME = 1 / 60

// The speech tests' mulberry32: a plain LCG's consecutive draws correlate, so a rare event's draw fixed the line drawn next.
export { seeded }

/** A one-shot played at speaker time `t`, `delay` s ahead. */
export interface Played { readonly sound: OneShot; readonly at: Placement; readonly delay: number; readonly t: number }

/** A director on a recording speaker whose clock (from `t`; 0 is no context yet) the test advances by `dt` per `hear`. */
export const rig = (clock: () => WallClock = () => ({ hour: 10, minute: 10, second: 0 }), t = 1) => {
  let holding = new Map<string, { readonly sound: Continuous; readonly at: Placement }>()
  let held = holding
  const plays: Array<Played> = []
  const speaker: Speaker = {
    now: () => t,
    hold: (key, sound, at) => void holding.set(key, { sound, at }),
    play: (sound, at, delay) => void plays.push({ sound, at, delay, t }),
    flush: () => {
      held = holding
      holding = new Map()
    }
  }
  const director = makeDirector(speaker, { random: seeded(7), clock })
  return {
    plays,
    /** What the last frame held. */
    held: () => held,
    hear: (heard: Heard, frames = 1, dt = FRAME) => {
      for (let i = 0; i < frames; i++) {
        t += dt
        director.hear(heard)
      }
    },
    /** Plays of `kind` since it was last taken. */
    take: (kind: OneShot["kind"]): Array<Played> => {
      const taken = plays.filter((p) => p.sound.kind === kind)
      plays.splice(0, plays.length, ...plays.filter((p) => p.sound.kind !== kind))
      return taken
    }
  }
}

/** Screen-right on the ground, with the view in its home seat. */
export const SCREEN_RIGHT = screenAxes(0).right

/** A point `metres` from `from` along `dir` (screen-right by default). */
export const away = (from: { readonly x: number; readonly y: number }, metres: number, dir: { readonly x: number; readonly y: number } = SCREEN_RIGHT) =>
  ({ x: from.x + metres * dir.x, y: from.y + metres * dir.y })

/** Person `id` standing at `at`: a man, walking. */
export const person = (id: number, at: { readonly x: number; readonly y: number }, more: Partial<HeardPerson> = {}): HeardPerson => ({
  id, x: at.x, y: at.y, vx: 0, vy: 0, player: false, age: "adult", female: false, mood: "walk", fx: at.x, fy: at.y, down: false, dead: false, ...more
})

/** Animal `id` of `species`, idle at `at`, of its species' usual size. */
export const animal = (id: number, species: HeardAnimal["species"], at: { readonly x: number; readonly y: number }, more: Partial<HeardAnimal> = {}): HeardAnimal => ({
  id, species, x: at.x, y: at.y, vx: 0, vy: 0, size: 1, mood: "idle", down: false, dead: false, ...more
})

/** What the listener at `at` (in car `car`) hears: nothing but `more`. */
export const world = (at: { readonly x: number; readonly y: number }, more: Partial<Heard> = {}, car?: number): Heard => ({
  listener: { x: at.x, y: at.y, vx: 0, vy: 0, car, turns: 0 }, vehicles: [], people: [], animals: [], happenings: [], horn: false, ...more
})
