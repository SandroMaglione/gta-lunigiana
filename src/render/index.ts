/**
 * The render schedule: mirrors people, animals and vehicles into three nodes with RenderSync (a
 * vehicle that blew up as its charred shell), places them between fixed steps (PrevPose → Pose at
 * the loop's alpha), people and animals on the ground or road under them in the frame for what they
 * do, and vehicles at their centre of mass from their Chassis, spreads the blood pools under the
 * dead, marks the player's car for the x-ray silhouette, lays tyre marks and smoke from the Skid
 * events, draws the damaged engines' smoke and fire and the Explosion events' blasts, and hands the
 * sky host the clock, the weather, the lightning and the cars with their lamps on, and the
 * see-through cut the player as drawn. Read-only towards the world (__tests__/index.test.ts checks
 * every system's declared access); the host ticks it once per animation frame after writing
 * `RenderClock.alpha`.
 *
 * @module render
 */
import { Descriptor } from "@typeonce/ritmo"
import { NodeRegistry, RenderSync } from "@typeonce/ritmo-render"
import type { Object3D } from "three"

import { wrapAngle } from "../sim/body.ts"
import { stageOf } from "../sim/damage.ts"
import {
  Animal,
  Chassis,
  type ChassisValue,
  Damage,
  Dead,
  Down,
  Driving,
  Explosion,
  Game,
  GameClock,
  InWater,
  Lightning,
  Motion,
  Pedestrian,
  Person,
  Player,
  Pose,
  type PoseValue,
  PrevPose,
  Rivers,
  type RiversValue,
  Skid,
  STEP,
  Time,
  Traffic,
  Vehicle,
  Weather,
} from "../sim/index.ts"
import { VEHICLES } from "../sim/vehicles.ts"
import { VIEW_REACH } from "../sim/view.ts"
import { FLOW, specificDischarge } from "../sim/water/flow.ts"
import { waterUnder } from "../sim/water/rivers.ts"
import { type ActorNode, vehicleBody, type VehicleNode, vehicleNode } from "./actors.ts"
import { AnimalNode } from "./animals.ts"
import { Blasts } from "./blasts.ts"
import { actorMaterial } from "./geometry.ts"
import { groundY, yOf } from "./ground.ts"
import { Marks, TREAD } from "./marks.ts"
import { PersonNode } from "./people.ts"
import type { SeeThrough } from "./sightline.ts"
import type { SkyHost } from "./sky/host.ts"
import { Smoke } from "./smoke.ts"
import { PLUMES_AT_ONCE, type WreckState, Wrecks } from "./wrecks.ts"

/** Person nodes, one per entity with a Person. */
export const People =
  Descriptor.Service<NodeRegistry.NodeRegistry<PersonNode>>()("Lunigiana/PeopleNodes")
/** Animal nodes, one per entity with an Animal. */
export const Animals =
  Descriptor.Service<NodeRegistry.NodeRegistry<AnimalNode>>()("Lunigiana/AnimalNodes")
/** Vehicle nodes, one per entity with a Vehicle. */
export const Vehicles =
  Descriptor.Service<NodeRegistry.NodeRegistry<VehicleNode>>()("Lunigiana/VehicleNodes")
/** Mutable host object: the loop writes `alpha` (fraction of a step since the last one) before ticking `render`. */
export const RenderClock = Descriptor.Service<{ readonly alpha: number }>()("Lunigiana/RenderClock")

/** The three registries, attaching nodes under `parent` and freeing them on detach. */
export const makeRegistries = (parent: Object3D) => {
  const options = {
    attach: (node: ActorNode) => parent.add(node),
    detach: (node: ActorNode) => {
      node.removeFromParent()
      node.dispose()
    },
  }
  return {
    people: NodeRegistry.make<PersonNode>(options),
    animals: NodeRegistry.make<AnimalNode>(options),
    vehicles: NodeRegistry.make<VehicleNode>(options),
  }
}

/**
 * The map's tyre marks and smoke, the damaged engines' smoke and flames, and the blasts, under `parent` for the page's life: in
 * the scene from the first frame, so their programs compile before play.
 */
