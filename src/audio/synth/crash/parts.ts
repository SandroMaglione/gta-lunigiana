/**
 * What breaks, falls and rattles on a crashing vehicle (physics.md §2, §3.3; critique §4.5, §4.7, §7.7):
 * parts switch on by threshold, read at each body's barrier-equivalent speed and chosen by the zone hit.
 * Front and rear: the PP cover's thock, cracks and clip pops from 3 m/s, the lamps from 4–6 m/s, the
 * airbag from 5–7 m/s (front), the laminated windscreen from 10–15 m/s (front), the side glass from
 * 15–20 m/s. A side: the door skin, the mirror snapping off, the side glass from 5–10 m/s. Under
 * (bottoming out): nothing. A part breaks once: not when an earlier hit on the zone already passed
 * its threshold (`worn`). Then the
 * aftermath: debris landing, rattles, creaks (Omori, t^−0.9), coolant hiss, and each model's own.
 * Levels are power re the crunch's main block.
 *
 * @module audio/synth/crash/parts
 */
import { smoothstep } from "../../buffers.ts"
import { between, halfSine, type Mix, power, puff, rayleigh, strike, tint } from "./dsp.ts"
import type { Crushed, Hit } from "./hit.ts"
import { grains, groundOf, land, train } from "./textures.ts"

// Spectra, dB per octave band 31.5 Hz … 16 kHz.
/** The PP cover and its foam: a dull thock peaking near 250 Hz. */
const THOCK = power([-30, -14, -4, 0, -3, -9, -16, -24, -32, -40])
/** A plastic crack or clip pop: broadband 1–8 kHz. */
const CRACK = power([-99, -99, -30, -16, -7, -2, 0, -4, -12, -25])
/** The tempered pane going: a broadband pop, brightest at 4–8 kHz. */
const POP = power([-99, -40, -30, -20, -12, -6, -3, 0, -1, -6])
/** The shower of cubes: loudest octave 8 kHz (2k −13, 4k −9, 16k −9: critique §4.5). */
const SHOWER = power([-99, -99, -40, -30, -24, -18, -13, -9, 0, -9])
/** The airbag: a broadband, low-heavy whump. */
const WHUMP = power([-6, 0, -1, -4, -9, -16, -24, -32, -99, -99])
/** Plastic bits landing: dull 0.5–3 kHz ticks. */
const BIT = power([-99, -99, -24, -12, -4, 0, -3, -10, -22, -36])
/** A metal click under a ring. */
const CLINK = power([-99, -99, -99, -26, -14, -5, 0, -4, -14, -28])
/** The car settling: rocking on its springs, scrubbing, its low body ringing on (the recordings' tails are loudest at 125–500 Hz). */
const SETTLE = power([-18, -8, 0, -2, -6, -10, -14, -20, -28, -40])
/** Refrigerant and coolant hissing out, 2–10 kHz. */
const HISS = power([-99, -99, -99, -40, -26, -12, -3, 0, -4, -16])

/** A tempered pane breaking at `t0` s from a sill `sill` m high (critique §4.5): the pop, a near-silent gap, cubes landing in clumps from 150–250 ms to ~1.4 s, a second cascade sometimes. */
export const tempered = (mix: Mix, hit: Hit, t0: number, sill: number): void => {
  const { random } = mix, ground = groundOf(hit.surface), shower = tint(SHOWER, ground.tint), level = ground.gain ** 2
  puff(mix, t0, 0.0003, 0.005, 0.03, POP)
  // 1400 cubes and 10–60 clumps land from 150–250 ms, densest about a third of the way down from the sill, thinning out to ~1.4 s.
  const first = t0 + between(random, 0.15, 0.25), peak = first + Math.sqrt((2 * sill) / 9.81) * between(random, 0.3, 0.5)
  const at = (u: number) => (u < 0.4 ? first + (peak - first) * Math.sqrt(u / 0.4) : peak - 0.3 * Math.log(1 - (u - 0.4) / 0.6 * 0.95))
  for (let i = 0; i < 1400; i++) puff(mix, at(random()), 0.0002, between(random, 0.0003, 0.001), 0.0002 * level * -Math.log(1 - random()), shower)
  for (let i = Math.round(between(random, 10, 60)); i > 0; i--) puff(mix, at(random()), 0.0005, between(random, 0.003, 0.01), 0.0015 * level * random(), shower)
  if (random() < 0.4) grains(mix, t0 + between(random, 1.5, 2), 3.5, 1200, 0.15, 0.0006, 0.0003 * level, shower)
}

/** The laminated windscreen cracking (it stays put: no shower): a sharp crack, a crackle of 5–20 clicks over 10–60 ms, the PVB's dull thud. */
const windscreen = (mix: Mix, t0: number): void => {
  const { random } = mix
  puff(mix, t0, 0.0002, 0.0005, 0.035, POP)
  for (let i = Math.round(between(random, 5, 20)); i > 0; i--) puff(mix, t0 + between(random, 0.01, 0.06) * random(), 0.0002, 0.0004, 0.015 * random(), CRACK)
  puff(mix, t0, 0.002, between(random, 0.015, 0.03), 0.045, THOCK)
  strike(mix, t0, between(random, 150, 400), 0.1, 0.045)
}

