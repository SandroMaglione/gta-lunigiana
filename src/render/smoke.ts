/**
 * Tyre smoke and dust: one InstancedMesh of low-poly puffs for the whole map, spawned from the
 * sim's Skid events in proportion to how far past its grip and how fast each tyre slides. Burnt
 * rubber is white-grey on asphalt and stone, dust tan on gravel and dirt, dark brown on leaves, and
 * grass hardly smokes. A puff grows, rises, drifts and shrinks away over 1–2 s of sim time, so the
 * smoke hangs still while the game is paused. When every puff is in the air, the puffs owed meanwhile are dropped.
 *
 * @module render/smoke
 */
import {
  Color,
  DynamicDrawUsage,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
} from "three"

import { STEP } from "../sim/index.ts"
import type { Surface } from "../sim/map/surface.ts"
import { paint } from "./geometry.ts"
import { yOf } from "./ground.ts"
import type { SkidValue } from "./marks.ts"
import { PALETTE } from "./palette.ts"

/** What a sliding tyre throws up on each surface: its colour, and puffs per second per m/s of slip at a full slide. */
export const PUFF = {
  asphalt: { hex: PALETTE.limestone, rate: 1.5 },
  stone: { hex: PALETTE.plasterGrey, rate: 1.2 },
  gravel: { hex: PALETTE.stoneLight, rate: 2 },
  dirt: { hex: PALETTE.dirtTrack, rate: 2.5 },
  grass: { hex: PALETTE.grassDry, rate: 0.2 },
  leaves: { hex: PALETTE.woodBrown, rate: 1 },
} as const satisfies Record<Surface, { readonly hex: number; readonly rate: number }>

/** Floats per puff: spawn point (three space), drift and rise (m/s), birth and life (sim s), peak radius (m), yaw. */
const STRIDE = 10

const shape = paint(new IcosahedronGeometry(1, 0), 0xffffff) // tinted per puff by its instance colour
const material = new MeshLambertMaterial({
  vertexColors: true,
  flatShading: true,
  transparent: true,
  opacity: 0.6,
  depthWrite: false,
})
const matrix = new Matrix4(),
  at = new Vector3(),
  turn = new Quaternion(),
  size = new Vector3(),
  up = new Vector3(0, 1, 0),
  tint = new Color()

/** Every puff in the air. Host state for the page's life: nothing loads a save in the browser. */
export class Smoke {
  readonly mesh: InstancedMesh
  private readonly random: () => number
  private readonly max: number
  /** Live puffs, packed at the front. */
  private readonly puffs: Float32Array
  /** Puffs owed but not yet spawned (a slide under one puff a step still smokes, every few steps). */
  private debt = 0

  constructor(random: () => number = Math.random, max = 256) {
    this.random = random
    this.max = max
    this.puffs = new Float32Array(max * STRIDE)
    this.mesh = new InstancedMesh(shape, material, max)
    this.mesh.count = 0
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage)
    this.mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(
      DynamicDrawUsage,
    )
    this.mesh.frustumCulled = false // spread over the whole map, and the bounds would change every frame
  }

  /** One step of a sliding tyre. */
  add(skid: SkidValue): void {
    this.debt += PUFF[skid.surface].rate * skid.amount * skid.slip * STEP.dt
    for (; this.debt >= 1; this.debt--) this.spawn(skid)
  }

  /** Moves every puff to sim time `now` (s) and lets the burnt-out ones go. */
  update(now: number): void {
    const p = this.puffs,
      colors = this.mesh.instanceColor!.array
    for (let i = 0; i < this.mesh.count;) {
      const o = i * STRIDE,
        age = Math.max(0, now - p[o + 6]!),
        u = age / p[o + 7]!
      if (u >= 1) {
        const last = --this.mesh.count
        p.copyWithin(o, last * STRIDE, (last + 1) * STRIDE)
        colors.copyWithin(i * 3, last * 3, last * 3 + 3)
        continue
      }
      const s = p[o + 8]! * Math.sin(Math.PI * Math.sqrt(u)) // swells quickly, then thins away
      at.set(p[o]! + p[o + 3]! * age, p[o + 1]! + p[o + 5]! * age, p[o + 2]! + p[o + 4]! * age)
      this.mesh.setMatrixAt(
        i,
        matrix.compose(at, turn.setFromAxisAngle(up, p[o + 9]!), size.set(s, s, s)),
      )
      i++
    }
    this.mesh.instanceMatrix.needsUpdate = true
    this.mesh.instanceColor!.needsUpdate = true
  }

  private spawn(skid: SkidValue): void {
    if (this.mesh.count === this.max) return
    const i = this.mesh.count++,
      r = this.random,
      heading = r() * 2 * Math.PI,
      drift = 0.2 + 0.4 * r()
    this.puffs.set(
      [
        skid.x + (r() - 0.5) * 0.4,
        yOf(skid.z) + 0.2,
        -(skid.y + (r() - 0.5) * 0.4),
        Math.cos(heading) * drift,
        -Math.sin(heading) * drift,
        0.5 + 0.4 * r(),
        skid.step * STEP.dt,
        1 + r(),
        0.4 + 0.4 * r(),
        r() * 2 * Math.PI,
      ],
      i * STRIDE,
    )
    this.mesh.setColorAt(i, tint.setHex(PUFF[skid.surface].hex))
  }
}
