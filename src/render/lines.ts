/**
 * Ribbons along map polylines (roads, water, rail), the bridge decks under them and station
 * platforms, as pieces the streamed world draws chunk by chunk. Ribbons are densified so they
 * follow the terrain facets and go in the decal layer.
 *
 * @module render/lines
 */
import { ExtrudeGeometry, Shape, Vector2 } from "three"

import { ROAD_LIFT } from "../sim/map/ground.ts"
import { MAP, roadClassOf, type Road } from "../sim/map/index.ts"
import { surfaceY, terrainY, yOf } from "./ground.ts"
import { APRON } from "./chunks.ts"
import { paint, type Piece, type SinkAt, type Triangles } from "./geometry.ts"
import { PALETTE } from "./palette.ts"

/** A strip along a polyline. `y` gives the render height of an edge point from the centreline elevation there. */
interface RibbonSpec {
  readonly pts: ReadonlyArray<number>
  /** Elevation (m a.s.l.) per vertex of `pts`. */
  readonly z: ReadonlyArray<number>
  readonly width: number
  readonly hex: number
  readonly y: (x: number, y: number, z: number) => number
  /** Lateral shift of the strip's centre, metres (positive = left of travel). */
  readonly offset?: number
  /** Dash length (m): draw every other `dash` metres. */
  readonly dash?: number
}

const { minX, minY, maxX, maxY } = MAP.bounds
const OUT = APRON * MAP.heightmap.cell
/** Where (x, y) on the bounds goes when pushed straight out across the apron, or undefined if it is inside. */
const outward = (x: number, y: number): readonly [number, number] | undefined =>
  x <= minX + 0.5 ? [x - OUT, y] : x >= maxX - 0.5 ? [x + OUT, y] : y <= minY + 0.5 ? [x, y - OUT] : y >= maxY - 0.5 ? [x, y + OUT] : undefined

/**
 * A line that leaves the map continues straight across the apron at its edge elevation, like the
 * apron terrain (edge heights extruded outwards), so roads and rivers do not stop at the bounds.
 */
const throughApron = (pts: ReadonlyArray<number>, z: ReadonlyArray<number>): { pts: Array<number>; z: Array<number> } => {
  const head = outward(pts[0]!, pts[1]!), tail = outward(pts.at(-2)!, pts.at(-1)!)
  return {
    pts: [...(head ?? []), ...pts, ...(tail ?? [])],
    z: [...(head === undefined ? [] : [z[0]!]), ...z, ...(tail === undefined ? [] : [z.at(-1)!])]
  }
}

/**
 * Adds segments k0..k1 of a ribbon to the decal layer of the chunks they cross. Their neighbours
 * are densified too, for the mitres, and their quads go wherever `at` puts them; the arc length
 * (dashes) still counts from the start of the line.
 */
const ribbon = (at: SinkAt, spec: RibbonSpec, k0: number, k1: number): void => {
  const step = spec.dash === undefined ? 2 : Math.min(1, spec.dash / 2)
  const xs: Array<number> = [], ys: Array<number> = [], zs: Array<number> = [], ss: Array<number> = []
  const first = Math.max(0, k0 - 1), last = Math.min(spec.z.length - 2, k1 + 1)
  let s = 0
  for (let k = 0; k < first; k++) s += Math.hypot(spec.pts[2 * k + 2]! - spec.pts[2 * k]!, spec.pts[2 * k + 3]! - spec.pts[2 * k + 1]!)
  for (let k = first; k <= last; k++) {
    const ax = spec.pts[2 * k]!, ay = spec.pts[2 * k + 1]!, bx = spec.pts[2 * k + 2]!, by = spec.pts[2 * k + 3]!
    const len = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(len / step))
    for (let j = 0; j < n; j++) {
      xs.push(ax + ((bx - ax) * j) / n)
      ys.push(ay + ((by - ay) * j) / n)
      zs.push(spec.z[k]! + ((spec.z[k + 1]! - spec.z[k]!) * j) / n)
      ss.push(s + (len * j) / n)
    }
    s += len
  }
  xs.push(spec.pts[2 * last + 2]!)
  ys.push(spec.pts[2 * last + 3]!)
  zs.push(spec.z[last + 1]!)
  ss.push(s)
  const count = xs.length
  if (count < 2) return
  // Left normal of segment i, then mitred edge points per vertex (clamped at sharp corners).
  const left = (i: number): readonly [number, number] => {
    const dx = xs[i + 1]! - xs[i]!, dy = ys[i + 1]! - ys[i]!, l = Math.hypot(dx, dy) || 1
    return [-dy / l, dx / l]
  }
  const half = spec.width / 2, offset = spec.offset ?? 0
  const edges: Array<readonly [number, number, number, number, number, number]> = []
  for (let i = 0; i < count; i++) {
    const a = left(Math.max(0, i - 1)), b = left(Math.min(count - 2, i))
    let mx = a[0] + b[0], my = a[1] + b[1]
    const ml = Math.hypot(mx, my) || 1
    mx /= ml
    my /= ml
    const k = 1 / Math.max(mx * b[0] + my * b[1], 0.5)
    const lx = xs[i]! + mx * (offset + half) * k, ly = ys[i]! + my * (offset + half) * k
    const rx = xs[i]! + mx * (offset - half) * k, ry = ys[i]! + my * (offset - half) * k
    edges.push([lx, ly, spec.y(lx, ly, zs[i]!), rx, ry, spec.y(rx, ry, zs[i]!)])
  }
  for (let i = 0; i + 1 < count; i++) {
    if (spec.dash !== undefined && Math.floor((ss[i]! + ss[i + 1]!) / 2 / spec.dash) % 2 === 1) continue
    const [lx0, ly0, lh0, rx0, ry0, rh0] = edges[i]!, [lx1, ly1, lh1, rx1, ry1, rh1] = edges[i + 1]!
    // Right edge forward, then left edge back: counter-clockwise seen from above.
    at((xs[i]! + xs[i + 1]!) / 2, (ys[i]! + ys[i + 1]!) / 2).decal.quad(
      [rx0, rh0, -ry0], [rx1, rh1, -ry1], [lx1, lh1, -ly1], [lx0, lh0, -ly0], spec.hex)
  }
}

