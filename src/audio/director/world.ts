/**
 * The valley around the listener: the wind and cricket beds, running water, birds in the trees,
 * farm dogs, and the church bells striking the hours from the village towers within earshot.
 * Rivers and the wind raise the masking floor every other sound is heard against; the streets
 * around the listener set the reverb send.
 *
 * @module audio/director/world
 */
import { hash01 } from "../../tools/geometry.ts"
import {
  AMBIENT_DB,
  audibility,
  CABIN,
  dbToGain,
  EAR_HEIGHT,
  mixGain,
  spreading,
  sumDb,
} from "../acoustics.ts"
import { smoothstep } from "../buffers.ts"
import {
  ambienceAt,
  type Bell,
  bells,
  birdSpot,
  type Dog,
  dogsNear,
  streetAt,
  waterNear,
  type WaterHeard,
} from "../places.ts"
import { cricketsQuiet } from "../synth/nature.ts"
import type { OneShot } from "../types.ts"
import type { Frame } from "./frame.ts"
import type { Ears, Hearing } from "./hearing.ts"
import { BEDS, HEIGHT, LEVELS, TOWERS, WATER_R_MIN, windDb } from "./levels.ts"
import { RUN } from "./people.ts"

/** The local wall-clock time the bells follow. */
export interface WallClock {
  readonly hour: number
  readonly minute: number
  readonly second: number
}

/** Water and dogs are looked up again after this long (s) or this far (m); water within `WATER_REACH` m, dogs `DOG_REACH`. */
const NEAR_EVERY = 0.25,
  NEAR_MOVED = 2,
  WATER_REACH = 400,
  DOG_REACH = 200
/** The street around the listener eases over this long, s. */
const STREET_TAU = 0.5
/** Wind strength from altitude (smoothstep over `ALTITUDE` m a.s.l. to `CALM`…`GALE`), up to `OPEN` more in the open, `STREETS` less in streets. */
const ALTITUDE = [150, 1000] as const,
  CALM = 0.15,
  GALE = 0.85,
  OPEN = 0.15,
  STREETS = 0.3
/** The stillest the wind gets (`windDb` at `AMBIENT_DB`): the rural background itself, leaves and the far valley, even in a sheltered street. */
const STILL = 10 ** ((AMBIENT_DB - BEDS.wind) / 40)
/** Birds call this often (per s) in full forest, plus `HOUSES` near houses (a built share over `GARDENS`). */
const BIRDS = { forest: 0.3, houses: 0.05 } as const,
  GARDENS = 0.05
const SPECIES = [
  ["robin", 0.35],
  ["tit", 0.3],
  ["blackbird", 0.2],
  ["chaffinch", 0.15],
] as const satisfies ReadonlyArray<
  readonly [Extract<OneShot, { readonly kind: "bird" }>["species"], number]
>
/** A dog barks every `BARK_MEAN` s on average, `EXCITED`× as often while the listener runs (or drives) within `EXCITED_NEAR` m. */
const BARK_MEAN = 45,
  EXCITED = 4,
  EXCITED_NEAR = 30
/** Hour strokes are this far apart (s); each tower starts up to `TOWER_LAG` s late (its own, stable); a stroke is scheduled `STROKE_AHEAD` s early. */
const STROKE_GAP = 2.5,
  TOWER_LAG = 6,
  STROKE_AHEAD = 0.1

/** A body of water heard from where it was looked up: its level and its distance there. */
interface Water extends WaterHeard {
  readonly r: number
}

/** Whether a Poisson process of `rate` per second fires in `dt`. */
const fires = (random: () => number, rate: number, dt: number): boolean =>
  random() < 1 - Math.exp(-rate * dt)

