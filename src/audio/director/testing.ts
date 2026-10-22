/**
 * The director tests' kit: real map spots, a director on a recording speaker with a seeded random
 * source and a clock the test advances, and the plain `Heard` data the tests stage (a vehicle, a
 * person, a frame of the world, a wall hit). Imported only by tests.
 *
 * The spots were found by probing the map: a treeless meadow on Monte dei Bianchi clear for 300 m to
 * the south and screen-right, a lane at Pian del Molino with a 10.7 m building 30 m east and open
 * ground 30 m north-west, a wooded ridge above Aiola (900 m) with no water within 400 m, Monzone
 * station 68 m from the Torrente Lucido, a street 50 m from Monzone Alto's tower, the woods above
 * Isolano, in earshot of eleven bell towers, and the street of Monzone where the game starts, 50 m
 * from the Lucido behind the houses; a bank 15 m from the Lucido with nothing in the way, the two
 * flanks of Monte San Giorgio, 400 m apart (the west one in the open under a rock face), Gragnola's
 * centre, walled in on every side, the rendered house wall on Via Cesare Battisti where
 * src/sim/index.test.ts drives a Panda, on its cobbles, and the riverbed's gravel 16 m under a
 * bridge's asphalt deck.
 *
 * @module audio/director/testing
 */
import { groundZ } from "../../sim/map/ground.ts"
import { VEHICLES, type VehicleModel } from "../../sim/vehicles.ts"
import { screenAxes } from "../../sim/view.ts"
import type { Continuous, Happening, Heard, HeardPerson, HeardVehicle, OneShot, Placement, Speaker, Zone } from "../types.ts"
import { makeDirector, type WallClock } from "./index.ts"

/** The open meadow, the lane at Pian del Molino, behind its building and in the open beside it. */
export const MEADOW = { x: -329, y: 1078 }, STREET = { x: -916.6, y: 1706.8 }, BEHIND = { x: -886.6, y: 1706.8 }, OPEN = { x: -937.8, y: 1728 }
/** The wooded ridge, Monzone station, the street under Monzone Alto's tower. */
export const RIDGE = { x: 1600, y: -494.5 }, STATION = { x: -494, y: 437 }, BELFRY = { x: -41.8, y: -306.6 }
/** The woods above Isolano, Monzone's street where the game starts, the bank of the Lucido. */
export const HILLSIDE = { x: -950, y: 71 }, SPAWN = { x: -412.6, y: 437.8 }, BANK = { x: -418.6, y: 395.8 }
/** Monte San Giorgio's flanks, the house wall on Via Cesare Battisti. */
export const WEST_FLANK = { x: 785.7, y: -563.4 }, EAST_FLANK = { x: 1185.7, y: -563.4 }, HOUSE_WALL = { x: -429.85, y: 452.9 }
/** Gragnola's walled centre, the riverbed under a bridge. */
export const GRAGNOLA = { x: -1751.2, y: 3360.4 }, UNDER_BRIDGE = { x: -1190.3, y: 1273.1 }
/** One frame at 60 Hz, s. */
export const FRAME = 1 / 60
/** Screen-right on the ground, with the view in its home seat. */
export const SCREEN_RIGHT = screenAxes(0).right
/** Due south on the ground. */
export const SOUTH = { x: 0, y: -1 }
/** A Panda's mass, t. */
export const PANDA = VEHICLES.panda.mass / 1000
/** A Panda revving at the redline under full load. */
export const FULL = { rpm: VEHICLES.panda.engine.redline, load: 1 } as const

/** A small deterministic random source. */
const seeded = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)

/** A one-shot played at speaker time `t`, `delay` s ahead. */
interface Played { readonly sound: OneShot; readonly at: Placement; readonly delay: number; readonly t: number }

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

/** Vehicle `id`, idling on its wheels at `at`. */
export const car = (id: number, model: VehicleModel, at: { readonly x: number; readonly y: number }, more: Partial<HeardVehicle> = {}): HeardVehicle => ({
  id, model, x: at.x, y: at.y, z: groundZ(at.x, at.y) + VEHICLES[model].cg, angle: 0, vx: 0, vy: 0, rpm: VEHICLES[model].engine.idle, load: 0,
  wheelsDown: true, hullDown: false, running: true, mine: false, damage: 0, misfire: false, burning: false, ...more
})
/** Person `id` standing at `at`. */
export const person = (id: number, at: { readonly x: number; readonly y: number }, more: Partial<HeardPerson> = {}): HeardPerson => ({
  id, x: at.x, y: at.y, vx: 0, vy: 0, player: false, fleeing: false, down: false, ...more
})
/** A frame of the world heard at `at`, on foot or sitting in `car`. */
export const world = (at: { readonly x: number; readonly y: number }, more: Partial<Heard> = {}, car?: number): Heard => ({
  listener: { x: at.x, y: at.y, vx: 0, vy: 0, car, turns: 0 }, vehicles: [], people: [], happenings: [], horn: false, ...more
})
/** The point `metres` from `from` along `dir` (screen-right by default). */
export const away = (from: { readonly x: number; readonly y: number }, metres: number, dir: { readonly x: number; readonly y: number } = SCREEN_RIGHT) =>
  ({ x: from.x + metres * dir.x, y: from.y + metres * dir.y })
/** Car `car`, a Panda, hitting a wall at `at` on its `zone` (nose first). */
export const wallHit = (at: { readonly x: number; readonly y: number }, speed: number, car = 1, zone: Zone = "front"): Happening => ({
  kind: "impact", hit: "wall", x: at.x, y: at.y, speed, mass: PANDA, car, body: { model: "panda", zone }
})
