import assert from "node:assert/strict"
import { test } from "node:test"

import { Group, Mesh, Vector3, type Object3D } from "three"

import { tiltOf, turn } from "../sim/chassis.ts"
import { lintTarget, STEP } from "../sim/index.ts"
import { LOOK } from "../sim/testing.ts"
import { VEHICLE_MODELS, VEHICLES } from "../sim/vehicles.ts"
import { vehicleNode, wheelLayout } from "./actors.ts"
import { AnimalNode } from "./animals.ts"
import { solidMaterial } from "./geometry.ts"
import { yOf } from "./ground.ts"
import { makeRegistries, placeVehicle } from "./index.ts"
import { PersonNode } from "./people.ts"

/** The x-ray proxy an actor shows now, if any: its one visible child drawn after the world (`renderOrder` 1). */
const shownProxy = (node: Object3D): Mesh | undefined =>
  node.children.find((c): c is Mesh => c instanceof Mesh && c.visible && c.renderOrder === 1)

// Regression: detached vehicle nodes kept their x-ray geometry, so despawned traffic leaked GPU buffers.
test("registries: a detached node frees its own geometry (frames, pool, proxy), not its vehicle's shared body", () => {
  const { people, animals, vehicles } = makeRegistries(new Group())
  const car = vehicles.ensure(1, () => vehicleNode("panda", 0xb8312b, solidMaterial))
  const person = people.ensure(2, () => new PersonNode(LOOK, solidMaterial, 2))
  const cat = animals.ensure(3, () => new AnimalNode({ species: "cat", coat: 0x8a857c, patch: 0x4e4a45, size: 1 }, solidMaterial, 3))
  const freed = new Set<string>()
  const watch = (name: string, geometry: { addEventListener: (type: "dispose", listener: () => void) => void }) =>
    geometry.addEventListener("dispose", () => freed.add(name))
  car.showXray(true)
  watch("car x-ray", shownProxy(car)!.geometry)
  watch("car body", car.body.geometry)
  // The person shows its walking, running and lying proxies in turn.
  person.showXray(true)
  for (const [gait, speed, down] of [["walk", 1.4, false], ["run", 4, false], ["lying", 0, true]] as const) {
    person.speed = speed
    person.lie(down, false)
    person.pose()
    watch(`person ${gait} x-ray`, shownProxy(person)!.geometry)
  }
  for (const [who, node] of [["person", person], ["cat", cat]] as const) {
    watch(`${who} pool`, node.pool.geometry)
    for (const [name, frame] of Object.entries(node.frames)) watch(`${who} ${name}`, frame)
  }
  assert.ok(vehicles.remove(1) && people.remove(2) && animals.remove(3))
  assert.deepEqual([...freed].sort(), [
    "car x-ray", "cat pool", "cat stand", "cat step1", "cat step2",
    "person lying x-ray", "person pool", "person run x-ray", "person run1", "person run2", "person shock", "person stand", "person talk",
    "person walk x-ray", "person walk1", "person walk2"
  ])
  assert.equal(car.parent, null)
})

test("the host schedules (render, audio) read the world and never write it", async () => {
  const { runtime, schedules, describe = {} } = await lintTarget()
  runtime.debug.nameSchedules({ ...schedules, ...describe })
  const described = runtime.debug.describe()
  assert.deepEqual(Object.keys(describe), ["render", "audio"])
  for (const name of Object.keys(describe)) {
    const steps = described.schedules.find((s) => s.name === name)?.steps ?? []
    const names = steps.flatMap((step) => (step.kind === "system" ? [step.system] : []))
    const systems = described.systems.filter((s) => names.includes(s.name))
    // Sync and place people, animals and vehicles, mark the driven car, spread the blood pools, draw the tyre marks and smoke.
    if (name === "render") assert.equal(systems.length, 9)
    assert.ok(systems.length > 0, `${name} has systems`)
    for (const s of systems) {
      const writes = [...s.queries.flatMap((q) => q.writes), ...s.resources.writes, ...s.events.writes, ...Object.values(s.commands).flat()]
      assert.deepEqual(writes, [], `${s.name} writes the world`)
    }
  }
})

