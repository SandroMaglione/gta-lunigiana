/**
 * Running water as heard from a point: rivers and streams as incoherent line sources (`lineLevel`),
 * fountains and the Cascata di Equi as point sources. Loudness per reach comes from the water's
 * width (a stand-in for discharge) and its grade smoothed over ±40 m (rapids against calm reaches),
 * calibrated at 2 m from the bank: the Torrente Lucido ≈ 70 dB(A) in rapids and ≈ 62 on calm
 * reaches, the 8 m torrents ≈ 64, the 4 m named streams ≈ 55, the unnamed 2 m gullies ≈ 40.
 *
 * @module audio/places/water
 */
import { staticGrid } from "../../sim/collide.ts"
import { heightAt, MAP, type Water } from "../../sim/map/index.ts"
import { segDist2 } from "../../tools/geometry.ts"
import { AMBIENT_DB, lineLevel, spreading, type LineSegment } from "../acoustics.ts"
import { smoothstep } from "../buffers.ts"

/** A body of water heard from a point: its nearest point (z the water surface) and level there, dB(A). */
export interface WaterHeard {
  /** Stable per body: the river's name (its pieces merged), or the piece's or fountain's id. */
  readonly key: string
  readonly body: "fountain" | "stream" | "river"
  /** 0 (trickle) … 1 (the Lucido in rapids). */
  readonly flow: number
  readonly level: number
  readonly x: number
  readonly y: number
  readonly z: number
}

/** A straight reach of one body: its line-source power, and what the synth needs at its nearest point. */
interface Reach extends LineSegment {
  readonly key: string
  readonly river: boolean
  readonly flow: number
  readonly az: number
  readonly bz: number
}

/** Sound power Lw′ (dB per metre) by width (m), midway between calm and rapids: the calibration above. */
const POWER: ReadonlyArray<readonly [number, number]> = [
  [2, 47],
  [4, 63],
  [8, 81],
  [14, 81.5],
]
/** Grades from calm (1 %) to rapids (6 %) move the power from −4 to +4 dB. */
const CALM = 0.01,
  RAPIDS = 0.06,
  RAPIDS_DB = 8
/** Half-width of the grade window along the water, m (bridge caps and culvert dips are local). */
const GRADE_WINDOW = 40
/** Flow is the width relative to the Lucido's, `CALM_FLOW` of it on calm reaches. */
const WIDEST = 14,
  CALM_FLOW = 0.4
/** Fountains, taps and the lavoir, dB(A) at 1 m. */
const FOUNTAIN_DB = 65
/** The Cascata di Equi on the Torrente Fagli, dB(A) at 1 m: hard-coded, only the raw OSM has it. */
const CASCATA = { key: "water:Cascata di Equi", x: 1835, y: 530, z: 259, level: 80 } as const
/** Bodies fainter than this at the listener are left out: the hard cull of the masking rule. */
const FLOOR = AMBIENT_DB - 15
/** The farthest a body is looked for, m. */
const FARTHEST = 400

/** `POWER` at width `w`, linear between the rows. */
const powerOf = (w: number): number => {
  if (w <= POWER[0]![0]) return POWER[0]![1]
  const i = POWER.findIndex(([width]) => width >= w)
  if (i < 0) return POWER[POWER.length - 1]![1]
  const [w0, p0] = POWER[i - 1]!,
    [w1, p1] = POWER[i]!
  return p0 + ((p1 - p0) * (w - w0)) / (w1 - w0)
}

