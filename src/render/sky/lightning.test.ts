import assert from "node:assert/strict"
import { test } from "node:test"

import { BufferAttribute, Vector3 } from "three"

import { boltSegments, Bolts, MAX_SEGMENTS, sceneFlash, strokeLevel } from "./lightning.ts"
import { NOON } from "./testing.ts"

const ground = { x: 1234.5, y: -678.25, z: 87.5 }

test("a bolt is the same for the same seed, differs between seeds, and its main channel ends exactly on the ground point", () => {
  const a = boltSegments(42, ground), b = boltSegments(42, ground), c = boltSegments(43, ground)
  assert.deepEqual(a, b)
  assert.notDeepEqual(a.points, c.points)
  const { points, trunk } = a
  assert.ok(trunk === 128, `${trunk} channel segments`)
  assert.ok(points.length / 6 <= MAX_SEGMENTS && points.length / 6 > trunk, `${points.length / 6} segments, branches included`)
  assert.deepEqual(points.slice(trunk * 6 - 3, trunk * 6), [ground.x, ground.z, -ground.y], "three space (x, render y, −y)")
  assert.ok(points[1]! - ground.z > 350, "it starts high in the cloud")
  for (let k = 1; k < trunk; k++) assert.deepEqual(points.slice(k * 6, k * 6 + 3), points.slice(k * 6 - 3, k * 6), `channel joined at ${k}`)
  for (let k = trunk; k < points.length / 6; k++) assert.ok(points[k * 6 + 4]! > ground.z, "branches end in the air")
})

test("strokes: 2 to 4, 30–120 ms apart, each seen at its peak by a 60 Hz frame whatever the frame phase", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const starts: Array<number> = []
    for (let ms = 0; ms < 500; ms++) if (strokeLevel(seed, ms / 1000) > strokeLevel(seed, (ms - 1) / 1000) + 0.05) starts.push(ms)
    assert.ok(starts.length >= 2 && starts.length <= 4, `seed ${seed}: ${starts.length} strokes`)
    for (let k = 1; k < starts.length; k++) {
      const gap = starts[k]! - starts[k - 1]!
      assert.ok(gap >= 30 && gap <= 121, `seed ${seed}: ${gap} ms between strokes`)
    }
    for (const phase of [0, 0.004, 0.009, 0.0166]) {
      const seen = Array.from({ length: 30 }, (_, f) => strokeLevel(seed, phase + f / 60))
      assert.ok(seen.some((v) => v === 1), `seed ${seed} phase ${phase}: the first stroke shows at full`)
    }
  }
  assert.equal(strokeLevel(7, -0.01), 0)
  assert.ok(strokeLevel(7, 1) < 0.001, "over within a second")
})

test("the scene flash is one smooth pulse: it rises once, then only falls, and nearer is brighter (WCAG 2.3.1)", () => {
  const samples = Array.from({ length: 120 }, (_, f) => sceneFlash(f / 60, 1, 0))
  const top = samples.indexOf(Math.max(...samples))
  for (let f = 1; f <= top; f++) assert.ok(samples[f]! >= samples[f - 1]!, `rising at frame ${f}`)
  for (let f = top + 1; f < samples.length; f++) assert.ok(samples[f]! <= samples[f - 1]!, `falling at frame ${f}`)
  assert.ok(Math.max(...samples) <= 1 && top <= 4, `peak ${Math.max(...samples)} at frame ${top}`)
  assert.equal(sceneFlash(-0.01, 1, 0), 0)
  assert.equal(sceneFlash(2, 1, 0), 0)
  assert.ok(sceneFlash(0.1, 1, 500) > sceneFlash(0.1, 1, 3000))
  assert.ok(Math.abs(sceneFlash(0.1, 1, 1500) - sceneFlash(0.1, 1, 0) / 2) < 1e-12, "half as bright at 1.5 km")
})