/** A cover cracking, clips popping, a lamp breaking, a mirror snapping: `count` bright clicks within `spread` s from `t0` at up to `level`, and `shards` pieces ringing at `hz` with loss factor `eta`. */
const breaking = (mix: Mix, t0: number, count: number, spread: number, level: number, shards: number, hz: readonly [number, number], eta: number): void => {
  const { random } = mix
  for (let i = 0; i < count; i++) puff(mix, t0 + spread * random() ** 2, 0.0002, between(random, 0.0004, 0.0012), level * between(random, 0.3, 1), CRACK)
  for (let i = 0; i < shards; i++) strike(mix, t0 + spread * random(), between(random, hz[0], hz[1]), eta, 0.05 * rayleigh(random) * Math.sqrt(level))
}

/** The parts of `body` that break in this hit: those whose threshold it passes and no earlier hit on the zone did. */
export const breakage = (mix: Mix, hit: Hit, body: Crushed): void => {
  // Bottoming out: no bumper, lamp, pane or airbag faces the ground.
  if (body.zone === "under") return
  const { random } = mix, v = body.speed, spec = body.spec, frontal = body.zone === "front"
  // ponytail: each threshold is drawn per render, so a harder later hit can break a part again when its draw lands between the two speeds; per-vehicle thresholds would make it exact.
  const breaks = (threshold: number) => v > threshold && body.worn <= threshold
  if (body.zone === "side") {
    // The door skin takes it (no crash box: more crunch per joule, in the crunch itself); the mirror snaps off; the side glass goes from 5–10 m/s.
    if (breaks(3)) breaking(mix, between(random, 0.02, 0.06), 3, 0.01, 0.1, 2, [1000, 3000], 0.05)
    if (breaks(between(random, 5, 10))) tempered(mix, hit, between(random, 0.02, 0.06), spec.sill)
  } else {
    if (spec.bumper === "plastic") {
      // The cover over its foam: a dull thock, its modes struck through the soft contact's spectrum; cracks and clip pops from 3 m/s.
      const thock = 1 - 0.7 * smoothstep(3, 10, v)
      puff(mix, 0, hit.rise * 0.6, between(random, 0.02, 0.04), 0.2 * thock, THOCK)
      for (let i = 0; i < 6; i++) {
        // A thock rings 20–100 ms (η ≈ 0.07 at 300 Hz).
        const hz = between(random, 150, 700)
        strike(mix, 0, hz, 2.2 / (hz * between(random, 0.02, 0.1)), 0.8 * rayleigh(random) * Math.max(0.3, halfSine(hz, body.contact)) * thock, hit.rise * 0.6)
      }
      if (v > 3) breaking(mix, hit.rise * 0.6, Math.round(Math.min(12, 2 + v / 2)), 0.03, 0.08, 0, [0, 0], 0)
    } else {
      // Bare steel: a bumper's clang, a few low-damped modes at 150–900 Hz.
      for (let i = 0; i < 4; i++) strike(mix, 0, between(random, 150, 900), 0.004, spec.clang * rayleigh(random) * Math.min(1, hit.speed / 8), hit.rise)
    }
    // The lamps (polycarbonate: a snap and short 0.8–2.5 kHz ticks), from 4–6 m/s.
    if (breaks(between(random, 4, 6))) breaking(mix, hit.rise * 0.6 + between(random, 0, 0.015), 3, 0.05, 0.08, Math.round(between(random, 5, 15)), [800, 2500], 0.015)
    if (frontal && breaks(between(random, 10, 15))) windscreen(mix, between(random, 0.02, 0.08))
    if (breaks(between(random, 15, 20))) tempered(mix, hit, between(random, 0.02, 0.1), spec.sill)
  }
  // The airbag fires 15–30 ms in from 5–7.2 m/s barrier-equivalent: a muffled whump.
  if (frontal && spec.airbag && breaks(between(random, 5, 7.2))) puff(mix, between(random, 0.015, 0.03), 0.003, between(random, 0.025, 0.04), between(random, 0.02, 0.08), WHUMP)
}

