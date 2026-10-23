import assert from "node:assert/strict"
import { test } from "node:test"

import { PointLight, Scene, SpotLight, Vector3 } from "three"

import { MAP } from "../../../sim/map/index.ts"
import { streetLamps } from "../lamps.ts"
import { K_POINT, K_SPOT, type LitCar, NightLights, SlotPool } from "../night-lights.ts"
import { NOON } from "../testing.ts"

const NIGHT = { ...NOON, night: 1, lamps: 1, ambient: 0.1 }
const near = (a: number, b: number, what: string) =>
  assert.ok(Math.abs(a - b) < 1e-9, `${what}: ${a} vs ${b}`)

test("slot pool: the nearest get the lights, fading in over 0.35 s; a lit one keeps its light while among the nearest, so lights do not snap", () => {
  const pool = new SlotPool(2),
    range = { add: 50, keep: 80 }
  pool.update(
    [
      { id: 7, d: 5 },
      { id: 3, d: 10 },
      { id: 9, d: 20 },
    ],
    0,
    range,
  )
  assert.deepEqual([...pool.ids], [7, 3])
  pool.update(
    [
      { id: 7, d: 5 },
      { id: 3, d: 10 },
    ],
    0.175,
    range,
  )
  near(pool.levels[0]!, 0.5, "half way in after 0.175 s")
  pool.update(
    [
      { id: 7, d: 5 },
      { id: 3, d: 10 },
    ],
    1,
    range,
  )
  assert.deepEqual([...pool.levels], [1, 1])
  // Two nearer cars arrive: 7 and 3 are still among the nearest four, so they keep their lights.
  pool.update(
    [
      { id: 1, d: 1 },
      { id: 2, d: 2 },
      { id: 7, d: 5 },
      { id: 3, d: 10 },
    ],
    0.1,
    range,
  )
  assert.deepEqual([...pool.ids], [7, 3])
  assert.deepEqual([...pool.levels], [1, 1])
  // 3 drives off past `keep`: its light fades out in place, and only then goes to the nearest free car.
  pool.update(
    [
      { id: 1, d: 1 },
      { id: 7, d: 5 },
      { id: 3, d: 90 },
    ],
    0.2,
    range,
  )
  assert.deepEqual([...pool.ids], [7, 3])
  assert.ok(pool.levels[1]! < 1 && pool.levels[1]! > 0)
  pool.update(
    [
      { id: 1, d: 1 },
      { id: 7, d: 5 },
      { id: 3, d: 90 },
    ],
    0.2,
    range,
  )
  near(pool.levels[1]!, 0, "faded out")
  pool.update(
    [
      { id: 1, d: 1 },
      { id: 7, d: 5 },
      { id: 3, d: 90 },
    ],
    0.1,
    range,
  )
  assert.deepEqual([...pool.ids], [7, 1])
  pool.update([], 0, range)
  pool.update([], 1, range)
  pool.update([], 0, range)
  assert.deepEqual([...pool.ids], [-1, -1], "nothing in range: every light free")
})

test("night lights: a fixed set made once, never added, removed or hidden, dark by day and without shadows", () => {
  const scene = new Scene(),
    lights = new NightLights(scene)
  const count = scene.children.length
  assert.equal(count, 2 * K_SPOT + K_POINT, "each spot with its target, and the points")
  assert.equal(scene.children.filter((c) => c instanceof SpotLight).length, K_SPOT)
  assert.equal(scene.children.filter((c) => c instanceof PointLight).length, K_POINT)
  const { x, y } = MAP.spawns.player,
    focus = new Vector3(x, 0, -y)
  const cars: Array<LitCar> = Array.from({ length: 30 }, (_, i) => ({
    id: i,
    x: x + 7 * i - 100,
    y: y + 3 * i,
    z: 0,
    angle: i,
    driven: i === 4,
  }))
  for (let f = 0; f < 120; f++) lights.update({ ...NOON, now: f / 60 }, focus, cars)
  for (const light of [...lights.spots, ...lights.points]) {
    assert.equal(light.intensity, 0, "dark at noon")
    assert.ok(light.visible && !light.castShadow)
  }
  for (let f = 120; f < 240; f++)
    lights.update({ ...NIGHT, now: f / 60 }, focus, cars.slice(f % 30))
  assert.equal(scene.children.length, count)
})

test("night lights: the first beam follows the player's car, the street-lamp lights stand under the lamps nearest the focus", () => {
  const scene = new Scene(),
    lights = new NightLights(scene)
  const { x, y } = MAP.spawns.player,
    focus = new Vector3(x, 0, -y)
  const car: LitCar = { id: 9, x, y, z: 120, angle: Math.PI / 2, driven: true }
  for (let f = 0; f <= 30; f++) lights.update({ ...NIGHT, now: f / 60 }, focus, [car])
  const beam = lights.spots[0]!
  assert.ok(beam.intensity > 0, "on, faded in")
  near(beam.position.x, x, "ahead of the car (it faces north)")
  assert.ok(
    -beam.position.z > y + 1 && beam.target.position.y < car.z,
    "in front of it, aimed down the road",
  )
  for (const spot of lights.spots.slice(1))
    assert.equal(spot.intensity, 0, "no traffic: the other beams stay dark")
  const lit = lights.points.filter((p) => p.intensity > 0)
  const around = streetLamps().filter((l) => Math.hypot(l.x - x, l.y - y) <= 60).length
  assert.equal(lit.length, Math.min(K_POINT, around), `${around} lamps within 60 m`)
  for (const p of lit) {
    const lamp = streetLamps().find((l) => Math.hypot(l.x - p.position.x, l.y + p.position.z) < 0.5)
    assert.ok(lamp !== undefined && p.position.y < lamp.h, "just out from a lantern and under it")
  }
})
