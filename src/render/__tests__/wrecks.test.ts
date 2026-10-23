import assert from "node:assert/strict"
import { test } from "node:test"

import { Color, Matrix4, MeshBasicMaterial, Quaternion, Vector3 } from "three"

import { VEHICLE_MODELS } from "../../sim/vehicles.ts"
import { vehicleNode } from "../actors.ts"
import { solidMaterial } from "../geometry.ts"
import { placeVehicle } from "../index.ts"
import { FLAMES, PLUMES, PLUMES_AT_ONCE, type WreckState, Wrecks } from "../wrecks.ts"

/** A fixed sequence: puffs land the same way every run. */
const steady = () => 0.5
const still = {
  z: 300,
  vz: 0,
  pitch: 0,
  pitchRate: 0,
  roll: 0,
  rollRate: 0,
  steer: 0,
  gear: 0,
  shiftUntil: 0,
}
const posed = (model: (typeof VEHICLE_MODELS)[number] = "panda", roll = 0) => {
  const node = vehicleNode(model, 0xb8312b, solidMaterial),
    pose = { x: 10, y: 20, angle: 0.7 }
  placeVehicle(node, pose, pose, { ...still, roll }, 1)
  return node
}
/** `seconds` of sim time of one vehicle in `state`, drawn at `fps`: the puffs and flames in the air at the end. */
const burn = (
  state: WreckState,
  seconds: number,
  fps = 60,
  wrecks = new Wrecks(steady),
  node = posed(),
) => {
  for (let frame = 0; frame <= seconds * fps; frame++) {
    const now = frame / fps
    wrecks.emit(node, state, wrecks.frame(now), now)
    wrecks.update(now)
  }
  return { smoke: wrecks.smoke.mesh.count, flames: wrecks.flames.mesh.count, wrecks }
}
/** The colour of puff `i` of `mesh`, in HSL. */
const hsl = (wrecks: Wrecks, i: number) =>
  new Color().fromArray(wrecks.smoke.mesh.instanceColor!.array, i * 3).getHSL({ h: 0, s: 0, l: 0 })
/** Where instance `i` of `mesh` is. */
const where = (mesh: { getMatrixAt: (i: number, m: Matrix4) => void }, i: number) => {
  const m = new Matrix4(),
    at = new Vector3()
  mesh.getMatrixAt(i, m)
  m.decompose(at, new Quaternion(), new Vector3())
  return at
}

test("engine smoke by stage: none while lightly damaged, thin white at medium, thick black when severe, black over flames once destroyed", () => {
  const light = burn("light", 2),
    medium = burn("medium", 2),
    severe = burn("severe", 2),
    destroyed = burn("destroyed", 2)
  assert.deepEqual([light.smoke, light.flames], [0, 0])
  assert.equal(medium.flames + severe.flames, 0, "only a destroyed engine burns")
  assert.ok(
    severe.smoke > medium.smoke && destroyed.smoke >= severe.smoke,
    `${medium.smoke} < ${severe.smoke} ≤ ${destroyed.smoke} puffs`,
  )
  assert.ok(destroyed.flames > 10, `${destroyed.flames} flames`)
  const white = hsl(medium.wrecks, 0),
    dark = hsl(severe.wrecks, 0),
    black = hsl(destroyed.wrecks, 0)
  assert.ok(white.s < 0.35 && white.l > 0.8, `white smoke: ${JSON.stringify(white)}`)
  assert.ok(
    dark.l < 0.05 && black.l < 0.05,
    `severe smoke ${JSON.stringify(dark)}, destroyed ${JSON.stringify(black)}: both black`,
  )
  assert.ok(
    destroyed.wrecks.flames.mesh.material instanceof MeshBasicMaterial,
    "flames are unlit: they glow in shadow",
  )
})

