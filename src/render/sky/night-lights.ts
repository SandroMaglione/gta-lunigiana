/**
 * The night light pool: a FIXED set of real lights made once, before the first frame compiles the
 * shaders, and never added, removed or hidden after (the light counts are in every lit program's
 * key: changing them recompiles everything, a frame hitch). Four spot lights are headlight beams:
 * the first follows the player's car, the other three the nearest cars with their lamps on. Eight
 * point lights stand under the street lamps nearest the focus. A light hands over to a new car or
 * lamp only after fading out (0.35 s), and keeps what it follows while that stays among the
 * nearest, so beams do not snap from car to car. No shadows; an unused light has intensity 0.
 *
 * @module render/sky/night-lights
 */
import { type Object3D, PointLight, SpotLight } from "three"

import { PALETTE } from "../palette.ts"
import type { SkyFrame } from "./frame.ts"
import { lampsIn, streetLamps } from "./lamps.ts"

/** Headlight beams in the pool (slot 0: the player's car). */
export const K_SPOT = 4
/** Street-lamp lights in the pool. */
export const K_POINT = 8
/** Seconds a light takes to fade fully in or out. */
const FADE = 0.35
/**
 * A headlight beam: candela at full night (r186 lights are physical: decay 2 gives ≈ 2 lx on the
 * road 10 m ahead), reach, cone half-angle and penumbra; from `ahead` m in front of the centre of
 * mass and `rise` m above it, aimed `reach` m ahead and `drop` m down.
 */
const HEAD = {
  candela: 300,
  range: 45,
  angle: 0.5,
  penumbra: 0.6,
  decay: 2,
  ahead: 2,
  rise: 0.25,
  reach: 14,
  drop: 1.6,
} as const
/**
 * A street lamp's light: candela at full night with decay 1 (a softer fall-off than the inverse
 * square, so the house wall behind the lantern does not blow out while the street below is lit),
 * standing 0.4 m further out than the lantern and 0.3 m under it.
 */
const STREET = { candela: 2.6, range: 18, decay: 1, out: 0.4, down: 0.3 } as const
/** Cars within `add` m of the focus get a free beam; a lit car keeps it within `keep` m. */
const CAR_RANGE = { add: 80, keep: 110 } as const
/** Street lamps within `add` m of the focus get a free light; a lit lamp keeps it within `keep` m. */
const LAMP_RANGE = { add: 60, keep: 80 } as const
/** Longest frame step faded, s. */
const MAX_DT = 0.25

/** A candidate for a light: what it is (car id, lamp index) and its distance from the focus, m. */
interface Candidate {
  readonly id: number
  readonly d: number
}

/**
 * Light slots handed to the nearest candidates with hysteresis (pure bookkeeping, no three): a
 * slot keeps its candidate while it is among the nearest 2 × slots and within `keep`, otherwise
 * fades it out and only then takes the nearest free candidate within `add`.
 */
export class SlotPool {
  /** What each slot follows (−1: free). */
  readonly ids: Int32Array
  /** How far each slot is faded in, 0..1. */
  readonly levels: Float64Array
  private readonly on: Uint8Array

  constructor(size: number) {
    this.ids = new Int32Array(size).fill(-1)
    this.levels = new Float64Array(size)
    this.on = new Uint8Array(size)
  }

  /** One frame of `dt` s: `ranked` lists this frame's candidates nearest first. */
  update(
    ranked: ReadonlyArray<Candidate>,
    dt: number,
    range: { readonly add: number; readonly keep: number },
  ): void {
    const n = this.ids.length
    for (let s = 0; s < n; s++) {
      if (this.ids[s]! < 0) continue
      let rank = -1
      for (let r = 0; r < ranked.length && rank < 0; r++)
        if (ranked[r]!.id === this.ids[s]) rank = r
      this.on[s] = rank >= 0 && rank < 2 * n && ranked[rank]!.d <= range.keep ? 1 : 0
      if (this.on[s] === 0 && this.levels[s]! <= 0) this.ids[s] = -1
    }
    let next = 0
    for (let s = 0; s < n; s++) {
      if (this.ids[s]! >= 0) continue
      while (next < ranked.length && this.ids.includes(ranked[next]!.id)) next++
      if (next >= ranked.length || ranked[next]!.d > range.add) break
      this.ids[s] = ranked[next++]!.id
      this.on[s] = 1
      this.levels[s] = 0
    }
    for (let s = 0; s < n; s++)
      this.levels[s] = Math.min(
        1,
        Math.max(0, this.levels[s]! + (this.on[s] === 1 ? dt : -dt) / FADE),
      )
  }
}

/** A car as the pool needs it: its id, centre of mass (map x, y; render y as z), heading (rad CCW from east), and whether the player drives it. */
export interface LitCar {
  readonly id: number
  readonly x: number
  readonly y: number
  readonly z: number
  readonly angle: number
  readonly driven: boolean
}

