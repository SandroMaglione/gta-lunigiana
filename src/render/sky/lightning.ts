/**
 * Lightning: the bolt's jagged channel (seeded midpoint displacement plus branches, built once per
 * flash, as return strokes reuse the channel), the strokes' flicker on the bolt, and the scene-wide
 * flash. The scene flash is one smooth pulse per flash, at most three a second, with the strokes
 * modulating it by ±10 % at most: full-field 10–16 Hz flicker would fail WCAG 2.3.1 (three flashes).
 * Only the bolt, a thin line, flickers fully; under `reduced` (prefers-reduced-motion) it does not
 * flicker and the scene flash is halved. Everything runs on sim seconds, so it freezes in the pause.
 *
 * @module render/sky/lightning
 */
import { BufferAttribute, BufferGeometry, Color, DynamicDrawUsage, Group, LineBasicMaterial, LineSegments, type Vector3 } from "three"

import { hash01 } from "../../tools/geometry.ts"
import { PALETTE } from "../palette.ts"
import type { SkyFrame } from "./frame.ts"
import { stream } from "./random.ts"

/** Height of the bolt's top over the ground it strikes, m: only its lowest 50–100 m ever shows. */
const HEIGHT = 400
/** Midpoint displacement levels of the main channel: 2^7 = 128 segments of ≈ 3 m. */
const LEVELS = 7
/** Horizontal displacement at the first level, m, halved at each level after (0.6 m at the last). */
const SWAY = 40
/** Levels at which a new midpoint may start a branch, and how likely it does. */
const BRANCH = { levels: 4, chance: 0.35, most: 6 } as const
/** Most segments a bolt has (channel, branches and their twigs). */
export const MAX_SEGMENTS = 512

/** Points (map x, render y, map y) of a channel from `a` to `b` displaced `levels` times; `fork` hears every new midpoint. */
const channel = (a: readonly number[], b: readonly number[], levels: number, sway: number, r: () => number,
  fork?: (point: readonly number[], level: number) => void): Array<Array<number>> => {
  let pts = [[...a], [...b]]
  for (let level = 0, d = sway; level < levels; level++, d /= 2) {
    const next: Array<Array<number>> = [pts[0]!]
    for (let k = 1; k < pts.length; k++) {
      const p = pts[k - 1]!, q = pts[k]!, turn = 2 * Math.PI * r(), reach = d * r()
      const mid = [(p[0]! + q[0]!) / 2 + Math.cos(turn) * reach, (p[1]! + q[1]!) / 2 + (r() - 0.5) * d * 0.3, (p[2]! + q[2]!) / 2 + Math.sin(turn) * reach]
      next.push(mid, q)
      fork?.(mid, level)
    }
    pts = next
  }
  return pts
}

/** A bolt's segments: endpoint pairs in three space, the main channel's first. */
export interface BoltShape {
  /** Flat (ax, ay, az, bx, by, bz) per segment, three space. */
  readonly points: ReadonlyArray<number>
  /** How many of the segments, from the first, are the main channel (the rest are branches, shown on the first stroke). */
  readonly trunk: number
}

/**
 * The bolt of flash `seed` striking `ground` (map x, y and render y as z): a main channel from
 * 400 m up down to exactly the ground point, displaced sideways at each halving, plus branches that
 * fork off its upper levels and end in the air. Deterministic per seed.
 */
export const boltSegments = (seed: number, ground: { readonly x: number; readonly y: number; readonly z: number }): BoltShape => {
  const r = stream(seed)
  const top = [ground.x + (r() - 0.5) * 120, ground.z + HEIGHT, ground.y + (r() - 0.5) * 120]
  const forks: Array<{ point: readonly number[]; level: number }> = []
  const trunk = channel(top, [ground.x, ground.z, ground.y], LEVELS, SWAY, r, (point, level) => {
    if (level < BRANCH.levels && forks.length < BRANCH.most && r() < BRANCH.chance) forks.push({ point, level })
  })
  const out: Array<number> = []
  const draw = (pts: ReadonlyArray<ReadonlyArray<number>>) => {
    for (let k = 1; k < pts.length && out.length < MAX_SEGMENTS * 6; k++) {
      const p = pts[k - 1]!, q = pts[k]!
      out.push(p[0]!, p[1]!, -p[2]!, q[0]!, q[1]!, -q[2]!)
    }
  }
  draw(trunk)
  const trunkSegments = out.length / 6
  for (const { point, level } of forks) {
    // A branch runs 0.4–0.7 of its parent segment's length, out to one side and down; one twig may fork off it.
    const length = (HEIGHT / 2 ** level) * (0.4 + 0.3 * r()), turn = 2 * Math.PI * r(), out2 = 0.5 + 0.3 * r()
    const drop = Math.min(length * (0.6 + 0.3 * r()), point[1]! - ground.z - 20) // branches end in the air
    const end = [point[0]! + Math.cos(turn) * length * out2, point[1]! - drop, point[2]! + Math.sin(turn) * length * out2]
    let twig: { point: readonly number[]; level: number } | undefined
    const branch = channel(point, end, Math.max(3, LEVELS - level - 2), SWAY / 2 ** (level + 1), r, (p, l) => {
      if (twig === undefined && l === 0 && r() < 0.5) twig = { point: p, level: l }
    })
    draw(branch)
    if (twig !== undefined) {
      const t = twig.point, l2 = length * 0.4, a = turn + (r() - 0.5) * 1.6
      draw(channel(t, [t[0]! + Math.cos(a) * l2 * 0.6, t[1]! - l2 * 0.8, t[2]! + Math.sin(a) * l2 * 0.6], 3, SWAY / 2 ** (level + 3), r))
    }
  }
  return { points: out, trunk: trunkSegments }
}

