/**
 * Each river and stream as a channel: per vertex its bed, its grade and the two coefficients that
 * turn the catchment's discharge per km² (`specificDischarge`) into the water's depth and mean
 * speed there. The channel is as wide as the water (`Water.w`); its bed is the terrain drawn under
 * its centreline, which the map build carves `depth`/2 under the built surface `z` (the 4 m terrain
 * lies up to 0.8 m off that under the narrow streams), except under an at-grade road, where it
 * stays `depth`/2 under the culvert's dip. Depth and speed follow Manning's equation with
 * Jarrett's roughness for high-gradient streams (1984, J. Hydraulic Eng. 110:1519): n = 0.39 S^0.38
 * R^−0.16, fitted on 21 Colorado mountain streams of grade 0.2–5.2 %; for a wide channel (R ≈ the
 * depth h) Q = w h^1.83 S^0.12 / 0.39.
 *
 * @module water/channel
 */
import { Ops } from "@typeonce/ritmo-math"

import { atGrade, terrainZ } from "../map/ground.ts"
import type { Water } from "../map/index.ts"

/** Jarrett's n = 0.39 S^0.38 R^−0.16 folded into Manning's V = R^(2/3) S^(1/2) / n: V = R^DEPTH S^GRADE / ROUGH. */
const ROUGH = 0.39,
  DEPTH = 2 / 3 + 0.16,
  GRADE = 0.5 - 0.38
/** The grades Jarrett fitted: flatter reaches (a pond behind a culvert) and steeper ones (step pools) are held to them. */
const GRADES = { min: 0.002, max: 0.052 } as const
/** An at-grade road stands at least this far over the terrain under it, m (the lowest `ROAD_LIFT`, a path's 0.06 m). */
const ON_ROAD = 0.03
/** Half-width of the grade window along the water, m: bridge caps and culvert dips are local. */
const GRADE_WINDOW = 40

/** Depth (m) and mean speed (m/s) at a vertex are `stage` × q^STAGE and `speed` × q^SPEED, q the discharge per km² (m³/s). */
export const STAGE = 1 / (1 + DEPTH),
  SPEED = 1 - STAGE

/** One water piece as a channel, per vertex. */
export interface Channel {
  /** The surface's fall over ±GRADE_WINDOW m, as a share (0.01 = 1 %). */
  readonly grade: Float64Array
  /** The bed under the centreline, m a.s.l. */
  readonly bed: Float64Array
  /** Depth (m) at 1 m³/s per km²: `stage` × q^STAGE. */
  readonly stage: Float64Array
  /** Mean speed (m/s) at 1 m³/s per km²: `speed` × q^SPEED. */
  readonly speed: Float64Array
}

/** Linear interpolation of per-vertex `z` at arc length `at`, given ascending arc lengths `s`. */
const zAlong = (s: Float64Array, z: ArrayLike<number>, at: number): number => {
  let lo = 0,
    hi = s.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (s[mid]! <= at) lo = mid
    else hi = mid
  }
  const span = s[hi]! - s[lo]!
  return span > 0 ? z[lo]! + ((z[hi]! - z[lo]!) * (at - s[lo]!)) / span : z[lo]!
}

/** The channel of `water`: grades over ±GRADE_WINDOW m of its surface, its bed, and its depth and speed per unit discharge. */
export const channelOf = (water: Water): Channel => {
  const { pts, z, w, area } = water,
    n = pts.length / 2
  const s = new Float64Array(n)
  for (let i = 1; i < n; i++)
    s[i] = s[i - 1]! + Ops.hypot(pts[2 * i]! - pts[2 * i - 2]!, pts[2 * i + 1]! - pts[2 * i - 1]!)
  const total = s[n - 1]!
  const grade = Float64Array.from(s, (at) => {
    const lo = Math.max(0, at - GRADE_WINDOW),
      hi = Math.min(total, at + GRADE_WINDOW)
    return hi > lo ? Math.abs(zAlong(s, z, lo) - zAlong(s, z, hi)) / (hi - lo) : 0
  })
  const stage = Float64Array.from(grade, (g, i) => {
    const held = Math.min(GRADES.max, Math.max(GRADES.min, g))
    return Ops.pow((ROUGH * area[i]!) / (w * Ops.pow(held, GRADE)), STAGE)
  })
  return {
    grade,
    bed: Float64Array.from(z, (zi, i) => {
      const x = pts[2 * i]!,
        y = pts[2 * i + 1]!,
        under = terrainZ(x, y)
      return atGrade(x, y) > under + ON_ROAD ? zi - water.depth / 2 : under
    }),
    stage,
    speed: Float64Array.from(stage, (k, i) => (k > 0 ? area[i]! / (w * k) : 0)),
  }
}
