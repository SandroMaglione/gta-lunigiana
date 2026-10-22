/**
 * The director: the brain of proximity and physical behaviour between the `Heard` frames of the
 * audio schedule and a `Speaker`. Each frame it finds the listener's ears (and the cabin around
 * them), the masking floor, how enclosed the street is and the rock faces that echo, lets its
 * vehicle, people and world parts place every sound through the acoustic chain (hearing.ts), keeps
 * the loudest voices of each kind up to their caps, and flushes the speaker. Pure TypeScript: Node
 * tests drive it with a recording speaker, a seeded random source and a fake wall clock.
 *
 * Time is the speaker's: before its context exists (and while it is suspended) no time passes;
 * the director still tracks who sits where, but measures and plays nothing.
 *
 * @module audio/director
 */
import { VEHICLES } from "../../sim/vehicles.ts"
import { screenAxes } from "../../sim/view.ts"
import { EAR_HEIGHT } from "../acoustics.ts"
import { echoesAt, type Echo } from "../places.ts"
import type { Heard, Speaker } from "../types.ts"
import { commit, groundAt, makeFrame, type Offer } from "./frame.ts"
import { makeOccluder } from "./occluder.ts"
import { makePeople } from "./people.ts"
import { makeVehicles } from "./vehicles.ts"
import { makeWorld, type WallClock } from "./world.ts"

export type { WallClock } from "./world.ts"

/** A frame longer than this (s) is a stall, not time passing. */
const MAX_DT = 0.25
/** Echoing rock faces are looked up again after this long (s) or this far (m). */
const ECHOES_EVERY = 1, ECHOES_MOVED = 10

/** The local time of day. */
const localTime = (): WallClock => {
  const d = new Date()
  return { hour: d.getHours(), minute: d.getMinutes(), second: d.getSeconds() }
}

/** The director playing through `speaker`; `random` drives birds and dogs, `clock` the bells (local time by default). */
export const makeDirector = (
  speaker: Speaker,
  options: { readonly random?: () => number; readonly clock?: () => WallClock } = {}
): { readonly hear: (heard: Heard) => void } => {
  const random = options.random ?? Math.random
  const occluder = makeOccluder(), vehicles = makeVehicles(), people = makePeople(), world = makeWorld(options.clock ?? localTime)
  let last: number | undefined, ground: number | undefined
  let held: ReadonlySet<string> = new Set()
  let faces: { readonly x: number; readonly y: number; readonly at: number; readonly echoes: ReadonlyArray<Echo> } | undefined

  return {
    hear: (heard) => {
      const now = speaker.now(), live = now > 0
      const dt = last === undefined ? 0 : Math.min(MAX_DT, Math.max(0, now - last))
      last = now
      const { listener } = heard
      // In a car the ears ride with it, in the air too; on foot the ground under the listener stays on the level it was on: a bridge
      // deck, not the river under it.
      const seat = listener.car === undefined ? undefined : heard.vehicles.find((v) => v.id === listener.car)
      ground = seat === undefined ? groundAt(listener.x, listener.y, ground) : seat.z - VEHICLES[seat.model].cg
      const ears = { x: listener.x, y: listener.y, z: ground + EAR_HEIGHT, vx: listener.vx, vy: listener.vy, right: screenAxes(listener.turns).right }
      const inside = seat?.model
      const { ambient, street } = world.listen(ears, now, dt)
      if (live && (faces === undefined || now - faces.at >= ECHOES_EVERY || Math.hypot(ears.x - faces.x, ears.y - faces.y) >= ECHOES_MOVED)) {
        faces = { x: ears.x, y: ears.y, at: now, echoes: echoesAt(ears.x, ears.y) }
      }
      const offers: Array<Offer> = []
      const frame = makeFrame({
        heard, now, dt, live, ears, inside, ambient, street, random, occluder, echoes: faces?.echoes ?? [], speaker, offers
      })
      vehicles.hear(frame)
      people.hear(frame)
      world.hear(frame)
      if (live) occluder.refresh(now)
      held = commit(offers, speaker, held)
      speaker.flush()
    }
  }
}