/** The aftermath of `body`: debris landing from 0.25 s (to 2.5 s in a wreck), loose parts rattling, creaks decaying as t^−0.9, coolant hiss after a hard frontal hit. */
export const aftermath = (mix: Mix, hit: Hit, body: Crushed): void => {
  const { random } = mix, v = body.speed, spread = 0.5 + 1.5 * smoothstep(8, 35, v)
  // The car settling, 8–13 dB under the block (a little louder after a bump, whose rub is short).
  puff(mix, hit.block * 0.8, 0.05, hit.tail * between(random, 0.25, 0.4), 10 ** -(between(random, 0.8, 1.3) - 0.1 * (1 - smoothstep(3, 8, v))) * body.part, SETTLE)
  // Pieces: none at 2 m/s, a handful at 5, dozens at 10–15, hundreds in a wreck, more the harder it is past the level cap; a third of them metal.
  for (let i = Math.round(between(random, 0.6, 1.2) * Math.min(220 * (1 + smoothstep(25, 60, v)), 0.7 * Math.max(0, v - 3) ** 2)); i > 0; i--) {
    const t = Math.sqrt((2 * between(random, 0.3, 1.3)) / 9.81) + spread * random() ** 2, level = 10 ** -between(random, 2.2, 3.6)
    if (random() < 0.35) {
      // Metal clinks at 1–6 kHz ringing 20–100 ms.
      const hz = between(random, 1000, 6000), eta = 2.2 / (hz * between(random, 0.03, 0.1))
      land(mix, t, hit.surface, level, CLINK, [[hz, eta], [hz * between(random, 1.3, 2.4), eta]], 0.5)
    } else land(mix, t, hit.surface, level * 2, BIT)
  }
  if (v > 4) {
    // Loose trim and fittings: short click trains through a couple of the part's own modes.
    for (let i = Math.round(between(random, 1, 2 + Number(v > 12)) * body.spec.rattle); i > 0; i--) {
      const hz = between(random, 800, 3500)
      train(mix, between(random, 0.05, 0.4), Math.round(between(random, 8, 30) * body.spec.rattle), 1 / between(random, 15, 45), between(random, 0.1, 0.4), 0.004 * body.spec.rattle, CLINK, [[hz, 0.02], [hz * between(random, 1.4, 2.1), 0.02]], 0.4)
    }
  }
  if (v > 5) {
    // Crumpled sheet relaxing: creaks at an Omori rate ∝ (t + 0.2)^−0.9 (physics.md §2.8), each a little stick-slip burst.
    const count = Math.round(5 + 25 * smoothstep(5, 30, v) + 15 * smoothstep(30, 60, v)), a = 0.35 ** 0.1, b = (0.35 + hit.tail) ** 0.1
    for (let i = 0; i < count; i++) {
      const t = (a + random() * (b - a)) ** 10 - 0.2, hz = between(random, 400, 2500)
      train(mix, t, Math.round(between(random, 3, 10)), 1 / between(random, 100, 300), 0.03, 10 ** -between(random, 2.5, 4), CLINK, [[hz, between(random, 0.01, 0.03)]], 0.5, 2)
    }
  }
  if (body.zone === "front" && random() < smoothstep(10, 18, v)) puff(mix, between(random, 0.1, 0.4), between(random, 0.1, 0.3), 1, 10 ** -between(random, 3.3, 4.3), HISS)
  QUIRKS[body.model](mix, hit, body)
}

/** Each model's own: the Panda's hubcap wobbling down, the truck's marble and chain, the Giulia's light bar; the Ape's rattles are its `rattle`. */
const QUIRKS: Record<Crushed["model"], (mix: Mix, hit: Hit, body: Crushed) => void> = {
  panda: (mix, _hit, body) => {
    const { random } = mix
    if (body.speed < 9 || random() > 0.4) return
    // Euler's disk: strikes ever closer together, from 0.15 s apart to 20 ms.
    const hz = between(random, 1200, 2000)
    for (let t = between(random, 0.3, 0.8), gap = 0.15; gap > 0.02; t += gap, gap *= 0.85) {
      for (const ratio of [1, 2.3, 3.9]) strike(mix, t, hz * ratio, 0.004, 0.006 * rayleigh(random))
    }
  },
  ape: () => undefined,
  truck: (mix, hit, body) => {
    const { random } = mix
    // The marble in the bed shifts by the truck's own velocity change (from 0.5 m/s: 2.6 m/s is ~3 g against stone's ~0.5 g of friction): stone thunks at 80–300 Hz, a chain rattling from 2.5 m/s.
    for (let i = Math.round(smoothstep(0.5, 3, body.dv) * between(random, 2, 6)); i > 0; i--) {
      const hz = between(random, 80, 300)
      land(mix, between(random, 0.05, 0.6), "asphalt", 0.03 * random(), THOCK, [[hz, 0.02], [hz * between(random, 1.5, 2.2), 0.02]], 0.8)
    }
    if (body.dv > 2.5) train(mix, between(random, 0.05, 0.2), Math.round(between(random, 15, 40)), 1 / between(random, 25, 50), 0.4, 0.01, CLINK, [[between(random, 2000, 5000), 0.006]], 0.5)
    void hit
  },
  carabinieri: (mix, _hit, body) => {
    const { random } = mix
    // The light bar: its polycarbonate cracks and its electronics rattle, in a crash (a landing breaks nothing).
    if (body.speed < 6 || body.zone === "under") return
    breaking(mix, between(random, 0.01, 0.05), 3, 0.02, 0.2, 2, [1000, 2500], 0.015)
    train(mix, between(random, 0.05, 0.15), Math.round(between(random, 6, 20)), 1 / between(random, 30, 60), 0.2, 0.004, CLINK, [[between(random, 1000, 3000), 0.02]], 0.4)
  }
}
