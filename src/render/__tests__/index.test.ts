import assert from "node:assert/strict"
import { test } from "node:test"

import { Keyboard } from "@typeonce/ritmo-browser"
import { Color, Group, Matrix4, Vector3 } from "three"

import { tiltOf, turn } from "../../sim/chassis.ts"
import { UNDAMAGED } from "../../sim/damage.ts"
import {
  bindings,
  CarInput,
  Chassis,
  Damage,
  Game,
  KeyboardInput,
  lintTarget,
  makeRuntime,
  Motion,
  Pose,
  type PoseValue,
  PrevPose,
  setup,
  STEP,
  update,
  Vehicle,
} from "../../sim/index.ts"
import { lanePoint, laneOf, laneSide } from "../../sim/route.ts"
import { parkedCar, rollingChassis } from "../../sim/spawning.ts"
import {
  BATTISTI,
  battistiTraffic,
  burning,
  door,
  ON_BATTISTI,
  press,
  stage,
  World,
} from "../../sim/testing.ts"
import { VEHICLE_MODELS, VEHICLES } from "../../sim/vehicles.ts"
import { PersonNode, vehicleBody, vehicleNode, wheelLayout } from "../actors.ts"
import { FIREBALL, FLASH } from "../blasts.ts"
import { actorMaterial, linear, solidMaterial } from "../geometry.ts"
import { yOf } from "../ground.ts"
import {
  Effects,
  makeEffects,
  makeRegistries,
  People,
  placeVehicle,
  render,
  RenderClock,
  Sky,
  Vehicles,
} from "../index.ts"
import { PALETTE } from "../palette.ts"
import { vehicleLampMaterials } from "../sky/glow.ts"
import { SkyHost } from "../sky/host.ts"
import type { LitCar } from "../sky/night-lights.ts"
import { PLUMES_AT_ONCE } from "../wrecks.ts"

// Regression: detached vehicle nodes kept their x-ray geometry, so despawned traffic leaked GPU buffers.
test("registries: a detached node frees its own geometry, not its vehicle's shared body", () => {
  const { people, vehicles } = makeRegistries(new Group())
  const car = vehicles.ensure(1, () => vehicleNode("panda", 0xb8312b, solidMaterial))
  const person = people.ensure(
    2,
    () =>
      new PersonNode(
        { skin: 0xe7b896, hair: 0x2b1d14, shirt: 0xf0c93c, pants: 0x1d2b4f },
        solidMaterial,
      ),
  )
  const freed = new Set<string>()
  const watch = (
    name: string,
    geometry: { addEventListener: (type: "dispose", listener: () => void) => void },
  ) => geometry.addEventListener("dispose", () => freed.add(name))
  watch("car x-ray", car.xray.geometry)
  watch("car body", car.body.geometry)
  // Blown up, it is left a charred shell: shared like the intact body.
  car.body.geometry = vehicleBody("panda", 0xb8312b, true)
  watch("car shell", car.body.geometry)
  watch("person x-ray", person.xray.geometry)
  person.frames.forEach((frame, i) => watch(`frame ${i}`, frame))
  assert.ok(vehicles.remove(1) && people.remove(2))
  assert.deepEqual([...freed].sort(), [
    "car x-ray",
    "frame 0",
    "frame 1",
    "frame 2",
    "person x-ray",
  ])
  assert.equal(car.parent, null)
})

test("a charred shell is its model's body darkened toward charcoal, shaped the same, one per model and paint", () => {
  for (const model of VEHICLE_MODELS) {
    const intact = vehicleBody(model, 0xb8312b),
      shell = vehicleBody(model, 0xb8312b, true)
    assert.equal(vehicleBody(model, 0xb8312b, true), shell, `${model}: shared`)
    assert.notEqual(vehicleBody(model, 0x3d6155, true), shell, `${model}: one per paint`)
    assert.notEqual(shell, intact)
    assert.deepEqual(
      shell.getAttribute("position").array,
      intact.getAttribute("position").array,
      `${model}: the same shape`,
    )
    // Every part (linear RGB) a grey, its hue burnt off, a quarter as light or less, and none lighter than a sixth of white.
    const was = intact.getAttribute("color").array,
      now = shell.getAttribute("color").array,
      soot = linear(PALETTE.outline)
    const light = (c: ArrayLike<number>, i: number) =>
      0.2126 * c[i]! + 0.7152 * c[i + 1]! + 0.0722 * c[i + 2]!
    for (let i = 0; i < was.length; i += 3) {
      const spread =
        Math.max(now[i]!, now[i + 1]!, now[i + 2]!) - Math.min(now[i]!, now[i + 1]!, now[i + 2]!)
      assert.ok(
        spread <= Math.max(...soot) - Math.min(...soot) + 1e-6,
        `${model}: vertex ${i / 3} is ${now.slice(i, i + 3).join(",")}`,
      )
      assert.ok(
        light(now, i) <= Math.max(light(was, i) / 4, light(soot, 0) * 1.5) && light(now, i) < 1 / 6,
        `${model}: vertex ${i / 3} ${light(was, i)} → ${light(now, i)}`,
      )
    }
  }
})