/**
 * A box swept from (ax, ay) to (bx, by) whose bottom and top follow the heights `ya` → `yb`
 * (sheared, so consecutive pieces join on slopes); `offset` shifts it sideways (left positive).
 */
const prism = (tris: Triangles, ax: number, ay: number, ya: number, bx: number, by: number, yb: number,
  offset: number, width: number, bottom: number, top: number, hex: number): void => {
  const dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy) || 1
  const nx = -dy / l, ny = dx / l
  const p = (end: 0 | 1, side: number, level: number) => {
    const w = offset + (side * width) / 2
    return [(end === 0 ? ax : bx) + nx * w, (end === 0 ? ya : yb) + level, -((end === 0 ? ay : by) + ny * w)] as const
  }
  tris.face(p(0, -1, top), p(1, -1, top), p(1, 1, top), p(0, 1, top), [0, 1, 0], hex)
  tris.face(p(0, -1, bottom), p(1, -1, bottom), p(1, 1, bottom), p(0, 1, bottom), [0, -1, 0], hex)
  tris.face(p(0, 1, bottom), p(1, 1, bottom), p(1, 1, top), p(0, 1, top), [nx, 0, -ny], hex)
  tris.face(p(0, -1, bottom), p(1, -1, bottom), p(1, -1, top), p(0, -1, top), [-nx, 0, ny], hex)
  tris.face(p(0, -1, bottom), p(0, 1, bottom), p(0, 1, top), p(0, -1, top), [-dx, 0, dy], hex)
  tris.face(p(1, -1, bottom), p(1, 1, bottom), p(1, 1, top), p(1, -1, top), [dx, 0, -dy], hex)
}

/** Deck slab under segments k0..k1 of a bridge and a low parapet along each side. */
const bridge = (at: SinkAt, pts: ReadonlyArray<number>, y: (k: number) => number, width: number, hex: number, k0: number, k1: number): void => {
  for (let k = 2 * k0; k <= 2 * k1 && k + 3 < pts.length; k += 2) {
    const ax = pts[k]!, ay = pts[k + 1]!, bx = pts[k + 2]!, by = pts[k + 3]!
    const tris = at((ax + bx) / 2, (ay + by) / 2).solid
    const ya = y(k / 2), yb = y(k / 2 + 1)
    prism(tris, ax, ay, ya, bx, by, yb, 0, width + 0.8, -0.9, -0.05, hex)
    for (const side of [-1, 1]) prism(tris, ax, ay, ya, bx, by, yb, side * (width / 2 + 0.25), 0.35, -0.1, 0.8, hex)
  }
}

/** The surface colour of a road. */
export const roadHex = (road: Road): number => {
  const cls = roadClassOf(road)
  if (cls === "steps") return PALETTE.stoneLight
  switch (road.surface) {
    case "asphalt": return cls === "service" || cls === "track" || cls === "path" ? PALETTE.asphaltWorn : PALETTE.asphalt
    case "cobblestone":
    case "pebblestone": return PALETTE.cobbleDark
    case "gravel": return PALETTE.stoneLight
    default: return PALETTE.dirtTrack
  }
}

