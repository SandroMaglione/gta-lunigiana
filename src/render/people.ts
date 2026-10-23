/**
 * People: a low-poly box figure built from the whole look (height and age, sex, outfit, hairdo,
 * colours) in seven frames (standing, two walk steps, two run steps, hands to the head, a talking
 * gesture), the rule that picks the frame for what the person is doing, and the x-ray proxies the
 * player shows (one per gait, one lying down). A figure faces local +X with its right on +Z; its
 * feet stand on y = 0.
 *
 * @module render/people
 */
import { Euler, Matrix4, type BufferGeometry, type Material, type Mesh } from "three"

import type { Look, Mood } from "../sim/index.ts"
import { MEAN_HEIGHT } from "../sim/population/looks.ts"
import { WALK_SPEED } from "../sim/tuning.ts"
import { xray } from "./actors.ts"
import { at, Figure, FigureNode, leaning, seeded, type Basis, type Vec } from "./figure.ts"
import { PALETTE } from "./palette.ts"

/** A person's frames. */
export const PERSON_FRAMES = ["stand", "walk1", "walk2", "run1", "run2", "shock", "talk"] as const
/** A person's frame. */
export type PersonFrame = (typeof PERSON_FRAMES)[number]

/** The height the figure's widths are drawn for, m: an Italian man's mean, the one people are drawn from. */
const ADULT = MEAN_HEIGHT.adult[0]
/** How far an elder's back bends forward, rad (TUNED: a visible stoop, about 10°). */
const STOOP = 0.17

/** A leg's swing (thigh forward of vertical +) and knee bend (shin back +), rad. */
type Leg = readonly [thigh: number, knee: number]
/** An arm's swing (upper arm forward +) and elbow bend (forearm forward +), rad; `head`: the hand on the side of the head. */
type Arm = readonly [upper: number, elbow: number] | "head"
/** A frame's body pose: forward lean (rad), left and right leg, left and right arm. */
interface Stance {
  readonly lean: number
  readonly legs: readonly [Leg, Leg]
  readonly arms: readonly [Arm, Arm]
}

const STILL: Leg = [0, 0]
const HANG: Arm = [0, 0.1]
/** Each frame's pose (TUNED by eye: the walk's legs ≈ ±20°, the run's thigh up 43° and the rear heel kicked up, arms bent 90°). */
const STANCES: Record<PersonFrame, Stance> = {
  stand: { lean: 0, legs: [STILL, STILL], arms: [HANG, HANG] },
  walk1: {
    lean: 0,
    legs: [
      [0.35, 0.05],
      [-0.3, 0.3],
    ],
    arms: [
      [-0.3, 0.2],
      [0.3, 0.3],
    ],
  },
  walk2: {
    lean: 0,
    legs: [
      [-0.3, 0.3],
      [0.35, 0.05],
    ],
    arms: [
      [0.3, 0.3],
      [-0.3, 0.2],
    ],
  },
  run1: {
    lean: 0.2,
    legs: [
      [0.75, 0.5],
      [-0.45, 1.3],
    ],
    arms: [
      [-0.6, 1.5],
      [0.6, 1.5],
    ],
  },
  run2: {
    lean: 0.2,
    legs: [
      [-0.45, 1.3],
      [0.75, 0.5],
    ],
    arms: [
      [0.6, 1.5],
      [-0.6, 1.5],
    ],
  },
  shock: { lean: 0, legs: [STILL, STILL], arms: ["head", "head"] },
  talk: { lean: 0, legs: [STILL, STILL], arms: [HANG, [0.25, 1.5]] },
}

/** The point `length` m from `from` along a limb swung `angle` rad forward of straight down. */
const swing = (from: Vec, length: number, angle: number): Vec => [
  from[0] + Math.sin(angle) * length,
  from[1] - Math.cos(angle) * length,
  from[2],
]

/**
 * A person's build, m. Stylised like the old figure (a big head reads at the game's pixel size): head 0.19 of the height,
 * legs 0.47. A kid's head is relatively bigger and its legs shorter (the artists' canon: a 6-year-old is about six heads tall,
 * an adult seven and a half); widths follow the height, kids a little stockier, women narrower in the shoulders.
 */
