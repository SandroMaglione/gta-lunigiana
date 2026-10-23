import assert from "node:assert/strict"
import { test } from "node:test"

import { STAGE_FROM } from "../../../sim/damage.ts"
import { type EngineSpec, VEHICLE_MODELS, VEHICLES } from "../../../sim/vehicles.ts"
import { CABIN, engineQuiet, engineTargets, timbre, timbreOf, variation } from "../engine.ts"

const db = (a: number, b: number) => 20 * Math.log10(a / b)
/** A petrol four-stroke four of 1.2 l, naturally aspirated, revving 800–6200: the Panda's engine. */
const FOUR: EngineSpec = VEHICLES.panda.engine
const of = (more: Partial<EngineSpec>) => timbreOf({ ...FOUR, ...more })
const at = (
  model: keyof typeof VEHICLES,
  rpm: number,
  load: number,
  inside = false,
  variant = 0.5,
  damage = 0,
  misfire = false,
) => engineTargets(timbre(model), rpm, load, inside, variant, damage, misfire)

test("firing pulses per revolution come from the cylinders and the cycle: half of them on a four-stroke, all of them on a two-stroke", () => {
  assert.deepEqual(
    [
      of({ cylinders: 4 }),
      of({ cylinders: 6 }),
      of({ strokes: 2, cylinders: 1 }),
      of({ strokes: 2, cylinders: 2 }),
    ].map((t) => t.pulses),
    [2, 3, 1, 2],
  )
  assert.equal(at("panda", 6000, 1).hz, 200)
  assert.equal(at("ape", 6000, 1).hz, 100)
  assert.equal(at("truck", 2000, 1).hz, 100)
})

test("a bigger engine sounds bigger: its exhaust formants fall as the cube root of the displacement, its sub rises with the size of each cylinder", () => {
  const small = of({}),
    big = of({ displacement: 8 * FOUR.displacement })
  for (const [i, formant] of small.formants.entries())
    assert.ok(Math.abs(big.formants[i]![0] / formant[0] - 0.5) < 1e-9, `formant ${i}`)
  assert.ok(big.lowpass[0] < small.lowpass[0])
  assert.ok(of({ cylinders: 2 }).sub > small.sub && of({ cylinders: 8 }).sub < small.sub)
})

test("a two-stroke is brighter and thinner than a four-stroke of its size, and rattles at its firing rate", () => {
  const two = of({ strokes: 2 }),
    four = of({})
  assert.ok(
    two.formants[0]![0] > four.formants[0]![0] &&
      two.highpass > four.highpass &&
      two.lowpass[1] > four.lowpass[1],
  )
  assert.notEqual(two.wave, "sawtooth")
  assert.ok(two.noise.pulse > 0 && four.noise.pulse === 0)
})

test("a diesel clatters at its firing rate and a petrol four does not; only a turbo whines", () => {
  assert.ok(of({ fuel: "diesel" }).noise.pulse > 0)
  assert.equal(of({}).noise.pulse, 0)
  assert.equal(of({}).turbo, 0)
  assert.ok(
    of({ aspiration: "turbo" }).turbo > 0 && of({ fuel: "diesel", aspiration: "turbo" }).turbo > 0,
  )
  assert.deepEqual(
    VEHICLE_MODELS.map((model) => timbre(model).turbo > 0),
    VEHICLE_MODELS.map((model) => VEHICLES[model].engine.aspiration === "turbo"),
  )
})

test("the Giulia's sports exhaust voices it below its 2 l: darker than the Panda's 1.2 l, where size alone would put it barely under", () => {
  const giulia = timbre("carabinieri").formants[0]![0],
    panda = timbre("panda").formants[0]![0],
    bySize = timbreOf(VEHICLES.carabinieri.engine).formants[0]![0]
  assert.ok(giulia < 0.8 * bySize && bySize < panda, `${giulia} / ${bySize} / ${panda} Hz`)
})

