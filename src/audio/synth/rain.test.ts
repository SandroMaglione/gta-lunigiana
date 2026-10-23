import assert from "node:assert/strict"
import { test } from "node:test"

import { crackleSamples } from "../buffers.ts"
import { measure } from "../measure.ts"
import { seeded } from "./crash/dsp.ts"
import { bandEnergy } from "./crash/testing.ts"
import { DOWNPOUR, drumSamples, rainMix, rainQuiet, roofMix } from "./rain.ts"

const rain = (rate: number, ground: { readonly forest?: number; readonly built?: number; readonly water?: number } = {}) =>
  ({ kind: "rain", rate, forest: 0, built: 0, water: 0, ...ground }) as const

test("rain is louder the harder it falls: the drops' kinetic energy, 12 dB a decade, a downpour at the nominal", () => {
  assert.equal(rainQuiet(DOWNPOUR), 0)
  // Wischmeier–Smith: 21.4 dB under at 1 mm/h, 13.8 at 4, 9.0 at 10.
  assert.ok(Math.abs(rainQuiet(1) - 21.4) < 0.1 && Math.abs(rainQuiet(4) - 13.8) < 0.1 && Math.abs(rainQuiet(10) - 9) < 0.1)
  assert.ok(Math.abs(rainQuiet(4) - rainQuiet(40) - 12) < 1)
  for (let rate = 0.5; rate < 60; rate *= 1.5) assert.ok(rainQuiet(rate) > rainQuiet(rate * 1.5))
  // Nothing falling, or nonsense, is the faintest drizzle rather than −Infinity or NaN; past 76 mm/h the law saturates.
  for (const rate of [0, -3, Number.NaN]) assert.equal(rainQuiet(rate), rainQuiet(0.1))
  assert.ok(Number.isFinite(rainQuiet(0)) && rainQuiet(200) === rainQuiet(76))
})

test("a shower's separate drops fill into patter, then fuse into the hiss as the runoff starts to roar", () => {
  const [shower, moderate, heavy, downpour] = [1, 4, 25, 60].map((rate) => rainMix(rain(rate)))
  assert.ok(shower!.sparse > moderate!.sparse && moderate!.sparse > heavy!.sparse && downpour!.sparse === 0)
  assert.ok(moderate!.dense > shower!.dense)
  assert.ok(shower!.roar === 0 && heavy!.roar > 0 && downpour!.roar > heavy!.roar)
  for (const mix of [shower, moderate, heavy, downpour]) assert.ok(Object.values(mix!).every(Number.isFinite))
})

test("the drops ring as what they land on, its shares adding in power, so a forest's edge is as loud as either side", () => {
  const power = (mix: ReturnType<typeof rainMix>) => (mix.leaves / 2.2) ** 2 + (mix.hard / 3.1) ** 2 + mix.ground ** 2
  for (const ground of [{}, { forest: 1 }, { built: 1 }, { forest: 0.5 }, { forest: 0.3, built: 0.4 }, { forest: 0.8, built: 0.8 }]) {
    assert.ok(Math.abs(power(rainMix(rain(4, ground))) - 1) < 1e-9, JSON.stringify(ground))
  }
  assert.ok(rainMix(rain(4, { forest: 1 })).top > rainMix(rain(4)).top)
  // Bubbles only where it falls on water, and once it rains.
  assert.equal(rainMix(rain(10)).water, 0)
  assert.ok(rainMix(rain(10, { water: 1 })).water > rainMix(rain(1, { water: 1 })).water)
})

test("rain on water plinks over a steady rain's drops, its loudest bubble never louder than a downpour's", () => {
  // Regression: a layer at 0.4 left a steady rain on a river sounding like open ground's (8 mm/h: every octave within 0.3 dB).
  const law = (rate: number) => 10 ** (-rainQuiet(rate) / 20)
  assert.ok(rainMix(rain(8, { water: 1 })).water > 1, `${rainMix(rain(8, { water: 1 })).water}`)
  for (let rate = 0.5; rate <= 80; rate *= 1.25) assert.ok(rainMix(rain(rate, { water: 1 })).water * law(rate) <= rainMix(rain(DOWNPOUR, { water: 1 })).water + 1e-9, `${rate} mm/h`)
})

test("on a car's roof a shower is drops you can count, a downpour a roar", () => {
  const shower = roofMix({ kind: "roof", rate: 1 }), downpour = roofMix({ kind: "roof", rate: 60 })
  assert.ok(shower.drums > downpour.drums && shower.roar === 0 && downpour.roar > downpour.drums)
})

test("the roof drums low and tonal where the drops outside tick bright: the panel's and the glass's modes, under 1 kHz", () => {
  const rate = 16000, drums = drumSamples(rate, 4, 40, seeded(3)), ticks = crackleSamples(rate * 4, rate, 30, seeded(3))
  const m = measure([drums], rate)
  assert.ok(!m.nan && Math.abs(Math.sqrt(drums.reduce((sum, v) => sum + v * v, 0) / drums.length) - 0.2) < 1e-3)
  // Measured on seeds 1–5: 99.6 % of its energy under 1 kHz, centroid 0.68–0.73 kHz; the grains the drops outside are made of,
  // 3.9–4.1 kHz before their surfaces' filters (the rain voice's centroid: 4.4–8 kHz, the roof's 0.6 kHz).
  assert.ok(bandEnergy(drums, rate, 0, 4, 1, 1000) > 0.95 * bandEnergy(drums, rate, 0, 4, 1, rate / 2))
  assert.ok(measure([ticks], rate).centroid > 4 * m.centroid, `${m.centroid} Hz`)
})
