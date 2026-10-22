/**
 * Animals: one low-poly box model per species (dog, cat, cow, pig), sized to `FAUNA` and the
 * animal's `size`, in its coat with its markings (a pale belly and paws, a tabby's stripes, a
 * Frisona's patches, a Cinta Senese's belt), in three frames (standing and two steps, the legs
 * swapping in diagonal pairs), and lying on its side when down or dead. A model faces local +X
 * with its right on +Z; its feet stand on y = 0.
 *
 * @module render/animals
 */
import type { BufferGeometry, Material } from "three"

import type { AnimalValue, Species } from "../sim/index.ts"
import { Figure, FigureNode, leaning, seeded, type Vec } from "./figure.ts"
import { PALETTE } from "./palette.ts"

/** An animal's frames. */
const ANIMAL_FRAMES = ["stand", "step1", "step2"] as const
/** An animal's frame. */
export type AnimalFrame = (typeof ANIMAL_FRAMES)[number]

/** A species' trunk (a box x0…x1 long, y0…y1 high, ±w wide) and legs (height, thickness, front and rear x, ±z), m at size 1. */
interface Build {
  readonly x0: number
  readonly x1: number
  readonly y0: number
  readonly y1: number
  readonly w: number
  readonly legs: number
  readonly leg: number
  readonly front: number
  readonly rear: number
  readonly side: number
  /** How far its blood pool spreads when dead, m (TUNED). */
  readonly pool: number
}

/**
 * Each species' build at size 1, m: a dog ≈ 0.8 m nose to rump and 0.55 m at the back (a medium mongrel), a cat 0.45 m long
 * and 0.25 m tall, a cow 2.3 m long and 1.4 m at the withers (a Bruna Alpina cow), a pig 1.2 m long and 0.7 m tall.
 */
const BUILDS: Record<Species, Build> = {
  dog: { x0: -0.3, x1: 0.22, y0: 0.3, y1: 0.55, w: 0.11, legs: 0.32, leg: 0.075, front: 0.15, rear: -0.24, side: 0.07, pool: 0.45 },
  cat: { x0: -0.17, x1: 0.12, y0: 0.12, y1: 0.25, w: 0.06, legs: 0.13, leg: 0.035, front: 0.08, rear: -0.14, side: 0.035, pool: 0.25 },
  cow: { x0: -0.95, x1: 0.65, y0: 0.72, y1: 1.4, w: 0.3, legs: 0.72, leg: 0.13, front: 0.5, rear: -0.75, side: 0.2, pool: 1.1 },
  pig: { x0: -0.5, x1: 0.35, y0: 0.26, y1: 0.7, w: 0.22, legs: 0.28, leg: 0.09, front: 0.24, rear: -0.38, side: 0.13, pool: 0.6 }
}

/** Relative luminance of an sRGB hex colour, 0…1 (gamma ignored: it only ranks coats light or dark). */
const luma = (hex: number): number => (0.2126 * ((hex >> 16) & 255) + 0.7152 * ((hex >> 8) & 255) + 0.0722 * (hex & 255)) / 255

/**
 * How the patch colour lies on the coat: none on a plain coat; a pig's belt (Cinta Senese) round its shoulders and forelegs;
 * a paler patch on the belly, chest, paws and face (a mongrel's white socks, a crossbred cow's pale belly); a darker one as a
 * tabby's stripes on a cat that is not white; otherwise patches (a Frisona's, a calico's).
 */
export const markings = (a: AnimalValue): "plain" | "belt" | "points" | "stripes" | "patches" => {
  if (a.patch === a.coat) return "plain"
  if (a.species === "pig") return "belt"
  if (luma(a.patch) > luma(a.coat)) return "points"
  return a.species === "cat" && luma(a.coat) < 0.8 ? "stripes" : "patches"
}

/** Thickness markings stand off the coat, m: enough not to fight it in depth at the game's pixel size. */
const SKIN = 0.008

