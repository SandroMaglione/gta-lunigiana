import assert from "node:assert/strict"
import { test } from "node:test"

import { SPEED_OF_SOUND } from "../../acoustics.ts"
import { measure } from "../../measure.ts"
import { fft } from "../crash/dsp.ts"
import { bandEnergy } from "../crash/testing.ts"
import {
  IN_CLOUD,
  LONGEST,
  renderThunder,
  THUNDER_RATE,
  thunderQuiet,
  thunderRender,
} from "../thunder.ts"

const RATE = THUNDER_RATE
/** Twelve draws of each thunder: every bound below holds on seeds 1–96 too, twelve (or 24) at a time. */
const SEEDS = Array.from({ length: 12 }, (_, i) => i + 1)

const median = (values: ReadonlyArray<number>): number =>
  [...values].sort((a, b) => a - b)[values.length >> 1]!

/** Ear height over level ground, m. */
const EARS = 1.6

/** Every seed's render of a thunder `distance` m away, a `bolt` or an in-cloud flash, heard from `ears` m over the ground under it. */
const renders = (distance: number, bolt = true, rate = RATE, seeds = SEEDS, ears = EARS) =>
  seeds.map((seed) => renderThunder({ kind: "thunder", distance, ears, bolt, seed }, rate))

/** The share of `x`'s energy between `lo` and `hi` Hz, over its first `seconds` (all of it when undefined). */
const share = (x: Float32Array, lo: number, hi: number, seconds = x.length / RATE): number =>
  bandEnergy(x, RATE, 0, seconds, lo, hi) / bandEnergy(x, RATE, 0, seconds, 1, RATE / 2)

/** IEC 61672 A-weighting, as a power gain. */
const aWeight = (hz: number): number => {
  const f2 = hz * hz,
    ra =
      (12194 ** 2 * f2 * f2) /
      ((f2 + 20.6 ** 2) * Math.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194 ** 2))
  return (ra * 10 ** (2 / 20)) ** 2
}

/** The loudest 128 ms of `x` (half-overlapping Hann frames), A-weighted, dB: a sound level meter's fast maximum. */
const loudestA = (x: Float32Array): number => {
  const n = 2048,
    re = new Float64Array(n),
    im = new Float64Array(n)
  let loudest = 0
  for (let start = 0; start + n <= x.length; start += n / 2) {
    for (let i = 0; i < n; i++)
      [re[i], im[i]] = [x[start + i]! * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n)), 0]
    fft(re, im)
    let power = 0
    for (let k = 1; k < n / 2; k++) power += (re[k]! ** 2 + im[k]! ** 2) * aWeight((k * RATE) / n)
    loudest = Math.max(loudest, power)
  }
  return 10 * Math.log10(loudest)
}

test("a thunder render is finite, held to the nominal 0.5, at most LONGEST s and faded out, the same for the same flash", () => {
  for (const [distance, bolt, rate] of [
    [0, true, RATE],
    [50, true, RATE],
    [300, true, RATE],
    [2000, true, RATE],
    [8000, true, RATE],
    [15000, true, RATE],
    [0, false, RATE],
    [5000, false, RATE],
    [300, true, 8000],
    [8000, false, 8000],
  ] as const) {
    for (const { samples, lead } of renders(distance, bolt, rate)) {
      const m = measure([samples], rate)
      assert.ok(
        !m.nan && m.peak <= 0.5 + 1e-6 && m.peak > 0.2,
        `${distance} m ${bolt}: peak ${m.peak}`,
      )
      assert.ok(
        samples.length <= LONGEST * rate && samples.length > 2 * rate,
        `${distance} m: ${samples.length / rate} s`,
      )
      assert.ok(Math.abs(samples.at(-1)!) < 1e-3, `${distance} m: ends at ${samples.at(-1)}`)
      assert.ok(lead >= 0 && lead < LONGEST, `lead ${lead}`)
    }
  }
  const flash = { kind: "thunder", distance: 1000, ears: EARS, bolt: true, seed: 3 } as const
  assert.deepEqual(renderThunder(flash, RATE), renderThunder({ ...flash }, RATE))
  assert.notDeepEqual(renderThunder(flash, RATE), renderThunder({ ...flash, seed: 4 }, RATE))
})

