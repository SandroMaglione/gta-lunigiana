/**
 * Where the animals live, from the map: the farms (the buildings that stand on open, unpaved land), which of them are
 * rural, and the ground checks the animal spawns run (indoors, pasture, open ground, a spot off a wall). Built on first
 * use from `MAP` and the land cover (after `mapCover`, which the host builds while loading): static data shared by every
 * runtime, never written after.
 *
 * @module population/farms
 */
import { Ops, type Random } from "@typeonce/ritmo-math"

import { pointInRing, segDist2, staticGrid } from "../collide.ts"
import { type Cover, coverAt } from "../map/cover.ts"
import { buildingBoxes, buildingsIn, graph, heightAt, MAP } from "../map/index.ts"
import { distanceToEdge, edgeIndex, roadOf } from "../route.ts"
import { buildingCentre, residentsNear } from "./density.ts"

/** The buildings a farm can be: a farmhouse, its barn, shed, farm building or silo. */
const FARM_KINDS: ReadonlySet<string> = new Set(["house", "barn", "shed", "farm_auxiliary", "silo"])
/** The farm buildings pigs are kept by: a barn, a shed, a farm building (or any farm building on a farmyard). */
const PEN_KINDS: ReadonlySet<string> = new Set(["barn", "shed", "farm_auxiliary"])
/** Open, unpaved land: a farm stands on it, free dogs and pigs are put on it. Paved and residential cover are the villages. */
const OPEN: ReadonlySet<Cover> = new Set(["meadow", "grassland", "farmland", "farmyard"])
/** Where cows graze: open land but the farmyard. */
const PASTURE: ReadonlySet<Cover> = new Set(["meadow", "grassland", "farmland"])
/** A place with fewer residents than this within `RURAL_REACH` m is rural: cows and pigs are kept only there (TUNED). */
export const RURAL = 60
/** The reach of the residents count that tells rural from village, m. */
export const RURAL_REACH = 140
/** A herd grazes at least this far from any building and from any road's edge, and at most this far from a rural farm, m. */
const PASTURE_ROOM = { building: 15, road: 5, farm: 250 } as const
/** Steepest ground (rise over run) a herd or pen is put on: 0.47 is 25°, steep for a pasture (TUNED). */
const STEEPEST = 0.47

/** A farm: the building (index into `MAP.buildings`), its centre, whether it is rural, and whether pigs are kept by it. */
export interface Farm {
  readonly building: number
  readonly x: number
  readonly y: number
  readonly rural: boolean
  readonly pen: boolean
}

/** Grid cell of the farm lookup, m. */
const FARM_CELL = 64

const build = () => {
  const list: Array<Farm> = []
  MAP.buildings.forEach((b, i) => {
    if (!FARM_KINDS.has(b.kind) || b.ruins === true) return
    const { x, y } = buildingCentre(i)
    const cover = coverAt(x, y)
    if (!OPEN.has(cover)) return
    list.push({
      building: i,
      x,
      y,
      rural: residentsNear(x, y, RURAL_REACH) < RURAL,
      pen: PEN_KINDS.has(b.kind) || cover === "farmyard",
    })
  })
  const grid = staticGrid(
    list.length,
    (k) => [list[k]!.x, list[k]!.y, list[k]!.x, list[k]!.y],
    FARM_CELL,
  )
  // Roads in tunnels run under the fields: they keep no herd off.
  const roads = edgeIndex(graph.edges.flatMap((_, e) => (roadOf(e).tunnel === true ? [] : [e])))
  return { list, grid, roads }
}
/**
 * Built on first use: 2,405 farms on the current map, 1,710 of them rural, in 8–10 ms once the land cover exists (`mapCover`,
 * which the browser builds while loading; in Node the first call builds it too, about 0.1 s more). The first fill (`FillAnimals`,
 * in `setup`) asks for farms, so the build happens behind the title card, not in play.
 */
let built: ReturnType<typeof build> | undefined
const data = () => (built ??= build())

/** The farms whose centre is within `r` m of (x, y), in a fixed order. */
export const farmsNear = (x: number, y: number, r: number): Array<Farm> => {
  const { list, grid } = data()
  const found: Array<Farm> = []
  grid(x - r, y - r, x + r, y + r, (k) => {
    const f = list[k]!
    if ((f.x - x) ** 2 + (f.y - y) ** 2 <= r * r) found.push(f)
  })
  return found
}

/** Whether (x, y) is inside a building (not in a courtyard). */
export const indoors = (x: number, y: number): boolean => {
  let inside = false
  buildingsIn(x, y, x, y, (i) => {
    const { outer, holes } = MAP.buildings[i]!
    inside ||= pointInRing(x, y, outer) && !(holes ?? []).some((h) => pointInRing(x, y, h))
  })
  return inside
}

