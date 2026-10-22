import assert from "node:assert/strict"
import { test } from "node:test"

import { VEHICLE_MODELS, VEHICLES, type VehicleModel } from "../../../sim/vehicles.ts"
import type { Material, Surface, Zone } from "../../types.ts"
import { BANDS, between } from "./dsp.ts"
import { type Crash, crushSpeeds, hitOf } from "./hit.ts"
import { crashQuiet } from "./index.ts"
import { aftermath, breakage, tempered } from "./parts.ts"
import { partials as longPartials, renderCrash } from "./render.ts"
import { bandEnergy, centroidOf, type Features, features, layer, partials } from "./testing.ts"
import { land } from "./textures.ts"

const RATE = 48000
/** Twenty draws of each crash: every bound below holds on other seeds too (checked on seeds 1–80, twenty at a time), with margin. */
const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1)

/** A small deterministic random source (mulberry32), so the checks never flake. */
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

interface Spec {
  readonly speed: number
  readonly model?: VehicleModel
  readonly zone?: Zone
  /** A wall's material, or the model of the car hit (on its rear). */
  readonly against?: Material | VehicleModel
  readonly surface?: Surface
  readonly inside?: boolean
}
const isModel = (name: string): name is VehicleModel => (VEHICLE_MODELS as ReadonlyArray<string>).includes(name)
/** `model`'s mass as the sim reports it, t. */
const tonnes = (model: VehicleModel) => VEHICLES[model].mass / 1000
/** The crash `spec` describes, with the sim's mass behind it: the car's against a wall, the reduced mass of two cars. */
const crash = ({ speed, model = "panda", zone = "front", against = "masonry", surface = "asphalt", inside = false }: Spec): Crash => ({
  kind: "crash", speed, body: { model, zone }, surface, inside,
  mass: isModel(against) ? 1 / (1 / tonnes(model) + 1 / tonnes(against)) : tonnes(model),
  against: isModel(against) ? { kind: "car", body: { model: against, zone: "rear" } } : { kind: "wall", material: against }
})

/** The design's matrix: a Panda into a house wall from a bump to a hard hit, car–car pairs, each other target, a side hit, the cabin, a wreck. */
const CASES = {
  bump: { speed: 2 },
  masonry5: { speed: 5 },
  masonry14: { speed: 14 },
  masonry20: { speed: 20 },
  pandas: { speed: 10, against: "panda" },
  truck: { speed: 12, against: "truck" },
  stone: { speed: 8, model: "ape", against: "stone" },
  rail: { speed: 12, model: "carabinieri", against: "rail" },
  tree: { speed: 10, against: "tree" },
  earth: { speed: 8, against: "earth", surface: "grass" },
  side: { speed: 12, zone: "side" },
  inside: { speed: 14, inside: true },
  wreck: { speed: 40, model: "carabinieri" },
  sheet: { speed: 12, against: "sheet" },
  masonry12: { speed: 12 },
  // The cabin with no airbag to fill its lows: a side hit, a rear hit, the Ape.
  insideSide: { speed: 12, zone: "side", inside: true },
  insideRear: { speed: 8, zone: "rear", inside: true },
  insideApe: { speed: 14, model: "ape", inside: true },
  // Bottoming out after a jump, and the laden truck: a nudge and a hard hit.
  landing: { speed: 6, zone: "under" },
  truckNudge: { speed: 2, model: "truck" },
  truck12: { speed: 12, model: "truck" }
} as const satisfies Record<string, Spec>
type Case = keyof typeof CASES

const renders = new Map<Case, ReadonlyArray<{ readonly x: Float32Array; readonly f: Features }>>()
/** Every seed's render of `name` and its features, made once. */
const of = (name: Case) => {
  let done = renders.get(name)
  if (done === undefined) renders.set(name, (done = SEEDS.map((seed) => {
    const x = renderCrash(crash(CASES[name]), RATE, seeded(seed))
    return { x, f: features(x, RATE) }
  })))
  return done
}
const median = (values: ReadonlyArray<number>): number => [...values].sort((a, b) => a - b)[values.length >> 1]!
/** The share of `values` that pass `ok`. */
const share = <T>(values: ReadonlyArray<T>, ok: (value: T) => boolean): number => values.filter(ok).length / values.length
/** The median over the seeds of `name` of what `read` takes from a render. */
const med = (name: Case, read: (f: Features) => number) => median(of(name).map(({ f }) => read(f)))
const within = (value: number, lo: number, hi: number, what: string) => assert.ok(value >= lo && value <= hi, `${what}: ${value.toFixed(3)} not in ${lo}…${hi}`)

