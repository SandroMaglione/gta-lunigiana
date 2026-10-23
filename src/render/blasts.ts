/**
 * Car explosions: when a burning wreck blows up (the sim's Explosion event) a pyrotechnic blast
 * bursts from its centre of mass. A white-hot flash swells to a 4 m radius and is gone within
 * 0.3 s; a fireball of unlit octahedra is flung out and up, burning from white through yellow and
 * orange to red; embers arc out; charred and painted debris tumbles back to the ground where it
 * lands; and thick black smoke rolls up for seconds after. Each layer is one InstancedMesh of
 * low-poly shapes, no sprites and no light: a PointLight would recompile every lit material's
 * program. Everything ages by sim time, so a blast hangs still while the game is paused. The pools
 * hold `BLASTS_AT_ONCE` blasts in full and drop the pieces of any more. Host state for the page's
 * life.
 *
 * @module render/blasts
 */
import {
  BoxGeometry,
  type BufferGeometry,
  Color,
  IcosahedronGeometry,
  type InstancedMesh,
  type Material,
  Matrix4,
  Quaternion,
  Vector3,
} from "three"

import { along, fireMaterial, fireShape, HOT, hot } from "./fire.ts"
import { paint, solidMaterial } from "./geometry.ts"
import { PALETTE } from "./palette.ts"
import { Pool } from "./pool.ts"
import { between, Smoke } from "./smoke.ts"

/** A [min, max] range, drawn per piece. */
type Range = readonly [number, number]

/** How one layer's pieces fly and burn. */
interface Layer {
  /** Pieces per blast. */
  readonly count: number
  /** Launch speed (m/s) and angle over the horizontal (rad), every way round. */
  readonly speed: Range
  readonly climb: Range
  /** How fast the air slows a piece (1/s), and how hard it falls (m/s²; under 0 it rises, as hot gas does). */
  readonly drag: number
  readonly fall: number
  /** Life (sim s), size at its largest (m: a fire shape's radius, a shard's length) and spin (rad/s). */
  readonly life: Range
  readonly size: Range
  readonly spin: Range
  /** Its size over its life: the share of its largest at `u` (0 born, 1 gone). */
  readonly swell: (u: number) => number
  /** Its colours over its life; without, each piece keeps the colour it was given. */
  readonly ramp?: ReadonlyArray<Color>
}

const WHITE_HOT = hot(PALETTE.marbleWhite)
/**
 * The flash: one white-hot ball, 1.2 m in radius the moment the wreck blows (over the shell's charring within a frame or two),
 * swelling to 4 m in its first 0.12 s, then shrinking away, gone at 0.3 s; white to yellow.
 */
export const FLASH = {
  count: 1,
  speed: [0, 0],
  climb: [0, 0],
  drag: 0,
  fall: 0,
  life: [0.3, 0.3],
  size: [4, 4],
  spin: [0, 0],
  swell: (u) => (u < 0.4 ? 0.3 + (0.7 * u) / 0.4 : (1 - u) / 0.6),
  ramp: [WHITE_HOT, HOT[0]!],
} as const satisfies Layer
/**
 * The fireball: octahedra flung out and up, slowed by the air and rising as they burn, swelling then thinning away; white hot,
 * then yellow, orange, and red as they die.
 */
export const FIREBALL = {
  count: 40,
  speed: [4, 12],
  climb: [0.15, 1.35],
  drag: 3,
  fall: -4,
  life: [0.6, 1.2],
  size: [0.7, 1.7],
  spin: [0, 0],
  swell: (u) => Math.sin(Math.PI * Math.sqrt(u)),
  ramp: [WHITE_HOT, ...HOT],
} as const satisfies Layer
/** Embers: sparks arcing out and down under gravity, shrinking from yellow to red. */
export const EMBERS = {
  count: 30,
  speed: [6, 14],
  climb: [0.3, 1.3],
  drag: 1.5,
  fall: 9.81,
  life: [0.6, 1.2],
  size: [0.12, 0.24],
  spin: [0, 0],
  swell: (u) => 1 - u,
  ramp: HOT,
} as const satisfies Layer
/** Debris: shards thrown up and tumbling, a third in the body's paint and the rest charred; gone once they fall back to the ground. */
export const DEBRIS = {
  count: 24,
  speed: [4, 11],
  climb: [0.7, 1.45],
  drag: 0,
  fall: 9.81,
  life: [2.5, 2.5],
  size: [0.25, 0.6],
  spin: [4, 12],
  swell: () => 1,
} as const satisfies Layer
/** Smoke: big black puffs within `spread` m of the blast, born over its first `over` s, rolling up and drifting off. */
export const BLAST_SMOKE = {
  count: 24,
  spread: 1.5,
  over: 0.5,
  look: { drift: [0.4, 1.2], rise: [1.5, 2.5], life: [3, 5], size: [1.2, 2.2] },
} as const
/** Blasts in the air at once in full: the pools hold this many, and drop the pieces of any more. */
export const BLASTS_AT_ONCE = 4

