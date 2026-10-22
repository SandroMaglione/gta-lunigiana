/**
 * Smoke and fire from damaged engines: white smoke from the medium stage of damage, black from the
 * severe, once a vehicle is destroyed flames with thick black smoke over them, and once it has blown
 * up a thin dark wisp from its charred shell, the flames out. Each leaves its model's engine
 * (`VehicleNode.engine`) wherever the body lies, a flipped car's too. The smoke is a pool of `Smoke`
 * puffs of its own, so wrecks and tyre smoke never starve each other; the flames are small unlit
 * shapes, so they glow in shadow, turning from yellow to red as they rise and shrink. Both age by
 * sim time, so they hang still while the game is paused. Host state for the page's life.
 *
 * @module render/wrecks
 */
import { Color, type InstancedMesh, Matrix4, Quaternion, Vector3 } from "three"

import { WHEELS_DOWN } from "../sim/chassis.ts"
import type { DamageStage } from "../sim/damage.ts"
import type { VehicleNode } from "./actors.ts"
import { along, fireMaterial, fireShape, HOT } from "./fire.ts"
import { PALETTE } from "./palette.ts"
import { Pool } from "./pool.ts"
import { between, type PuffLook, Smoke } from "./smoke.ts"

/** What a wreck gives off smoke and fire for: its stage of damage, or `burnt` once it has blown up (a charred shell). */
export type WreckState = DamageStage | "burnt"

/** One state's engine smoke: its colour, puffs a second, how far over the engine it leaves (m) and how it moves and lasts. */
interface Plume {
  readonly hex: number
  readonly rate: number
  readonly lift: number
  readonly look: PuffLook
}

/**
 * Each state's engine smoke: none while lightly damaged, white (puffs a little bigger than a tyre's smoke, so it reads from afar),
 * then thick black, then black billowing over the flames, and once burnt out a thin dark grey wisp.
 */
export const PLUMES = {
  light: undefined,
  medium: { hex: PALETTE.marbleWhite, rate: 10, lift: 0, look: { drift: [0.1, 0.3], rise: [0.8, 1.2], life: [1.5, 2.5], size: [0.5, 0.9] } },
  severe: { hex: PALETTE.outline, rate: 12, lift: 0, look: { drift: [0.1, 0.3], rise: [1, 1.5], life: [2, 3], size: [0.5, 0.9] } },
  destroyed: { hex: PALETTE.outline, rate: 12, lift: 0.5, look: { drift: [0.1, 0.4], rise: [1.4, 2], life: [2.5, 3.5], size: [0.6, 1] } },
  burnt: { hex: PALETTE.cobbleDark, rate: 4, lift: 0, look: { drift: [0.1, 0.3], rise: [0.6, 1], life: [2, 3], size: [0.3, 0.5] } }
} as const satisfies Record<WreckState, Plume | undefined>
/** At most this many damaged engines smoke at once (the burning first, then the nearest the player): the pools hold that many plumes and fires in full. */
export const PLUMES_AT_ONCE = 8

/**
 * Flames a second from a burning engine, how far from its middle they lick up (m, either way across the bonnet), and how they rise
 * (m/s), last (s) and how big they start (m), each a [min, max] range.
 */
export const FLAMES = { rate: 40, spread: 0.5, rise: [1.2, 2], life: [0.35, 0.7], size: [0.35, 0.6] } as const
/** Engine smoke and flames spawn for no frame longer than this, s: a stalled tab does not dump a burst. */
const LONGEST = 0.25

/** Puffs and flames in the air at most, so the pools hold every plume and fire in full: each burning, each puff and flame living its longest. */
const SMOKE_POOL = Math.ceil(PLUMES_AT_ONCE * PLUMES.destroyed.rate * PLUMES.destroyed.look.life[1])
const FLAME_POOL = Math.ceil(PLUMES_AT_ONCE * FLAMES.rate * FLAMES.life[1])

/** Floats per flame: its place off the engine it burns on (three x, z; m), birth and life (sim s), starting radius (m), rise (m/s), yaw. */
const STRIDE = 7
const matrix = new Matrix4(), at = new Vector3(), turn = new Quaternion(), size = new Vector3(), up = new Vector3(0, 1, 0), tint = new Color()
const lean = new Vector3(), trail = new Vector3()
/** A body lying on its side or roof (its up axis under the sim's `WHEELS_DOWN`) smokes and burns from this far over its centre of mass, m. */
const OVER = 0.6

/** Every flame alight: one InstancedMesh, drawn after the smoke, each flame burning on its car's engine wherever the car goes. */
class Flames {
  private readonly random: () => number
  /** Live flames, packed at the front, and the vehicle each burns on. */
  private readonly flames: Pool
  private readonly owners: Array<VehicleNode> = []