/** The exterior crashes the critique's acceptance targets apply to (the bump, the rail and the cabin have their own). */
const EXTERIOR = ["masonry5", "masonry14", "masonry20", "pandas", "truck", "stone", "tree", "earth", "side", "wreck"] as const satisfies ReadonlyArray<Case>

test("every render is finite, never over full scale, at most 4 s long and faded to silence", () => {
  for (const name of Object.keys(CASES) as Array<Case>) {
    for (const { x } of of(name)) {
      let peak = 0
      for (const v of x) {
        assert.ok(Number.isFinite(v), name)
        peak = Math.max(peak, Math.abs(v))
      }
      assert.ok(peak > 0.01 && peak <= 1, `${name} peaks at ${peak}`)
      assert.ok(x.length <= 4 * RATE, name)
      assert.ok(Math.abs(x[x.length - 1]!) < 1e-6 && Math.abs(x[x.length - 100]!) < peak * 1e-3, `${name} ends with a click`)
    }
  }
})

// Regression: under 16 kHz a band with no bins under Nyquist was scaled by 1/0, and every sample of a crash was NaN.
test("a crash renders finite at any device rate, 8 kHz up", () => {
  for (const rate of [8000, 16000, 22050]) {
    const x = renderCrash(crash(CASES.masonry14), rate, seeded(1))
    assert.ok(x.every(Number.isFinite) && x.some((v) => Math.abs(v) > 0.01), `${rate} Hz`)
  }
})

// Regression: the band noise looped every 1.4 s, so a long tail replayed the same noise (correlation 0.99 one loop apart).
test("a crash's noise never repeats inside a render", () => {
  for (const seed of [1, 2, 3]) {
    const x = renderCrash(crash(CASES.masonry20), RATE, seeded(seed)), from = Math.round(0.9 * RATE), n = Math.round(0.5 * RATE), lag = 1 << 16
    let xy = 0, xx = 0, yy = 0
    for (let i = from; i < from + n; i++) {
      xy += x[i]! * x[i + lag]!
      xx += x[i]! * x[i]!
      yy += x[i + lag]! * x[i + lag]!
    }
    assert.ok(Math.abs(xy / Math.sqrt(xx * yy)) < 0.3, `seed ${seed}: ${xy / Math.sqrt(xx * yy)}`)
  }
})

test("a seed renders the same crash twice; another seed draws another", () => {
  const a = renderCrash(crash(CASES.masonry14), RATE, seeded(7)), b = renderCrash(crash(CASES.masonry14), RATE, seeded(7)), c = renderCrash(crash(CASES.masonry14), RATE, seeded(8))
  assert.deepEqual(a, b)
  assert.ok(a.length !== c.length || a.some((v, i) => v !== c[i]))
})

test("one level law, ½·μ·v²·(1 − e²): +6.5 dB per doubling of speed, Panda–Panda 3 dB under a Panda into a wall, capped 6 dB over the 15 m/s reference", () => {
  const quiet = (spec: Spec) => crashQuiet(crash(spec))
  assert.ok(Math.abs(quiet({ speed: 15 })) < 0.01)
  for (const v of [2, 4, 8]) within(quiet({ speed: v }) - quiet({ speed: 2 * v }), 5.9, 7, `${v} → ${2 * v} m/s`)
  within(quiet({ speed: 10, against: "panda" }) - quiet({ speed: 10 }), 2.9, 3.1, "Panda–Panda")
  assert.equal(quiet({ speed: 30 }), -6)
  assert.equal(quiet({ speed: 60, model: "carabinieri" }), -6)
  // The car crushes 30 % of its energy into an earth bank, 60 % into a tree: quieter by that much.
  within(quiet({ speed: 10, against: "earth" }) - quiet({ speed: 10 }), 5, 5.5, "earth")
  within(quiet({ speed: 10, against: "tree" }) - quiet({ speed: 10 }), 2, 2.5, "tree")
  // The renders follow it: the main block's RMS rises with the law.
  const rms = (name: Case) => med(name, (f) => f.rms)
  within(rms("masonry14") - rms("masonry5"), quiet({ speed: 5 }) - quiet({ speed: 14 }) - 2, quiet({ speed: 5 }) - quiet({ speed: 14 }) + 2, "5 → 14 m/s RMS")
  // Regression: a bump played 3–5 dB under the law and a guard rail's ring 2–3 dB over it, so masking culled them wrongly. Peaks re the reference's, 10 seeds.
  const peakOf = (spec: Spec) => median(SEEDS.slice(0, 10).map((seed) => renderCrash(crash(spec), RATE, seeded(seed)).reduce((p, v) => Math.max(p, Math.abs(v)), 0)))
  const reference = peakOf({ speed: 15 })
  for (const spec of [{ speed: 2 }, { speed: 5 }, { speed: 2, against: "rail" }, { speed: 15, against: "rail" }, { speed: 15, against: "sheet" }, { speed: 10, against: "panda" }, { speed: 2, model: "truck" }] as const) {
    within(20 * Math.log10(peakOf(spec) / reference) + quiet(spec), -2, 2, `${JSON.stringify(spec)} peak re the law, dB`)
  }
})

