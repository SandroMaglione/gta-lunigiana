/**
 * A blood pool: a flat, dark red, low-poly disc with a ragged outline, spreading under a dead
 * body. It lies a few cm over the ground (each corner over the ground or road ribbon under it, so
 * it follows a slope or a kerb) and is pulled toward the camera in depth like the decals, so it
 * never fights what it lies on. Its node owns it and frees its geometry.
 *
 * @module render/pool
 */
import { BufferAttribute, BufferGeometry, DynamicDrawUsage, Mesh } from "three"

import { decalMaterial, linear } from "./geometry.ts"
import { PALETTE } from "./palette.ts"

/** Seconds a pool takes to reach its full size (TUNED: long enough to watch it spread, short enough to see it end). */
export const SPREAD = 6
/** Metres over the ground: over the centre dash (0.02 m) and the tyre marks (0.04 m). */
const LIFT = 0.05
/** Corners round the outline. */
const CORNERS = 9

/**
 * A pool's radius `seconds` after death, spreading to `full` m over `SPREAD` s: ∝ √t, the disc a steady flow of a fixed
 * thickness covers (its area grows with the volume shed).
 */
export const poolRadius = (seconds: number, full: number): number => full * Math.sqrt(Math.min(Math.max(seconds / SPREAD, 0), 1))

/** A blood pool, hidden until its body dies; `spread` sizes and drapes it. Its outline's raggedness comes from `random`. */
export class Pool extends Mesh {
  /** Each corner's direction (x, z) times its share of the radius, round the outline. */
  private readonly outline: Float32Array
  private readonly corners: BufferAttribute

  constructor(random: () => number) {
    const outline = new Float32Array(CORNERS * 2)
    for (let i = 0; i < CORNERS; i++) {
      // Counter-clockwise on the map, so the fan's faces look up; the corners a little uneven, so no two pools match.
      const a = -((i + (random() - 0.5) * 0.5) / CORNERS) * 2 * Math.PI, r = 0.78 + random() * 0.22
      outline.set([Math.cos(a) * r, Math.sin(a) * r], i * 2)
    }
    const geometry = new BufferGeometry()
    const position = new BufferAttribute(new Float32Array((CORNERS + 1) * 3), 3).setUsage(DynamicDrawUsage)
    const normal = new Float32Array((CORNERS + 1) * 3), color = new Float32Array((CORNERS + 1) * 3), [r, g, b] = linear(PALETTE.blood)
    for (let v = 0; v <= CORNERS; v++) {
      normal[v * 3 + 1] = 1
      color.set([r, g, b], v * 3)
    }
    const index = new Uint16Array(CORNERS * 3)
    for (let i = 0; i < CORNERS; i++) index.set([0, 1 + i, 1 + ((i + 1) % CORNERS)], i * 3)
    geometry.setAttribute("position", position).setAttribute("normal", new BufferAttribute(normal, 3)).setAttribute("color", new BufferAttribute(color, 3))
    geometry.setIndex(new BufferAttribute(index, 1))
    super(geometry, decalMaterial)
    this.outline = outline
    this.corners = position
    this.receiveShadow = true
    this.visible = false
  }

  /** Spreads to `radius` m round (cx, cz) in its node's frame, each point `rise(x, z)` m over the node's origin (the ground under it there). */
  spread(radius: number, cx: number, cz: number, rise: (x: number, z: number) => number): void {
    const p = this.corners.array
    p.set([cx, rise(cx, cz) + LIFT, cz], 0)
    for (let i = 0; i < CORNERS; i++) {
      const x = cx + this.outline[i * 2]! * radius, z = cz + this.outline[i * 2 + 1]! * radius
      p.set([x, rise(x, z) + LIFT, z], (i + 1) * 3)
    }
    this.corners.needsUpdate = true
    this.geometry.computeBoundingSphere()
  }
}