export const makeEffects = (parent: Object3D) => {
  const effects = {
    marks: new Marks(),
    smoke: new Smoke(),
    wrecks: new Wrecks(),
    blasts: new Blasts(),
  }
  parent.add(
    effects.marks.mesh,
    effects.smoke.mesh,
    effects.wrecks.smoke.mesh,
    effects.wrecks.flames.mesh,
    ...effects.blasts.meshes,
  )
  return effects
}
/** The host's tyre marks and smoke, the wrecks' smoke and fire and the blasts (`makeEffects`), fed by the render schedule. */
export const Effects = Descriptor.Service<ReturnType<typeof makeEffects>>()("Lunigiana/Effects")
/** The host's sky (`SkyHost`), fed by the render schedule: it draws the light, the weather and the night lights. */
export const Sky = Descriptor.Service<SkyHost>()("Lunigiana/Sky")
/** The host's see-through cut (`SeeThrough`), fed the player as drawn by the render schedule. */
export const Cut = Descriptor.Service<SeeThrough>()("Lunigiana/SeeThrough")

const SyncPeople = RenderSync.system(Game, {
  name: "Lunigiana/SyncPeople",
  renderable: Person,
  registry: People,
  select: {
    driving: Game.Query.optional(Driving),
    down: Game.Query.optional(Down),
    dead: Game.Query.optional(Dead),
    player: Game.Query.optional(Player),
    pedestrian: Game.Query.optional(Pedestrian),
    motion: Game.Query.read(Motion),
    pose: Game.Query.read(Pose),
    wet: Game.Query.optional(InWater),
  },
  resources: { time: Time, rivers: Rivers },
  // PrevPose is written every step, so apply also sees Driving and Down going away, and keeps the speed and clock current.
  redrawOn: [Driving, Down, Dead, Pedestrian, InWater, PrevPose],
  create: ({ renderable, entity }) => new PersonNode(renderable, actorMaterial, entity),
  apply: (node, { data, resources }) => {
    node.visible = !data.driving.present
    node.lie(data.down.present, data.dead.present)
    node.mood = data.pedestrian.value()?.mood ?? "walk"
    const { vx, vy } = data.motion.get()
    node.speed = Math.hypot(vx, vy)
    node.clock = resources.time.get().step * STEP.dt
    node.floating(
      ...afloat(data.pose.get(), data.wet.value(), data.down.present, resources.rivers.get()),
    )
    node.showXray(data.player.present)
  },
})

/**
 * How a person or animal at `pose` is in the water (`wet`): whether it is, the render y of the surface over it while it swims or
 * lies there (undefined while it wades, standing on the bed, or is out of it), and whether it swims.
 */
const afloat = (
  pose: PoseValue,
  wet: { readonly swimming: boolean } | undefined,
  lying: boolean,
  rivers: RiversValue,
): [boolean, number | undefined, boolean] => {
  if (wet === undefined || !(wet.swimming || lying)) return [wet !== undefined, undefined, false]
  const water = waterUnder(pose.x, pose.y, true, specificDischarge(rivers, FLOW))
  return [true, water === undefined ? undefined : yOf(water.level), wet.swimming]
}

const SyncAnimals = RenderSync.system(Game, {
  name: "Lunigiana/SyncAnimals",
  renderable: Animal,
  registry: Animals,
  select: {
    down: Game.Query.optional(Down),
    dead: Game.Query.optional(Dead),
    motion: Game.Query.read(Motion),
    pose: Game.Query.read(Pose),
    wet: Game.Query.optional(InWater),
  },
  resources: { time: Time, rivers: Rivers },
  redrawOn: [Down, Dead, InWater, PrevPose],
  create: ({ renderable, entity }) => new AnimalNode(renderable, actorMaterial, entity),
  apply: (node, { data, resources }) => {
    node.lie(data.down.present, data.dead.present)
    const { vx, vy } = data.motion.get()
    node.speed = Math.hypot(vx, vy)
    node.clock = resources.time.get().step * STEP.dt
    node.floating(
      ...afloat(data.pose.get(), data.wet.value(), data.down.present, resources.rivers.get()),
    )
  },
})

const SyncVehicles = RenderSync.system(Game, {
  name: "Lunigiana/SyncVehicles",
  renderable: Vehicle,
  registry: Vehicles,
  select: { damage: Game.Query.read(Damage) },
  redrawOn: [Damage],
  create: ({ renderable }) => vehicleNode(renderable.model, renderable.color, actorMaterial),
  // A wreck that blew up is left a charred shell, its lamps burnt off with it.
  apply: (node, { renderable, data }) => {
    const exploded = data.damage.get().exploded
    node.body.geometry = vehicleBody(renderable.model, renderable.color, exploded)
    node.lamps.visible = !exploded
  },
})