// Regression: the sim's masses became kilograms and tonnes; at the full 10·log10 μ a 26 t truck's nudge played as a Panda's 15 m/s crash.
test("a laden truck crashes loud and heavy, but its 2 m/s nudge into a house plays like a Panda's 4 m/s bump and breaks nothing", () => {
  const quiet = (spec: Spec) => crashQuiet(crash(spec))
  within(quiet({ speed: 2, model: "truck" }) - quiet({ speed: 4 }), -1, 1, "truck at 2 m/s re a Panda at 4")
  within(quiet({ speed: 8, model: "truck" }) - quiet({ speed: 8 }), -7.5, -6.5, "truck re a Panda at 8 m/s")
  assert.equal(quiet({ speed: 14, model: "truck" }), -6)
  // Each body's barrier-equivalent speed, what its parts break by: the truck's own into a wall (under the 3 m/s of the first
  // part to go), a Panda against the truck nearly its own, the truck hit by it barely any (it hardly moves).
  const [nudge] = crushSpeeds(crash({ speed: 2, model: "truck" }))
  within(nudge!, 1.99, 2.01, "the truck's nudge, m/s")
  const [panda, truck] = crushSpeeds(crash({ speed: 12, against: "truck" }))
  within(panda!, 9.5, 11, "the Panda against the truck, m/s")
  within(truck!, 1, 1.4, "the truck hit by the Panda, m/s")
})

test("bottoming out after a jump breaks no glass, lamp or airbag: nothing faces the ground", () => {
  const broken = layer(RATE, 2.5, seeded(2), (mix) => {
    const hit = hitOf(crash({ speed: 15, zone: "under" }), seeded(4))
    breakage(mix, hit, hit.bodies[0]!)
  })
  assert.ok(broken.every((v) => v === 0))
  // Nor the Giulia's light bar: its landing settles and rattles like a body with no parts of its own (the Ape's quirks are none).
  const settling = (model: VehicleModel) => layer(RATE, 2.5, seeded(2), (mix) => {
    const hit = hitOf(crash({ speed: 15, model: "carabinieri", zone: "under" }), seeded(4))
    aftermath(mix, hit, { ...hit.bodies[0]!, model })
  })
  const giulia = settling("carabinieri"), plain = settling("ape")
  const off = giulia.reduce((most, v, i) => Math.max(most, Math.abs(v - plain[i]!)), 0)
  assert.equal(off, 0, `the landing differs by up to ${off}`)
})

