import assert from "node:assert/strict"
import { test } from "node:test"

import { measure } from "../measure.ts"
import { SILENCE_DB } from "../mixer.ts"

const RATE = 48000
const tone = (hz: number, amplitude: number, seconds = 1) =>
  Float32Array.from(
    { length: RATE * seconds },
    (_, i) => amplitude * Math.sin((2 * Math.PI * hz * i) / RATE),
  )

test("a half-scale 1 kHz sine peaks at 0.5, reads −9 dBFS and centres on 1 kHz", () => {
  const sine = tone(1000, 0.5)
  const m = measure([sine, sine], RATE)
  assert.ok(Math.abs(m.peak - 0.5) < 1e-6)
  assert.ok(Math.abs(m.rms - 20 * Math.log10(0.5 / Math.SQRT2)) < 0.01)
  assert.ok(Math.abs(m.centroid - 1000) < 30, `centroid ${m.centroid}`)
  assert.equal(m.nan, false)
})

test("two equal tones centre between them, even in a sound shorter than a frame", () => {
  const low = tone(1000, 0.25),
    high = tone(3000, 0.25),
    both = low.map((v, i) => v + high[i]!)
  assert.ok(Math.abs(measure([both], RATE).centroid - 2000) < 60)
  assert.ok(Math.abs(measure([both.subarray(0, 1000)], RATE).centroid - 2000) < 150)
})

test("silence measures nothing, and a NaN is flagged without poisoning the numbers", () => {
  assert.deepEqual(measure([new Float32Array(4096)], RATE), {
    peak: 0,
    rms: SILENCE_DB,
    centroid: 0,
    nan: false,
  })
  const broken = tone(500, 0.3)
  broken[100] = Number.NaN
  const m = measure([broken], RATE)
  assert.equal(m.nan, true)
  assert.ok(Number.isFinite(m.peak) && Number.isFinite(m.rms) && Number.isFinite(m.centroid))
})