/** Floats per piece: launch point (three space), velocity (m/s), birth and life (sim s), largest size (m), spin axis, angle and rate, floor (three y). */
const STRIDE = 15
/**
 * Times a falling piece's landing is found, each on the ground found the time before: where the ground falls away at 50 %, 3 passes
 * bring every shard down to within 0.35 m of it (1 pass left some 2.5 m up in the air). Each pass only lowers its floor, so a bank
 * across a valley found on a long throw does not lift it back up over the valley.
 */
const LANDINGS = 3
const matrix = new Matrix4(),
  at = new Vector3(),
  axis = new Vector3(),
  turn = new Quaternion(),
  size = new Vector3(),
  tint = new Color()

/** The ground under three-space (x, z): its three y. */
type Ground = (x: number, z: number) => number

/** One layer of every blast in the air: one InstancedMesh, its live pieces packed at the front. */
class Burst {
  private readonly layer: Layer
  private readonly random: () => number
  private readonly pieces: Pool

  constructor(
    layer: Layer,
    random: () => number,
    max: number,
    shape: BufferGeometry,
    material: Material,
    order: number,
  ) {
    this.layer = layer
    this.random = random
    this.pieces = new Pool(shape, material, max, STRIDE, order)
  }

  get mesh(): InstancedMesh {
    return this.pieces.mesh
  }

  /**
   * The layer's pieces of a blast at (x, y, z) in three space, born at sim time `born` (s), each gone once it falls under the ground
   * where it comes down (`ground`); piece i tinted `tints[i % tints.length]` (sRGB hex) when the layer has no ramp. None past a full pool.
   */
  add(
    x: number,
    y: number,
    z: number,
    ground: Ground,
    born: number,
    tints: ReadonlyArray<number>,
  ): void {
    const r = this.random,
      layer = this.layer,
      { drag, fall } = layer,
      foot = Math.min(ground(x, z), y)
    for (let n = 0; n < layer.count; n++) {
      const i = this.pieces.take()
      if (i < 0) return
      const heading = r() * 2 * Math.PI,
        climb = between(r, layer.climb),
        speed = between(r, layer.speed)
      const flat = Math.cos(climb) * speed,
        tilt = 2 * r() - 1,
        round = r() * 2 * Math.PI,
        across = Math.sqrt(1 - tilt * tilt)
      const vx = Math.cos(heading) * flat,
        vy = Math.sin(climb) * speed,
        vz = -Math.sin(heading) * flat
      // Its floor: the ground where it comes down (a slope's, the valley's beside a bridge), never
      // over the blast's foot, so none goes rising: where it would land on level ground at the foot,
      // then on the ground found there, nearer each pass.
      let floor = foot
      if (fall > 0)
        for (let pass = 0; pass < LANDINGS; pass++) {
          const fly = (vy + Math.sqrt(vy * vy + 2 * fall * (y - floor))) / fall,
            out = drag === 0 ? fly : (1 - Math.exp(-drag * fly)) / drag
          floor = Math.min(floor, ground(x + vx * out, z + vz * out))
        }
      this.pieces.data.set(
        [
          x,
          y,
          z,
          vx,
          vy,
          vz,
          born,
          between(r, layer.life),
          between(r, layer.size),
          across * Math.cos(round),
          tilt,
          across * Math.sin(round),
          r() * 2 * Math.PI,
          between(r, layer.spin),
          floor,
        ],
        i * STRIDE,
      )
      if (layer.ramp === undefined)
        this.pieces.mesh.setColorAt(i, tint.setHex(tints[n % tints.length]!))
    }
  }