/** Return strokes of flash `seed`: 2–4, the first at 0 and each 30–120 ms after the last; the later ones a little weaker. */
const strokes = (seed: number): { readonly start: ReadonlyArray<number>; readonly peak: ReadonlyArray<number> } => {
  const n = 2 + Math.floor(hash01(seed, 1) * 3), start = [0], peak = [1]
  for (let k = 1; k < n; k++) {
    start.push(start[k - 1]! + 0.03 + 0.09 * hash01(seed, 10 + k))
    peak.push(0.75 + 0.25 * hash01(seed, 20 + k))
  }
  return { start, peak }
}

/** A stroke holds its peak this long (one 60 Hz frame, so every stroke is seen), then decays. */
const HOLD = 1 / 60
/** Stroke decay time constant, s: 30 ms on, a stroke is down to 64 %, under the next one's 75 % peak, so each stroke reads as a new flare. */
const STROKE_DECAY = 0.03

/** Bolt brightness 0..1 `age` s into flash `seed`: 2–4 strokes 30–120 ms apart, each held a frame at its peak, then decaying (τ = 30 ms) until the next. */
export const strokeLevel = (seed: number, age: number): number => {
  const { start, peak } = strokes(seed)
  let k = start.length - 1
  while (k >= 0 && age < start[k]!) k--
  if (k < 0) return 0
  const a = age - start[k]!
  return peak[k]! * (a < HOLD ? 1 : Math.exp(-(a - HOLD) / STROKE_DECAY))
}

/** Scene flash: rise time and decay time constant, s; distance at which it is half as bright, m. */
const FLASH = { rise: 0.05, decay: 0.25, half: 1500 } as const
/** A pulse is over once its shape has decayed this many time constants (e^−6 ≈ 0.25 %). */
const FLASH_END = FLASH.rise + 6 * FLASH.decay

/**
 * The scene-wide light of one flash `age` s after it started, 0..1: one smooth pulse (eased rise
 * over 50 ms, exponential decay τ = 0.25 s), × `power` and dimmed with the strike's `distance` (m):
 * half as bright at 1.5 km.
 */
export const sceneFlash = (age: number, power: number, distance: number): number => {
  if (age < 0 || age >= FLASH_END) return 0
  const u = age / FLASH.rise
  const shape = u < 1 ? u * u * (3 - 2 * u) : Math.exp(-(age - FLASH.rise) / FLASH.decay)
  return (Math.min(1, Math.max(0, power)) * shape) / (1 + (distance / FLASH.half) ** 2)
}

/** A lightning event as the sim emits it (the `Lightning` event's fields the drawing needs). */
export interface Strike {
  /** Map metres. */
  readonly x: number
  readonly y: number
  /** A ground strike (a bolt drawn) or a flash inside the cloud (light only). */
  readonly bolt: boolean
  /** 0..1. */
  readonly power: number
  /** Integer: the bolt's shape and its strokes. */
  readonly seed: number
}

/** Bolt meshes in the pool: three flashes can overlap. */
const POOL = 3
/** The bolt's linear colour × this: far past 1 in the HalfFloat target, so it shows at full brightness whatever the exposure (the post pass keeps its blue-white hue). */
const BOLT_HDR = 6
/** WCAG 2.3.1: at most three scene flashes in any second, so a new pulse waits 0.4 s after the last (1/3 s would let four start in a closed second). */
const FLASH_GAP = 0.4
/** How the strokes shimmer the scene flash: × (base + depth · stroke level), within ±5 % of the pulse (the design allows ±10 %). */
const STROKE_SHIMMER = { base: 0.95, depth: 0.1 } as const
/** Under reduced motion a bolt shows steady, fading with this time constant, s (seen ≈ 0.55 s). */
const CALM_DECAY = 0.12
/** A flash inside the cloud lights the scene this much less than a ground strike of the same power. */
const IN_CLOUD = 0.6
/** Draw order among the transparent effects: the bolt before the rain and snow (which draw over it). */
const BOLT_ORDER = 2
const BOLT = new Color(PALETTE.bolt)

