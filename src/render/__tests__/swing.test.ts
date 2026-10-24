import assert from "node:assert/strict"
import { test } from "node:test"

import { Vector3 } from "three"

import { followYaw, QUARTER } from "../../sim/view.ts"
import { viewAxes } from "../pipeline.ts"
import { followToward, settleOn, type Swing, swingView, turnToward } from "../swing.ts"

const FRAME = 1 / 60

test("a quarter turn swings over about a third of a second and stops exactly on its heading, either way", () => {
  for (const [from, to] of [
    [0, QUARTER],
    [QUARTER, 0],
    [-QUARTER, -2 * QUARTER],
  ] as const) {
    let yaw = from,
      frames = 0
    while (yaw !== to && frames < 60) {
      const next = turnToward(yaw, to, FRAME)
      assert.ok(Math.abs(to - next) < Math.abs(to - yaw), "always closer")
      yaw = next
      frames++
    }
    assert.ok(frames >= 15 && frames <= 25, `${from} -> ${to} in ${frames} frames`)
  }
  assert.equal(turnToward(QUARTER, QUARTER, FRAME), QUARTER, "at rest it stays put")
})

test("the driving view's screen-up points along the car's heading", () => {
  for (const heading of [0, 1, -2.5, Math.PI, 7]) {
    const { up } = viewAxes(followYaw(heading))
    // three (x, z) = sim (x, −y)
    const ground = new Vector3(up.x, 0, up.z).normalize()
    assert.ok(
      Math.abs(ground.x - Math.cos(heading)) < 1e-9 &&
        Math.abs(-ground.z - Math.sin(heading)) < 1e-9,
      `heading ${heading}`,
    )
  }
})

test("following from rest eases in and out: it starts slowly, never overshoots, and stops on the target", () => {
  for (const target of [QUARTER, -Math.PI]) {
    let spin = { yaw: 0, rate: 0 },
      frames = 0
    const rates: Array<number> = []
    while ((spin.yaw !== target || spin.rate !== 0) && frames < 600) {
      spin = followToward(spin, target, FRAME)
      assert.ok(Math.abs(spin.yaw) <= Math.abs(target), `no overshoot at frame ${frames}`)
      rates.push(Math.abs(spin.rate))
      frames++
    }
    const fastest = Math.max(...rates),
      peak = rates.indexOf(fastest)
    assert.ok(rates[0]! < fastest / 5, `starts at ${rates[0]} rad/s, peaks at ${fastest}`)
    assert.ok(
      rates.slice(0, peak).every((r, i) => i === 0 || r >= rates[i - 1]!) &&
        rates.slice(peak).every((r, i, after) => i === 0 || r <= after[i - 1]!),
      "speeds up, then slows down",
    )
    assert.ok(frames >= 90 && frames <= 180, `${target} rad in ${frames} frames`)
  }
})

test("following holds still for a heading just off its rest, and eases off once it is farther", () => {
  const rest = { yaw: 1, rate: 0 }
  assert.deepEqual(followToward(rest, 1.015, FRAME), rest)
  const moving = followToward(rest, 1.03, FRAME)
  assert.ok(moving.yaw > 1 && moving.yaw < 1.001 && moving.rate > 0, JSON.stringify(moving))
  const turning = { yaw: 1, rate: 0.01 }
  assert.ok(followToward(turning, 1.015, FRAME).yaw > 1, "moving, it keeps following")
})

test("following lands the same at any frame rate, and a long frame does not overshoot", () => {
  const after = (fps: number, seconds: number) => {
    let spin = { yaw: 0, rate: 0 }
    for (let i = 0; i < fps * seconds; i++) spin = followToward(spin, 1, 1 / fps)
    return spin
  }
  for (const fps of [30, 144])
    assert.ok(Math.abs(after(fps, 0.5).yaw - after(60, 0.5).yaw) < 1e-9, `${fps} fps`)
  const long = followToward({ yaw: 0, rate: 0 }, 1, 1)
  assert.ok(long.yaw > 0.8 && long.yaw <= 1, `a 1 s frame: ${long.yaw}`)
})

