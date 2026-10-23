import assert from "node:assert/strict"
import { test } from "node:test"

import { Group, Scene, Vector3, type WebGLRenderer } from "three"

import { screenAxes } from "../../sim/view.ts"
import { PixelView, QUARTER, shadowFit, turnToward, viewAxes, zoomFor } from "../pipeline.ts"

test("at every quarter turn the camera's screen axes are the sim's on the ground, and ground axes project as exact 2:1 pixel lines", () => {
  for (const turns of [0, 1, 2, 3, -1, 6]) {
    const { right, up } = viewAxes(turns * QUARTER),
      sim = screenAxes(turns)
    // three (x, z) = sim (x, −y)
    assert.ok(
      Math.abs(right.x - sim.right.x) < 1e-9 &&
        Math.abs(-right.z - sim.right.y) < 1e-9 &&
        Math.abs(right.y) < 1e-9,
      `right at ${turns}`,
    )
    const ground = new Vector3(up.x, 0, up.z).normalize()
    assert.ok(
      Math.abs(ground.x - sim.up.x) < 1e-9 && Math.abs(-ground.z - sim.up.y) < 1e-9,
      `up at ${turns}`,
    )
    for (const axis of [new Vector3(1, 0, 0), new Vector3(0, 0, 1)]) {
      assert.ok(Math.abs(Math.abs(axis.dot(up) / axis.dot(right)) - 0.5) < 1e-9, `2:1 at ${turns}`)
    }
  }
})

test("a quarter turn swings over about a third of a second and stops exactly on its heading, either way", () => {
  for (const [from, to] of [
    [0, QUARTER],
    [QUARTER, 0],
    [-QUARTER, -2 * QUARTER],
  ] as const) {
    let yaw = from,
      frames = 0
    while (yaw !== to && frames < 60) {
      const next = turnToward(yaw, to, 1 / 60)
      assert.ok(Math.abs(to - next) < Math.abs(to - yaw), "always closer")
      yaw = next
      frames++
    }
    assert.ok(frames >= 15 && frames <= 25, `${from} -> ${to} in ${frames} frames`)
  }
  assert.equal(turnToward(QUARTER, QUARTER, 1 / 60), QUARTER, "at rest it stays put")
})

test("the driving zoom widens above 16 m/s and narrows again only below 13 m/s", () => {
  assert.equal(zoomFor(undefined, 5), 8)
  assert.equal(zoomFor(15, 8), 6, "just got in at town speed")
  assert.equal(zoomFor(17, 6), 5)
  assert.equal(zoomFor(-14, 5), 5, "slowing through the band keeps the wide view")
  assert.equal(zoomFor(12, 5), 6)
  assert.equal(zoomFor(15, 6), 6)
})

// Regression: sized for flat ground, the shadow box left most of a mountain view unshadowed.
test("the shadow box covers the view's ground rectangle on the flat and the far ground a falling slope shows", () => {
  const axes = viewAxes(0),
    toSun = new Vector3(-0.75, 1, 0.35).normalize(),
    focus = new Vector3(0, 0, 0)
  const flat = shadowFit(focus, axes, 100, 60, toSun, () => 0)
  assert.ok(Math.abs(flat.half - (Math.hypot(100, 60 / Math.sin(Math.PI / 6)) / 2 + 10)) < 1e-9)
  // Ground falling away from the camera at 25° along screen-up (three −z is north, screen-up points south-east).
  const fall = Math.tan((25 * Math.PI) / 180),
    dir = new Vector3(axes.up.x, 0, axes.up.z).normalize()
  const slope = shadowFit(
    focus,
    axes,
    100,
    60,
    toSun,
    (x, z) => -fall * Math.max(0, x * dir.x + z * dir.z),
  )
  assert.ok(slope.half > flat.half + 20, `half ${slope.half} vs ${flat.half}`)
  assert.ok(slope.below < -10, "the far ground lies away from the sun, deeper than the focus")
})

// Regression: only the view's corners and edge midpoints were marched, so a valley seen between them
// (east of Monte Sagro at zoom 5, 600 m deeper along the light) fell past the shadow camera's far plane.
test("the shadow box reaches ground that shows only between the view's edges", () => {
  const axes = viewAxes(0),
    toSun = new Vector3(-0.75, 1, 0.35).normalize(),
    focus = new Vector3(0, 0, 0)
  const right = new Vector3(axes.right.x, 0, axes.right.z).normalize(),
    ahead = new Vector3(axes.up.x, 0, axes.up.z).normalize()
  // A 6 m wide gully 800 m deep, a quarter of the view's width right of centre, beyond the focus.
  const gully = (x: number, z: number) =>
    Math.abs(x * right.x + z * right.z - 25) < 3 && x * ahead.x + z * ahead.z > 0 ? -800 : 0
  assert.ok(shadowFit(focus, axes, 100, 60, toSun, gully).below < -400)
})

// Regression: compiled while the canvas was bound, every program was an sRGB-output twin no frame used
// (26 programs against 16), and the ones the frames draw with compiled mid-game.
test("compile builds the programs into the target the scene renders into, then binds the canvas again", () => {
  let bound: unknown = null
  const compiled: Array<unknown> = [],
    rendered: Array<unknown> = []
  const renderer = {
    setRenderTarget: (target: unknown) => {
      bound = target
    },
    compile: () => compiled.push(bound),
    render: () => rendered.push(bound),
    setPixelRatio: () => {},
    setSize: () => {},
    getDrawingBufferSize: (size: { set(x: number, y: number): unknown }) => size.set(640, 360),
  }
  const view = new PixelView(renderer as unknown as WebGLRenderer),
    scene = new Scene()
  view.resize(640, 360, 1)
  view.compile(scene, new Group())
  assert.equal(bound, null, "the canvas bound again")
  view.render(scene)
  const [target, canvas] = rendered
  assert.ok(
    target !== null && canvas === null,
    "the scene into the target, then the blit to the canvas",
  )
  assert.deepEqual(compiled, [target, target], "the scene and the stand-ins, both into that target")
})