test("a vehicle's node sits at its centre of mass between the last two steps, and its wheels touch down where the sim's tilted body has them", () => {
  const node = vehicleNode("carabinieri", 0x1d2b4f, solidMaterial)
  const { cg, wheels } = VEHICLES.carabinieri, dt = STEP.dt
  const prev = { x: 10, y: 20, angle: 0.3 }, pose = { x: 11, y: 20.5, angle: 0.4 }
  const chassis = { z: 300, vz: 3, pitch: 0.2, pitchRate: 0.6, roll: -0.15, rollRate: -1.2, steer: 0, gear: 0, shiftUntil: 0 }
  const near = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) < 1e-9, `${what}: ${a} vs ${b}`)
  placeVehicle(node, prev, pose, chassis, 0)
  near(node.position.x, 10, "x at the previous step")
  near(node.position.y, yOf(300 - 3 * dt), "height stepped back along vz")
  near(node.position.z, -20, "three z = −north")
  near(node.rotation.z, 0.2 - 0.6 * dt, "pitch stepped back")
  near(node.rotation.x, -0.15 + 1.2 * dt, "roll stepped back")
  near(node.rotation.y, 0.3, "heading at the previous step")
  placeVehicle(node, prev, pose, chassis, 1)
  near(node.position.y, yOf(300), "height at the current step")
  near(node.body.position.y, -cg, "the body hangs its ground line cg under the node")
  node.showXray(true)
  near(shownProxy(node)!.position.y, -cg, "and so does its x-ray proxy")
  node.updateMatrixWorld(true)
  const tilt = tiltOf(chassis.pitch, chassis.roll), c = Math.cos(pose.angle), s = Math.sin(pose.angle)
  for (const w of wheels) {
    const drawn = node.body.localToWorld(new Vector3(w.x, 0, -w.y))
    const t = turn({ f: w.x, l: w.y, u: -cg }, tilt)
    const sim = new Vector3(pose.x + t.f * c - t.l * s, yOf(chassis.z + t.u), -(pose.y + t.f * s + t.l * c))
    assert.ok(drawn.distanceTo(sim) < 1e-9, `wheel at ${w.x}, ${w.y}: drawn ${drawn.toArray()} vs sim ${sim.toArray()}`)
  }
})

// Regression: across the step a tumbling car folds its angles (heading + π, pitch π − pitch, roll + π), the drawn body swung 2.7 m off.
test("a car flipping end over end is drawn turning smoothly across the step its angles fold", () => {
  const roof = (node: ReturnType<typeof vehicleNode>) => {
    node.updateMatrixWorld(true)
    return node.body.localToWorld(new Vector3(1.6, 1.5, -0.7))
  }
  const dt = STEP.dt, rate = 3, angle = 0.3
  // The truth, unfolded: pitch crosses vertical from 1.55 to 1.55 + 3·dt.
  const truth = { z: 300, vz: 0, pitch: 1.55 + rate * dt, pitchRate: rate, roll: 0.1, rollRate: 0, steer: 0, gear: 0, shiftUntil: 0 }
  const folded = { ...truth, pitch: Math.PI - truth.pitch, pitchRate: -rate, roll: truth.roll - Math.PI }
  const prev = { x: 0, y: 0, angle }, pose = { x: 0, y: 0, angle: angle + Math.PI }
  const a = vehicleNode("panda", 0xb8312b, solidMaterial), b = vehicleNode("panda", 0xb8312b, solidMaterial)
  for (const alpha of [0, 0.25, 0.5, 0.75, 1]) {
    placeVehicle(a, prev, { ...prev }, truth, alpha)
    placeVehicle(b, prev, pose, folded, alpha)
    const off = roof(a).distanceTo(roof(b))
    assert.ok(off < 1e-9, `at alpha ${alpha} the roof is drawn ${off} m off`)
  }
})

test("wheels are drawn where the sim has them, on the ground line: three on the Ape, the truck's rear axle as a tandem", () => {
  assert.equal(wheelLayout("ape").length, 3)
  assert.deepEqual(wheelLayout("panda"), VEHICLES.panda.wheels.map((w) => ({ x: w.x, z: -w.y })))
  const axles = [...new Set(wheelLayout("truck").map((w) => w.x.toFixed(2)))]
  assert.deepEqual(axles, ["2.80", "-1.20", "-2.50"], "the sim's one rear axle at −1.85 drawn as two, 1.3 m apart")
  for (const model of VEHICLE_MODELS) {
    const body = vehicleNode(model, 0xb8312b, solidMaterial).body.geometry
    body.computeBoundingBox()
    assert.ok(Math.abs(body.boundingBox!.min.y) < 1e-6, `${model}: the tyres touch y = 0`)
  }
})