test("idle is 11 dB under full load at the redline in gain, overrun in between, and darker", () => {
  const { idle, redline } = VEHICLES.panda.engine
  const full = at("panda", redline, 1),
    still = at("panda", idle, 0),
    overrun = at("panda", redline, 0)
  assert.ok(Math.abs(db(still.gain, full.gain) + 11) < 1e-9)
  assert.ok(overrun.gain > still.gain && overrun.gain < full.gain)
  assert.ok(still.lowpass < overrun.lowpass && overrun.lowpass < full.lowpass)
  assert.ok(
    Math.abs(engineQuiet("panda", idle, 0) - 11) < 1e-9 && engineQuiet("panda", redline, 1) === 0,
  )
  assert.equal(at("panda", 0, 0).gain, still.gain, "revs under idle read as idle")
})

test("the driver's seat dulls the own engine behind the firewall and leaves its level to the director", () => {
  const outside = at("carabinieri", 3000, 0.5),
    inside = at("carabinieri", 3000, 0.5, true)
  assert.equal(inside.gain, outside.gain)
  assert.deepEqual(
    [inside.cabinHz, inside.shelf, outside.cabinHz, outside.shelf],
    [CABIN.lowpass, CABIN.shelf, 20000, 0],
  )
})

test("every model peaks at the same nominal level at the redline under full load (the director sets each model's loudness)", () => {
  for (const model of VEHICLE_MODELS)
    assert.equal(at(model, VEHICLES[model].engine.redline, 1).gain, 0.5 * timbre(model).trim, model)
})

test("only turbo models whine, and only under load", () => {
  assert.equal(at("panda", 6000, 1).turbo, 0)
  assert.equal(at("truck", 2000, 0).turbo, 0)
  assert.ok(at("truck", 2000, 1).turbo > 0)
})

test("two vehicles of one model differ a little: 4 % in pitch and 8 % in exhaust formants end to end, nothing else of the law", () => {
  const low = at("panda", 3000, 0.5, false, 0),
    high = at("panda", 3000, 0.5, false, 1),
    nominal = at("panda", 3000, 0.5)
  assert.equal(nominal.hz, 100)
  assert.ok(Math.abs(high.hz / low.hz - 1.02 / 0.98) < 1e-9, `${high.hz / low.hz}`)
  assert.deepEqual({ ...low, hz: 0 }, { ...high, hz: 0 })
  assert.deepEqual(
    [variation(0).formant, variation(0.5).formant, variation(1).formant],
    [0.96, 1, 1.04],
  )
})

test("an engine as new plays the law it played before damage: no wobble, jitter or knock, the gate open, every target as it was", () => {
  // The targets before damage existed, for an engine as new: TRIM and the calibration renders rely on them.
  const before = {
    panda: [
      3000,
      0.5,
      {
        hz: 100,
        drive: 1.65,
        lowpass: 1881.712962962963,
        noiseHz: 1696.296296296296,
        noise: 0.026240740740740735,
        turboHz: 3722.222222222222,
        turbo: 0,
        gain: 0.12073530144858549,
      },
    ],
    truck: [
      1800,
      0.6,
      {
        hz: 90,
        drive: 2.5,
        lowpass: 892.2064400258269,
        noiseHz: 2205.8823529411766,
        noise: 0.04777411764705882,
        turboHz: 5041.176470588236,
        turbo: 0.008470588235294119,
        gain: 0.12113930854803939,
      },
    ],
    ape: [
      6800,
      1,
      {
        hz: 113.33333333333333,
        drive: 4.4,
        lowpass: 7480,
        noiseHz: 4500,
        noise: 0.13999999999999999,
        turboHz: 8500,
        turbo: 0,
        gain: 0.158,
      },
    ],
    carabinieri: [
      750,
      0,
      {
        hz: 25,
        drive: 0.4,
        lowpass: 570.6001296951782,
        noiseHz: 800,
        noise: 0.004800000000000001,
        turboHz: 2500,
        turbo: 0,
        gain: 0.06609107973815144,
      },
    ],
  } as const
  for (const model of VEHICLE_MODELS) {
    const [rpm, load, law] = before[model]
    assert.deepEqual(
      at(model, rpm, load),
      { ...law, cabinHz: 20000, shelf: 0, rough: 0, jitter: 0, knock: 0, gate: 1 },
      model,
    )
  }
  assert.equal(engineQuiet("panda", 3000, 0.5, 0), engineQuiet("panda", 3000, 0.5))
})