test("settling on a seat eases off, closes at least 0.1 rad/s at the end and lands exactly on it", () => {
  for (const off of [0.8, -0.3, 0.004]) {
    let spin = { yaw: off, rate: 0 },
      frames = 0
    const steps: Array<number> = []
    while ((spin.yaw !== 0 || spin.rate !== 0) && frames < 600) {
      const next = settleOn(spin, 0, FRAME)
      steps.push(Math.abs(spin.yaw) - Math.abs(next.yaw))
      assert.ok(Math.sign(next.yaw) !== -Math.sign(off), "no overshoot")
      spin = next
      frames++
    }
    assert.ok(frames < 110, `${off} rad landed in ${frames} frames`)
    assert.ok(
      steps.slice(Math.min(10, steps.length - 1)).every((s) => s >= 0.1 * FRAME - 1e-12),
      "never creeps",
    )
    assert.ok(steps[0]! < Math.max(...steps), "eases off")
  }
  // Getting out of a car still turning away from the seat, it carries on a little, then comes back.
  let spin = { yaw: 0.2, rate: 1 },
    furthest = 0
  for (let i = 0; i < 120; i++) {
    spin = settleOn(spin, 0, FRAME)
    furthest = Math.max(furthest, spin.yaw)
  }
  assert.ok(furthest > 0.2 && spin.yaw === 0, `out to ${furthest}, then on the seat`)
})

/** Runs `swingView` for `frames` frames at 60 fps, heading and seat given per frame. */
const swingFor = (
  from: Swing,
  frames: number,
  turns: (frame: number) => number,
  heading: (frame: number) => number | undefined,
) => {
  let swing = from
  const path: Array<Swing> = []
  for (let i = 0; i < frames; i++) {
    swing = swingView(swing, turns(i), heading(i), FRAME, false)
    path.push(swing)
  }
  return path
}

test("driving, the view follows the car the short way round; got out, it settles on the sim's seat, and the turn keys swing it as before", () => {
  const home: Swing = { yaw: 0, rate: 0, by: "keys", seat: 0 }
  // A car facing just short of the home seat's screen-up turned half round, wound a whole turn on.
  const heading = 3 * Math.PI - Math.PI / 4 - 0.2
  const driving = swingFor(
    home,
    240,
    () => 0,
    () => heading,
  )
  const followed = driving.at(-1)!
  assert.ok(driving.every((s) => s.yaw >= 0) && followed.rate === 0, "the short way, to rest")
  assert.ok(Math.abs(followed.yaw - (Math.PI - 0.2)) < 1e-9, `${followed.yaw}`)
  // Got out at the seat two quarters round, counted a whole turn on: the view settles on it the short way.
  const out = swingFor(
    followed,
    240,
    () => 6,
    () => undefined,
  )
  assert.ok(
    out.every((s) => Math.abs(s.yaw - 6 * QUARTER) <= Math.PI + 1e-9),
    "never the long way",
  )
  assert.equal(out.at(-1)!.yaw, 6 * QUARTER, "on the seat")
  // A turn key once settled is the quarter swing again.
  const keyed = swingView(out.at(-1)!, 7, undefined, FRAME, false)
  assert.equal(keyed.yaw, turnToward(6 * QUARTER, 7 * QUARTER, FRAME))
  // Getting out from a moving view eases out of its turn: the yaw never jumps.
  const turning = swingFor(
    home,
    30,
    () => 0,
    (i) => -Math.PI / 4 + 0.03 * i,
  ).at(-1)!
  const leaving = swingFor(
    turning,
    20,
    () => 0,
    () => undefined,
  )
  assert.ok(
    leaving.every((s, i) => Math.abs(s.yaw - (i === 0 ? turning : leaving[i - 1]!).yaw) < 0.05),
    "no jump on getting out",
  )
  assert.equal(swingView(followed, 6, undefined, FRAME, true).yaw, 6 * QUARTER, "instant")
})

test("with reduced motion the view jumps onto the car once, then follows it on the spring, which moves it less than the car turns", () => {
  const home: Swing = { yaw: 0, rate: 0, by: "keys", seat: 0 }
  const landed = swingView(home, 0, 1, FRAME, true)
  assert.deepEqual(landed, { yaw: followYaw(1), rate: 0, by: "car", seat: 0 }, "at once")
  assert.deepEqual(swingView(landed, 0, 1.01, FRAME, true), landed, "a wobble does not move it")
  // A slalom, ±0.3 rad at 1 Hz: the view turns through less than the car does.
  let swing = landed,
    car = 0,
    view = 0
  for (let i = 1; i <= 240; i++) {
    const heading = 1 + 0.3 * Math.sin(2 * Math.PI * i * FRAME),
      last = 1 + 0.3 * Math.sin(2 * Math.PI * (i - 1) * FRAME)
    const next = swingView(swing, 0, heading, FRAME, true)
    car += Math.abs(heading - last)
    view += Math.abs(next.yaw - swing.yaw)
    swing = next
  }
  assert.ok(view < car / 2, `the view turned ${view} rad, the car ${car}`)
})