test("Bolts: strokes modulate the flash by ±10 % at most, at most three pulses a second, reduced motion halves it and stops the flicker", () => {
  const focus = new Vector3(0, 0, 0), at = (now: number) => ({ ...NOON, now })
  const bolts = new Bolts()
  bolts.strike({ x: 10, y: 10, bolt: true, power: 1, seed: 9 }, 0, 1, focus)
  const flashes = Array.from({ length: 60 }, (_, f) => bolts.update(at(1 + f / 60)))
  for (let f = 0; f < 60; f++) {
    const pulse = sceneFlash(f / 60, 1, Math.hypot(10, 10))
    assert.ok(flashes[f]! >= pulse * 0.9 - 1e-12 && flashes[f]! <= Math.min(1, pulse * 1.1) + 1e-12, `frame ${f}: ${flashes[f]} vs pulse ${pulse}`)
  }

  const burst = new Bolts()
  for (let k = 0; k < 10; k++) burst.strike({ x: 0, y: 0, bolt: k % 2 === 0, power: 1, seed: k }, 0, 5 + k * 0.1, focus)
  const pulses = Array.from({ length: 120 }, (_, f) => burst.update(at(5 + f / 60)))
  // A pulse: a rise of more than 0.25 from the lowest point since the light last fell.
  let rises = 0, low = pulses[0]!, armed = true
  for (let f = 1; f < pulses.length; f++) {
    const v = pulses[f]!
    if (!armed && v < pulses[f - 1]!) [armed, low] = [true, v]
    if (armed && v - (low = Math.min(low, v)) > 0.25) [rises, armed] = [rises + 1, false]
  }
  assert.equal(rises, 3, "ten strikes in a second light the scene three times")
  // Strikes exactly a third of a second apart: four onsets would fall in the closed second [0, 1].
  const edge = new Bolts()
  for (let k = 0; k < 4; k++) edge.strike({ x: 0, y: 0, bolt: false, power: 1, seed: k }, 0, k / 3, focus)
  const onsets = Array.from({ length: 70 }, (_, f) => edge.update(at(f / 60))).filter((v, f, all) => f > 0 && v > all[f - 1]! + 0.2 && all[f - 1]! < 0.3)
  assert.equal(onsets.length, 2, `${onsets.length} pulses within a second`)

  const calm = new Bolts({ reduced: true })
  calm.strike({ x: 0, y: 0, bolt: true, power: 1, seed: 9 }, 0, 0, focus)
  const halved = Array.from({ length: 60 }, (_, f) => calm.update(at(f / 60)))
  for (let f = 0; f < 60; f++) assert.ok(Math.abs(halved[f]! - sceneFlash(f / 60, 1, 0) / 2) < 1e-12, `frame ${f}`)
})

// Regression: the position attribute copied the pool's buffer, so the bolt was written where the GPU never looked (every vertex at 0).
test("Bolts: the uploaded position attribute holds the struck bolt's segments", () => {
  const bolts = new Bolts(), ground = { x: 120, y: -340, z: 42 }
  bolts.strike({ x: ground.x, y: ground.y, bolt: true, power: 1, seed: 77 }, ground.z, 0, new Vector3())
  bolts.update({ now: 0 })
  const shape = boltSegments(77, ground)
  const line = bolts.lines.find((l) => l.geometry.drawRange.count > 0)!
  const position = line.geometry.getAttribute("position")
  assert.ok(position instanceof BufferAttribute && position.version > 0, "flagged for upload")
  assert.deepEqual(Array.from(position.array.subarray(0, shape.points.length)), Array.from(Float32Array.from(shape.points)))
})

test("Bolts: a fixed pool drawing the bolt (branches on the first stroke only), nothing once the flash is over", () => {
  const bolts = new Bolts(), lines = bolts.object.children.length
  const drawn = (b = bolts) => b.lines.map((line) => line.geometry.drawRange.count)
  assert.deepEqual(drawn(), Array.from({ length: lines }, () => 0), "idle bolts draw nothing")
  const shape = boltSegments(5, { x: 0, y: 0, z: 0 })
  bolts.strike({ x: 0, y: 0, bolt: true, power: 1, seed: 5 }, 0, 0, new Vector3())
  bolts.update({ now: 0 })
  assert.equal(Math.max(...drawn()), 2 * shape.points.length / 6, "the whole bolt on the first stroke")
  bolts.update({ now: 0.18 })
  assert.ok(Math.max(...drawn()) === 0 || Math.max(...drawn()) === 2 * shape.trunk, "later strokes: the channel only")
  bolts.update({ now: 3 })
  assert.deepEqual(drawn(), Array.from({ length: lines }, () => 0))
  for (let k = 0; k < 10; k++) bolts.strike({ x: 0, y: 0, bolt: true, power: 1, seed: k }, 0, 4, new Vector3())
  assert.equal(bolts.object.children.length, lines, "the pool never grows")
  const inCloud = new Bolts()
  inCloud.strike({ x: 0, y: 0, bolt: false, power: 1, seed: 1 }, 0, 0, new Vector3())
  assert.ok(inCloud.update({ now: 0.06 }) > 0, "a flash in the cloud lights the scene")
  assert.equal(Math.max(...drawn(inCloud)), 0, "but draws no bolt")
})