test("the host schedules (render, audio) read the world and never write it", async () => {
  const { runtime, schedules, describe = {} } = await lintTarget()
  runtime.debug.nameSchedules({ ...schedules, ...describe })
  const described = runtime.debug.describe()
  assert.deepEqual(Object.keys(describe), ["render", "audio"])
  for (const name of Object.keys(describe)) {
    const steps = described.schedules.find((s) => s.name === name)?.steps ?? []
    const names = new Set(steps.flatMap((step) => (step.kind === "system" ? [step.system] : [])))
    const systems = described.systems.filter((s) => names.has(s.name))
    // Sync and place people and vehicles, mark the driven car, draw the tyre marks and smoke, feed the sky.
    if (name === "render") assert.equal(systems.length, 7)
    assert.ok(systems.length > 0, `${name} has systems`)
    for (const s of systems) {
      const writes = [
        ...s.queries.flatMap((q) => q.writes),
        ...s.resources.writes,
        ...s.events.writes,
        ...(Object.values(s.commands).flat() as Array<unknown>),
      ]
      assert.deepEqual(writes, [], `${s.name} writes the world`)
    }
  }
})

// Regression: people and cars were drawn with the terrain's material, so above the snow line they turned to white stipple.
test("the render schedule draws people and vehicles with the actor material: cloud shadows, no snow or wet on them", () => {
  const scene = new Group(),
    { people, vehicles } = makeRegistries(scene)
  const made = makeRuntime({
    seed: 42,
    services: Game.Runtime.services(
      Game.Runtime.service(KeyboardInput, Keyboard.scripted(bindings, [])),
      Game.Runtime.service(People, people),
      Game.Runtime.service(Vehicles, vehicles),
      Game.Runtime.service(RenderClock, { alpha: 0 }),
      Game.Runtime.service(Effects, makeEffects(scene)),
      Game.Runtime.service(Sky, new SkyHost(scene, { reduced: () => false })),
    ),
  })
  assert.ok(made.ok)
  assert.ok(made.value.tick(setup).ok && made.value.tick(render).ok)
  const walkers = [...people.entries()].map(([, node]) => node),
    cars = [...vehicles.entries()].map(([, node]) => node)
  assert.ok(walkers.length > 0 && cars.length > 0, "the spawn has people and cars")
  for (const node of [...walkers, ...cars]) assert.equal(node.body.material, actorMaterial)
})

test("lamps: the player's car and traffic shine and get the sky's headlight beams, parked cars stay dark", () => {
  const scene = new Group(),
    { people, vehicles } = makeRegistries(scene),
    sky = new SkyHost(scene, { reduced: () => false })
  const beams: Array<LitCar> = [],
    car = sky.car.bind(sky)
  sky.car = (lit) => {
    beams.push(lit)
    car(lit)
  }
  const made = makeRuntime({
    seed: 42,
    services: Game.Runtime.services(
      Game.Runtime.service(KeyboardInput, Keyboard.scripted(bindings, press(0, "action"))),
      Game.Runtime.service(People, people),
      Game.Runtime.service(Vehicles, vehicles),
      Game.Runtime.service(RenderClock, { alpha: 0 }),
      Game.Runtime.service(Effects, makeEffects(scene)),
      Game.Runtime.service(Sky, sky),
    ),
  })
  assert.ok(made.ok)
  const runtime = made.value,
    { x, y, angle } = ON_BATTISTI,
    along = (m: number) => ({ x: x + Math.cos(angle) * m, y: y + Math.sin(angle) * m, angle })
  const paint = { driven: 0xb8312b, parked: 0x3d6155, traffic: 0x1d2b4f }
  const cast = {
    cars: [
      parkedCar("panda", paint.driven, ON_BATTISTI),
      parkedCar("panda", paint.parked, along(-12)),
    ],
    traffic: [battistiTraffic(paint.traffic, along(25))],
  }
  assert.ok(runtime.tick(setup).ok && runtime.tick(stage(door(ON_BATTISTI), cast)).ok)
  assert.ok(runtime.tick(update).ok, "the player gets into the car at the door")
  assert.ok(runtime.tick(render).ok)
  const id = (color: number) => runtime.inspect(World).vehicles.find((v) => v.color === color)!.id
  const driven = id(paint.driven),
    parked = id(paint.parked),
    traffic = id(paint.traffic)
  assert.equal(vehicles.get(driven)?.lamps.material, vehicleLampMaterials.on, "the player's car")
  assert.equal(vehicles.get(traffic)?.lamps.material, vehicleLampMaterials.on, "traffic")
  assert.equal(vehicles.get(parked)?.lamps.material, vehicleLampMaterials.off, "a parked car")
  assert.deepEqual(
    beams.map((lit) => [lit.id, lit.driven] as const).sort(([a], [b]) => a - b),
    (
      [
        [driven, true],
        [traffic, false],
      ] as const
    ).toSorted(([a], [b]) => a - b),
    "only the lit cars reach the sky, the player's marked",
  )
})

