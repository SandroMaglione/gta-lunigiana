import assert from "node:assert/strict"
import { test } from "node:test"

import { measure } from "../../measure.ts"
import type { ShotIo } from "../../types.ts"
import { type AnimalCall, animalQuiet, MEOW_QUIET, moo, renderAnimal, squeal } from "../animals.ts"

const RATE = 48000
/** A small deterministic random source. */
const seeded = (seed: number) => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32

/** The pitch (Hz) of `x` around `at` s by autocorrelation over 40 ms, searched between `lo` and `hi` Hz: the shortest lag within 10 % of the best (no octave errors). */
const pitchAt = (x: Float32Array, at: number, lo: number, hi: number): number => {
  const start = Math.round(at * RATE),
    n = Math.round(0.04 * RATE),
    from = Math.floor(RATE / hi),
    to = Math.ceil(RATE / lo)
  const r = Array.from({ length: to - from + 1 }, (_, j) => {
    let sum = 0,
      a = 0,
      b = 0
    for (let i = start; i < start + n; i++) {
      sum += x[i]! * x[i + from + j]!
      a += x[i]! ** 2
      b += x[i + from + j]! ** 2
    }
    return sum / Math.sqrt(a * b || 1)
  })
  const best = Math.max(...r)
  const j = r.findIndex((v, k) => v >= 0.9 * best && v >= (r[k - 1] ?? -1) && v >= (r[k + 1] ?? -1))
  return RATE / (from + j)
}

/** The loudest 10 ms window's start, s. */
const loudest = (x: Float32Array): number => {
  const n = Math.round(0.01 * RATE)
  let best = 0,
    at = 0
  for (let i = 0; i + n < x.length; i += n) {
    let e = 0
    for (let j = i; j < i + n; j++) e += x[j]! ** 2
    if (e > best) [best, at] = [e, i]
  }
  return at / RATE
}

/** `sound` rendered on seeds 1…`seeds`. */
const renders = (sound: AnimalCall, seeds = 6) =>
  Array.from({ length: seeds }, (_, i) => renderAnimal(sound, RATE, seeded(i + 1)))

test("every call peaks at its nominal 0.5 (a plain meow MEOW_QUIET under its yowl), finite, starting and ending silent", () => {
  const calls: ReadonlyArray<AnimalCall> = [
    { kind: "moo", size: 1 },
    { kind: "grunt", size: 1.1 },
    { kind: "squeal", size: 0.9 },
    { kind: "yelp", size: 1 },
    { kind: "meow", size: 1, yowl: false },
    { kind: "meow", size: 1, yowl: true },
    { kind: "hiss", size: 1 },
  ]
  for (const sound of calls) {
    for (const x of renders(sound, 3)) {
      const { peak, nan } = measure([x], RATE),
        nominal = 0.5 * 10 ** (-animalQuiet(sound) / 20)
      assert.ok(!nan && Math.abs(peak - nominal) < 1e-3, `${sound.kind}: ${peak}`)
      assert.ok(
        Math.abs(x[0]!) < 1e-3 && Math.abs(x.at(-1)!) < 1e-3,
        `${sound.kind} starts and ends silent`,
      )
    }
  }
  assert.equal(animalQuiet({ kind: "meow", size: 1, yowl: false }), MEOW_QUIET)
})

test("a cow moos 1–2 s at 100–160 Hz, lower for a bigger cow", () => {
  for (const x of renders({ kind: "moo", size: 1 })) {
    assert.ok(x.length / RATE >= 1 && x.length / RATE <= 2, `${x.length / RATE}`)
    const f0 = pitchAt(x, x.length / RATE / 2, 60, 300)
    assert.ok(f0 > 100 && f0 < 160, `${f0}`)
  }
  const pitch = (size: number) =>
    pitchAt(renderAnimal({ kind: "moo", size }, RATE, seeded(3)), 0.5, 60, 300)
  assert.ok(pitch(1.15) < pitch(0.85))
})

test("a cat's meow glides at 500–800 Hz; a pig's grunt is low and short, its squeal high and long", () => {
  for (const x of renders({ kind: "meow", size: 1, yowl: false })) {
    assert.ok(x.length / RATE >= 0.5 && x.length / RATE <= 1)
    const f0 = pitchAt(x, (x.length / RATE) * 0.45, 300, 1200)
    assert.ok(f0 > 500 && f0 < 860, `${f0}`)
  }
  for (const x of renders({ kind: "grunt", size: 1 })) {
    const f0 = pitchAt(x, loudest(x), 40, 300)
    assert.ok(f0 < 140, `grunt ${f0}`)
    assert.ok(x.length / RATE < 1.3, `${x.length / RATE}`)
  }
  for (const x of renders({ kind: "squeal", size: 1 })) {
    assert.ok(x.length / RATE >= 1 && x.length / RATE <= 1.5)
    assert.ok(measure([x], RATE).centroid > 1500, `${measure([x], RATE).centroid}`)
  }
})

test("a hiss is breath between 2 and 8 kHz; a dog yelps two to four times, high", () => {
  for (const x of renders({ kind: "hiss", size: 1 })) {
    const { centroid } = measure([x], RATE)
    assert.ok(centroid > 3000 && centroid < 8000, `${centroid}`)
    assert.ok(x.length / RATE >= 0.5 && x.length / RATE <= 1)
  }
  for (const x of renders({ kind: "yelp", size: 1 })) {
    assert.ok(x.length / RATE > 0.3 && x.length / RATE < 1.3, `${x.length / RATE}`)
    assert.ok(measure([x], RATE).centroid > 1000)
  }
})

test("a call renders deterministically per seed", () => {
  const sound: AnimalCall = { kind: "moo", size: 1 }
  assert.deepEqual(renderAnimal(sound, RATE, seeded(5)), renderAnimal(sound, RATE, seeded(5)))
})

test("a call's echoes replay its render: the same params object renders once", () => {
  // Was: each echo off a rock face rendered a new random call (another moo, three times the work).
  let renders = 0
  const ctx = {
    sampleRate: RATE,
    createBuffer: (_: number, length: number, sampleRate: number) => (
      renders++,
      { duration: length / sampleRate, copyToChannel: () => {} }
    ),
  }
  const node = {
    connect: (next: unknown) => next,
    disconnect: () => {},
    start: () => {},
    onended: null,
  }
  // The synth calls `new` on these, so a function (neither an arrow nor a method is a constructor) handing back the stub.
  function stub() {
    return node
  }
  Object.assign(globalThis, { AudioBufferSourceNode: stub, GainNode: stub })
  const io = { ctx, out: node } as unknown as ShotIo
  for (const [shot, sound] of [
    [moo, { kind: "moo", size: 1 }],
    [squeal, { kind: "squeal", size: 1 }],
  ] as const) {
    renders = 0
    const lengths = [0, 0.4, 0.9].map((when) => shot.play(io, sound as never, when) - when)
    assert.equal(renders, 1)
    assert.ok(
      lengths.every((l) => Math.abs(l - lengths[0]!) < 1e-9),
      `${lengths}`,
    )
    shot.play(io, { ...sound } as never, 0)
    assert.equal(renders, 2, "a new call renders anew")
  }
})