/** Shows the x-ray silhouette of the vehicle the player drives, and only that one. */
const MarkDriven = Game.System(
  "Lunigiana/MarkDriven",
  {
    queries: {
      player: Game.Query({ selection: { driving: Game.Query.optional(Driving) }, with: [Player] }),
      vehicles: Game.Query({ selection: { vehicle: Game.Query.read(Vehicle) } }),
    },
    services: { nodes: Game.System.service(Vehicles) },
  },
  ({ queries, services }) => {
    const found = queries.player.singleOptional()
    const driving = found.ok ? found.value?.data.driving.value() : undefined
    const car = driving === undefined ? undefined : queries.vehicles.getHandle(driving.vehicle)
    const driven: number | undefined = car?.ok === true ? car.value.entity.id : undefined
    for (const [entity, node] of services.nodes.entries()) node.showXray(entity === driven)
  },
)

/** `from` → `to` at `alpha`, turning the short way round. */
export const blend = (from: PoseValue, to: PoseValue, alpha: number): PoseValue => ({
  x: from.x + (to.x - from.x) * alpha,
  y: from.y + (to.y - from.y) * alpha,
  angle: from.angle + wrapAngle(to.angle - from.angle) * alpha,
})

const PlacePeople = RenderSync.interpolate(Game, {
  name: "Lunigiana/PlacePeople",
  registry: People,
  previous: PrevPose,
  current: Pose,
  clock: RenderClock,
  blend,
  place: (node, { x, y, angle }) => {
    node.place(x, y, angle)
    node.pose()
  },
})

const PlaceAnimals = RenderSync.interpolate(Game, {
  name: "Lunigiana/PlaceAnimals",
  registry: Animals,
  previous: PrevPose,
  current: Pose,
  clock: RenderClock,
  blend,
  place: (node, { x, y, angle }) => {
    node.place(x, y, angle)
    node.pose()
  },
})

/**
 * Puts a vehicle's node at its centre of mass `alpha` of the way through the last step: the pose
 * blended PrevPose → Pose, the height, pitch and roll stepped back from the current Chassis along
 * their rates (close to the previous step's values: the physics moves them in substeps). Three's rotation order YZX turns
 * the body as the sim does: heading, then pitch (nose up +) about its right axis, then roll (left
 * side up +, the roof toward local +Z, the right) about its forward axis.
 */
export const placeVehicle = (
  node: Object3D,
  prev: PoseValue,
  pose: PoseValue,
  chassis: ChassisValue,
  alpha: number,
): void => {
  // No car turns 90° in a step: a heading half a turn on is the physics folding a tumble's angles (heading + π, pitch π − pitch,
  // roll + π, the same body), unfolded here so the blend runs on from the previous step's angles.
  const folded = Math.abs(wrapAngle(pose.angle - prev.angle)) > Math.PI / 2
  const to = folded ? { ...pose, angle: pose.angle - Math.PI } : pose
  const pitch = folded ? Math.PI - chassis.pitch : chassis.pitch,
    pitchRate = folded ? -chassis.pitchRate : chassis.pitchRate
  const roll = folded ? chassis.roll - Math.PI : chassis.roll
  const { x, y, angle } = blend(prev, to, alpha),
    back = (1 - alpha) * STEP.dt
  node.position.set(x, yOf(chassis.z - chassis.vz * back), -y)
  node.rotation.set(roll - chassis.rollRate * back, angle, pitch - pitchRate * back)
}

const PlaceVehicles = Game.System(
  "Lunigiana/PlaceVehicles",
  {
    queries: {
      vehicles: Game.Query({
        selection: {
          prev: Game.Query.read(PrevPose),
          pose: Game.Query.read(Pose),
          chassis: Game.Query.read(Chassis),
        },
      }),
    },
    services: { nodes: Game.System.service(Vehicles), clock: Game.System.service(RenderClock) },
  },
  ({ queries, services }) => {
    for (const { entity, data } of queries.vehicles.each()) {
      const node = services.nodes.get(entity.id)
      if (node !== undefined)
        placeVehicle(
          node,
          data.prev.get(),
          data.pose.get(),
          data.chassis.get(),
          services.clock.alpha,
        )
    }
  },
)

