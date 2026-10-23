import assert from "node:assert/strict"
import { test } from "node:test"

import { Keyboard } from "@typeonce/ritmo-browser"
import { Group, Vector3 } from "three"

import { tiltOf, turn } from "../sim/chassis.ts"
import { bindings, Game, KeyboardInput, lintTarget, makeRuntime, setup, STEP, update } from "../sim/index.ts"
import { parkedCar } from "../sim/spawning.ts"
import { battistiTraffic, door, ON_BATTISTI, press, stage, World } from "../sim/testing.ts"
import { VEHICLE_MODELS, VEHICLES } from "../sim/vehicles.ts"
import { PersonNode, vehicleNode, wheelLayout } from "./actors.ts"
import { actorMaterial, solidMaterial } from "./geometry.ts"
import { yOf } from "./ground.ts"
import { Effects, makeEffects, makeRegistries, People, placeVehicle, render, RenderClock, Sky, Vehicles } from "./index.ts"
import { vehicleLampMaterials } from "./sky/glow.ts"
import { SkyHost } from "./sky/host.ts"
import type { LitCar } from "./sky/night-lights.ts"

// Regression: detached vehicle nodes kept their x-ray geometry, so despawned traffic leaked GPU buffers.
test("registries: a detached node frees its own geometry, not its vehicle's shared body", () => {
  const { people, vehicles } = makeRegistries(new Group())
  const car = vehicles.ensure(1, () => vehicleNode("panda", 0xb8312b, solidMaterial))
  const person = people.ensure(2, () => new PersonNode({ skin: 0xe7b896, hair: 0x2b1d14, shirt: 0xf0c93c, pants: 0x1d2b4f }, solidMaterial))
  const freed = new Set<string>()
  const watch = (name: string, geometry: { addEventListener: (type: "dispose", listener: () => void) => void }) =>
    geometry.addEventListener("dispose", () => freed.add(name))
  watch("car x-ray", car.xray.geometry)
  watch("car body", car.body.geometry)
  watch("person x-ray", person.xray.geometry)
  person.frames.forEach((frame, i) => watch(`frame ${i}`, frame))
  assert.ok(vehicles.remove(1) && people.remove(2))
  assert.deepEqual([...freed].sort(), ["car x-ray", "frame 0", "frame 1", "frame 2", "person x-ray"])
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
    // Sync and place people and vehicles, mark the driven car, draw the tyre marks and smoke, feed the sky.
    if (name === "render") assert.equal(systems.length, 7)
    assert.ok(systems.length > 0, `${name} has systems`)
    for (const s of systems) {
      const writes = [...s.queries.flatMap((q) => q.writes), ...s.resources.writes, ...s.events.writes, ...Object.values(s.commands).flat()]
      assert.deepEqual(writes, [], `${s.name} writes the world`)
    }
  }
})

// Regression: people and cars were drawn with the terrain's material, so above the snow line they turned to white stipple.
test("the render schedule draws people and vehicles with the actor material: cloud shadows, no snow or wet on them", () => {
  const scene = new Group(), { people, vehicles } = makeRegistries(scene)
  const made = makeRuntime({
    seed: 42,
    services: Game.Runtime.services(
      Game.Runtime.service(KeyboardInput, Keyboard.scripted(bindings, [])), Game.Runtime.service(People, people), Game.Runtime.service(Vehicles, vehicles),
      Game.Runtime.service(RenderClock, { alpha: 0 }), Game.Runtime.service(Effects, makeEffects(scene)),
      Game.Runtime.service(Sky, new SkyHost(scene, { reduced: () => false }))
    )
  })
  assert.ok(made.ok)
  assert.ok(made.value.tick(setup).ok && made.value.tick(render).ok)
  const walkers = [...people.entries()].map(([, node]) => node), cars = [...vehicles.entries()].map(([, node]) => node)
  assert.ok(walkers.length > 0 && cars.length > 0, "the spawn has people and cars")
  for (const node of [...walkers, ...cars]) assert.equal(node.body.material, actorMaterial)
})

test("lamps: the player's car and traffic shine and get the sky's headlight beams, parked cars stay dark", () => {
  const scene = new Group(), { people, vehicles } = makeRegistries(scene), sky = new SkyHost(scene, { reduced: () => false })
  const beams: Array<LitCar> = [], car = sky.car.bind(sky)
  sky.car = (lit) => {
    beams.push(lit)
    car(lit)
  }
  const made = makeRuntime({
    seed: 42,
    services: Game.Runtime.services(
      Game.Runtime.service(KeyboardInput, Keyboard.scripted(bindings, press(0, "action"))), Game.Runtime.service(People, people),
      Game.Runtime.service(Vehicles, vehicles), Game.Runtime.service(RenderClock, { alpha: 0 }), Game.Runtime.service(Effects, makeEffects(scene)),
      Game.Runtime.service(Sky, sky)
    )
  })
  assert.ok(made.ok)
  const runtime = made.value, { x, y, angle } = ON_BATTISTI, along = (m: number) => ({ x: x + Math.cos(angle) * m, y: y + Math.sin(angle) * m, angle })
  const paint = { driven: 0xb8312b, parked: 0x3d6155, traffic: 0x1d2b4f }
  const cast = { cars: [parkedCar("panda", paint.driven, ON_BATTISTI), parkedCar("panda", paint.parked, along(-12))], traffic: [battistiTraffic(paint.traffic, along(25))] }
  assert.ok(runtime.tick(setup).ok && runtime.tick(stage(door(ON_BATTISTI), cast)).ok)
  assert.ok(runtime.tick(update).ok, "the player gets into the car at the door")
  assert.ok(runtime.tick(render).ok)
  const id = (color: number) => runtime.inspect(World).vehicles.find((v) => v.color === color)!.id
  const driven = id(paint.driven), parked = id(paint.parked), traffic = id(paint.traffic)
  assert.equal(vehicles.get(driven)?.lamps.material, vehicleLampMaterials.on, "the player's car")
  assert.equal(vehicles.get(traffic)?.lamps.material, vehicleLampMaterials.on, "traffic")
  assert.equal(vehicles.get(parked)?.lamps.material, vehicleLampMaterials.off, "a parked car")
  assert.deepEqual(beams.map((lit) => [lit.id, lit.driven]).sort(), [[driven, true], [traffic, false]].sort(), "only the lit cars reach the sky, the player's marked")
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
  near(node.xray.position.y, -cg, "and so does its x-ray proxy")
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