/**
 * One flash in progress: when it began, its scene pulse's power (0 when it came within FLASH_GAP
 * of the last pulse) and distance, and its bolt slot (−1: none, or handed to a newer bolt).
 */
interface Flash { readonly seed: number; readonly start: number; readonly power: number; readonly distance: number; slot: number; readonly trunk: number; readonly count: number }

/**
 * The lightning host: a fixed pool of bolt line meshes (never added or removed after construction)
 * and the flashes in progress. `strike` each `Lightning` event, `update` once a frame; the scene
 * flash it returns feeds the sky host's lights.
 */
export class Bolts {
  /** Add to the scene once; its bolts stay in it (an idle bolt draws nothing). */
  readonly object = new Group()
  /** prefers-reduced-motion: bolts do not flicker, the scene flash is halved. */
  reduced: boolean
  /** The bolt pool (children of `object`): each draws its flash's segments, or nothing (`drawRange` count 0). */
  readonly lines: ReadonlyArray<LineSegments<BufferGeometry, LineBasicMaterial>>
  /** Each bolt's position buffer (endpoint pairs), rewritten per flash. */
  private readonly buffers: ReadonlyArray<Float32Array>
  private readonly flashes: Array<Flash> = []
  private lastPulse = Number.NEGATIVE_INFINITY
  private next = 0

  constructor(options: { readonly reduced?: boolean } = {}) {
    this.reduced = options.reduced ?? false
    this.buffers = Array.from({ length: POOL }, () => new Float32Array(MAX_SEGMENTS * 6))
    this.lines = this.buffers.map((buffer) => {
      const geometry = new BufferGeometry()
      // BufferAttribute keeps the array it is given (Float32BufferAttribute would copy it, and the bolt written into `buffer` never upload).
      geometry.setAttribute("position", new BufferAttribute(buffer, 3).setUsage(DynamicDrawUsage))
      geometry.setDrawRange(0, 0)
      const line = new LineSegments(geometry, new LineBasicMaterial({ color: 0, transparent: true, depthWrite: false, fog: false, toneMapped: false }))
      line.frustumCulled = false // it moves every flash; an idle one draws nothing
      line.renderOrder = BOLT_ORDER
      this.object.add(line)
      return line
    })
  }

  /** A `Lightning` event at sim time `now` (s): its bolt on ground at render y `groundY`, its flash dimmed by its distance from `focus` (three space). */
  strike(l: Strike, groundY: number, now: number, focus: Vector3): void {
    const distance = Math.hypot(l.x - focus.x, l.y + focus.z) // three z = −north
    const power = now - this.lastPulse >= FLASH_GAP ? l.power * (l.bolt ? 1 : IN_CLOUD) : 0
    if (power > 0) this.lastPulse = now
    let slot = -1, trunk = 0, count = 0
    if (l.bolt) {
      slot = this.next
      this.next = (this.next + 1) % POOL
      for (const f of this.flashes) if (f.slot === slot) f.slot = -1
      const shape = boltSegments(l.seed, { x: l.x, y: l.y, z: groundY })
      this.buffers[slot]!.set(shape.points)
      this.lines[slot]!.geometry.getAttribute("position").needsUpdate = true
      trunk = shape.trunk
      count = shape.points.length / 6
    }
    this.flashes.push({ seed: l.seed, start: now, power, distance, slot, trunk, count })
  }

  /** Moves the bolts and the flash to sim time `frame.now` (s); returns the scene flash now, 0..1. */
  update(frame: Pick<SkyFrame, "now">): number {
    let flash = 0
    for (const line of this.lines) line.geometry.setDrawRange(0, 0)
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i]!, age = frame.now - f.start, { start } = strokes(f.seed)
      const stroke = strokeLevel(f.seed, age)
      flash = Math.max(flash, sceneFlash(age, f.power, f.distance) * (this.reduced ? 0.5 : STROKE_SHIMMER.base + STROKE_SHIMMER.depth * stroke))
      const level = this.reduced ? (age < 0 ? 0 : Math.exp(-age / CALM_DECAY)) : stroke
      if (f.slot >= 0 && level > 0.01) {
        const line = this.lines[f.slot]!
        line.material.color.copy(BOLT).multiplyScalar(BOLT_HDR * level)
        line.geometry.setDrawRange(0, 2 * (age < start[1]! ? f.count : f.trunk)) // branches show on the first stroke only
      }
      if (age >= Math.max(FLASH_END, start.at(-1)! + 1)) this.flashes.splice(i, 1)
    }
    return Math.min(1, flash)
  }
}
