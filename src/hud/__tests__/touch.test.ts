import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

import { Keyboard, Touch } from "@typeonce/ritmo-browser"

import { bindings } from "../../sim/index.ts"
import { BUTTONS, unturn, withTouch } from "../touch.ts"

type Snapshot = Keyboard.Snapshot<typeof bindings>
const held = (snapshot: Snapshot) => Object.entries(snapshot).flatMap(([key, state]) => (state.held ? [key] : [])).sort()

test("the stick holds the arrow keys it leans to, eight ways, and the buttons press their own keys, the arrows' too", () => {
  const keyboard = Keyboard.scripted(bindings, [{ frame: 2, press: ["up"] }])
  const touch = Touch.scripted(BUTTONS, [
    { frame: 0, stick: { x: -0.6, y: -0.6 } },
    { frame: 1, stick: { x: 0.3, y: -0.9 } }, // 18° off straight up: up alone
    { frame: 2, stick: null, press: ["action"], release: ["action"] }, // a tap shorter than a frame
    { frame: 3, press: ["handbrake"] },
    { frame: 4, press: ["left", "down"] }, // driving: ◀ and Brake
    { frame: 5, stick: { x: -1, y: 0 }, release: ["left"] } // a thumb on the stick still holds ◀'s key
  ])
  const controls = withTouch(keyboard, touch)

  const leaning = controls.snapshot()
  assert.deepEqual(held(leaning), ["left", "up"])
  assert.equal(leaning.up.pressed && leaning.left.pressed, true)
  const ahead = controls.snapshot()
  assert.deepEqual(held(ahead), ["up"])
  assert.equal(ahead.up.pressed, false, "leaning up all along is one press")
  assert.equal(ahead.left.released, true)
  const lifted = controls.snapshot()
  assert.deepEqual(held(lifted), ["up"], "W holds up as the thumb lifts")
  assert.equal(lifted.up.released, false)
  assert.deepEqual([lifted.action.pressed, lifted.action.held], [true, false])
  const braking = controls.snapshot()
  assert.deepEqual(held(braking), ["handbrake", "up"])
  assert.equal(braking.action.pressed, false)
  const steering = controls.snapshot()
  assert.deepEqual(held(steering), ["down", "handbrake", "left", "up"])
  assert.equal(steering.left.pressed && steering.down.pressed, true)
  const both = controls.snapshot()
  assert.deepEqual(held(both), ["down", "handbrake", "left", "up"])
  assert.equal(both.left.released, false)
})

test("a control the mode hides under a thumb that stays down lets go of its keys", () => {
  const keyboard = Keyboard.scripted(bindings, [])
  const touch = Touch.scripted(BUTTONS, [
    { frame: 0, stick: { x: 0, y: -1 }, press: ["action"] }, // leaning toward a car, Steal tapped and held
    { frame: 3, stick: null, release: ["action"], press: ["left"] }, // driving: ◀ held, Exit tapped
    { frame: 4, press: ["action"] }
  ])
  let mode: "foot" | "driving" = "foot"
  const driving = new Set<string>(["left", "right", "up", "down", "handbrake", "horn"]), onFoot = new Set<string>(["stick", "sprint"])
  const controls = withTouch(keyboard, touch, (control) => !(mode === "driving" ? onFoot : driving).has(control))

  assert.deepEqual(held(controls.snapshot()), ["action", "up"])
  mode = "driving" // the stick hides under the thumb: no throttle from it
  const gotIn = controls.snapshot()
  assert.deepEqual(held(gotIn), ["action"])
  assert.equal(gotIn.up.released, true)
  assert.deepEqual(held(controls.snapshot()), ["action"])
  assert.deepEqual(held(controls.snapshot()), ["left"])
  mode = "foot" // ◀ hides under the thumb: the player does not walk off
  const gotOut = controls.snapshot()
  assert.deepEqual(held(gotOut), ["action"])
  assert.equal(gotOut.left.released, true)
  assert.equal(controls.snapshot().left.released, false, "released once")
})

// Only mobile mode looks the controls up, so a desktop start-up never notices a missing one.
test("index.html draws the stick and every button the touch screen presses", () => {
  const html = readFileSync(new URL("../../../index.html", import.meta.url), "utf8")
  for (const id of ["hud-touch", "hud-stick", ...BUTTONS.map((key) => `hud-touch-${key}`)]) assert.match(html, new RegExp(`id="${id}"`))
  assert.match(html, /id="hud-stick"><div class="knob">/)
})

test("a touch on a page turned upright lands where it is drawn, whatever the turn's origin", () => {
  // hud.css on a phone held upright, 390 px wide: translateX(100vw) rotate(90deg) about the top left.
  const W = 390, upright = { a: 0, b: 1, c: -1, d: 0, e: W, f: 0 }
  for (const [u, v] of [[0, 0], [150, 290], [800, 12]] as const) assert.deepEqual(unturn(upright, { x: 0, y: 0 }, W - v, u), { x: u, y: v })
  // The same quarter turn about the centre of an 844 × 390 page.
  const origin = { x: 422, y: 195 }, at = { x: 150, y: 290 }
  const screen = { x: origin.x - (at.y - origin.y), y: origin.y + (at.x - origin.x) }
  assert.deepEqual(unturn({ a: 0, b: 1, c: -1, d: 0, e: 0, f: 0 }, origin, screen.x, screen.y), at)
})