/** Spreads each dead body's blood pool to its size at the drawn moment's sim time, under the node as placed this frame. */
const SpreadPools = Game.System(
  "Lunigiana/SpreadPools",
  {
    queries: { dead: Game.Query({ selection: { dead: Game.Query.read(Dead) } }) },
    resources: { time: Game.System.readResource(Time) },
    services: {
      people: Game.System.service(People),
      animals: Game.System.service(Animals),
      clock: Game.System.service(RenderClock),
    },
  },
  ({ queries, resources, services }) => {
    const now = resources.time.get().step + services.clock.alpha
    for (const { entity, data } of queries.dead.each()) {
      const node = services.people.get(entity.id) ?? services.animals.get(entity.id)
      node?.bleed((now - data.dead.get().since) * STEP.dt)
    }
  },
)

/** Damaged engines and blasts farther than this from the player (m) are not drawn: past the view's reach, with room for a tall plume. */
const PLUME_REACH = VIEW_REACH + 60
/**
 * Which damaged engines smoke first: burning wrecks (about to blow), then the smoking ones, white or black alike so a near one is not
 * dropped for a far one, and the charred shells' thin wisps last.
 */
const PRIORITY = { destroyed: 0, severe: 1, medium: 1, burnt: 2 } as const satisfies Record<
  Exclude<WreckState, "light">,
  number
>

/**
 * Lays the steps' Skid events as tyre marks and smoke, sets off a blast for each Explosion near the
 * player at the drawn moment, gives off the smoke and fire of the damaged engines near the player
 * since the last frame, the burning ones first (by their stage of damage, or the thin smoke of a
 * shell that blew up, from their nodes as placed this frame), then moves them all to the drawn
 * moment's sim time.
 */
const DrawEffects = Game.System(
  "Lunigiana/DrawEffects",
  {
    queries: {
      player: Game.Query({ selection: { pose: Game.Query.read(Pose) }, with: [Player] }),
      vehicles: Game.Query({ selection: { damage: Game.Query.read(Damage) } }),
    },
    resources: { time: Game.System.readResource(Time) },
    events: { skids: Game.System.readEvent(Skid), explosions: Game.System.readEvent(Explosion) },
    services: {
      effects: Game.System.service(Effects),
      nodes: Game.System.service(Vehicles),
      clock: Game.System.service(RenderClock),
    },
  },
  ({ queries, resources, events, services }) => {
    const { marks, smoke, wrecks, blasts } = services.effects
    for (const skid of events.skids.all()) {
      // A vehicle despawned since leaves no more marks.
      const node = services.nodes.get(skid.car)
      if (node === undefined) continue
      marks.add(skid, TREAD[node.model])
      smoke.add(skid)
    }
    const now = (resources.time.get().step + services.clock.alpha) * STEP.dt,
      dt = wrecks.frame(now)
    const me = queries.player.singleOptional(),
      at = me.ok ? me.value?.data.pose.get() : undefined
    for (const blast of events.explosions.all()) {
      // A wreck despawned since (out of view) is not drawn.
      const node = services.nodes.get(blast.car)
      if (
        at === undefined ||
        node === undefined ||
        Math.hypot(blast.x - at.x, blast.y - at.y) > PLUME_REACH
      )
        continue
      // Its pieces come down on the ground on the level nearest the wreck's: a bridge's deck, not the river under it.
      const y = yOf(blast.z),
        deck = groundY(blast.x, blast.y, y)
      blasts.start(blast.x, y, -blast.y, (x, z) => groundY(x, -z, deck), now, node.paint)
    }
    const plumes =
      at === undefined
        ? []
        : queries.vehicles.each().flatMap(({ entity, data }) => {
            const damage = data.damage.get(),
              state: WreckState = damage.exploded ? "burnt" : stageOf(damage.amount),
              node = services.nodes.get(entity.id)
            if (state === "light" || node === undefined) return []
            const away = Math.hypot(node.position.x - at.x, node.position.z + at.y)
            return away > PLUME_REACH ? [] : [{ node, state, away }]
          })
    // As many as the pools hold in full, by PRIORITY and then the nearest first (the player's own car among them).
    const first = plumes
      .sort((a, b) => PRIORITY[a.state] - PRIORITY[b.state] || a.away - b.away)
      .slice(0, PLUMES_AT_ONCE)
    for (const { node, state } of first) wrecks.emit(node, state, dt, now)
    marks.update(now)
    smoke.update(now)
    wrecks.update(now)
    blasts.update(now)
  },
)