/** How loud the first 50 ms are against the loudest moment, dB (10 ms RMS): a crack starts at its loudest, a rumble far under it. */
const onset = (x: Float32Array): number => {
  const win = Math.round(RATE / 100),
    hop = Math.round(RATE / 1000),
    env: Array<number> = []
  for (let i = 0; i + win <= x.length; i += hop) {
    let s = 0
    for (let j = i; j < i + win; j++) s += x[j]! * x[j]!
    env.push(Math.sqrt(s / win))
  }
  return 20 * Math.log10(Math.max(...env.slice(0, 50)) / Math.max(...env))
}

test("a near bolt cracks and booms, a far one only rumbles: brighter, sharper, lower", () => {
  const near = renders(300),
    far = renders(8000)
  const centroid = (list: typeof near) =>
    median(list.map(({ samples }) => measure([samples], RATE).centroid))
  // Medians (96 draws): 840 Hz at 300 m, 120 Hz at 8 km.
  assert.ok(centroid(near) > 4 * centroid(far), `centroids ${centroid(near)} ${centroid(far)}`)
  // The crack: its first 50 ms are its loudest (median 0 dB), with energy above 2 kHz in its first 100 ms (median 1.4 %). The rumble
  // starts 30 dB under its loudest (median) and keeps nothing up there.
  assert.ok(median(near.map(({ samples }) => onset(samples))) > -3)
  assert.ok(median(far.map(({ samples }) => onset(samples))) < -15)
  assert.ok(median(near.map(({ samples }) => share(samples, 2000, 8000, 0.1))) > 0.005)
  assert.ok(median(far.map(({ samples }) => share(samples, 2000, 8000, 0.1))) < 0.001)
  // Almost all of a far rumble is under 200 Hz (99 %), not two thirds of a near crack (59 %).
  assert.ok(median(far.map(({ samples }) => share(samples, 1, 200))) > 0.95)
  assert.ok(median(near.map(({ samples }) => share(samples, 1, 200))) < 0.75)
  // A near bolt rolls on for seconds: its channel climbs kilometres and branches in the cloud (median 9.8 s).
  assert.ok(median(near.map(({ samples }) => samples.length / RATE)) > 6)
})

test("an in-cloud flash has no foot to crack: it starts under its loudest and dark, even overhead", () => {
  const bolt = renders(300),
    cloud = renders(300, false)
  // Medians (96 draws): 9 dB under, 190 Hz against the bolt's 0 dB, 840 Hz.
  assert.ok(median(cloud.map(({ samples }) => onset(samples))) < -3)
  assert.ok(
    median(cloud.map(({ samples }) => measure([samples], RATE).centroid)) <
      0.5 * median(bolt.map(({ samples }) => measure([samples], RATE).centroid)),
  )
})

test("a phone's speaker hears thunder within 2 km: a third or more of its energy lies at 100–400 Hz", () => {
  // Medians: 72 % at 300 m, 53 % at 1 km, 40 % at 2 km (8 % at 8 km, where the air has taken it).
  for (const distance of [300, 1000, 2000]) {
    assert.ok(
      median(renders(distance).map(({ samples }) => share(samples, 100, 400))) > 0.33,
      `${distance} m`,
    )
  }
})