/** The trunk and its markings, the same in every frame; `random` places the patches, so each animal keeps its own. */
const trunk = (f: Figure, a: AnimalValue, b: Build, random: () => number): void => {
  const o = leaning([0, 0, 0]), { x0, x1, y0, y1, w } = b, h = y1 - y0, l = x1 - x0, mark = markings(a)
  f.box(o, [x0, y0, -w], [x1, y1, w], a.coat)
  if (mark === "points") {
    f.box(o, [x0 + 0.1 * l, y0 - SKIN, -w - SKIN], [x1 - 0.1 * l, y0 + 0.25 * h, w + SKIN], a.patch)
    f.box(o, [x1 - 0.02, y0 - SKIN, -0.6 * w], [x1 + SKIN, y0 + 0.6 * h, 0.6 * w], a.patch)
  } else if (mark === "stripes") {
    for (let k = 0; k < 4; k++) {
      const x = x0 + ((k + 0.6) / 4.2) * l, s = 0.04 * l
      f.box(o, [x - s, y0 + 0.35 * h, -w - SKIN], [x + s, y1 + SKIN, w + SKIN], a.patch)
    }
  } else if (mark === "patches") {
    const n = 4 + Math.floor(random() * 4)
    for (let k = 0; k < n; k++) {
      const cx = x0 + (0.1 + 0.8 * random()) * l, a2 = (0.1 + 0.12 * random()) * l, cy = y0 + (0.25 + 0.6 * random()) * h, b2 = (0.15 + 0.2 * random()) * h
      const where = random(), top = Math.min(cy + b2, y1 + SKIN)
      if (where < 0.4) f.box(o, [cx - a2, cy - b2, -w - SKIN], [cx + a2, top, -w + 0.3 * w], a.patch)
      else if (where < 0.8) f.box(o, [cx - a2, cy - b2, w - 0.3 * w], [cx + a2, top, w + SKIN], a.patch)
      else {
        const cz = (random() - 0.5) * w
        f.box(o, [cx - a2, y1 - 0.02, cz - 0.4 * w], [cx + a2, y1 + SKIN, cz + 0.4 * w], a.patch)
      }
    }
  } else if (mark === "belt") {
    f.box(o, [b.front - 0.12, y0 - SKIN, -w - SKIN], [b.front + 0.1, y1 + SKIN, w + SKIN], a.patch)
  }
}

/** The four legs, swung `swing` rad in diagonal pairs (front left with rear right); returns the lowest foot's height. */
const legs = (f: Figure, a: AnimalValue, b: Build, swing: number): number => {
  const mark = markings(a)
  let lowest = Infinity
  for (const [x, z, s] of [[b.front, -b.side, 1], [b.front, b.side, -1], [b.rear, -b.side, -1], [b.rear, b.side, 1]] as const) {
    const angle = swing * s, hip: Vec = [x, b.y0 + 0.05 * (b.y1 - b.y0), z], length = hip[1]
    const knee: Vec = [x + Math.sin(angle) * length * 0.7, hip[1] - Math.cos(angle) * length * 0.7, z]
    const foot: Vec = [x + Math.sin(angle) * length, hip[1] - Math.cos(angle) * length, z]
    // A pale patch shows as socks; a belt takes in the forelegs.
    const lower = mark === "points" || (mark === "belt" && x === b.front) ? a.patch : a.coat
    f.limb(hip, knee, b.leg, b.leg, mark === "belt" && x === b.front ? a.patch : a.coat)
    f.limb(knee, foot, b.leg * 0.9, b.leg * 0.9, lower)
    lowest = Math.min(lowest, foot[1])
  }
  return lowest
}

/** Each species' head, ears, tail and the rest, in the coat (and patch on the face for `points`). */
const PARTS: Record<Species, (f: Figure, a: AnimalValue) => void> = {
  dog: (f, a) => {
    const face = markings(a) === "points" ? a.patch : a.coat, head = leaning([0.27, 0.56, 0])
    f.limb([0.16, 0.46, 0], [0.29, 0.62, 0], 0.11, 0.1, a.coat)
    f.box(head, [-0.05, 0, -0.075], [0.12, 0.15, 0.075], a.coat)
    f.box(head, [0.12, 0, -0.045], [0.21, 0.075, 0.045], face)
    f.box(head, [0.21, 0.035, -0.025], [0.23, 0.075, 0.025], PALETTE.nose)
    for (const s of [-1, 1]) f.box(head, [-0.04, 0.12, s > 0 ? 0.03 : -0.075], [0.02, 0.2, s > 0 ? 0.075 : -0.03], a.coat)
    f.limb([-0.29, 0.5, 0], [-0.44, 0.66, 0], 0.045, 0.045, a.coat)
  },
  cat: (f, a) => {
    const mark = markings(a), face = mark === "points" ? a.patch : a.coat, head = leaning([0.1, 0.19, 0])
    f.box(head, [0.02, 0, -0.055], [0.13, 0.1, 0.055], a.coat)
    f.box(head, [0.13, 0.005, -0.03], [0.155, 0.05, 0.03], face)
    f.box(head, [0.15, 0.035, -0.01], [0.16, 0.05, 0.01], PALETTE.nose)
    for (const s of [-1, 1]) f.box(head, [0.04, 0.1, s > 0 ? 0.015 : -0.05], [0.075, 0.14, s > 0 ? 0.05 : -0.015], a.coat)
    // The tail up, as a cat walks; a tabby's tip is the darker colour.
    f.limb([-0.16, 0.22, 0], [-0.22, 0.33, 0], 0.025, 0.025, a.coat)
    f.limb([-0.22, 0.33, 0], [-0.2, 0.45, 0], 0.022, 0.022, mark === "stripes" ? a.patch : a.coat)
  },
  cow: (f, a) => {
    const face = markings(a) === "points" ? a.patch : a.coat, head = leaning([0.78, 1.0, 0], 0.5)
    f.limb([0.5, 1.12, 0], [0.86, 1.22, 0], 0.32, 0.36, a.coat)
    f.box(head, [-0.05, 0, -0.13], [0.42, 0.32, 0.13], a.coat)
    f.box(head, [0.42, 0, -0.11], [0.52, 0.2, 0.11], face)
    for (const s of [-1, 1]) {
      f.limb([0.86, 1.3, 0.09 * s], [0.84, 1.42, 0.24 * s], 0.04, 0.04, PALETTE.horn)
      f.box(head, [0.04, 0.18, s > 0 ? 0.13 : -0.25], [0.11, 0.24, s > 0 ? 0.25 : -0.13], a.coat)
    }
    // The udder under the rear belly, its four teats below.
    f.box(leaning([0, 0, 0]), [-0.68, 0.6, -0.13], [-0.36, 0.73, 0.13], PALETTE.snoutPink)
    for (const [x, z] of [[-0.6, -0.06], [-0.6, 0.06], [-0.44, -0.06], [-0.44, 0.06]] as const) {
      f.box(leaning([0, 0, 0]), [x - 0.015, 0.54, z - 0.015], [x + 0.015, 0.6, z + 0.015], PALETTE.snoutPink)
    }
    f.limb([-0.95, 1.36, 0], [-1.0, 0.7, 0], 0.05, 0.05, a.coat)
    f.box(leaning([-1.0, 0.56, 0]), [-0.04, 0, -0.04], [0.04, 0.16, 0.04], a.patch === a.coat ? PALETTE.nose : a.patch)
  },
  pig: (f, a) => {
    const head = leaning([0.32, 0.3, 0], 0.25), snout = luma(a.coat) > 0.4 ? PALETTE.snoutPink : a.coat
    f.box(head, [0, 0, -0.16], [0.25, 0.34, 0.16], a.coat)
    f.box(head, [0.25, 0.05, -0.075], [0.33, 0.18, 0.075], snout)
    // Ears flopping forward over the eyes.
    for (const s of [-1, 1]) f.box(leaning([0.4, 0.62, 0.1 * s], 0.7), [-0.03, 0, -0.06], [0.08, 0.02, 0.06], a.coat)
    f.limb([-0.5, 0.6, 0], [-0.57, 0.67, 0], 0.03, 0.03, a.coat)
  }
}