const measure = (look: Look) => {
  const h = look.height,
    kid = look.age === "kid"
  const head = kid ? 0.3 * Math.sqrt(h / 1.2) : 0.19 * h,
    legs = (kid ? 0.42 : 0.47) * h
  const w = kid ? (1.1 * h) / ADULT : Math.sqrt(h / ADULT)
  return {
    head,
    legs,
    torso: h - legs - head,
    foot: 0.07 * w,
    depth: 0.13 * w,
    shoulder: (look.female ? 0.21 : 0.245) * w,
    hip: 0.1 * w,
    leg: 0.17 * w,
    arm: 0.12 * w,
    // Upper arm, forearm and hand as shares of the height (Drillis & Contini 1966: 0.186, 0.146, 0.108; the hand drawn shorter).
    upper: 0.186 * h,
    fore: 0.146 * h,
    hand: 0.09 * h,
  }
}

/** The colour of a flat cap: one of two tweeds, fixed by the look. */
const tweed = (look: Look): number =>
  ((look.shirt ^ look.pants) & 1) === 0 ? PALETTE.tweedBrown : PALETTE.tweedGrey

/**
 * Whether a person wears long sleeves: elders do, and about a third of the others, fixed by the look (the hair, skin and shirt
 * colours: not the trousers, which a dress sets to the shirt's colour).
 */
export const longSleeves = (look: Look): boolean =>
  look.age === "elder" || (look.hair ^ look.skin ^ look.shirt) % 3 === 0

/** One frame of a person. */
const personFrame = (look: Look, stance: Stance): BufferGeometry => {
  const f = new Figure(),
    m = measure(look)
  const lean = stance.lean + (look.age === "elder" ? STOOP : 0)
  const sleeve = longSleeves(look) ? look.shirt : look.skin
  const skirted = look.outfit === "skirt" || look.outfit === "dress"
  const thighColour = skirted ? look.skin : look.pants,
    shinColour = look.outfit === "trousers" ? look.pants : look.skin
  const half = (m.legs - m.foot) / 2

  let lowest = Infinity
  stance.legs.forEach(([thigh, knee], side) => {
    const hip: Vec = [0, m.legs, (side === 0 ? -1 : 1) * m.hip]
    const kneeAt = swing(hip, half, thigh),
      ankle = swing(kneeAt, half, thigh - knee)
    f.limb(hip, kneeAt, m.leg, m.leg, thighColour)
    f.limb(kneeAt, ankle, m.leg * 0.9, m.leg * 0.9, shinColour)
    f.box(
      leaning([ankle[0], ankle[1] - m.foot, ankle[2]]),
      [-0.05, 0, -m.leg / 2],
      [0.1 + m.leg / 2, m.foot, m.leg / 2],
      PALETTE.shoe,
    )
    lowest = Math.min(lowest, ankle[1] - m.foot)
  })
  if (skirted) {
    // A skirt flares from the waist to just over the knee; a dress is the same in the shirt's colour.
    const top: [number, number] = [m.depth + 0.01, m.hip + m.leg / 2 + 0.01],
      flare: [number, number] = [m.depth + 0.08, top[1] + 0.06]
    f.frustum(
      leaning([0, 0, 0]),
      m.legs * 0.5,
      m.legs + 0.06,
      flare,
      top,
      look.outfit === "dress" ? look.shirt : look.pants,
    )
  }

  const torso: Basis = leaning([0, m.legs, 0], lean)
  f.box(torso, [-m.depth, 0, -m.shoulder], [m.depth, m.torso, m.shoulder], look.shirt)
  const head: Basis = leaning(at(torso, [0.01, m.torso, 0]), lean * 0.4)
  const hx = m.head * 0.47,
    hz = m.head * 0.45,
    hs = m.head
  f.box(head, [-hx, 0, -hz], [hx, hs, hz], look.skin)
  hair(f, head, look, hx, hz, hs)

  stance.arms.forEach((arm, side) => {
    const s = side === 0 ? -1 : 1
    const shoulder = at(torso, [0, m.torso - m.arm / 2 - 0.02, s * (m.shoulder + m.arm / 2)])
    let elbow: Vec, wrist: Vec, tip: Vec
    if (arm === "head") {
      // Elbows out and up, the hands flat on the sides of the head.
      elbow = [
        shoulder[0] + 0.3 * m.upper,
        shoulder[1] + 0.45 * m.upper,
        shoulder[2] + s * 0.84 * m.upper,
      ]
      wrist = at(head, [hx * 0.2, hs * 0.35, s * (hz + m.arm / 2)])
      tip = [wrist[0], wrist[1] + m.hand, wrist[2]]
    } else {
      const [upper, bend] = arm
      elbow = swing(shoulder, m.upper, upper)
      wrist = swing(elbow, m.fore, upper + bend)
      tip = swing(wrist, m.hand, upper + bend)
    }
    f.limb(shoulder, elbow, m.arm, m.arm, look.shirt)
    f.limb(elbow, wrist, m.arm * 0.9, m.arm * 0.9, sleeve)
    f.limb(wrist, tip, m.arm * 0.8, m.arm * 0.6, look.skin)
  })
  return f.geometry(lowest)
}