test("thunderQuiet follows the renders: how much quieter (A-weighted) a thunder plays from farther, within 2 dB past 2 km", () => {
  // Medians of 24 draws, against 2 km (a near crack's loudness varies ±5 dB from draw to draw, a far rumble's ±2 dB).
  const seeds = Array.from({ length: 24 }, (_, i) => i + 1)
  const level = (distance: number, bolt = true) =>
    median(renders(distance, bolt, RATE, seeds).map(({ samples }) => loudestA(samples)))
  const at = level(2000)
  for (const [distance, bolt] of [
    [3000, true],
    [8000, true],
    [12000, true],
    [2000, false],
    [8000, false],
  ] as const) {
    const range = bolt ? distance : Math.hypot(distance, IN_CLOUD),
      measured = at - level(distance, bolt),
      law = thunderQuiet(range) - thunderQuiet(2000)
    assert.ok(Math.abs(measured - law) < 2, `${distance} m ${bolt}: ${measured} dB against ${law}`)
  }
  assert.equal(thunderQuiet(20), 0)
})

test("the strike point's own sound comes `lead` s into the render: at once near, after the nearer cloud branches far", () => {
  // Mostly the foot comes first; a channel leaning towards the ears may come first by tens of metres (0.2 s at most on seeds 1–48).
  const near = renders(300).map(({ lead }) => lead)
  assert.ok(median(near) < 0.01 && Math.max(...near) < 0.3, `leads ${near}`)
  // An in-cloud flash's first sound comes off a branch reaching towards the ears, before its start's: never more than its spread allows.
  for (const { lead } of renders(5000, false))
    assert.ok(lead >= 0 && lead <= 4000 / SPEED_OF_SOUND, `lead ${lead}`)
})

test("from a ridge 435 m over a valley bolt 500 m off, the trunk at the ears' height is heard first, before the foot", () => {
  // Regression: the render heard every bolt from its foot's level, so a ridge heard the foot first, half a second late.
  const slant = Math.hypot(500, 435) / SPEED_OF_SOUND,
    ridge = renders(500, true, RATE / 2, SEEDS, 435).map(({ lead }) => slant - lead)
  const level = renders(500, true, RATE / 2).map(({ lead }) => lead)
  // Medians: 1.57 s against the foot's 1.95 (0.83–1.79 s over these draws).
  assert.ok(median(ridge) < slant - 0.3, `first sounds ${ridge} s against ${slant} s`)
  assert.ok(median(level) < 0.01, `leads ${level}`)
})

test("a flash's render is made once per params object, at 16 kHz for a bolt within 1 km and 8 kHz past it or in the cloud, from where its reference sound comes", () => {
  const near = { kind: "thunder", distance: 600, ears: EARS, bolt: true, seed: 5 } as const,
    far = { kind: "thunder", distance: 4000, ears: EARS, bolt: false, seed: 5 } as const
  assert.equal(thunderRender(near), thunderRender(near))
  // An in-cloud flash overhead is 2.4 km off at its nearest: the air leaves nothing a 16 kHz render would add.
  const overhead = { kind: "thunder", distance: 0, ears: EARS, bolt: false, seed: 5 } as const
  assert.deepEqual(
    [thunderRender(near).rate, thunderRender(overhead).rate, thunderRender(far).rate],
    [THUNDER_RATE, THUNDER_RATE / 2, THUNDER_RATE / 2],
  )
  assert.ok(
    Math.abs(thunderRender(far).seconds - thunderRender(far).samples.length / (THUNDER_RATE / 2)) <
      1e-9,
  )
  // A bolt is heard from its strike point; an in-cloud flash from its start, 3–5 km up.
  assert.equal(thunderRender(near).height, 0)
  assert.ok(
    thunderRender(far).height >= 3000 && thunderRender(far).height <= 5000,
    `${thunderRender(far).height} m`,
  )
})

test("a flash at no finite distance thunders as one overhead rather than rendering nothing (which would mute thunder for the session)", () => {
  for (const distance of [Infinity, -Infinity, Number.NaN]) {
    const { samples, lead } = renderThunder(
      { kind: "thunder", distance, ears: distance, bolt: true, seed: 2 },
      RATE / 2,
    )
    assert.ok(
      samples.length > 0 && Number.isFinite(lead),
      `${distance}: ${samples.length} samples, lead ${lead}`,
    )
  }
})