// Regression: every ramp ended at the level cap (about 30 m/s), so a 42 or 60 m/s wreck rendered like a 30 m/s one.
test("past the level cap a crash grows in time: a longer tail and block, at most 3 sub-hits, another sound at 60 m/s than at 42", () => {
  const wreck = (speed: number, zone: Zone = "front") => crash({ speed, model: "carabinieri", zone })
  const tails = [30, 42, 60].map((v) => hitOf(wreck(v), seeded(1)).tail)
  assert.ok(tails[0]! < tails[1]! && tails[1]! < tails[2]!, `${tails}`)
  const blocks = (v: number) => median(SEEDS.map((seed) => hitOf(wreck(v), seeded(seed)).block))
  assert.ok(blocks(30) < blocks(60), `${blocks(30)} → ${blocks(60)} s`)
  for (const seed of SEEDS) assert.ok(hitOf(wreck(40, "side"), seeded(seed)).subHits.length <= 3)
  const a = renderCrash(wreck(42), RATE, seeded(3)), b = renderCrash(wreck(60), RATE, seeded(3))
  let diff = 0, sum = 0
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    diff += (a[i]! - b[i]!) ** 2
    sum += a[i]! ** 2
  }
  assert.ok(diff / sum > 0.01, `42 vs 60 m/s differ by ${10 * Math.log10(diff / sum)} dB`)
})

test("exterior crashes meet the measured targets: a 150–450 ms main block, a 8–25 ms rise, crest 9–15 dB, Gaussian-dense noise, no boom, the energy at 125 Hz–2 kHz", () => {
  for (const name of EXTERIOR) {
    within(med(name, (f) => f.db10 ?? Infinity), 150, 450, `${name} −10 dB, ms`)
    if (name !== "earth") within(med(name, (f) => f.rise), 8, 25, `${name} rise, ms`)
    within(med(name, (f) => f.crest), 9, 15, `${name} crest, dB`)
    for (const p of [1, 2]) within(med(name, (f) => f.phases[p]!.bandFlatness), 0.35, 0.6, `${name} band flatness, phase ${p}`)
    within(med(name, (f) => f.kurtosis), 2.8, 4.5, `${name} 1–8 kHz kurtosis`)
    within(med(name, (f) => f.phases[1]!.octaves[8]!), -25, -12, `${name} 8 kHz, dB`)
    within(med(name, (f) => f.phases[1]!.octaves[9]!), -36, -22, `${name} 16 kHz, dB`)
    for (const p of [0, 1, 2]) within(med(name, (f) => f.phases[p]!.centroid), 1500, 3500, `${name} centroid, phase ${p}`)
  }
  // Render by render (98–99 % of them measured): no boom, the loudest octave in 125 Hz–2 kHz.
  const all = EXTERIOR.flatMap((name) => of(name).map(({ f }) => f.phases[1]!.octaves))
  within(share(all, (octaves) => octaves[1]! <= -5), 0.97, 1, "renders with 63 Hz ≤ −5 dB")
  within(share(all, (octaves) => octaves.indexOf(0) >= 2 && octaves.indexOf(0) <= 6), 0.97, 1, "renders loudest at 125 Hz–2 kHz")
})

test("the tail grows with speed: −20 dB from 0.25 s to 2.5 s, later the harder the hit", () => {
  const d20 = (name: Case) => med(name, (f) => f.db20 ?? Infinity)
  for (const name of ["masonry5", "masonry14", "masonry20", "wreck"] as const) within(d20(name), 250, 2500, `${name} −20 dB, ms`)
  assert.ok(d20("masonry5") < d20("masonry14") && d20("masonry14") < d20("masonry20") && d20("masonry20") < d20("wreck"))
})

test("the median crash spectrum is flat within 6 dB over 125 Hz–2 kHz (the truck's bumper clang lifts 250–500 Hz: 8 dB)", () => {
  for (const [name, spread] of [["masonry14", 6], ["pandas", 6], ["truck", 8]] as const) {
    const bands = [2, 3, 4, 5, 6].map((b) => med(name, (f) => f.phases[1]!.octaves[b]!))
    assert.ok(Math.max(...bands) - Math.min(...bands) <= spread, `${name}: ${bands}`)
  }
})

