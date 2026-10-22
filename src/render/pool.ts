/**
 * The scaffolding that tyre smoke, engine flames and blasts share: live pieces packed at the front
 * of one InstancedMesh, each with its floats in one array, tinted per instance. A piece that goes
 * leaves its slot to the last one, and an empty pool uploads nothing. Host state for the page's life.
 *
 * @module render/pool
 */
import { type BufferGeometry, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, type Material } from "three"

/** Live pieces packed at the front of one InstancedMesh, `stride` floats each, tinted per instance; uploads only while any is drawn. */
export class Pool {
  readonly mesh: InstancedMesh
  /** Each live piece's floats, `stride` a piece, in the order of the mesh's instances. */
  readonly data: Float32Array
  private readonly stride: number
  private readonly max: number
  /** Whether any piece was drawn last frame (an empty pool uploads nothing). */
  private drawn = false

  constructor(shape: BufferGeometry, material: Material, max: number, stride: number, order = 0) {
    this.stride = stride
    this.max = max
    this.data = new Float32Array(max * stride)
    this.mesh = new InstancedMesh(shape, material, max)
    this.mesh.count = 0
    this.mesh.renderOrder = order
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage)
    this.mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(DynamicDrawUsage)
    this.mesh.frustumCulled = false // spread over the whole map, and the bounds would change every frame
  }

  /** Nothing live now and nothing drawn last frame: nothing to move or upload. */
  get idle(): boolean {
    return this.mesh.count === 0 && !this.drawn
  }

  /** The slot of a new piece, or -1 when every slot is live. */
  take(): number {
    return this.mesh.count < this.max ? this.mesh.count++ : -1
  }

  /** Lets piece `i` go, moving the last piece's floats and colour into its slot; returns the last piece's old slot. */
  drop(i: number): number {
    const last = --this.mesh.count, s = this.stride
    this.data.copyWithin(i * s, last * s, (last + 1) * s)
    this.mesh.instanceColor!.array.copyWithin(i * 3, last * 3, last * 3 + 3)
    return last
  }

  /** Uploads this frame's matrices and colours, and notes whether any piece is drawn. */
  upload(): void {
    this.mesh.instanceMatrix.needsUpdate = true
    this.mesh.instanceColor!.needsUpdate = true
    this.drawn = this.mesh.count > 0
  }
}
