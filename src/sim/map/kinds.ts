/**
 * Map vocabulary shared by the build (src/tools) and the runtime map module:
 * where the map lies on the Earth, road classes, building styles, area kinds and the tree-trunk
 * wall size. Imports no data, so the build can use it before monzone.bin exists. Game code imports
 * these through `./index.ts`; the sky (`src/sim/sky`) reads the loaded map's place through
 * `place()` (sky/place.ts) instead.
 *
 * @module map/kinds
 */

/** The map's origin, degrees (north, east): x and y count metres east and north of it. The build projects with it and writes it as `MAP.origin`. */
export const ORIGIN = { lat: 44.16175, lon: 10.13 } as const

/**
 * Highway classes the build emits, widest first. The build folds OSM `primary` (the SR445) into
 * tertiary, `living_street` into residential, `footway` and `pedestrian` into path.
 */
export const ROAD_CLASSES = ["tertiary", "unclassified", "residential", "service", "track", "path", "steps"] as const
export type RoadClass = (typeof ROAD_CLASSES)[number]

const roadClasses: ReadonlySet<string> = new Set(ROAD_CLASSES)
/** Whether `cls` is one of ROAD_CLASSES. */
export const isRoadClass = (cls: string): cls is RoadClass => roadClasses.has(cls)

/**
 * Per class: carriageway width (m), whether it is asphalt when OSM names no surface, and who uses
 * it (AI traffic and the player's car, the player's car only, or only people on foot).
 */
export const ROADS = {
  tertiary: { w: 6.5, paved: true, use: "traffic" },
  unclassified: { w: 5, paved: true, use: "traffic" },
  residential: { w: 4.5, paved: true, use: "traffic" },
  service: { w: 3.5, paved: false, use: "traffic" },
  track: { w: 3, paved: false, use: "drive" },
  path: { w: 1.5, paved: false, use: "walk" },
  steps: { w: 2, paved: false, use: "walk" }
} as const satisfies Record<RoadClass, { readonly w: number; readonly paved: boolean; readonly use: "traffic" | "drive" | "walk" }>

/** Whether the player can drive a road of this class (tracks included). */
export const isDrivable = (cls: string): boolean => isRoadClass(cls) && ROADS[cls].use !== "walk"

/** Whether AI traffic may use a road of this class (drivable minus tracks). */
export const isTraffic = (cls: string): boolean => isRoadClass(cls) && ROADS[cls].use === "traffic"

/** Facade styles the build emits. */
export const BUILDING_STYLES = ["plaster", "stone", "church", "tower", "industrial", "station", "ruin"] as const
export type BuildingStyle = (typeof BUILDING_STYLES)[number]

/** Land-use kinds the build emits. */
export const AREA_KINDS = [
  "forest", "cemetery", "pitch", "park", "parking", "vineyard", "farmland", "farmyard", "industrial", "residential", "platform", "school", "ruins",
  "grassland", "paved", "quarry", "rock", "sparse", "scree", "scrub"
] as const
export type AreaKind = (typeof AREA_KINDS)[number]

const areaKinds: ReadonlySet<string> = new Set(AREA_KINDS)
/** Whether `kind` is one of AREA_KINDS. */
export const isAreaKind = (kind: string): kind is AreaKind => areaKinds.has(kind)

/** Side of the square wall around every tree trunk, m. */
export const TRUNK = 0.5

/** Appends the four edges (ax, ay, bx, by) of the TRUNK square centred on (x, y) to `out`. */
export const pushTrunk = (out: Array<number>, x: number, y: number): void => {
  const h = TRUNK / 2
  out.push(x - h, y - h, x + h, y - h, x + h, y - h, x + h, y + h, x + h, y + h, x - h, y + h, x - h, y + h, x - h, y - h)
}
