/**
 * Where the ground is, in render space. Three world = (x = east, y = elevation − ELEVATION_BASE,
 * z = −north). The heights themselves are the sim's (`src/sim/map/ground.ts`), so the terrain
 * mesh, the road ribbons, every actor and the wheels the physics rolls on agree.
 *
 * @module render/ground
 */
import { groundZ, roadZ, terrainNodeZ, terrainZ } from "../sim/map/ground.ts"

/** Metres a.s.l. subtracted from every elevation before it reaches the GPU (the map spans ≈150–1800 m). */
const ELEVATION_BASE = 200

/** Render y of a map elevation (m a.s.l.). */
export const yOf = (z: number): number => z - ELEVATION_BASE

/** Terrain node height at grid index (i, j), row 0 = south, clamped to the edge (the apron). */
export const terrainNodeY = (i: number, j: number): number => yOf(terrainNodeZ(i, j))

/** Terrain height under (x, y) on the rendered mesh. */
export const terrainY = (x: number, y: number): number => yOf(terrainZ(x, y))

/** Surface y of a road whose profile is `z` (m a.s.l.) at (x, y): at-grade roads never dip under the terrain mesh. */
export const surfaceY = (z: number, x: number, y: number, lift: number, lifted: boolean): number =>
  yOf(roadZ(z, x, y, lift, lifted))

/** Where an actor at (x, y) stands in render y, keeping to the level nearest `near` (its previous render height); see `groundZ`. */
export const groundY = (x: number, y: number, near?: number): number =>
  yOf(groundZ(x, y, near === undefined ? undefined : near + ELEVATION_BASE))