/** The hair (or cap) on a head spanning x ±hx (the face at +x), y 0…hs and z ±hz in `head`'s frame. */
const hair = (f: Figure, head: Basis, look: Look, hx: number, hz: number, hs: number): void => {
  const o = 0.015,
    colour = look.hair
  const top = () => f.box(head, [-hx - o, hs * 0.78, -hz - o], [hx + o, hs + 0.03, hz + o], colour)
  const back = (from: number) =>
    f.box(head, [-hx - 0.02, from, -hz - o], [-hx + 0.06, hs + 0.03, hz + o], colour)
  switch (look.hairdo) {
    case "short":
      top()
      back(hs * 0.35)
      break
    case "long":
      // Falls to the shoulders at the back and covers the sides of the head.
      top()
      f.box(head, [-hx - 0.03, -0.12 * hs, -hz - 0.02], [-hx + 0.07, hs + 0.03, hz + 0.02], colour)
      for (const s of [-1, 1])
        f.box(
          head,
          [-hx - o, hs * 0.25, s > 0 ? hz : -hz - 0.025],
          [0, hs, s > 0 ? hz + 0.025 : -hz],
          colour,
        )
      break
    case "bun":
      top()
      back(hs * 0.45)
      f.box(head, [-hx - 0.12, hs * 0.65, -0.06], [-hx, hs * 0.92, 0.06], colour)
      break
    case "bald":
      // A horseshoe fringe round the back and the sides; the crown shows the skin.
      f.box(head, [-hx - o, hs * 0.35, -hz - o], [-hx + 0.04, hs * 0.62, hz + o], colour)
      for (const s of [-1, 1])
        f.box(
          head,
          [-hx, hs * 0.35, s > 0 ? hz : -hz - o],
          [0, hs * 0.62, s > 0 ? hz + o : -hz],
          colour,
        )
      break
    case "cap": {
      // A flat cap (coppola) with a short brim over the eyes, short hair showing under it at the back.
      back(hs * 0.4)
      const cap = tweed(look)
      f.box(head, [-hx - 0.02, hs * 0.74, -hz - 0.02], [hx + 0.02, hs + 0.06, hz + 0.02], cap)
      f.box(head, [hx, hs * 0.72, -hz], [hx + 0.07, hs * 0.8, hz], cap)
      break
    }
  }
}

/** Every frame of a person with this look. */
const personFrames = (look: Look): Record<PersonFrame, BufferGeometry> =>
  Object.fromEntries(
    PERSON_FRAMES.map((frame) => [frame, personFrame(look, STANCES[frame])]),
  ) as Record<PersonFrame, BufferGeometry>

/** Below this speed (m/s) a person is drawn standing (TUNED: a chat partner turning on the spot is not walking). */
const STILL_SPEED = 0.2
/**
 * Above this speed a person is drawn running, m/s: the walk-to-run gait transition (Hreljac 1993, preferred transition speed
 * ≈ 2.06 m/s), kept over the player's brisk game walk (`WALK_SPEED`) so walking looks like walking.
 */
const RUN_GAIT = Math.max(2.06, WALK_SPEED * 1.1)
/** Step length as a share of height: walking ≈ 0.41 (the pedometer rule of thumb, estimate), running ≈ 0.8 (estimate). */
const WALK_STEP = 0.41
const RUN_STEP = 0.8
/** Seconds between a talker's gestures (TUNED: about one per phrase). */
const TALK_BEAT = 1.1
/** A walk cycle by half steps: one leg forward, legs passing, the other forward, passing. */
const WALK_CYCLE = ["walk1", "stand", "walk2", "stand"] as const