/** Swing of a leg in a step frame, rad (TUNED by eye, ≈ 17°). */
const STEP_SWING = 0.3

/** Every frame of an animal with this look; `seed` places its patches. */
const animalFrames = (a: AnimalValue, seed = 0): Record<AnimalFrame, BufferGeometry> => {
  const b = BUILDS[a.species]
  const frame = (swing: number): BufferGeometry => {
    const f = new Figure()
    trunk(f, a, b, seeded(seed))
    PARTS[a.species](f, a)
    return f.geometry(legs(f, a, b, swing), a.size)
  }
  return { stand: frame(0), step1: frame(STEP_SWING), step2: frame(-STEP_SWING) }
}

/** Below this speed (m/s) an animal is drawn standing (TUNED). */
const STILL_SPEED = 0.1
/** A step's length as a share of the leg's height (estimate: a walking quadruped's stride ≈ 1.6 leg lengths, two steps). */
const STEP = 0.8
/** A gait by half steps: one diagonal pair forward, passing, the other forward, passing. */
const GAIT = ["step1", "stand", "step2", "stand"] as const

/** The frame for an animal going `speed` m/s that has covered `walked` m, on legs `legs` m tall; lying ones stand still. */
export const frameAnimal = (lying: boolean, speed: number, walked: number, legs: number): AnimalFrame =>
  lying || speed < STILL_SPEED ? "stand" : GAIT[Math.floor(walked / ((STEP * legs) / 2)) % 4]!

/** An animal node: its frames, the one for how it moves now, lying on its side when down or dead. */
export class AnimalNode extends FigureNode<AnimalFrame> {
  /** Its legs' height, m. */
  readonly legs: number
  /** How fast it went at the last step, m/s. */
  speed = 0

  constructor(a: AnimalValue, material: Material, seed = 0) {
    const frames = animalFrames(a, seed), b = BUILDS[a.species]
    frames.stand.computeBoundingBox()
    const right = frames.stand.boundingBox?.max.z ?? 0
    // On its right side: tipped about its forward axis, the back toward +z, the right flank on the ground; the pool spreads
    // under the trunk.
    super(frames, "stand", material, { turn: [Math.PI / 2, 0, 0], shift: [0, right, 0] }, {
      x: ((b.x0 + b.x1) / 2) * a.size, z: ((b.y0 + b.y1) / 2) * a.size, radius: b.pool * a.size, seed
    })
    this.legs = b.legs * a.size
  }

  /** Shows the frame for how it moves now. */
  pose(): void {
    this.body.geometry = this.frames[frameAnimal(this.lying, this.speed, this.walked, this.legs)]
  }
}
