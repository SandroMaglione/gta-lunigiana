// Encoder of monzone.bin (before gzip); the format and the decoder (`decodeMap`) are in
// src/sim/map/packed.ts. Every value must fit its section, or the build throws.
import type { MonzoneMap, MonzoneMapJson } from "../sim/map/index.ts"
import { packOrigin, treeOrigin } from "../sim/map/packed.ts"

interface Corner {
  readonly minX: number
  readonly minY: number
}

/** `values` as `size` byte planes of zigzag deltas from the value `stride` back, each an int32 whose delta fits. */
const pack = (values: ArrayLike<number>, size: 2 | 4, stride: number, what: string): Buffer => {
  const n = values.length,
    out = Buffer.alloc(n * size)
  for (let k = 0; k < n; k++) {
    const v = values[k]!,
      d = v - (k >= stride ? values[k - stride]! : 0),
      z = d < 0 ? -2 * d - 1 : 2 * d
    if (!Number.isInteger(v) || v < -(2 ** 31) || v >= 2 ** 31)
      throw new Error(`${what}: ${v} at ${k} is not an int32`)
    if (z >= 2 ** (8 * size))
      throw new Error(
        `${what}: ${v} at ${k} is ${d} from the value ${stride} back, too far for ${size} bytes`,
      )
    for (let p = 0; p < size; p++) out[p * n + k] = Math.floor(z / 256 ** p) % 256
  }
  return out
}

/** Integer decimetres (int16: the game keeps them in an `Int16Array`), rows of `cols` values each delta-coded from its first. */
const packRows = (dm: ArrayLike<number>, cols: number): Buffer =>
  pack(
    Array.from(dm, (v, k) => {
      if (v < -32768 || v > 32767) throw new Error(`heightmap: ${v} at ${k} does not fit int16`)
      return k % cols === 0 ? v : v - dm[k - 1]!
    }),
    2,
    cols,
    "heightmap",
  )

/** Wall segments (ax, ay, bx, by) as decimetres from `packOrigin(bounds)`. */
const packWalls = (flat: ArrayLike<number>, bounds: Corner, what: string): Buffer => {
  const o = packOrigin(bounds)
  return pack(
    Array.from(flat, (v, k) => Math.round(v * 10) - (k % 2 === 0 ? o.x : o.y)),
    4,
    2,
    what,
  )
}

/** Trees (x, y, scale) on whole metres: metres from `treeOrigin(bounds)`, the scale in hundredths. */
const packTrees = (flat: ArrayLike<number>, bounds: Corner): Buffer => {
  const o = treeOrigin(bounds)
  return pack(
    Array.from(flat, (v, k) => {
      const c = k % 3
      return c === 2 ? Math.round(v * 100) : v - (c === 0 ? o.x : o.y)
    }),
    2,
    3,
    "trees",
  )
}

/** The gunzipped map file `decodeMap` reads back into `map`, and the bytes of each of its parts. */
export const packMap = (
  map: MonzoneMap,
): { readonly file: Buffer; readonly sizes: Readonly<Record<string, number>> } => {
  const {
    heightmap: { data, ...heightmap },
    walls,
    trees,
    bounds,
  } = map
  const json: MonzoneMapJson = {
    ...map,
    heightmap,
    walls: {
      walk: walls.walk.length / 4,
      shore: walls.shore.length / 4,
      drive: walls.drive.length / 4,
    },
    trees: trees.length / 3,
  }
  const parts = {
    // file order
    json: Buffer.from(`${JSON.stringify(json)}\n`),
    heightmap: packRows(data, heightmap.cols),
    walk: packWalls(walls.walk, bounds, "walk walls"),
    shore: packWalls(walls.shore, bounds, "shore walls"),
    drive: packWalls(walls.drive, bounds, "drive walls"),
    trees: packTrees(trees, bounds),
  }
  return {
    file: Buffer.concat(Object.values(parts)),
    sizes: Object.fromEntries(Object.entries(parts).map(([part, b]) => [part, b.length])),
  }
}
