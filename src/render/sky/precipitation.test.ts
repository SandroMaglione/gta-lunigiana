import assert from "node:assert/strict"
import { test } from "node:test"

import { Vector2, Vector3 } from "three"

import { DAY, daysFromCivil, utcFromRome } from "../../sim/sky/calendar.ts"
import { NO_SNOW, orographic } from "../../sim/sky/climate.ts"
import { calmPlan, planFor } from "../../sim/sky/plan.ts"
import { viewAxes } from "../pipeline.ts"
import { advanceScroll, dropCount, dropDensity, MOST, planeVelocity, Precipitation, wrapBox } from "./precipitation.ts"
import { stream } from "./random.ts"
import { NOON } from "./testing.ts"

const { right, up } = viewAxes(0)

test("drop counts grow with the rate, none in a dry sky, capped at the buffer; snow is many more flakes than rain for the same water", () => {
  for (const kind of ["rain", "snow"] as const) {
    assert.equal(dropDensity(kind, 0), 0)
    let last = 0
    for (const rate of [0.1, 0.5, 1, 2, 5, 10, 30]) {
      const d = dropDensity(kind, rate)
      assert.ok(d > last, `${kind} at ${rate} mm/h`)
      last = d
    }
    assert.equal(dropCount(kind, 500, 112 * 64), MOST[kind], "a cloudburst fills the buffer and no more")
  }
  assert.ok(dropDensity("snow", 1) > 4 * dropDensity("rain", 1), "snow falls 8× slower: more flakes in the air than drops")
  // Heavy rain over a 1280×720 view on foot (54 × 30 screen metres): about one streak per 100 texels at 8 texels/m.
  const texelsPerStreak = (54 * 30 * 64) / (dropDensity("rain", 10) * 54 * 30)
  assert.ok(texelsPerStreak > 80 && texelsPerStreak < 130, `${texelsPerStreak.toFixed(0)} texels per streak`)
})

/** The heaviest rain or snow any day's plan sends over 30 years of days, mm/h of water at sea level (the plan holds it at a cap). */
const heaviestPlanned = (): number => {
  const first = utcFromRome(daysFromCivil(2001, 1, 1) * DAY)
  let plan = calmPlan(first), most = 0
  for (let day = 0; day < 30 * 365; day++) {
    plan = planFor(plan, first + day * DAY, 1)
    most = Math.max(most, plan.precip)
  }
  return most
}

test("rain and snow keep thickening over the widest view, 16:9 and 21:9, up to the heaviest the weather sends on high ground", () => {
  // The day plan's heaviest falls up to twice as hard on high ground (`orographic`'s cap): 30 mm/h of water, rain or snow.
  const heaviest = heaviestPlanned() * orographic(NO_SNOW)
  assert.ok(heaviest >= 20, `${heaviest} mm/h: the plan's cloudbursts reach the cap`)
  // The widest zoom (5 texels/m) at 1080 px tall: 96 × 54 m at 16:9, 128 × 54 m at 21:9.
  for (const [width, height] of [[96, 54], [128, 54]] as const) {
    const box = wrapBox(width, height, new Vector2()), area = box.x * box.y
    for (const kind of ["rain", "snow"] as const) {
      const count = dropCount(kind, heaviest, area)
      assert.ok(count < MOST[kind], `${kind} at ${heaviest} mm/h over ${width} × ${height} m: ${count} drops of the buffer's ${MOST[kind]}`)
    }
  }
})

test("the flakes are laid in one stream after the streaks: a bigger buffer only adds flakes, so lighter snow draws the same ones", () => {
  const seeds = new Precipitation().snow.geometry.getAttribute("position").array, r = stream(1)
  for (let k = 0; k < MOST.rain * 3; k++) r()
  let moved = 0
  for (let k = 0; k < seeds.length; k++) if (seeds[k] !== Math.fround(r())) moved++
  assert.equal(moved, 0, `${moved} of ${seeds.length} flake seeds off the stream`)
})