test("a vehicle's node sits at its centre of mass between the last two steps, and its wheels touch down where the sim's tilted body has them", () => {
  const node = vehicleNode("carabinieri", 0x1d2b4f, solidMaterial)
  const { cg, wheels } = VEHICLES.carabinieri,
    dt = STEP.dt
  const prev = { x: 10, y: 20, angle: 0.3 },
    pose = { x: 11, y: 20.5, angle: 0.4 }
  const chassis = {
    z: 300,
    vz: 3,
    pitch: 0.2,
    pitchRate: 0.6,
    roll: -0.15,
    rollRate: -1.2,
    steer: 0,
    gear: 0,
    shiftUntil: 0,
  }
  const near = (a: number, b: number, what: string) =>
    assert.ok(Math.abs(a - b) < 1e-9, `${what}: ${a} vs ${b}`)
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
  const tilt = tiltOf(chassis.pitch, chassis.roll),
    c = Math.cos(pose.angle),
    s = Math.sin(pose.angle)
  for (const w of wheels) {
    const drawn = node.body.localToWorld(new Vector3(w.x, 0, -w.y))
    const t = turn({ f: w.x, l: w.y, u: -cg }, tilt)
    const sim = new Vector3(
      pose.x + t.f * c - t.l * s,
      yOf(chassis.z + t.u),
      -(pose.y + t.f * s + t.l * c),
    )
    assert.ok(
      drawn.distanceTo(sim) < 1e-9,
      `wheel at ${w.x}, ${w.y}: drawn ${drawn.toArray()} vs sim ${sim.toArray()}`,
    )
  }
})

// Regression: across the step a tumbling car folds its angles (heading + π, pitch π − pitch, roll + π), the drawn body swung 2.7 m off.
test("a car flipping end over end is drawn turning smoothly across the step its angles fold", () => {
  const roof = (node: ReturnType<typeof vehicleNode>) => {
    node.updateMatrixWorld(true)
    return node.body.localToWorld(new Vector3(1.6, 1.5, -0.7))
  }
  const dt = STEP.dt,
    rate = 3,
    angle = 0.3
  // The truth, unfolded: pitch crosses vertical from 1.55 to 1.55 + 3·dt.
  const truth = {
    z: 300,
    vz: 0,
    pitch: 1.55 + rate * dt,
    pitchRate: rate,
    roll: 0.1,
    rollRate: 0,
    steer: 0,
    gear: 0,
    shiftUntil: 0,
  }
  const folded = {
    ...truth,
    pitch: Math.PI - truth.pitch,
    pitchRate: -rate,
    roll: truth.roll - Math.PI,
  }
  const prev = { x: 0, y: 0, angle },
    pose = { x: 0, y: 0, angle: angle + Math.PI }
  const a = vehicleNode("panda", 0xb8312b, solidMaterial),
    b = vehicleNode("panda", 0xb8312b, solidMaterial)
  for (const alpha of [0, 0.25, 0.5, 0.75, 1]) {
    placeVehicle(a, prev, { ...prev }, truth, alpha)
    placeVehicle(b, prev, pose, folded, alpha)
    const off = roof(a).distanceTo(roof(b))
    assert.ok(off < 1e-9, `at alpha ${alpha} the roof is drawn ${off} m off`)
  }
})

test("wheels are drawn where the sim has them, on the ground line: three on the Ape, the truck's rear axle as a tandem", () => {
  assert.equal(wheelLayout("ape").length, 3)
  assert.deepEqual(
    wheelLayout("panda"),
    VEHICLES.panda.wheels.map((w) => ({ x: w.x, z: -w.y })),
  )
  const axles = [...new Set(wheelLayout("truck").map((w) => w.x.toFixed(2)))]
  assert.deepEqual(
    axles,
    ["2.80", "-1.20", "-2.50"],
    "the sim's one rear axle at −1.85 drawn as two, 1.3 m apart",
  )
  for (const model of VEHICLE_MODELS) {
    const body = vehicleNode(model, 0xb8312b, solidMaterial).body.geometry
    body.computeBoundingBox()
    assert.ok(Math.abs(body.boundingBox!.min.y) < 1e-6, `${model}: the tyres touch y = 0`)
  }
})

