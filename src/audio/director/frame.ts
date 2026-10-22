/**
 * One frame of the director, shared by its vehicle, people and world parts: the listener's ears
 * and surroundings, where things stand (`groundAt`), the way from any source to them (`path`, with
 * the ground under it and its obstacles, cached per key), and the frame's requests. One-shots play
 * at once (a crash no louder than `CRASH_MOST_DB`), loud ones with their echoes off rock faces;
 * continuous voices are offered (`hold`) and `commit` keeps the loudest of each kind up to its cap.
 *
 * @module audio/director/frame
 */
import { groundZ } from "../../sim/map/ground.ts"
import { heightAt } from "../../sim/map/index.ts"
import type { VehicleModel } from "../../sim/vehicles.ts"
import { airCutoff, audibility, CABIN, dbToGain, gainToDb, panOf, SPEED_OF_SOUND, spreading } from "../acoustics.ts"
import type { Echo } from "../places.ts"
import type { Continuous, Heard, OneShot, Placement, Speaker } from "../types.ts"
import { type Ears, hear, type Hearing, SILENT, type Source } from "./hearing.ts"
import { CAPS, CRASH_MOST_DB, ECHO_MIN_DB, echoes, KEEP_DB, LEVELS, type Level } from "./levels.ts"
import type { Between, Occluder } from "./occluder.ts"

/** How a path is heard: Doppler-shifted (vehicles), through the listener's `cabin` (unless false: their own car's crash, scrape, doors), `quiet` dB under the nominal peak. */
interface Way { readonly doppler?: boolean; readonly cabin?: boolean; readonly quiet?: number }

/** What the director's parts see and do this frame. */
export interface Frame {
  readonly heard: Heard
  /** Speaker time, s, and the time since the last frame (0 while the audio is off or paused). */
  readonly now: number
  readonly dt: number
  /** The audio context exists: before it (behind the title card) every path is silent. */
  readonly live: boolean
  readonly ears: Ears
  /** The model of the vehicle the listener sits in. */
  readonly inside: VehicleModel | undefined
  /** The masking floor at the ears, dB(A). */
  readonly ambient: number
  readonly random: () => number
  /** How `source` reaches the ears; `key` caches its obstacles (none for sounds of the listener's own car or body). */
  readonly path: (key: string | undefined, source: Source, level: Level, way?: Way) => Hearing
  /** Offers continuous voice `key` this frame (ignored when inaudible). */
  readonly hold: (key: string, sound: Continuous, at: Hearing) => void
  /** Plays a one-shot `after` s past its travel time (ignored when inaudible). */
  readonly play: (sound: OneShot, at: Hearing, after?: number) => void
}

/** A continuous voice offered this frame. */
export interface Offer { readonly key: string; readonly sound: Continuous; readonly at: Hearing }

/** Everything a frame is made from. */
export interface Setup {
  readonly heard: Heard
  readonly now: number
  readonly dt: number
  /** The audio context exists: before, nothing is measured or played (state is still tracked). */
  readonly live: boolean
  readonly ears: Ears
  readonly inside: VehicleModel | undefined
  readonly ambient: number
  readonly street: number
  readonly random: () => number
  readonly occluder: Occluder
  readonly echoes: ReadonlyArray<Echo>
  readonly speaker: Speaker
  /** Filled by `hold`, for `commit`. */
  readonly offers: Array<Offer>
}

/** Elevation a.s.l. of what stands at (x, y): the terrain, a road, or the bridge deck nearest `near` (a previous elevation). */
export const groundAt = (x: number, y: number, near?: number): number => groundZ(x, y, near)

/** Nothing in the way (sounds of the listener's own car or body). */
const CLEAR: Between = { delta: 0, forest: 0 }

/** A placement Web Audio accepts: a non-finite one would mute its kind for the session. */
const finite = (p: Placement): boolean => Number.isFinite(p.gain + p.pan + p.cutoff + p.cents + p.wet)

