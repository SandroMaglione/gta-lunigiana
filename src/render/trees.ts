/**
 * Trees: chestnut-like round canopies and a few conifers, one
 * InstancedMesh per kind per chunk, built when the chunk streams in. Trees near the map edge are
 * mirrored into the apron so the forest does not stop at the bounds. A `canopy` vertex attribute
 * (1 on the crown, 0 on the trunk) tells the tree material what sways in the wind.
 *
 * @module render/trees
 */
import {
  Color,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Material,
} from "three"

import { MAP } from "../sim/map/index.ts"
import { hash01 } from "../tools/geometry.ts"
import { APRON, chunkOf } from "./chunks.ts"
import { merge, paint } from "./geometry.ts"
import { terrainY } from "./ground.ts"
import { PALETTE } from "./palette.ts"

const KINDS = ["broadleaf", "conifer"] as const
type TreeKind = (typeof KINDS)[number]

/** `piece` marked as crown (1: it sways rigidly in the wind) or trunk (0: it stays). */
const crown = (piece: BufferGeometry, sways: 0 | 1): BufferGeometry =>
  piece.setAttribute(
    "canopy",
    new Float32BufferAttribute(
      new Float32Array(piece.getAttribute("position").count).fill(sways),
      1,
    ),
  )

/** Each kind's crown at unit scale, m: its radius, its height and its centre's height over the trunk's base. */
const CROWN = {
  broadleaf: { radius: 3, height: 5, at: 4.2 },
  conifer: { radius: 2, height: 6.5, at: 4.2 },
} as const satisfies Record<TreeKind, { radius: number; height: number; at: number }>

/** Unit-scale tree shapes (≈ 7 m tall), trunk base at the origin; shared by every chunk. */
const shapes = {
  broadleaf: merge([
    crown(paint(new CylinderGeometry(0.22, 0.3, 2, 5).translate(0, 1, 0), PALETTE.woodBrown), 0),
    crown(
      paint(
        new IcosahedronGeometry(1, 0)
          .scale(CROWN.broadleaf.radius, CROWN.broadleaf.height / 2, CROWN.broadleaf.radius)
          .translate(0, CROWN.broadleaf.at, 0),
        PALETTE.forest,
      ),
      1,
    ),
  ]),
  conifer: merge([
    crown(
      paint(new CylinderGeometry(0.18, 0.24, 1.6, 5).translate(0, 0.8, 0), PALETTE.woodBrown),
      0,
    ),
    crown(
      paint(
        new ConeGeometry(CROWN.conifer.radius, CROWN.conifer.height, 6).translate(
          0,
          CROWN.conifer.at,
          0,
        ),
        PALETTE.conifer,
      ),
      1,
    ),
  ]),
} as const satisfies Record<TreeKind, BufferGeometry>

/** Linear multipliers on the canopy colour: mid, sunlit, shaded. */
const TINTS = [new Color(1, 1, 1), new Color(1.35, 1.3, 1.1), new Color(0.75, 0.78, 0.72)] as const

/**
 * Share of conifers: conifer woods and half the mixed ones are 3% of the woodland around the valley
 * (Regione Toscana land cover 2019); the rest is chestnut and hop-hornbeam, then beech higher up.
 */
const CONIFERS = 0.03

/** The kind of the tree drawn from `seed`. */
const kindOf = (seed: number): TreeKind => (hash01(seed, 11) < CONIFERS ? "conifer" : "broadleaf")
/** The drawn scale of a tree of map scale `scale` drawn from `seed`. */
const sizeOf = (seed: number, scale: number): number => scale * (0.85 + 0.3 * hash01(seed, 9))
/** Render y of a tree's trunk base at (x, y): a little into the ground, so no slope shows under it. */
const baseY = (x: number, y: number): number => terrainY(x, y) - 0.2

/**
 * Whether the point (x, y) at render height `h` lies in the crown of tree `k` (`MAP.trees` at 3k,
 * as `treesIn` gives it): the broadleaf's ellipsoid, or the conifer's cone, as drawn.
 */