test("a shell that blew up gives off a thin dark grey smoke, smaller and sparser than the fire's, and no flames", () => {
  const burnt = burn("burnt", 2),
    destroyed = burn("destroyed", 2)
  assert.equal(burnt.flames, 0, "the flames are out")
  assert.ok(
    Math.abs(burnt.smoke - PLUMES.burnt.rate * 2) <= 1 && burnt.smoke < destroyed.smoke / 2,
    `${burnt.smoke} puffs, ${destroyed.smoke} on fire`,
  )
  const grey = hsl(burnt.wrecks, 0),
    black = hsl(destroyed.wrecks, 0)
  assert.ok(grey.l > black.l && grey.l < 0.1 && grey.s < 0.15, `dark grey: ${JSON.stringify(grey)}`)
  // A puff's radius is its matrix's scale (decompose reads a newborn puff's zero scale as 1).
  const largest = (wrecks: Wrecks) =>
    Math.max(
      ...Array.from({ length: wrecks.smoke.mesh.count }, (_, i) => {
        const m = new Matrix4()
        wrecks.smoke.mesh.getMatrixAt(i, m)
        return new Vector3().setFromMatrixColumn(m, 0).length()
      }),
    )
  assert.ok(
    largest(burnt.wrecks) < largest(destroyed.wrecks) / 1.5,
    `puffs up to ${largest(burnt.wrecks)} m, ${largest(destroyed.wrecks)} m on fire`,
  )
})

test("engine smoke: as many puffs a second whatever the frame rate, and none while sim time stands still", () => {
  const at30 = burn("severe", 1, 30).smoke,
    at144 = burn("severe", 1, 144).smoke
  assert.ok(
    Math.abs(at30 - PLUMES.severe.rate) <= 1 && Math.abs(at144 - PLUMES.severe.rate) <= 1,
    `${at30} at 30 fps, ${at144} at 144 fps`,
  )
  const flames = burn("destroyed", 0.2, 60).flames
  assert.ok(Math.abs(flames - FLAMES.rate * 0.2) <= 1, `${flames} flames in 0.2 s`)
  const paused = new Wrecks(steady),
    node = posed()
  for (let frame = 0; frame < 120; frame++) paused.emit(node, "destroyed", paused.frame(5), 5)
  assert.deepEqual([paused.smoke.mesh.count, paused.flames.mesh.count], [0, 0])
})

test("engine smoke: two wrecks both smoke, and the pools are bounded", () => {
  const wrecks = new Wrecks(steady, 20, 8),
    a = posed(),
    b = posed("truck")
  for (let frame = 0; frame <= 60; frame++) {
    const now = frame / 60,
      dt = wrecks.frame(now)
    wrecks.emit(a, "medium", dt, now)
    wrecks.emit(b, "medium", dt, now)
    wrecks.update(now)
  }
  assert.ok(
    Math.abs(wrecks.smoke.mesh.count - 2 * PLUMES.medium.rate) <= 2,
    `${wrecks.smoke.mesh.count} puffs from two cars`,
  )
  const full = burn("destroyed", 3, 60, new Wrecks(steady, 20, 8))
  assert.deepEqual([full.smoke, full.flames], [20, 8])
})

test("smoke and flames leave each model's engine, wherever its body lies: on its side or roof, from over the body", () => {
  for (const model of VEHICLE_MODELS)
    for (const roll of [0, Math.PI / 2, Math.PI]) {
      const node = posed(model, roll),
        wrecks = new Wrecks(steady)
      node.updateWorldMatrix(true, false)
      const engine = node.engine.clone().applyMatrix4(node.matrixWorld)
      if (roll !== 0) engine.y = Math.max(engine.y, node.position.y + 0.6)
      wrecks.emit(node, "destroyed", 0.1, 1)
      wrecks.update(1)
      const flame = where(wrecks.flames.mesh, 0),
        puff = where(wrecks.smoke.mesh, 0)
      assert.ok(
        flame.distanceTo(engine) < 0.3,
        `${model}, roll ${roll}: flame ${flame.distanceTo(engine)} m off`,
      ) // the steady draw lands mid-spread
      assert.ok(
        puff.distanceTo(engine.clone().add(new Vector3(0, PLUMES.destroyed.lift, 0))) < 0.3,
        `${model}, roll ${roll}: smoke`,
      )
    }
})