/** `along` m down Via Cesare Battisti, in a Panda's lane. */
const on = (along: number): PoseValue => ({
  ...lanePoint(laneOf(BATTISTI.edge, BATTISTI.forward), along, laneSide(BATTISTI, "panda")),
  angle: ON_BATTISTI.angle,
})
/** A Panda at `pose` that blew up: a charred shell. */
const shell = (pose: PoseValue) =>
  Game.Command.spawn(
    [Vehicle, { model: "panda", color: 0x8b8170 }],
    [Pose, pose],
    [PrevPose, pose],
    [Motion, { vx: 0, vy: 0, spin: 0 }],
    [CarInput, { throttle: 0, steer: 0, handbrake: true }],
    [Chassis, rollingChassis("panda", pose, 0)],
    [Damage, { ...UNDAMAGED, amount: 1, exploded: true }],
  )
/** The game drawn into a scene of its own, the player on foot 55 m down the road and the `cars` on it; `frame` steps and draws. */
const drawn = (cars: ReadonlyArray<ReturnType<typeof burning>>) => {
  const scene = new Group(),
    { people, vehicles } = makeRegistries(scene),
    effects = makeEffects(scene)
  const made = makeRuntime({
    seed: 1,
    services: Game.Runtime.services(
      Game.Runtime.service(KeyboardInput, Keyboard.scripted(bindings, [])),
      Game.Runtime.service(People, people),
      Game.Runtime.service(Vehicles, vehicles),
      Game.Runtime.service(RenderClock, { alpha: 0 }),
      Game.Runtime.service(Effects, effects),
      Game.Runtime.service(Sky, new SkyHost(scene, { reduced: () => false })),
    ),
  })
  assert.ok(made.ok)
  const runtime = made.value
  assert.ok(runtime.tick(setup).ok)
  assert.ok(runtime.tick(stage(door(on(55)), { cars })).ok)
  assert.ok(runtime.tick(render).ok)
  return { vehicles, effects, frame: () => assert.ok(runtime.tick(update, render).ok) }
}
/** The colours of the engine smoke in the air. */
const smokeColors = ({ smoke }: ReturnType<typeof makeEffects>["wrecks"]) =>
  Array.from({ length: smoke.mesh.count }, (_, i) =>
    new Color().fromArray(smoke.mesh.instanceColor!.array, i * 3).getHex(),
  )

test("a burning wreck that blows up: a blast where it stood, then a charred shell giving off a thin smoke and no flames", () => {
  // The wreck 25 m down the road from the player, its fuse burning down 0.5 s from now.
  const { vehicles, effects, frame } = drawn([burning("panda", on(30), 30)])
  const node = [...vehicles.entries()][0]![1],
    { wrecks, blasts } = effects
  let frames = 0
  while (blasts.fireball.mesh.count === 0 && frames++ < 60) {
    assert.equal(node.body.geometry, vehicleBody("panda", 0x8b8170), "intact until it blows")
    assert.ok(node.lamps.visible, "its lamps with it")
    frame()
  }
  assert.ok(
    frames > 10 && wrecks.flames.mesh.count > 0,
    `blew after ${frames} frames, burning till then`,
  )
  assert.deepEqual(
    [blasts.flash.mesh.count, blasts.fireball.mesh.count],
    [FLASH.count, FIREBALL.count],
  )
  const flash = new Matrix4()
  blasts.flash.mesh.getMatrixAt(0, flash)
  const off = new Vector3().setFromMatrixPosition(flash).distanceTo(node.position)
  assert.ok(off < 0.1, `the flash ${off} m off the wreck's centre`)
  assert.equal(node.body.geometry, vehicleBody("panda", 0x8b8170, true), "a charred shell")
  assert.equal(node.lamps.visible, false, "its lamps burnt off")
  for (let n = 0; n < 60; n++) frame()
  assert.equal(wrecks.flames.mesh.count, 0, "its flames out within a second")
  assert.ok(
    smokeColors(wrecks).includes(PALETTE.cobbleDark),
    "a thin dark grey smoke from the shell",
  )
})

// Regression: the nearest damaged engines smoked, so charred shells nearer the player took every plume from a wreck about to blow.
test("a burning wreck smokes and burns before the charred shells nearer the player, and the nearest shells keep the rest", () => {
  // As many shells as there are plumes, 5–47 m from the player; the wreck 68 m away, its fuse far off.
  const { effects, frame } = drawn([
    ...Array.from({ length: PLUMES_AT_ONCE }, (_, i) => shell(on(50 - 6 * i))),
    burning("panda", on(-13), 100000),
  ])
  for (let n = 0; n < 60; n++) frame()
  assert.ok(effects.wrecks.flames.mesh.count > 0, "the wreck burns")
  const colors = smokeColors(effects.wrecks)
  assert.ok(
    colors.includes(PALETTE.outline) && colors.includes(PALETTE.cobbleDark),
    "black smoke over the fire, and the shells' grey wisps",
  )
})
