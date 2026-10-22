/**
 * Where the ground is, in metres a.s.l.: the terrain as the mesh draws it (each 4 m cell split
 * along its south-west to north-east diagonal), at-grade roads floating `ROAD_LIFT` above their
 * profile, and bridge decks and tunnels. Wheels, feet, sound sources and the renderer all read
 * their heights here, so what is drawn and what stands on it agree.
 *
 * @module map/ground
 */
import { segDist2 } from "../collide.ts"
import { MAP, type Road, roadClassOf } from "./index.ts"
import type { RoadClass } from "./kinds.ts"

/** How far each road class's surface floats above its profile (m); wider classes on top, so junctions never z-fight. */
export const ROAD_LIFT = {
  tertiary: 0.16, unclassified: 0.14, residential: 0.12, service: 0.1, track: 0.08, steps: 0.07, path: 0.06
} as const satisfies Record<RoadClass, number>

const hm = MAP.heightmap
/**
 * Terrain node elevation at grid index (i, j), row 0 = south; indices outside the grid clamp to
 * the edge, which is how the apron beyond the map bounds continues the landscape.
 */
export const terrainNodeZ = (i: number, j: number): number =>
  hm.data[Math.min(hm.rows - 1, Math.max(0, j)) * hm.cols + Math.min(hm.cols - 1, Math.max(0, i))]! / 10

/** Terrain elevation under (x, y) on the drawn mesh: each cell is split along its south-west to north-east diagonal. */
export const terrainZ = (x: number, y: number): number => {
  const fx = (x - hm.x0) / hm.cell, fy = (y - hm.y0) / hm.cell
  const i = Math.floor(fx), j = Math.floor(fy)
  const u = fx - i, v = fy - j
  const sw = terrainNodeZ(i, j), se = terrainNodeZ(i + 1, j), nw = terrainNodeZ(i, j + 1), ne = terrainNodeZ(i + 1, j + 1)
  return u >= v ? sw + (se - sw) * u + (ne - se) * v : sw + (ne - nw) * u + (nw - sw) * v
}

interface RoadSegment {
  readonly ax: number
  readonly ay: number
  readonly bx: number
  readonly by: number
  readonly za: number
  readonly zb: number
  readonly half: number
  readonly lift: number
  /** Bridge or tunnel: the surface is the profile, never the terrain. */
  readonly lifted: boolean
}

const BUCKET = 16
const buckets = new Map<number, Array<RoadSegment>>()
const keyOf = (bx: number, by: number) => bx * 4096 + by
for (const road of MAP.roads) {
  const lifted = road.bridge === true || road.tunnel === true
  const lift = ROAD_LIFT[roadClassOf(road)]
  for (let k = 0; k + 1 < road.z.length; k++) {
    const s: RoadSegment = {
      ax: road.pts[2 * k]!, ay: road.pts[2 * k + 1]!, bx: road.pts[2 * k + 2]!, by: road.pts[2 * k + 3]!,
      za: road.z[k]!, zb: road.z[k + 1]!, half: road.w / 2 + 0.3, lift, lifted
    }
    const x0 = Math.floor((Math.min(s.ax, s.bx) - s.half) / BUCKET), x1 = Math.floor((Math.max(s.ax, s.bx) + s.half) / BUCKET)
    const y0 = Math.floor((Math.min(s.ay, s.by) - s.half) / BUCKET), y1 = Math.floor((Math.max(s.ay, s.by) + s.half) / BUCKET)
    for (let bx = x0; bx <= x1; bx++) for (let by = y0; by <= y1; by++) {
      const list = buckets.get(keyOf(bx + 2048, by + 2048))
      if (list === undefined) buckets.set(keyOf(bx + 2048, by + 2048), [s])
      else list.push(s)
    }
  }
}

/** Surface elevation of a road whose profile is `z` (m a.s.l.) at (x, y): at-grade roads never dip under the terrain mesh. */
export const roadZ = (z: number, x: number, y: number, lift: number, lifted: boolean): number =>
  (lifted ? z : Math.max(z, terrainZ(x, y))) + lift