/** This frame's view and requests. */
export const makeFrame = (setup: Setup): Frame => {
  const { ears, inside, ambient, street, speaker, occluder, now } = setup
  const cabin = inside === undefined ? undefined : CABIN[inside]
  const play = (sound: OneShot, at: Hearing, after = 0) => {
    const delay = at.delay + after
    if (!at.audible || !finite(at.placement) || !Number.isFinite(delay)) return
    // A crash's direct sound only: its echoes, far under it, keep the way's own level.
    speaker.play(sound, sound.kind === "crash" ? { ...at.placement, gain: Math.min(at.placement.gain, dbToGain(CRASH_MOST_DB)) } : at.placement, delay)
    if (!echoes(sound)) return
    for (const echo of setup.echoes) {
      // The echo's extra way past the direct sound, never closer than `ECHO_MIN_DB` under it; in a street the facades
      // hide all but the open share of the faces. It comes back from outside, through the cabin a sound of the own car skipped.
      const shell = at.shell?.loss ?? 0
      const extra = Math.max(ECHO_MIN_DB, echo.loss - spreading(at.r, LEVELS[sound.kind].rMin)) - gainToDb(1 - street) + shell
      if (audibility(at.level - extra, ambient) === 0) continue
      const placement = {
        gain: at.placement.gain * dbToGain(-extra),
        pan: panOf(echo.dx, echo.dy, ears.right),
        cutoff: Math.min(at.placement.cutoff, airCutoff(echo.delay * SPEED_OF_SOUND), at.shell?.cutoff ?? 20000),
        cents: 0,
        // The send is post-gain, and the cabin's loss is in the gain now.
        wet: at.placement.wet * dbToGain(shell)
      }
      if (finite(placement)) speaker.play(sound, placement, delay + echo.delay)
    }
  }
  return {
    heard: setup.heard,
    now,
    dt: setup.dt,
    live: setup.live,
    ears,
    inside,
    ambient,
    random: setup.random,
    path: (key, source, level, way = {}) => {
      if (!setup.live) return SILENT
      const bare = way.cabin === false, through = bare ? undefined : cabin
      // Obstacles only take away: a source masked even in the clear is not worth measuring.
      const r = Math.hypot(source.x - ears.x, source.y - ears.y, source.z - ears.z)
      if (audibility(level.db - (way.quiet ?? 0) - spreading(r, level.rMin) - (through?.loss ?? 0), ambient) === 0) return SILENT
      const between = key === undefined ? CLEAR : occluder.between(key, ears, source, now)
      // ISO 9613-2's mean path height: both ends over the terrain under them (a bridge deck lifts the path).
      const height = Math.max(0, (ears.z - heightAt(ears.x, ears.y) + source.z - heightAt(source.x, source.y)) / 2)
      return hear({
        ears, source, db: level.db, rMin: level.rMin, height, quiet: way.quiet, delta: between.delta, forest: between.forest, ambient, street,
        cabin, bare, doppler: way.doppler
      })
    },
    hold: (key, sound, at) => {
      if (at.audible && finite(at.placement)) setup.offers.push({ key, sound, at })
    },
    play
  }
}

/** Holds the loudest offers of each kind up to its cap, those `kept` from last frame counting `KEEP_DB` louder; returns the keys held. */
export const commit = (offers: ReadonlyArray<Offer>, speaker: Speaker, kept: ReadonlySet<string>): Set<string> => {
  const rank = (offer: Offer) => offer.at.level + (kept.has(offer.key) ? KEEP_DB : 0)
  const counts = new Map<Continuous["kind"], number>(), held = new Set<string>()
  for (const { key, sound, at } of [...offers].sort((a, b) => rank(b) - rank(a))) {
    const n = (counts.get(sound.kind) ?? 0) + 1
    counts.set(sound.kind, n)
    if (n > CAPS[sound.kind]) continue
    speaker.hold(key, sound, at.placement)
    held.add(key)
  }
  return held
}