/** The world part of the director, with the nearby water and dogs, the eased street, the last ring it rang and its strokes to come. */
export const makeWorld = (clock: () => WallClock) => {
  let near:
    | {
        readonly x: number
        readonly y: number
        readonly at: number
        readonly water: ReadonlyArray<Water>
        readonly dogs: ReadonlyArray<Dog>
      }
    | undefined
  let street: number | undefined
  let strength = 0,
    forest = 0,
    open = 0,
    built = 0
  /** The loudest water as heard last frame (occlusion and cabin included), dB(A): an occluded river masks only as loud as it sounds. */
  let loudest = -Infinity
  let rung = ""
  /** Bell strokes still to ring, speaker time. */
  const strokes: Array<{ readonly bell: Bell; readonly at: number }> = []

  /**
   * The bed of `db` dB(A) at the ears, whose voice plays `under` dB under its nominal by itself: everywhere at once,
   * through the cabin when inside, and diffuse already (no reverb send). Its level is compressed like any source's, so
   * the gain gives back what the voice took.
   */
  const bed = (frame: Frame, db: number, under: number): Hearing => {
    const cabin = frame.inside === undefined ? undefined : CABIN[frame.inside]
    return {
      placement: {
        gain: mixGain(db, cabin?.loss ?? 0) * dbToGain(under),
        pan: 0,
        cutoff: cabin?.cutoff ?? 20000,
        cents: 0,
        wet: 0,
      },
      level: db - (cabin?.loss ?? 0),
      audible: true,
      r: 0,
      delay: 0,
    }
  }

  return {
    /** Before the rest of the frame: what is near, the street, and the masking floor (the wind bed, which is the rural day at its stillest, and the loudest water last heard). */
    listen: (
      ears: Ears,
      now: number,
      dt: number,
    ): { readonly ambient: number; readonly street: number } => {
      if (
        near === undefined ||
        now - near.at >= NEAR_EVERY ||
        Math.hypot(ears.x - near.x, ears.y - near.y) >= NEAR_MOVED
      ) {
        const water = waterNear(ears.x, ears.y, WATER_REACH).map((w) => ({
          ...w,
          r: Math.hypot(w.x - ears.x, w.y - ears.y, w.z + HEIGHT.water - ears.z),
        }))
        near = { x: ears.x, y: ears.y, at: now, water, dogs: dogsNear(ears.x, ears.y, DOG_REACH) }
      }
      const enclosed = streetAt(ears.x, ears.y)
      street =
        street === undefined
          ? enclosed
          : street + (enclosed - street) * (1 - Math.exp(-dt / STREET_TAU))
      ;({ forest, open, built } = ambienceAt(ears.x, ears.y))
      const height =
        CALM + (GALE - CALM) * smoothstep(ALTITUDE[0], ALTITUDE[1], ears.z - EAR_HEIGHT)
      strength = Math.min(1, Math.max(STILL, height + OPEN * open - STREETS * street))
      return { ambient: sumDb([windDb(strength), loudest]), street }
    },

    hear: (frame: Frame): void => {
      const { ears, now, dt, random } = frame
      const wind = windDb(strength)
      frame.hold("wind", { kind: "wind", strength, forest }, bed(frame, wind, BEDS.wind - wind))
      // Tree crickets sing in the meadows, not in the villages: a bed, with no reverb send.
      const density = Math.max(0, open - built)
      if (density > 0) {
        const crickets = frame.path(
          undefined,
          ears,
          { db: BEDS.crickets, rMin: 1 },
          { quiet: cricketsQuiet(density) },
        )
        frame.hold(
          "crickets",
          { kind: "crickets", density },
          { ...crickets, placement: { ...crickets.placement, wet: 0 } },
        )
      }

      // The level looked up holds the distance cue: it passes as the source level back to 1 m, the spreading as the loss
      // (obstacles, lowpass, masking). Like a bed's, that level here is what the mix compresses: far water is no louder a source.
      loudest = -Infinity
      for (const w of near?.water ?? []) {
        const at = frame.path(
          w.key,
          { x: w.x, y: w.y, z: w.z + HEIGHT.water },
          { db: w.level + spreading(w.r, WATER_R_MIN), rMin: WATER_R_MIN },
        )
        const gain = mixGain(w.level, w.level - at.level) * audibility(at.level, frame.ambient)
        frame.hold(
          w.key,
          { kind: "water", body: w.body, flow: w.flow },
          { ...at, placement: { ...at.placement, gain } },
        )
        if (at.audible) loudest = Math.max(loudest, at.level)
      }

      if (fires(random, BIRDS.forest * forest + (built > GARDENS ? BIRDS.houses : 0), dt)) {
        const spot = birdSpot(ears.x, ears.y, random)
        if (spot !== undefined) {
          let pick = random()
          const species = SPECIES.find(([, share]) => (pick -= share) < 0)?.[0] ?? "robin"
          frame.play(
            { kind: "bird", species },
            frame.path(`bird:${spot.x},${spot.y}`, spot, LEVELS.bird),
          )
        }
      }

      const listener = frame.heard.listener,
        busy = listener.car !== undefined || Math.hypot(listener.vx, listener.vy) > RUN
      for (const dog of near?.dogs ?? []) {
        const excited = busy && Math.hypot(dog.x - ears.x, dog.y - ears.y) < EXCITED_NEAR
        if (fires(random, (excited ? EXCITED : 1) / BARK_MEAN, dt))
          frame.play({ kind: "bark", big: dog.big }, frame.path(dog.key, dog, LEVELS.bark))
      }

      // On the hour the hours (1–12), on the half hour one stroke: each ring once, from the towers loudest here.
      const { hour, minute } = clock(),
        ring = `${hour}:${minute}`
      if ((minute === 0 || minute === 30) && ring !== rung) {
        rung = ring
        const count = minute === 0 ? hour % 12 || 12 : 1
        const towers = bells.flatMap((bell, i) => {
          const at = frame.path(bell.key, bell, LEVELS.bell)
          return at.audible ? [{ bell, lag: TOWER_LAG * hash01(i, 7), level: at.level }] : []
        })
        for (const { bell, lag } of towers.sort((a, b) => b.level - a.level).slice(0, TOWERS)) {
          for (let k = 0; k < count; k++) strokes.push({ bell, at: now + lag + k * STROKE_GAP })
        }
      }
      // A stroke is placed when it rings: in the half minute of the hours the listener moves on.
      for (let k = strokes.length - 1; k >= 0; k--) {
        const { bell, at } = strokes[k]!
        if (at > now + STROKE_AHEAD) continue
        strokes.splice(k, 1)
        frame.play(
          { kind: "bell", pitch: bell.pitch },
          frame.path(bell.key, bell, LEVELS.bell),
          Math.max(0, at - now),
        )
      }
    },
  }
}