/** Surface elevation of segment `s` at (x, y), or undefined when (x, y) is off it. */
const onSegment = (s: RoadSegment, x: number, y: number): number | undefined => {
  const { d2, t } = segDist2(x, y, s.ax, s.ay, s.bx, s.by)
  return d2 > s.half * s.half ? undefined : roadZ(s.za + (s.zb - s.za) * t, x, y, s.lift, s.lifted)
}

/** A bridge deck or tunnel within this height (m) of where an actor was is the one it is on. */
const ON_DECK = 0.5

/**
 * Where an actor at (x, y) stands, m a.s.l. At-grade roads are part of the ground: where several
 * overlap (a junction), their surfaces blend, each weighted by the square of how deep inside its
 * carriageway the point is, so the ground stays continuous where their profiles disagree (by up to
 * a few metres); then the higher of that and the terrain. Bridge decks and tunnels compete with that
 * ground for the one nearest `near`, the actor's previous elevation, so it stays on the level it
 * was on; without `near`, the highest wins. A deck within ON_DECK of `near` wins outright: on a ramp
 * over a gully the ground below can be nearer than the climbing deck, and the actor must not drop
 * onto it.
 */
export const groundZ = (x: number, y: number, near?: number): number => {
  const segments = buckets.get(keyOf(Math.floor(x / BUCKET) + 2048, Math.floor(y / BUCKET) + 2048)) ?? []
  let best = terrainZ(x, y), sum = 0, weights = 0
  for (const s of segments) {
    if (s.lifted) continue
    const { d2, t } = segDist2(x, y, s.ax, s.ay, s.bx, s.by)
    if (d2 > s.half * s.half) continue
    const depth = s.half - Math.sqrt(d2), weight = depth * depth + 1e-9
    sum += weight * roadZ(s.za + (s.zb - s.za) * t, x, y, s.lift, false)
    weights += weight
  }
  if (weights > 0) best = Math.max(best, sum / weights)
  let score = near === undefined ? -best : Math.abs(best - near)
  for (const s of segments) {
    const h = s.lifted ? onSegment(s, x, y) : undefined
    if (h === undefined) continue
    const off = near === undefined ? 0 : Math.abs(h - near)
    const sc = near === undefined ? -h : off < ON_DECK ? off - ON_DECK : off
    if (sc < score) [best, score] = [h, sc]
  }
  return best
}

/** The surface elevation of `road` at the point of it nearest (x, y), m a.s.l.: where a vehicle on that road stands, whatever is above or below. */
export const roadLevel = (road: Road, x: number, y: number): number => {
  let best = Number.MAX_VALUE, level = road.z[0]!
  for (let k = 0; k + 1 < road.z.length; k++) {
    const { d2, t } = segDist2(x, y, road.pts[2 * k]!, road.pts[2 * k + 1]!, road.pts[2 * k + 2]!, road.pts[2 * k + 3]!)
    if (d2 < best) [best, level] = [d2, road.z[k]! + (road.z[k + 1]! - road.z[k]!) * t]
  }
  return roadZ(level, x, y, ROAD_LIFT[roadClassOf(road)], road.bridge === true || road.tunnel === true)
}

/** The ground at (x, y) on the level of the terrain there: a road at grade, never a deck above or a tunnel below. */
export const atGrade = (x: number, y: number): number => groundZ(x, y, terrainZ(x, y))

/** How far over a wheel's ground (m) `drawnZ` looks for the surface drawn there: junction and hairpin ribbons stand up to 2.9 m over it. */
const DRAWN_REACH = 3

/**
 * What shows on top over ground `near` at (x, y): the highest at-grade road ribbon as it is drawn (each at its own profile), or the
 * terrain, within DRAWN_REACH over it, where the blended `groundZ` sits under a junction's or a hairpin's higher ribbon; else `near`
 * (a deck, or a tunnel's floor under the hill). Tyre marks lie on it.
 */
export const drawnZ = (x: number, y: number, near: number): number => {
  let top = near
  const over = (h: number) => h > top && h <= near + DRAWN_REACH
  if (over(terrainZ(x, y))) top = terrainZ(x, y)
  for (const s of buckets.get(keyOf(Math.floor(x / BUCKET) + 2048, Math.floor(y / BUCKET) + 2048)) ?? []) {
    const h = s.lifted ? undefined : onSegment(s, x, y)
    if (h !== undefined && over(h)) top = h
  }
  return top
}