/** What picks a person's frame: what it does, how fast it goes (m/s), how far it has gone (m), the sim time (s) and its height. */
export interface Doing {
  readonly mood: Mood
  readonly lying: boolean
  readonly speed: number
  readonly walked: number
  readonly clock: number
  /** A stable phase in [0, 1) of its own, so two talkers do not gesture in step. */
  readonly phase: number
  readonly height: number
}

/**
 * The frame for what a person is doing: lying flat (down or dead) on the standing frame; hands to the head in shock; talking,
 * standing and gesturing by turns; running when fleeing or going faster than a walk, stepping by the distance covered;
 * walking through the walk cycle by half steps.
 */
export const framePerson = (d: Doing): PersonFrame => {
  if (d.lying) return "stand"
  if (d.mood === "shock") return "shock"
  if (d.speed < STILL_SPEED)
    return d.mood === "chat" && Math.floor(d.clock / TALK_BEAT + d.phase * 2) % 2 === 1
      ? "talk"
      : "stand"
  if (d.mood === "flee" || d.speed > RUN_GAIT)
    return Math.floor(d.walked / (RUN_STEP * d.height)) % 2 === 0 ? "run1" : "run2"
  return WALK_CYCLE[Math.floor(d.walked / ((WALK_STEP * d.height) / 2)) % 4]!
}

/** How far a dead person's blood pool spreads, m (TUNED). */
const POOL = 0.8

/**
 * The frames each x-ray proxy encloses: the player walks and runs, but never shows the shock or talk frames, and a box round
 * those would reach into the walls beside them. Within a gait one box encloses every frame, so the silhouette does not jump
 * every half step, and the body's own limbs never poke out in front of it (they would show yellow).
 */
const GAITS = {
  walk: ["stand", "walk1", "walk2"],
  run: ["run1", "run2"],
} as const satisfies Record<string, ReadonlyArray<PersonFrame>>

/** A person node: its look's frames, the one for what it does now, lying along its heading when down or dead. */
export class PersonNode extends FigureNode<PersonFrame> implements Doing {
  readonly height: number
  readonly phase: number
  /** What it does, how fast it goes (m/s) and the sim time (s), as of the last step. */
  mood: Mood = "walk"
  speed = 0
  clock = 0
  private xrayed = false

  constructor(look: Look, material: Material, seed = 0) {
    const frames = personFrames(look)
    frames.stand.computeBoundingBox()
    const front = frames.stand.boundingBox?.max.x ?? 0
    // Lying is the standing figure tipped forward about its right axis onto its face, the feet where it stood; the pool spreads
    // under the chest and head.
    super(
      frames,
      "stand",
      material,
      { turn: [0, 0, -Math.PI / 2], shift: [0, front, 0] },
      { x: 0.6 * look.height, z: 0, radius: POOL, seed },
    )
    this.height = look.height
    this.phase = seeded(seed + 0x9e3779b9)()
  }

  /** Shows the frame for what it is doing now, and the x-ray proxy that fits it if its silhouette shows. */
  pose(): void {
    const frame = framePerson(this)
    this.body.geometry = this.frames[frame]
    this.showProxy(
      this.xrayed
        ? this.lying
          ? "lying"
          : frame === "run1" || frame === "run2"
            ? "run"
            : "walk"
        : undefined,
    )
  }

  /** Shows its x-ray silhouette (`on`), fitted to its gait or to its body lying down, or hides it. */
  override showXray(on: boolean): void {
    this.xrayed = on
    this.pose()
  }

  /** Builds the proxy round the frames of the gait `key`, or round the standing frame as it lies (`lying`). */
  protected override proxy(key: string): Mesh {
    if (key === "walk" || key === "run") return xray(GAITS[key].map((frame) => this.frames[frame]))
    // The box round the body as it lies, not the standing box turned with it: that would reach under the ground.
    const { turn, shift } = this.lies
    const lying = this.frames.stand
      .clone()
      .applyMatrix4(new Matrix4().makeRotationFromEuler(new Euler(...turn)).setPosition(...shift))
    const proxy = xray([lying])
    lying.dispose()
    return proxy
  }
}