test("the fall scrolls on the camera plane, wrapped into the box in float64, the same after an hour of sim time", () => {
  const box = new Vector2(64, 48), v = new Vector2(3, -7), scroll = new Vector2()
  for (let f = 0; f < 60 * 3600; f++) advanceScroll(scroll, v, 1 / 60, box)
  // The exact fall, 3 × 3600 m and −7 × 3600 m, is a whole number of boxes plus (48, 0).
  const off = (a: number, b: number, size: number) => Math.min(Math.abs(a - b), size - Math.abs(a - b))
  assert.ok(off(scroll.x, 48, 64) < 1e-6 && off(scroll.y, 0, 48) < 1e-6, `${scroll.toArray()}`)
  assert.ok(scroll.x >= 0 && scroll.x < 64 && scroll.y >= 0 && scroll.y < 48)
})

test("the drops fall straight down the screen in still air and slant with the wind; the wrap box steps in 16 m", () => {
  const still = planeVelocity({ x: 0, y: 0 }, 8, right, up, new Vector2())
  assert.ok(Math.abs(still.x) < 1e-12 && Math.abs(still.y + 8 * Math.cos(Math.PI / 6)) < 1e-9, `${still.toArray()}`)
  // Home view: screen-right is south-west on the ground; air moving south-west pushes the rain right.
  const windy = planeVelocity({ x: -5, y: -5 }, 8, right, up, new Vector2())
  assert.ok(windy.x > 6, `${windy.toArray()}`)
  assert.deepEqual(wrapBox(54, 30, new Vector2()).toArray(), [64, 48])
  assert.deepEqual(wrapBox(85.8, 48.4, new Vector2()).toArray(), [96, 64])
})

test("Precipitation: draw ranges follow the rates, the colour the ambient light, and the drops stand still while the sim clock does", () => {
  const p = new Precipitation(), focus = new Vector3(100, 50, -200), view = { width: 86, height: 48 }
  p.update(NOON, focus, { right, up }, 8, view)
  assert.equal(p.rain.geometry.drawRange.count, 0)
  assert.equal(p.snow.geometry.drawRange.count, 0)
  assert.ok(p.object.children.every((c) => c.visible), "kept visible: compiled with the first frame, drawing nothing")
  const area = p.box.x * p.box.y
  const storm = { ...NOON, now: 10, rain: 20, snow: 0.5, ambient: 0.25, wind: { x: 6, y: 0 } }
  p.update(storm, focus, { right, up }, 8, view)
  assert.equal(p.rain.geometry.drawRange.count, 2 * dropCount("rain", 20, area), "two vertices per streak")
  assert.equal(p.snow.geometry.drawRange.count, dropCount("snow", 0.5, area))
  const cell = p.rain.material.uniforms["uColor"]!, dim = cell.value.clone()
  p.update({ ...storm, now: 10.5, ambient: 1 }, focus, { right, up }, 8, view)
  assert.equal(p.rain.material.uniforms["uColor"], cell, "one uniform cell, rewritten")
  for (const channel of ["r", "g", "b"] as const) assert.ok(Math.abs(dim[channel] / cell.value[channel] - 0.25) < 1e-9, `${channel} scales with the ambient light`)
  const scroll = () => p.rain.material.uniforms["uScroll"]!.value.map((v: Vector2) => v.clone())
  const before = scroll()
  p.update({ ...storm, now: 10.5 }, focus, { right, up }, 8, view)
  assert.deepEqual(scroll(), before, "paused: no fall")
  p.update({ ...storm, now: 10.6 }, focus, { right, up }, 8, view)
  assert.notDeepEqual(scroll(), before)
  const streak = p.rain.material.uniforms["uStreak"]!.value
  assert.ok(Number.isInteger(Math.round(streak.x * 8 * 1e6) / 1e6) && Number.isInteger(Math.round(streak.y * 8 * 1e6) / 1e6), "whole texels")
  assert.ok(streak.y < 0, "the streak trails up the screen behind the falling head")
})