/** The buildings (indices into `MAP.buildings`, ruins left out) whose bounding box comes within `r` m of (x, y), in a fixed order. */
export const buildingsNear = (x: number, y: number, r: number): Array<number> => {
  const found: Array<number> = []
  buildingsIn(x - r, y - r, x + r, y + r, (i) => {
    const [x0, y0, x1, y1] = buildingBoxes[i]!
    if (
      MAP.buildings[i]!.ruins !== true &&
      Math.max(x0 - x, 0, x - x1) ** 2 + Math.max(y0 - y, 0, y - y1) ** 2 <= r * r
    )
      found.push(i)
  })
  return found
}

/** Whether a building's walls come within `d` m of (x, y), or it stands on it. */
const nearBuilding = (x: number, y: number, d: number): boolean => {
  let near = false
  buildingsIn(x - d, y - d, x + d, y + d, (i) => {
    if (near) return
    const [x0, y0, x1, y1] = buildingBoxes[i]!
    if (Math.max(x0 - x, 0, x - x1) ** 2 + Math.max(y0 - y, 0, y - y1) ** 2 > d * d) return
    const { outer } = MAP.buildings[i]!
    for (let k = 0, n = outer.length; k < n && !near; k += 2) {
      near =
        segDist2(x, y, outer[k]!, outer[k + 1]!, outer[(k + 2) % n]!, outer[(k + 3) % n]!).d2 <=
        d * d
    }
    near ||= pointInRing(x, y, outer)
  })
  return near
}

/** The steepness (rise over run) of the terrain at (x, y), from its height 2 m either way. */
const slopeAt = (x: number, y: number): number =>
  Ops.hypot(heightAt(x + 2, y) - heightAt(x - 2, y), heightAt(x, y + 2) - heightAt(x, y - 2)) / 4

/** Whether (x, y) is open, unpaved land outdoors, not too steep: where a free dog or a pig may stand. */
export const openGround = (x: number, y: number): boolean =>
  OPEN.has(coverAt(x, y)) && slopeAt(x, y) <= STEEPEST && !indoors(x, y)

/**
 * Whether (x, y) is a pasture for a herd: meadow, grassland or farmland, not too steep, `PASTURE_ROOM` clear of buildings
 * and roads, near a rural farm.
 */
export const pasture = (x: number, y: number): boolean => {
  if (
    !PASTURE.has(coverAt(x, y)) ||
    slopeAt(x, y) > STEEPEST ||
    nearBuilding(x, y, PASTURE_ROOM.building)
  )
    return false
  const road = data().roads.nearest(x, y)
  if (distanceToEdge(road, x, y) - roadOf(road).w / 2 < PASTURE_ROOM.road) return false
  return farmsNear(x, y, PASTURE_ROOM.farm).some((f) => f.rural)
}

/** Whether (x, y) is grass a cow of the herd can stand on: pasture cover, not too steep, outdoors. */
export const grazing = (x: number, y: number): boolean =>
  PASTURE.has(coverAt(x, y)) && slopeAt(x, y) <= STEEPEST && !indoors(x, y)

/** A point `distance` m out from a random spot on the outside of building `i`'s walls (a wall picked by its length). */
export const offWall = (
  i: number,
  distance: number,
  random: Random.Random,
): { readonly x: number; readonly y: number } => {
  const { outer } = MAP.buildings[i]!
  const n = outer.length
  // The ring's turning sense: counter-clockwise rings have the outside on the right of each wall.
  let twice = 0
  for (let k = 0; k < n; k += 2)
    twice += outer[k]! * outer[(k + 3) % n]! - outer[(k + 2) % n]! * outer[k + 1]!
  const out = twice > 0 ? 1 : -1
  const walls = Array.from({ length: n / 2 }, (_, w) => 2 * w)
  const k =
    random.weighted(walls, (w) =>
      Ops.hypot(outer[(w + 2) % n]! - outer[w]!, outer[(w + 3) % n]! - outer[w + 1]!),
    ) ?? 0
  const ax = outer[k]!,
    ay = outer[k + 1]!,
    ex = outer[(k + 2) % n]! - ax,
    ey = outer[(k + 3) % n]! - ay
  const length = Math.max(Ops.hypot(ex, ey), 1e-9),
    t = random.next()
  return {
    x: ax + ex * t + (out * ey * distance) / length,
    y: ay + ey * t - (out * ex * distance) / length,
  }
}