/**
 * Hands the sky host this frame's game time (blended at alpha), the weather, sim time and what the
 * rivers carry, the steps' lightning, and the cars with their lamps on, switching every car's lamps: on in traffic and in the
 * player's car, off when parked. Last in the schedule, so the cars stand where they are drawn.
 */
const DrawSky = Game.System(
  "Lunigiana/DrawSky",
  {
    queries: {
      player: Game.Query({ selection: { driving: Game.Query.optional(Driving) }, with: [Player] }),
      vehicles: Game.Query({
        selection: { vehicle: Game.Query.read(Vehicle), traffic: Game.Query.optional(Traffic) },
      }),
    },
    resources: {
      time: Game.System.readResource(Time),
      clock: Game.System.readResource(GameClock),
      weather: Game.System.readResource(Weather),
      rivers: Game.System.readResource(Rivers),
    },
    events: { lightning: Game.System.readEvent(Lightning) },
    services: {
      sky: Game.System.service(Sky),
      nodes: Game.System.service(Vehicles),
      clock: Game.System.service(RenderClock),
    },
  },
  ({ queries, resources, events, services }) => {
    const { sky, nodes } = services,
      alpha = services.clock.alpha,
      { seconds, rate } = resources.clock.get()
    sky.sky(
      seconds + alpha * rate,
      rate,
      resources.weather.get(),
      (resources.time.get().step + alpha) * STEP.dt,
      specificDischarge(resources.rivers.get(), FLOW),
    )
    for (const lightning of events.lightning.all()) sky.strike(lightning)
    const found = queries.player.singleOptional()
    const driving = found.ok ? found.value?.data.driving.value() : undefined
    const car = driving === undefined ? undefined : queries.vehicles.getHandle(driving.vehicle)
    const driven: number | undefined = car?.ok === true ? car.value.entity.id : undefined
    for (const { entity, data } of queries.vehicles.each()) {
      const node = nodes.get(entity.id)
      if (node === undefined) continue
      const on = data.traffic.present || entity.id === driven
      node.setLamps(on)
      if (on)
        sky.car({
          id: entity.id,
          x: node.position.x,
          y: -node.position.z,
          z: node.position.y,
          angle: node.rotation.y,
          driven: entity.id === driven,
        })
    }
  },
)

/** How tall a lying person is drawn for the see-through cut's sight lines, m. */
const LYING = 0.5

/**
 * Hands the see-through cut the player as drawn this frame: on foot their figure (standing on its
 * feet, or lying), driving their car (its ground `cg` under the node, its spec's height), or shuts
 * it when there is no player. After the placing systems, so it follows the nodes where they stand.
 */
const FollowPlayer = Game.System(
  "Lunigiana/FollowPlayer",
  {
    queries: {
      player: Game.Query({ selection: { driving: Game.Query.optional(Driving) }, with: [Player] }),
      vehicles: Game.Query({ selection: { vehicle: Game.Query.read(Vehicle) } }),
    },
    resources: { time: Game.System.readResource(Time) },
    services: {
      cut: Game.System.service(Cut),
      people: Game.System.service(People),
      vehicles: Game.System.service(Vehicles),
      clock: Game.System.service(RenderClock),
    },
  },
  ({ queries, resources, services }) => {
    const now = (resources.time.get().step + services.clock.alpha) * STEP.dt
    const found = queries.player.singleOptional()
    const me = found.ok ? found.value : undefined
    const driving = me?.data.driving.value()
    const car = driving === undefined ? undefined : queries.vehicles.getHandle(driving.vehicle)
    const node =
      car?.ok === true
        ? services.vehicles.get(car.value.entity.id)
        : me === undefined
          ? undefined
          : services.people.get(me.entity.id)
    if (node === undefined) return services.cut.shut()
    const at = node.position
    if (node instanceof PersonNode)
      services.cut.follow(at.x, at.y, at.z, node.lying ? LYING : node.height, now)
    else {
      const spec = VEHICLES[node.model]
      services.cut.follow(at.x, at.y - spec.cg, at.z, spec.height, now)
    }
  },
)

/** The render schedule, ticked once per animation frame after the fixed updates. */
export const render = Game.Schedule(
  SyncPeople,
  SyncAnimals,
  SyncVehicles,
  MarkDriven,
  PlacePeople,
  PlaceAnimals,
  PlaceVehicles,
  SpreadPools,
  DrawEffects,
  DrawSky,
  FollowPlayer,
)