  constructor(random: () => number, max: number) {
    this.random = random
    this.flames = new Pool(fireShape, fireMaterial, max, STRIDE, 1) // over the smoke it burns in
  }

  get mesh(): InstancedMesh {
    return this.flames.mesh
  }

  /** One flame within FLAMES.spread of `owner`'s engine (`smoked`, as placed this frame), born at sim time `born` (s); none when every flame is alight. */
  add(owner: VehicleNode, born: number): void {
    const i = this.flames.take()
    if (i < 0) return
    const r = this.random, spread = 2 * FLAMES.spread
    this.flames.data.set([
      (r() - 0.5) * spread, (r() - 0.5) * spread, born, between(r, FLAMES.life), between(r, FLAMES.size), between(r, FLAMES.rise), r() * 2 * Math.PI
    ], i * STRIDE)
    this.owners[i] = owner
  }

  /** Moves every flame to sim time `now` (s): up from its engine, smaller, redder; the burnt-out ones go. */
  update(now: number): void {
    const { mesh, data: f } = this.flames
    // Nothing alight now or last frame: nothing to upload.
    if (this.flames.idle) return
    for (let i = 0; i < mesh.count;) {
      const o = i * STRIDE, age = Math.max(0, now - f[o + 2]!), u = age / f[o + 3]!
      if (u >= 1) {
        const last = this.flames.drop(i)
        this.owners[i] = this.owners[last]!
        this.owners.length = last
        continue
      }
      const s = f[o + 4]! * (1 - u), engine = this.owners[i]!.smoked // a tongue licks up and shrinks away
      at.set(engine.x + f[o]!, engine.y + f[o + 5]! * age, engine.z + f[o + 1]!)
      mesh.setMatrixAt(i, matrix.compose(at, turn.setFromAxisAngle(up, f[o + 6]!), size.set(s, s * 1.6, s)))
      mesh.setColorAt(i, along(HOT, u, tint))
      i++
    }
    this.flames.upload()
  }
}

/** The engine smoke and flames of every damaged vehicle near the player. */
export class Wrecks {
  readonly smoke: Smoke
  readonly flames: Flames
  /** The sim time of the last frame drawn, s. */
  private last: number | undefined

  constructor(random: () => number = Math.random, smoke = SMOKE_POOL, flames = FLAME_POOL) {
    this.smoke = new Smoke(random, smoke)
    this.flames = new Flames(random, flames)
  }

  /** Starts a frame at sim time `now` (s): the time to spawn smoke and flames for, since the last frame (none on the first, at most LONGEST). */
  frame(now: number): number {
    const dt = this.last === undefined ? 0 : Math.min(LONGEST, Math.max(0, now - this.last))
    this.last = now
    return dt
  }

  /**
   * `dt` seconds up to `now` of the smoke (and fire) a vehicle in `state` gives off, from its engine as its `node` is posed now. Each
   * puff is born when it was due, where the engine was then (between last frame's place and this one's), so a moving car trails
   * its smoke; its flames burn on the engine wherever it goes. A body on its side or roof smokes from over it.
   */
  emit(node: VehicleNode, state: WreckState, dt: number, now: number): void {
    const plume = PLUMES[state]
    if (plume === undefined || dt <= 0) return
    node.updateWorldMatrix(true, false)
    const engine = at.copy(node.engine).applyMatrix4(node.matrixWorld)
    // Lying over, the engine bay faces the ground: the smoke and fire come out over the body.
    if (lean.setFromMatrixColumn(node.matrixWorld, 1).y < WHEELS_DOWN) engine.y = Math.max(engine.y, node.position.y + OVER)
    const from = now - node.smokedAt <= dt + 1e-9 ? node.smoked : engine
    node.smokeDebt += plume.rate * dt
    for (; node.smokeDebt >= 1; node.smokeDebt--) {
      const back = (node.smokeDebt - 1) / plume.rate, p = trail.copy(engine).lerp(from, Math.min(1, back / dt))
      this.smoke.puff(p.x, p.y + plume.lift, p.z, now - back, plume.hex, plume.look)
    }
    node.smoked.copy(engine)
    node.smokedAt = now
    if (state !== "destroyed") return
    node.flameDebt += FLAMES.rate * dt
    for (; node.flameDebt >= 1; node.flameDebt--) this.flames.add(node, now - (node.flameDebt - 1) / FLAMES.rate)
  }

  /** Moves every puff and flame to sim time `now` (s). */
  update(now: number): void {
    this.smoke.update(now)
    this.flames.update(now)
  }
}
