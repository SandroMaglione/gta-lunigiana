/**
 * The chunk grid the static world is cut into (128 m squares over the heightmap plus its apron)
 * and the streaming plan: which chunks to build and which to drop for a camera focus. Distances
 * are measured on the screen plane (the camera's right and up axes) against each chunk's box,
 * terrain relief included, so a valley far below a ridge still counts as near when the camera
 * shows it next to the focus.
 *
 * @module render/chunks
 */
import type { Vector3 } from "three"

import { MAP } from "../sim/map/index.ts"
import { terrainNodeY } from "./ground.ts"

const hm = MAP.heightmap
/** Cells per chunk side (32 × 4 m = 128 m). */
const CHUNK_CELLS = 32
/** Chunk side in metres. */
const CHUNK = CHUNK_CELLS * hm.cell
/**
 * Apron cells beyond each map edge (192 m): more than the camera shows past the bounds from any
 * road, mountain edges included (where the SP10 leaves the map the view reaches about 150 m out).
 */
export const APRON = 48
/** Heightmap cells along x and y. */
export const CELLS = { x: hm.cols - 1, y: hm.rows - 1 } as const
/** South-west corner of chunk (0, 0), metres. */
const ORIGIN = { x: hm.x0 - APRON * hm.cell, y: hm.y0 - APRON * hm.cell } as const
/** Chunk counts along x and y, apron included. */
export const CHUNKS = {
  x: Math.ceil((CELLS.x + 2 * APRON) / CHUNK_CELLS),
  y: Math.ceil((CELLS.y + 2 * APRON) / CHUNK_CELLS),
} as const

/** Chunk key of a map point (any static piece goes in the chunk holding its anchor); clamps to the grid. */
export const chunkOf = (x: number, y: number): number => {
  const cx = Math.min(CHUNKS.x - 1, Math.max(0, Math.floor((x - ORIGIN.x) / CHUNK)))
  const cy = Math.min(CHUNKS.y - 1, Math.max(0, Math.floor((y - ORIGIN.y) / CHUNK)))
  return cy * CHUNKS.x + cx
}

/** Heightmap cells [i0, i1) × [j0, j1) of chunk `key`; apron cells lie outside the grid (negative or past the end). */
export const chunkCells = (
  key: number,
): { readonly i0: number; readonly j0: number; readonly i1: number; readonly j1: number } => {
  const i0 = -APRON + (key % CHUNKS.x) * CHUNK_CELLS,
    j0 = -APRON + Math.floor(key / CHUNKS.x) * CHUNK_CELLS
  return {
    i0,
    j0,
    i1: Math.min(i0 + CHUNK_CELLS, CELLS.x + APRON),
    j1: Math.min(j0 + CHUNK_CELLS, CELLS.y + APRON),
  }
}

/** Room above a chunk's highest terrain node for what stands on it (towers, roofs, trees), m. */
const HEADROOM = 50
/** Room below its lowest node (river beds), m. */
const FOOTROOM = 5

/**
 * Every chunk's box: flat (x0, x1, y0, y1, low, high) per key, map metres and three-space heights,
 * from its terrain nodes plus room for what stands on them. Reading the terrain is the slow part,
 * so this is computed once; `screenRects` projects the boxes for whichever way the view is turned.
 */
export const chunkBoxes = (): Float32Array => {
  const out = new Float32Array(CHUNKS.x * CHUNKS.y * 6)
  for (let key = 0; key < CHUNKS.x * CHUNKS.y; key++) {
    const { i0, j0, i1, j1 } = chunkCells(key)
    let low = Number.MAX_VALUE,
      high = -Number.MAX_VALUE
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const h = terrainNodeY(i, j)
        low = Math.min(low, h)
        high = Math.max(high, h)
      }
    out.set(
      [
        hm.x0 + i0 * hm.cell,
        hm.x0 + i1 * hm.cell,
        hm.y0 + j0 * hm.cell,
        hm.y0 + j1 * hm.cell,
        low - FOOTROOM,
        high + HEADROOM,
      ],
      key * 6,
    )
  }
  return out
}

/**
 * The screen-plane rectangle of every chunk box of `boxes` for a camera with axes `right` and `up`
 * (three space), written into `out`: flat (right0, right1, up0, up1) per key.
 */
export const screenRects = (
  boxes: Float32Array,
  right: Vector3,
  up: Vector3,
  out: Float32Array,
): Float32Array => {
  for (let key = 0; key < out.length / 4; key++) {
    let r0 = Number.MAX_VALUE,
      r1 = -Number.MAX_VALUE,
      u0 = Number.MAX_VALUE,
      u1 = -Number.MAX_VALUE
    for (let corner = 0; corner < 8; corner++) {
      const x = boxes[key * 6 + (corner & 1)]!,
        y = boxes[key * 6 + 2 + ((corner >> 1) & 1)]!,
        h = boxes[key * 6 + 4 + (corner >> 2)]!
      // three space: (x, h, -y)
      const r = x * right.x + h * right.y - y * right.z,
        u = x * up.x + h * up.y - y * up.z
      r0 = Math.min(r0, r)
      r1 = Math.max(r1, r)
      u0 = Math.min(u0, u)
      u1 = Math.max(u1, u)
    }
    out[key * 4] = r0
    out[key * 4 + 1] = r1
    out[key * 4 + 2] = u0
    out[key * 4 + 3] = u1
  }
  return out
}

/** Screen distance (m) from the point (r, u) to each rectangle of `rects`, written into `out`. */
export const screenDistances = (
  rects: Float32Array,
  r: number,
  u: number,
  out: Float32Array,
): Float32Array => {
  for (let key = 0; key < out.length; key++) {
    const dr = Math.max(rects[key * 4]! - r, 0, r - rects[key * 4 + 1]!),
      du = Math.max(rects[key * 4 + 2]! - u, 0, u - rects[key * 4 + 3]!)
    out[key] = Math.hypot(dr, du)
  }
  return out
}

/** Load and unload radii, screen metres; `unload` > `load` keeps a chunk at the rim from flickering in and out. */
interface Radii {
  readonly load: number
  readonly unload: number
}

/** Screen metres kept loaded beyond what the view shows: a chunk is built well before it comes into sight. */
const MARGIN = 64

/**
 * Radii for a view that shows `reach` screen metres from its centre: load within the margin,
 * drop one chunk side further out.
 */
export const radiiFor = (reach: number): Radii => ({
  load: reach + MARGIN,
  unload: reach + MARGIN + CHUNK,
})

/**
 * The streaming plan for chunk `distances` (by key): chunks to build (not loaded, within
 * `load`), nearest first, and loaded chunks to drop (beyond `unload`). Chunks between the two
 * radii stay as they are.
 */
export const plan = (
  distances: ArrayLike<number>,
  loaded: { has: (key: number) => boolean },
  radii: Radii,
) => {
  const build: Array<number> = [],
    drop: Array<number> = []
  for (let key = 0; key < distances.length; key++) {
    const d = distances[key]!
    if (loaded.has(key)) {
      if (d > radii.unload) drop.push(key)
    } else if (d <= radii.load) build.push(key)
  }
  build.sort((a, b) => distances[a]! - distances[b]!)
  return { build, drop }
}