test("damage dulls, softens, roughens and knocks an engine: rough from 0.2 before any smoke, knocking from the medium stage", () => {
  const panda = (damage: number, rpm = 3000, load = 0.5) =>
    at("panda", rpm, load, false, 0.5, damage)
  const [nominal, light, medium, severe] = [
    panda(0),
    panda(0.3),
    panda(STAGE_FROM.medium + 0.1),
    panda(0.9),
  ]
  for (const worn of [light, medium, severe])
    assert.ok(
      worn.lowpass < nominal.lowpass &&
        worn.drive < nominal.drive &&
        worn.gain < nominal.gain &&
        worn.hz === nominal.hz,
    )
  assert.ok(severe.lowpass < medium.lowpass && medium.lowpass < light.lowpass)
  assert.deepEqual([panda(0.2).rough, panda(0.2).jitter], [0, 0])
  assert.ok(
    light.rough > 0 &&
      medium.rough > light.rough &&
      severe.rough > medium.rough &&
      severe.jitter > medium.jitter,
  )
  assert.deepEqual([panda(STAGE_FROM.medium).knock, light.knock], [0, 0])
  assert.ok(medium.knock > 0 && severe.knock > medium.knock)
  // Loudest off the throttle; full load masks it.
  assert.ok(Math.abs(panda(0.9, 3000, 1).knock / panda(0.9, 3000, 0).knock - 0.5) < 1e-9)
  // The wobble swings the output between 1 − 2·rough and 1: it never inverts it.
  assert.ok(panda(1).rough <= 0.5)
})

test("a misfire closes the engine's gate, whatever its damage; nothing else of the law moves", () => {
  const firing = at("truck", 1500, 1, false, 0.5, 0.9),
    misfiring = at("truck", 1500, 1, false, 0.5, 0.9, true)
  assert.ok(firing.gate === 1 && misfiring.gate > 0 && misfiring.gate < 0.2)
  assert.deepEqual({ ...misfiring, gate: 1 }, firing)
})

test("damage never lifts an engine's output gain over its nominal, and engineQuiet counts the level it plays", () => {
  for (const model of VEHICLE_MODELS) {
    const { idle, redline } = VEHICLES[model].engine,
      nominal = 0.5 * timbre(model).trim
    for (const rpm of [idle, (idle + redline) / 2, redline]) {
      for (const load of [0, 0.5, 1]) {
        for (const damage of [0, 0.3, 0.6, 0.9, 1]) {
          const t = at(model, rpm, load, false, 0.5, damage)
          assert.ok(
            t.gain <= nominal && t.gate <= 1 && t.rough >= 0,
            `${model} ${rpm} ${load} ${damage}`,
          )
          assert.ok(
            Math.abs(db(nominal, t.gain) - engineQuiet(model, rpm, load, damage)) < 1e-9,
            `${model} ${rpm} ${load} ${damage}`,
          )
        }
      }
    }
  }
  assert.ok(Math.abs(engineQuiet("panda", 6200, 1, 1) - 2) < 1e-9, "2 dB weaker at full damage")
  assert.deepEqual(
    at("panda", 3000, 0.5, false, 0.5, Number.NaN),
    at("panda", 3000, 0.5),
    "NaN damage is none",
  )
})