/** The fixed night light pool; add it once, before the first frame, and `update` it every frame. */
export class NightLights {
  /** Headlight beams: slot 0 follows the player's car, the rest the nearest cars with lamps on. */
  readonly spots: ReadonlyArray<SpotLight>
  /** Lights under the nearest street lamps. */
  readonly points: ReadonlyArray<PointLight>
  private readonly driven = new SlotPool(1)
  private readonly traffic = new SlotPool(K_SPOT - 1)
  private readonly lamps = new SlotPool(K_POINT)
  /** Last pose (x, y, z, angle) of what each spot follows, so a beam fades out in place when its car is gone. */
  private readonly poses = new Float64Array(K_SPOT * 4)
  private readonly cars = new Map<number, LitCar>()
  private readonly ranked: Array<Candidate> = []
  private last = Number.NaN

  /** Makes every light (intensity 0) and adds it, with each spot's target, to `scene`. */
  constructor(scene: Object3D) {
    this.spots = Array.from({ length: K_SPOT }, () => {
      const spot = new SpotLight(
        PALETTE.headlight,
        0,
        HEAD.range,
        HEAD.angle,
        HEAD.penumbra,
        HEAD.decay,
      )
      scene.add(spot, spot.target)
      return spot
    })
    this.points = Array.from({ length: K_POINT }, () => {
      const point = new PointLight(PALETTE.lampLight, 0, STREET.range, STREET.decay)
      scene.add(point)
      return point
    })
  }

  /**
   * Hands the lights to the player's car, the nearest `cars` (only those with lamps on: traffic and
   * the player's car, not parked ones) and the nearest street lamps around `focus` (three space),
   * fades them, and sets their intensity from `frame.lamps`.
   */
  update(
    frame: SkyFrame,
    focus: { readonly x: number; readonly z: number },
    cars: Iterable<LitCar>,
  ): void {
    const dt = Number.isNaN(this.last) ? 0 : Math.min(MAX_DT, Math.max(0, frame.now - this.last))
    this.last = frame.now
    const fx = focus.x,
      fy = -focus.z,
      ranked = this.ranked
    this.cars.clear()
    ranked.length = 0
    let driven: LitCar | undefined
    for (const car of cars) {
      this.cars.set(car.id, car)
      if (car.driven) driven = car
      else ranked.push({ id: car.id, d: Math.hypot(car.x - fx, car.y - fy) })
    }
    ranked.sort((a, b) => a.d - b.d)
    this.traffic.update(ranked, dt, CAR_RANGE)
    this.driven.update(driven === undefined ? [] : [{ id: driven.id, d: 0 }], dt, {
      add: 1,
      keep: 1,
    })
    for (let s = 0; s < K_SPOT; s++) {
      const pool = s === 0 ? this.driven : this.traffic,
        slot = s === 0 ? 0 : s - 1
      const id = pool.ids[slot]!,
        car = id < 0 ? undefined : this.cars.get(id),
        p = this.poses,
        o = s * 4
      if (car !== undefined) [p[o], p[o + 1], p[o + 2], p[o + 3]] = [car.x, car.y, car.z, car.angle]
      const x = p[o]!,
        y = p[o + 1]!,
        z = p[o + 2]!,
        c = Math.cos(p[o + 3]!),
        sn = Math.sin(p[o + 3]!)
      const spot = this.spots[s]!
      spot.position.set(x + c * HEAD.ahead, z + HEAD.rise, -(y + sn * HEAD.ahead))
      spot.target.position.set(x + c * HEAD.reach, z - HEAD.drop, -(y + sn * HEAD.reach))
      spot.intensity = HEAD.candela * frame.lamps * pool.levels[slot]!
    }
    ranked.length = 0
    const all = streetLamps(),
      keep = LAMP_RANGE.keep
    lampsIn(fx - keep, fy - keep, fx + keep, fy + keep, (i) => {
      const d = Math.hypot(all[i]!.x - fx, all[i]!.y - fy)
      if (d <= keep) ranked.push({ id: i, d })
    })
    ranked.sort((a, b) => a.d - b.d)
    this.lamps.update(ranked, dt, LAMP_RANGE)
    for (let s = 0; s < K_POINT; s++) {
      const id = this.lamps.ids[s]!,
        point = this.points[s]!
      if (id >= 0) {
        const lamp = all[id]!
        point.position.set(
          lamp.x + lamp.nx * STREET.out,
          lamp.h - STREET.down,
          -(lamp.y + lamp.ny * STREET.out),
        )
      }
      point.intensity = STREET.candela * frame.lamps * this.lamps.levels[s]!
    }
  }
}