test("a moving wreck trails its smoke and its flames burn on its engine, even when it stops dead; empty pools upload nothing", () => {
  const wrecks = new Wrecks(steady),
    node = posed(),
    pose = { x: 10, y: 20, angle: 0.7 }
  wrecks.emit(node, "destroyed", 0.1, 1)
  // A slow frame (0.25 s) later the car is 2 m on, eastward: that frame's puffs spread back along the way it came.
  placeVehicle(node, pose, { ...pose, x: 12 }, still, 1)
  wrecks.emit(node, "destroyed", 0.25, 1.25)
  wrecks.update(1.25)
  const xs = Array.from(
    { length: wrecks.smoke.mesh.count },
    (_, i) => where(wrecks.smoke.mesh, i).x,
  )
  assert.ok(
    Math.max(...xs) - Math.min(...xs) > 1.8,
    `puffs from x ${Math.min(...xs)} to ${Math.max(...xs)}`,
  )
  // Driving east at 15 m/s for 1 s, then stopped dead: every flame stays on the engine, none flies on past it.
  const moving = new Wrecks(steady),
    car = posed(),
    engine = () => car.engine.clone().applyMatrix4(car.matrixWorld)
  for (let frame = 0; frame <= 108; frame++) {
    const now = frame / 60,
      x = 10 + 15 * Math.min(now, 1)
    placeVehicle(car, { ...pose, x }, { ...pose, x }, still, 1)
    moving.emit(car, "destroyed", moving.frame(now), now)
    moving.update(now)
    const at = engine()
    for (let i = 0; i < moving.flames.mesh.count; i++) {
      const flame = where(moving.flames.mesh, i)
      assert.ok(
        Math.hypot(flame.x - at.x, flame.z - at.z) < FLAMES.spread * Math.SQRT2 + 0.01,
        `frame ${frame}: a flame ${Math.hypot(flame.x - at.x, flame.z - at.z)} m off the engine`,
      )
    }
  }

  const idle = new Wrecks(steady)
  idle.update(1)
  idle.update(2)
  assert.deepEqual(
    [idle.smoke.mesh.instanceMatrix.version, idle.flames.mesh.instanceMatrix.version],
    [0, 0],
  )
})

test("the pools hold every plume and fire in full: eight wrecks burning drop no puff and no flame", () => {
  const wrecks = new Wrecks(steady),
    nodes = Array.from({ length: PLUMES_AT_ONCE }, () => posed())
  let owed = 0,
    flamesOwed = 0
  for (let frame = 0; frame <= 600; frame++) {
    const now = frame / 60,
      dt = wrecks.frame(now)
    owed += PLUMES.destroyed.rate * dt * nodes.length
    flamesOwed += FLAMES.rate * dt * nodes.length
    for (const node of nodes) wrecks.emit(node, "destroyed", dt, now)
    wrecks.update(now)
  }
  // Steady draws: each puff lives 3 s and each flame 0.525 s, so the last of those owed are all still in the air.
  assert.ok(
    Math.abs(wrecks.smoke.mesh.count - PLUMES.destroyed.rate * 3 * nodes.length) <= nodes.length,
    `${wrecks.smoke.mesh.count} puffs`,
  )
  assert.ok(
    Math.abs(wrecks.flames.mesh.count - FLAMES.rate * 0.525 * nodes.length) <= nodes.length,
    `${wrecks.flames.mesh.count} flames`,
  )
  assert.ok(owed > 0 && flamesOwed > 0)
})

// Regression: lying at 66° (its up axis 0.41 high, past the sim's 0.5 for overturned) a car still smoked from under its body.
test("a body the sim counts as overturned smokes from over it", () => {
  const node = posed("panda", 1.15),
    wrecks = new Wrecks(steady)
  node.updateWorldMatrix(true, false)
  wrecks.emit(node, "destroyed", 0.1, 1)
  wrecks.update(1)
  // The newest flame, born this moment, has not risen yet.
  const newest = where(wrecks.flames.mesh, wrecks.flames.mesh.count - 1)
  assert.ok(
    Math.abs(
      newest.y -
        Math.max(node.engine.clone().applyMatrix4(node.matrixWorld).y, node.position.y + 0.6),
    ) < 1e-3,
  ) // float32 instance matrices
})

test("a flame rises, shrinks and reddens as it burns out", () => {
  const wrecks = new Wrecks(steady)
  wrecks.emit(posed(), "destroyed", 1 / FLAMES.rate, 0)
  const look = (t: number) => {
    wrecks.update(t)
    const m = new Matrix4(),
      at = new Vector3(),
      size = new Vector3()
    wrecks.flames.mesh.getMatrixAt(0, m)
    m.decompose(at, new Quaternion(), size)
    return {
      y: at.y,
      size: size.x,
      color: new Color()
        .fromArray(wrecks.flames.mesh.instanceColor!.array, 0)
        .getHSL({ h: 0, s: 0, l: 0 }),
    }
  }
  const young = look(0.05),
    old = look(0.4)
  assert.ok(
    old.y > young.y && old.size < young.size,
    `${JSON.stringify(young)} → ${JSON.stringify(old)}`,
  )
  assert.ok(old.color.h < young.color.h, "yellow toward red")
  wrecks.update(1)
  assert.equal(wrecks.flames.mesh.count, 0, "gone within its life")
})