export const inCrown = (k: number, x: number, y: number, h: number): boolean => {
  const tx = MAP.trees[3 * k]!,
    ty = MAP.trees[3 * k + 1]!,
    seed = 3 * k,
    s = sizeOf(seed, MAP.trees[3 * k + 2]!),
    kind = kindOf(seed),
    { radius, height, at } = CROWN[kind]
  const across = Math.hypot(x - tx, y - ty) / (radius * s),
    up = (h - baseY(tx, ty)) / s - at
  if (kind === "broadleaf") return across * across + ((2 * up) / height) ** 2 < 1
  // The cone narrows from its full radius at its base to nothing at its tip.
  return Math.abs(up) < height / 2 && across < 0.5 - up / height
}

/** Calls `visit` for each tree of MAP.trees and each mirror image of the trees within the apron width of an edge. */
const eachTree = (visit: (x: number, y: number, scale: number, seed: number) => void): void => {
  const { minX, minY, maxX, maxY } = MAP.bounds
  const reach = APRON * MAP.heightmap.cell
  for (let i = 0; i + 2 < MAP.trees.length; i += 3) {
    const x = MAP.trees[i]!,
      y = MAP.trees[i + 1]!,
      scale = MAP.trees[i + 2]!
    visit(x, y, scale, i)
    // Most trees are far from every edge: no mirrors, so skip building the lists below.
    if (x - minX >= reach && maxX - x >= reach && y - minY >= reach && maxY - y >= reach) continue
    const xs = [
      x,
      ...(x - minX < reach ? [2 * minX - x] : []),
      ...(maxX - x < reach ? [2 * maxX - x] : []),
    ]
    const ys = [
      y,
      ...(y - minY < reach ? [2 * minY - y] : []),
      ...(maxY - y < reach ? [2 * maxY - y] : []),
    ]
    for (const mx of xs) for (const my of ys) if (mx !== x || my !== y) visit(mx, my, scale, i + 1)
  }
}

/** One chunk's trees per kind: flat (x, y, scale, seed) quadruples. */
type ChunkTrees = Record<TreeKind, Array<number>>

/** Every tree (apron mirrors included) bucketed by chunk and kind, once. */
export const bucketTrees = (): Map<number, ChunkTrees> => {
  const chunks = new Map<number, ChunkTrees>()
  eachTree((x, y, scale, seed) => {
    const kind = kindOf(seed)
    const key = chunkOf(x, y)
    let trees = chunks.get(key)
    if (trees === undefined) chunks.set(key, (trees = { broadleaf: [], conifer: [] }))
    trees[kind].push(x, y, scale, seed)
  })
  return chunks
}

const matrix = new Matrix4(),
  rotation = new Quaternion(),
  up = new Vector3(0, 1, 0),
  at = new Vector3(),
  size = new Vector3()
/** The tree meshes of one chunk, one per kind it has. Dispose them with `InstancedMesh.dispose` (the shapes are shared). */
export const treeMeshes = (trees: ChunkTrees, material: Material): Array<InstancedMesh> => {
  const meshes: Array<InstancedMesh> = []
  for (const kind of KINDS) {
    const list = trees[kind]
    if (list.length === 0) continue
    const mesh = new InstancedMesh(shapes[kind], material, list.length / 4)
    for (let i = 0; i < mesh.count; i++) {
      const x = list[4 * i]!,
        y = list[4 * i + 1]!,
        scale = list[4 * i + 2]!,
        seed = list[4 * i + 3]!
      rotation.setFromAxisAngle(up, hash01(seed, 5) * Math.PI * 2)
      const s = sizeOf(seed, scale)
      mesh.setMatrixAt(i, matrix.compose(at.set(x, baseY(x, y), -y), rotation, size.set(s, s, s)))
      mesh.setColorAt(i, TINTS[Math.floor(hash01(seed, 13) * TINTS.length)]!)
    }
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere() // after setMatrixAt, or culling keeps a stale sphere
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.matrixAutoUpdate = false
    meshes.push(mesh)
  }
  return meshes
}
