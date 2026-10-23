/**
 * Where the player is, in words: the name of the nearest road, if it has one (tracks and paths
 * skipped, their refs are trail numbers), and the district from the map.
 *
 * @module hud/location
 */
import { districtAt, MAP, roadClassOf } from "../sim/map/index.ts"
import { segDist2 } from "../tools/geometry.ts"

/** Roads the HUD can name, with their name or ref (undefined on unnamed roads), as segments `[ax, ay, bx, by, ...]`. */
const roads = MAP.roads
  .filter((road) => {
    const cls = roadClassOf(road)
    return cls !== "track" && cls !== "path"
  })
  .map((road) => ({ name: road.name ?? road.ref, pts: road.pts }))

/** The name of the nearest road within `reach` metres of (x, y); undefined when that road has none. */
// ponytail: brute force over ~4k segments (0.02 ms a call, at most one a frame); add a grid if it ever shows in a profile.
const roadNear = (x: number, y: number, reach = 15): string | undefined => {
  let best = reach * reach,
    found: string | undefined
  for (const road of roads)
    for (let i = 0; i + 3 < road.pts.length; i += 2) {
      const d = segDist2(
        x,
        y,
        road.pts[i]!,
        road.pts[i + 1]!,
        road.pts[i + 2]!,
        road.pts[i + 3]!,
      ).d2
      if (d < best) [best, found] = [d, road.name]
    }
  return found
}

/** Road (if any) and district at (x, y). */
export const locationAt = (
  x: number,
  y: number,
): { readonly road: string | undefined; readonly district: string } => ({
  road: roadNear(x, y),
  district: districtAt(x, y).name,
})