/** Linear interpolation of per-vertex `z` at arc length `at`, given ascending arc lengths `s`. */
const zAlong = (s: Float64Array, z: ReadonlyArray<number>, at: number): number => {
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

/** The reaches of one water piece, with their grade-dependent power and flow. */
const reachesOf = (water: Water): Array<Reach> => {
  const { pts, z, w } = water,
    n = pts.length / 2
  const s = new Float64Array(n)
  for (let i = 1; i < n; i++)
    s[i] = s[i - 1]! + Math.hypot(pts[2 * i]! - pts[2 * i - 2]!, pts[2 * i + 1]! - pts[2 * i - 1]!)
  const total = s[n - 1]!
  const grade = Array.from(s, (at) => {
    const lo = Math.max(0, at - GRADE_WINDOW),
      hi = Math.min(total, at + GRADE_WINDOW)
    return hi > lo ? Math.abs(zAlong(s, z, lo) - zAlong(s, z, hi)) / (hi - lo) : 0
  })
  const key = `water:${water.name ?? water.id}`,
    river = water.kind === "river" || w >= 8
  const out: Array<Reach> = []
  for (let i = 0; i + 1 < n; i++) {
    const rapids = smoothstep(CALM, RAPIDS, (grade[i]! + grade[i + 1]!) / 2)
    out.push({
      key,
      river,
      ax: pts[2 * i]!,
      ay: pts[2 * i + 1]!,
      bx: pts[2 * i + 2]!,
      by: pts[2 * i + 3]!,
      az: z[i]!,
      bz: z[i + 1]!,
      lw: powerOf(w) + RAPIDS_DB * (rapids - 0.5),
      flow: Math.min(1, w / WIDEST) * (CALM_FLOW + (1 - CALM_FLOW) * rapids),
    })
  }
  return out
}

/** Every reach of the map, gridded (≈ 30 ms, on the first query). */
const indexReaches = () => {
  const reaches = MAP.water.flatMap(reachesOf)
  const near = staticGrid(
    reaches.length,
    (i) => {
      const r = reaches[i]!
      return [
        Math.min(r.ax, r.bx),
        Math.min(r.ay, r.by),
        Math.max(r.ax, r.bx),
        Math.max(r.ay, r.by),
      ]
    },
    32,
  )
  return { reaches, near }
}
let index: ReturnType<typeof indexReaches> | undefined

/** Drinking fountains, taps and the Fontana di Aiola lavoir (more water: higher flow). */
const fountains = MAP.pois.filter(
  (p) =>
    p.kind === "amenity=drinking_water" ||
    p.kind === "man_made=water_tap" ||
    p.kind === "area:lavoir",
)

/**
 * The bodies of water heard at (x, y) within `radius` m (at most 400), loudest first: rivers and
 * streams (pieces merged by name) at their nearest point, fountains and the waterfall as points.
 * Bodies under 20 dB(A) at (x, y) are left out.
 */
export const waterNear = (x: number, y: number, radius: number): ReadonlyArray<WaterHeard> => {
  const r = Math.min(radius, FARTHEST),
    out: Array<WaterHeard> = []
  const { reaches, near } = (index ??= indexReaches())
  const bodies = new Map<
    string,
    { readonly reaches: Array<Reach>; nearest: Reach; d2: number; t: number }
  >()
  near(x - r, y - r, x + r, y + r, (i) => {
    const reach = reaches[i]!,
      { d2, t } = segDist2(x, y, reach.ax, reach.ay, reach.bx, reach.by)
    if (d2 > r * r) return
    const body = bodies.get(reach.key)
    if (body === undefined) bodies.set(reach.key, { reaches: [reach], nearest: reach, d2, t })
    else {
      body.reaches.push(reach)
      if (d2 < body.d2) [body.nearest, body.d2, body.t] = [reach, d2, t]
    }
  })
  for (const [key, { reaches: line, nearest: n, t }] of bodies) {
    out.push({
      key,
      body: n.river ? "river" : "stream",
      flow: n.flow,
      level: lineLevel(line, x, y).level,
      x: n.ax + (n.bx - n.ax) * t,
      y: n.ay + (n.by - n.ay) * t,
      z: n.az + (n.bz - n.az) * t,
    })
  }
  for (const f of fountains) {
    const d = Math.hypot(f.x - x, f.y - y)
    if (d > r) continue
    out.push({
      key: `fountain:${f.id}`,
      body: "fountain",
      flow: f.kind === "area:lavoir" ? 0.5 : 0.2,
      level: FOUNTAIN_DB - spreading(d, 1),
      x: f.x,
      y: f.y,
      z: heightAt(f.x, f.y) + 0.8,
    })
  }
  const d = Math.hypot(CASCATA.x - x, CASCATA.y - y)
  if (d <= r)
    out.push({
      key: CASCATA.key,
      body: "river",
      flow: 1,
      level: CASCATA.level - spreading(d, 1),
      x: CASCATA.x,
      y: CASCATA.y,
      z: CASCATA.z,
    })
  return out.filter((w) => w.level >= FLOOR).sort((a, b) => b.level - a.level)
}