  /** Moves every piece to sim time `now` (s): out, slowed by the air, falling (or rising); burnt out or fallen to the ground, it goes. */
  update(now: number): void {
    const { mesh, data: p } = this.pieces,
      { drag, fall, swell, ramp } = this.layer
    // Nothing in the air now or last frame: nothing to upload.
    if (this.pieces.idle) return
    for (let i = 0; i < mesh.count;) {
      const o = i * STRIDE,
        age = Math.max(0, now - p[o + 6]!),
        u = age / p[o + 7]!
      const out = drag === 0 ? age : (1 - Math.exp(-drag * age)) / drag // how far the launch speed carried it through the air, s
      at.set(
        p[o]! + p[o + 3]! * out,
        p[o + 1]! + p[o + 4]! * out - (fall * age * age) / 2,
        p[o + 2]! + p[o + 5]! * out,
      )
      if (u >= 1 || at.y < p[o + 14]!) {
        this.pieces.drop(i)
        continue
      }
      const s = p[o + 8]! * swell(u)
      turn.setFromAxisAngle(
        axis.set(p[o + 9]!, p[o + 10]!, p[o + 11]),
        p[o + 12]! + p[o + 13]! * age,
      )
      mesh.setMatrixAt(i, matrix.compose(at, turn, size.set(s, s, s)))
      if (ramp !== undefined) mesh.setColorAt(i, along(ramp, u, tint))
      i++
    }
    this.pieces.upload()
  }
}

const flashShape = paint(new IcosahedronGeometry(1, 1), 0xffffff) // tinted by its instance colour
const shardShape = paint(new BoxGeometry(1, 0.35, 0.7), 0xffffff)
/** Debris that is not paint: soot black and charcoal grey. */
const CHAR = [PALETTE.outline, PALETTE.cobbleDark] as const

/** Every blast in the air: its flash, fireball, embers, debris and smoke. */
export class Blasts {
  readonly smoke: Smoke
  readonly debris: Burst
  readonly flash: Burst
  readonly fireball: Burst
  readonly embers: Burst
  private readonly random: () => number

  constructor(random: () => number = Math.random) {
    this.random = random
    this.smoke = new Smoke(random, BLASTS_AT_ONCE * BLAST_SMOKE.count)
    this.debris = new Burst(
      DEBRIS,
      random,
      BLASTS_AT_ONCE * DEBRIS.count,
      shardShape,
      solidMaterial,
      0,
    )
    // Fire over the smoke it rolls into: the flash first, the fireball and the sparks through it.
    this.flash = new Burst(FLASH, random, BLASTS_AT_ONCE * FLASH.count, flashShape, fireMaterial, 1)
    this.fireball = new Burst(
      FIREBALL,
      random,
      BLASTS_AT_ONCE * FIREBALL.count,
      fireShape,
      fireMaterial,
      2,
    )
    this.embers = new Burst(
      EMBERS,
      random,
      BLASTS_AT_ONCE * EMBERS.count,
      fireShape,
      fireMaterial,
      2,
    )
  }

  /** Every layer's mesh, for the scene. */
  get meshes(): ReadonlyArray<InstancedMesh> {
    return [
      this.smoke.mesh,
      this.debris.mesh,
      this.flash.mesh,
      this.fireball.mesh,
      this.embers.mesh,
    ]
  }

  /**
   * A blast at (x, y, z) in three space at sim time `born` (s), its pieces coming down on `ground`: its debris a third the body's
   * `paint` (sRGB hex), the rest charred.
   */
  start(x: number, y: number, z: number, ground: Ground, born: number, paint: number): void {
    const r = this.random
    this.flash.add(x, y, z, ground, born, [])
    this.fireball.add(x, y, z, ground, born, [])
    this.embers.add(x, y, z, ground, born, [])
    this.debris.add(x, y, z, ground, born, [paint, ...CHAR])
    for (let n = 0; n < BLAST_SMOKE.count; n++) {
      const heading = r() * 2 * Math.PI,
        out = BLAST_SMOKE.spread * Math.sqrt(r())
      this.smoke.puff(
        x + Math.cos(heading) * out,
        y,
        z - Math.sin(heading) * out,
        born + r() * BLAST_SMOKE.over,
        PALETTE.outline,
        BLAST_SMOKE.look,
      )
    }
  }

  /** Moves every blast to sim time `now` (s). */
  update(now: number): void {
    this.smoke.update(now)
    this.debris.update(now)
    this.flash.update(now)
    this.fireball.update(now)
    this.embers.update(now)
  }
}