/** Old masonry for small and historic bridges, concrete for the provincial roads. */
const bridgeHex = (road: Road): number => {
  const cls = roadClassOf(road)
  return cls === "tertiary" || cls === "unclassified" ? PALETTE.plasterGrey : PALETTE.stoneMid
}

/** A piece drawing every ribbon in `specs` along `line`. */
const strips = (line: { readonly pts: ReadonlyArray<number> }, specs: ReadonlyArray<RibbonSpec>): Piece =>
  ({ pts: line.pts, draw: (at, k0, k1) => { for (const spec of specs) ribbon(at, spec, k0, k1) } })

/** A piece drawing the deck under a bridge whose deck top is `y(k)` at vertex k. */
const deck = (pts: ReadonlyArray<number>, y: (k: number) => number, width: number, hex: number): Piece =>
  ({ pts, draw: (at, k0, k1) => bridge(at, pts, y, width, hex, k0, k1) })

/** Roads (with centre dashes on the provincial roads and decks on bridges); tunnels are not drawn. */
const roads = (): Array<Piece> => MAP.roads.flatMap((road) => {
  if (road.tunnel === true) return []
  const cls = roadClassOf(road), lift = ROAD_LIFT[cls], lifted = road.bridge === true
  const line = throughApron(road.pts, road.z)
  const specs: Array<RibbonSpec> = [{ ...line, width: road.w, hex: roadHex(road), y: (x, y, z) => surfaceY(z, x, y, lift, lifted) }]
  if (cls === "tertiary") {
    specs.push({ ...line, width: 0.25, hex: PALETTE.marbleWhite, dash: 3, y: (x, y, z) => surfaceY(z, x, y, lift + 0.02, lifted) })
  }
  return [strips(line, specs), ...(lifted ? [deck(road.pts, (k) => yOf(road.z[k]!) + lift, road.w, bridgeHex(road))] : [])]
})

/** Rivers and streams: a shallow ribbon with a deeper channel down the middle of the wide ones. */
const water = (): Array<Piece> => MAP.water.map((w) => {
  const line = throughApron(w.pts, w.z)
  return strips(line, [
    { ...line, width: w.w, hex: PALETTE.waterShallow, y: (_x, _y, z) => yOf(z) + 0.02 },
    ...(w.w >= 8 ? [{ ...line, width: w.w * 0.45, hex: PALETTE.waterDeep, y: (_x: number, _y: number, z: number) => yOf(z) + 0.04 }] : [])
  ])
})

const GAUGE = 1.435
/** The Lucca–Aulla line: ballast, sleepers and two rails; bridges get decks, tunnels are skipped. */
const rail = (): Array<Piece> => MAP.rail.flatMap((r) => {
  if (r.tunnel === true) return []
  const lifted = r.bridge === true
  const y = (lift: number) => (x: number, y: number, z: number) => surfaceY(z, x, y, lift, lifted)
  const line = throughApron(r.pts, r.z)
  const ribbons = strips(line, [
    { ...line, width: 3.2, hex: PALETTE.stoneMid, y: y(0.04) },
    { ...line, width: 2.4, hex: PALETTE.woodBrown, dash: 0.6, y: y(0.07) },
    ...[-1, 1].map((side) => ({ ...line, width: 0.18, hex: PALETTE.stoneDark, offset: (side * GAUGE) / 2, y: y(0.12) }))
  ])
  return [ribbons, ...(lifted ? [deck(r.pts, (k) => yOf(r.z[k]!) + 0.04, 3.2, PALETTE.stoneMid)] : [])]
})

/** Station platforms: a slab half a metre above the highest ground under it. */
const platforms = (): Array<Piece> => MAP.areas.flatMap((area) => {
  if (area.kind !== "platform") return []
  const outer = area.rings[0]!
  return [{
    pts: [outer[0]!, outer[1]!],
    draw: (at) => {
      const points: Array<Vector2> = []
      let top = -Number.MAX_VALUE
      for (let k = 0; k + 1 < outer.length; k += 2) {
        points.push(new Vector2(outer[k]!, outer[k + 1]!))
        top = Math.max(top, terrainY(outer[k]!, outer[k + 1]!))
      }
      const slab = new ExtrudeGeometry(new Shape(points), { depth: 2, bevelEnabled: false })
      slab.rotateX(-Math.PI / 2)
      slab.translate(0, top + 0.5 - 2, 0)
      at(outer[0]!, outer[1]!).pieces.push(paint(slab, PALETTE.asphaltWorn))
    }
  }]
})

/** Every line piece of the map (roads, water, rail) and the platforms, in draw order. */
export const linePieces = (): Array<Piece> => [...roads(), ...water(), ...rail(), ...platforms()]
