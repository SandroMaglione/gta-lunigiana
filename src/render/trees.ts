/**
 * Trees: chestnut-like round canopies and a few conifers, one
 * InstancedMesh per kind per chunk, built when the chunk streams in. Trees near the map edge are
 * mirrored into the apron so the forest does not stop at the bounds.
 *
 * @module render/trees
 */
import {
  Color,
  ConeGeometry,
  CylinderGeometry,
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

/** Unit-scale tree shapes (≈ 7 m tall), trunk base at the origin; shared by every chunk. */
const shapes = {
  broadleaf: merge([
    paint(new CylinderGeometry(0.22, 0.3, 2, 5).translate(0, 1, 0), PALETTE.woodBrown),
    paint(new IcosahedronGeometry(1, 0).scale(3, 2.5, 3).translate(0, 4.2, 0), PALETTE.forest),
  ]),
  conifer: merge([
    paint(new CylinderGeometry(0.18, 0.24, 1.6, 5).translate(0, 0.8, 0), PALETTE.woodBrown),
    paint(new ConeGeometry(2, 6.5, 6).translate(0, 4.2, 0), PALETTE.conifer),
  ]),
} as const satisfies Record<TreeKind, BufferGeometry>

/** Linear multipliers on the canopy colour: mid, sunlit, shaded. */
const TINTS = [new Color(1, 1, 1), new Color(1.35, 1.3, 1.1), new Color(0.75, 0.78, 0.72)] as const

/**
 * Share of conifers: conifer woods and half the mixed ones are 3% of the woodland around the valley
 * (Regione Toscana land cover 2019); the rest is chestnut and hop-hornbeam, then beech higher up.
 */
const CONIFERS = 0.03

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
    const kind: TreeKind = hash01(seed, 11) < CONIFERS ? "conifer" : "broadleaf"
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
      const s = scale * (0.85 + 0.3 * hash01(seed, 9))
      mesh.setMatrixAt(
        i,
        matrix.compose(at.set(x, terrainY(x, y) - 0.2, -y), rotation, size.set(s, s, s)),
      )
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