test("a crash has 1–3 long partials: the layer rings its model's count at 0.6–4.3 kHz, η 0.001–0.01; in the render they stand 9 dB clear of the crunch", () => {
  // The layer alone, over a flat crunch: Panda and Giulia 1–2, the Ape 2–3, the truck 1–2 (and 0–1 on the other body of two).
  const flat = BANDS.map(() => 0.1)
  for (const [model, few, many] of [["panda", 1, 2], ["ape", 2, 3], ["truck", 1, 2], ["carabinieri", 1, 2]] as const) {
    for (const seed of SEEDS.slice(0, 8)) {
      const random = seeded(seed), hit = hitOf(crash({ speed: 12, model }), random)
      const x = layer(RATE, 1.6, random, (mix) => longPartials(mix, hit, hit.bodies[0]!, flat)), found = partials(x, RATE, 0, 500, 5000)
      assert.ok(found.length >= few && found.length <= many, `${model} seed ${seed}: ${found.length} partials`)
      for (const p of found) assert.ok(p.hz >= 600 && p.hz <= 4300 && p.eta >= 0.0007 && p.eta <= 0.011 && p.t60 >= 0.2, `${model}: ${p.hz.toFixed(0)} Hz, η ${p.eta.toFixed(4)}`)
    }
  }
  for (const name of ["masonry5", "masonry14", "pandas", "stone", "tree", "earth"] as const) {
    const counts = of(name).map(({ x, f }) => partials(x, RATE, f.onset).filter((p) => p.eta >= 0.001 && p.eta <= 0.01).length)
    assert.ok(median(counts) >= 1 && median(counts) <= 3, `${name}: ${counts}`)
  }
})

test("a parking bump is short: −10 dB at 40–100 ms, its crest that of a bumper tap", () => {
  within(med("bump", (f) => f.db10 ?? Infinity), 40, 100, "−10 dB, ms")
  within(med("bump", (f) => f.rise), 8, 25, "rise, ms")
  within(med("bump", (f) => f.crest), 12, 16, "crest, dB")
  within(med("bump", (f) => f.phases[1]!.bandFlatness), 0.35, 0.6, "band flatness")
})

test("the guard rail is the only long tonal ring: low band flatness through 150–600 ms, partials ringing a second and more", () => {
  within(med("rail", (f) => f.phases[2]!.bandFlatness), 0, 0.4, "rail band flatness 150–600 ms")
  assert.ok(med("rail", (f) => f.phases[2]!.bandFlatness) < med("masonry14", (f) => f.phases[2]!.bandFlatness) - 0.15)
  within(share(of("rail"), ({ x, f }) => partials(x, RATE, f.onset, 150, 3000).some((p) => p.t60 >= 1)), 0.9, 1, "renders with a partial of T60 ≥ 1 s")
})

test("a tree rustles for more than 2 s, faintly; an earth bank is the slowest, dullest hit", () => {
  const rustle = (name: Case) => median(of(name).map(({ x }) => bandEnergy(x, RATE, 2, 2.5, 2500, 8000) / bandEnergy(x, RATE, 0, 0.3, 2500, 8000)))
  // Regression: the leaves hissed at 7–13 dB under the crash itself, brighter than any recording's tail (w4, a real tree crash: 1.4 kHz).
  within(10 * Math.log10(rustle("tree")), -45, -18, "tree rustle at 2–2.5 s re 0–0.3 s, 2.5–8 kHz, dB")
  assert.ok(rustle("tree") > 4 * rustle("masonry14"), `tree ${rustle("tree")}, masonry ${rustle("masonry14")}`)
  within(med("tree", (f) => f.phases[3]!.centroid), 1500, 3500, "tree centroid 0.6–3 s")
  const others = EXTERIOR.filter((name) => name !== "earth")
  for (const name of others) {
    assert.ok(med("earth", (f) => f.rise) > med(name, (f) => f.rise), `earth rises slower than ${name}`)
    assert.ok(med("earth", (f) => f.phases[1]!.octaves[8]!) < med(name, (f) => f.phases[1]!.octaves[8]!), `earth duller than ${name}`)
  }
})

// Regression: the crunch bed skipped the cabin's balance, so only a frontal hit (its airbag) sounded from inside.
test("heard from the cabin every crash is boom-heavy, its highs muffled: 70–85 % of its energy under 200 Hz, 2–16 kHz 15 dB and more under the same crash outside", () => {
  for (const [name, outside] of [["inside", CASES.inside], ["insideSide", CASES.insideSide], ["insideRear", CASES.insideRear], ["insideApe", CASES.insideApe]] as const) {
    within(med(name, (f) => f.below200), 0.7, 0.85, `${name} share under 200 Hz`)
    const highs = (x: Float32Array, f: Features) => bandEnergy(x, RATE, f.onset / RATE + 0.03, f.onset / RATE + 0.4, 2000, 16000)
    const drops = of(name).slice(0, 8).map(({ x, f }, i) => {
      const out = renderCrash(crash({ ...outside, inside: false }), RATE, seeded(SEEDS[i]!))
      return 10 * Math.log10(highs(x, f) / highs(out, features(out, RATE)))
    })
    assert.ok(Math.max(...drops) <= -15, `${name}: 2–16 kHz ${drops.map((d) => d.toFixed(1))} dB`)
  }
  assert.ok(med("masonry14", (f) => f.below200) < 0.45)
})

// Regression: the truck's bumper clang sat 23–28 dB under the crunch, and the marble and chain needed the truck to lose 2–6 m/s.
test("a Panda into the truck rings the truck's steel bumper: a 150–650 Hz partial 12 dB clear in most renders, in a Panda–Panda hit's hardly any", () => {
  const clang = (name: Case) => share(of(name), ({ x, f }) => partials(x, RATE, f.onset, 150, 650).some((p) => p.eta <= 0.01 && p.clear >= 12))
  assert.ok(clang("truck") >= 0.3 && clang("pandas") <= 0.1, `truck ${clang("truck")}, pandas ${clang("pandas")}`)
})

// Regression: a sheet-metal wall rang 11–18 dB under the car's crunch and measured like masonry.
test("a sheet-metal wall rings: its band flatness through 150–600 ms well under masonry's", () => {
  const flatness = (name: Case) => med(name, (f) => f.phases[2]!.bandFlatness)
  assert.ok(flatness("sheet") < flatness("masonry12") - 0.1, `sheet ${flatness("sheet")}, masonry ${flatness("masonry12")}`)
  for (const { f } of of("sheet")) assert.ok(f.phases[1]!.octaves[1]! <= -5, `sheet: 63 Hz at ${f.phases[1]!.octaves[1]} dB`)
})

// Regression: a 2 m/s nudge into a greenhouse opened with the full pane-breaking crack (0–30 ms centroid 5.9 kHz), and nothing fell after it.
test("a greenhouse nudged at 2 m/s barely cracks: its first 30 ms near a house wall's, a 5 m/s hit's bright", () => {
  const first = (spec: Spec) => median(SEEDS.slice(0, 10).map((seed) => features(renderCrash(crash(spec), RATE, seeded(seed)), RATE).phases[0]!.centroid))
  assert.ok(first({ speed: 2, against: "glass" }) < 4000 && first({ speed: 5, against: "glass" }) > 4500, `${first({ speed: 2, against: "glass" })} / ${first({ speed: 5, against: "glass" })} Hz`)
})

test("what broke stays broken: a side already hit at 12 m/s loses no mirror and no glass again", () => {
  const side = (worn: number) => layer(RATE, 2.5, seeded(2), (mix) => {
    const hit = hitOf({ ...crash({ speed: 12, zone: "side" }), body: { model: "panda", zone: "side", worn } }, seeded(4))
    breakage(mix, hit, hit.bodies[0]!)
  })
  const energy = (x: Float32Array) => x.reduce((p, v) => p + v * v, 0)
  assert.ok(energy(side(0)) > 0 && energy(side(12)) === 0)
})

test("a tempered pane's shower is centred on the 8 kHz octave, and grass swallows it 14 dB and more", () => {
  const shower = (surface: Surface) => layer(RATE, 2.5, seeded(3), (mix) => tempered(mix, hitOf(crash({ speed: 12, zone: "side", surface }), seeded(4)), 0.02, 0.95))
  const asphalt = shower("asphalt"), grass = shower("grass")
  within(centroidOf(asphalt, RATE, 0.15, 1.4), 6000, 10000, "shower centroid, Hz")
  assert.ok(10 * Math.log10(bandEnergy(grass, RATE, 0.1, 2.4, 20, 20000) / bandEnergy(asphalt, RATE, 0.1, 2.4, 20, 20000)) <= -14)
  // A single piece of debris too.
  const piece = (surface: Surface) => layer(RATE, 1, seeded(5), (mix) => land(mix, 0.1, surface, 0.01, [0, 0, 0, 0, 0.3, 1, 0.6, 0.2, 0, 0], [[between(mix.random, 1000, 2000), 0.01]], 0.5))
  assert.ok(10 * Math.log10(bandEnergy(piece("grass"), RATE, 0, 1, 20, 20000) / bandEnergy(piece("asphalt"), RATE, 0, 1, 20, 20000)) <= -14)
})
