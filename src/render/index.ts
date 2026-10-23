/**
 * The render schedule: mirrors people and vehicles into three nodes with RenderSync, places them
 * between fixed steps (PrevPose → Pose at the loop's alpha), people on the ground or road under
 * them and vehicles at their centre of mass from their Chassis, marks the player's car for the
 * x-ray silhouette, and lays tyre marks and smoke from the Skid events. Read-only towards the
 * world (__tests__/index.test.ts checks every system's declared access); the host ticks it once per
 * animation frame after writing `RenderClock.alpha`.
 *
 * @module render
 */
import { Descriptor } from "@typeonce/ritmo"
import { NodeRegistry, RenderSync } from "@typeonce/ritmo-render"
import type { Object3D } from "three"

import { wrapAngle } from "../sim/body.ts"
import {
  Chassis, type ChassisValue, Down, Driving, Game, Person, Player, Pose, type PoseValue, PrevPose, Skid, STEP, Time, Vehicle
} from "../sim/index.ts"
import { type ActorNode, PersonNode, type VehicleNode, vehicleNode } from "./actors.ts"
import { solidMaterial } from "./geometry.ts"
import { groundY, yOf } from "./ground.ts"
import { Marks, TREAD } from "./marks.ts"
import { Smoke } from "./smoke.ts"

/** Person nodes, one per entity with a Person. */
export const People = Descriptor.Service<NodeRegistry.NodeRegistry<PersonNode>>()("Lunigiana/PeopleNodes")
/** Vehicle nodes, one per entity with a Vehicle. */
export const Vehicles = Descriptor.Service<NodeRegistry.NodeRegistry<VehicleNode>>()("Lunigiana/VehicleNodes")
/** Mutable host object: the loop writes `alpha` (fraction of a step since the last one) before ticking `render`. */
export const RenderClock = Descriptor.Service<{ readonly alpha: number }>()("Lunigiana/RenderClock")

/** The two registries, attaching nodes under `parent` and freeing them on detach. */
export const makeRegistries = (parent: Object3D) => {
  const options = {
    attach: (node: ActorNode) => parent.add(node),
    detach: (node: ActorNode) => {
      node.removeFromParent()
      node.dispose()
    }
  }
  return { people: NodeRegistry.make<PersonNode>(options), vehicles: NodeRegistry.make<VehicleNode>(options) }
}

/** The map's tyre marks and smoke, under `parent` for the page's life. */
export const makeEffects = (parent: Object3D) => {
  const effects = { marks: new Marks(), smoke: new Smoke() }
  parent.add(effects.marks.mesh, effects.smoke.mesh)
  return effects
}
/** The host's tyre marks and smoke (`makeEffects`), fed by the render schedule. */
export const Effects = Descriptor.Service<ReturnType<typeof makeEffects>>()("Lunigiana/Effects")

const SyncPeople = RenderSync.system(Game, {
  name: "Lunigiana/SyncPeople",
  renderable: Person,
  registry: People,
  select: { driving: Game.Query.optional(Driving), down: Game.Query.optional(Down), player: Game.Query.optional(Player) },
  // PrevPose is written every step, so apply also sees Driving and Down going away.
  redrawOn: [Driving, Down, PrevPose],
  create: ({ renderable }) => new PersonNode(renderable, solidMaterial),
  apply: (node, { data }) => {
    node.visible = !data.driving.present
    node.rotation.z = data.down.present ? -Math.PI / 2 : 0
    node.xray.visible = data.player.present
  }
})

const SyncVehicles = RenderSync.system(Game, {
  name: "Lunigiana/SyncVehicles",
  renderable: Vehicle,
  registry: Vehicles,
  create: ({ renderable }) => vehicleNode(renderable.model, renderable.color, solidMaterial),
  apply: () => {}
})

/** Shows the x-ray silhouette of the vehicle the player drives, and only that one. */
const MarkDriven = Game.System("Lunigiana/MarkDriven", {
  queries: {
    player: Game.Query({ selection: { driving: Game.Query.optional(Driving) }, with: [Player] }),
    vehicles: Game.Query({ selection: { vehicle: Game.Query.read(Vehicle) } })
  },
  services: { nodes: Game.System.service(Vehicles) }
}, ({ queries, services }) => {
  const found = queries.player.singleOptional()
  const driving = found.ok ? found.value?.data.driving.value() : undefined
  const car = driving === undefined ? undefined : queries.vehicles.getHandle(driving.vehicle)
  const driven: number | undefined = car?.ok === true ? car.value.entity.id : undefined
  for (const [entity, node] of services.nodes.entries()) node.xray.visible = entity === driven
})

/** `from` → `to` at `alpha`, turning the short way round. */
export const blend = (from: PoseValue, to: PoseValue, alpha: number): PoseValue => ({
  x: from.x + (to.x - from.x) * alpha,
  y: from.y + (to.y - from.y) * alpha,
  angle: from.angle + wrapAngle(to.angle - from.angle) * alpha
})

const STRIDE = 0.45 // metres per walk frame
const PlacePeople = RenderSync.interpolate(Game, {
  name: "Lunigiana/PlacePeople",
  registry: People,
  previous: PrevPose,
  current: Pose,
  clock: RenderClock,
  blend,
  place: (node, { x, y, angle }) => {
    const h = groundY(x, y, node.elevation)
    node.elevation = h
    node.position.set(x, h + (node.rotation.z === 0 ? 0 : 0.2), -y)
    node.rotation.y = angle
    const moved = node.last === undefined ? 0 : Math.hypot(x - node.last.x, y - node.last.y)
    node.last = { x, y }
    node.walked += moved
    node.body.geometry = moved < 1e-3 || node.rotation.z !== 0 ? node.frames[0] : node.frames[Math.floor(node.walked / STRIDE) % 2 === 0 ? 1 : 2]
  }
})

/**
 * Puts a vehicle's node at its centre of mass `alpha` of the way through the last step: the pose
 * blended PrevPose → Pose, the height, pitch and roll stepped back from the current Chassis along
 * their rates (close to the previous step's values: the physics moves them in substeps). Three's rotation order YZX turns
 * the body as the sim does: heading, then pitch (nose up +) about its right axis, then roll (left
 * side up +, the roof toward local +Z, the right) about its forward axis.
 */
export const placeVehicle = (node: Object3D, prev: PoseValue, pose: PoseValue, chassis: ChassisValue, alpha: number): void => {
  // No car turns 90° in a step: a heading half a turn on is the physics folding a tumble's angles (heading + π, pitch π − pitch,
  // roll + π, the same body), unfolded here so the blend runs on from the previous step's angles.
  const folded = Math.abs(wrapAngle(pose.angle - prev.angle)) > Math.PI / 2
  const to = folded ? { ...pose, angle: pose.angle - Math.PI } : pose
  const pitch = folded ? Math.PI - chassis.pitch : chassis.pitch, pitchRate = folded ? -chassis.pitchRate : chassis.pitchRate
  const roll = folded ? chassis.roll - Math.PI : chassis.roll
  const { x, y, angle } = blend(prev, to, alpha), back = (1 - alpha) * STEP.dt
  node.position.set(x, yOf(chassis.z - chassis.vz * back), -y)
  node.rotation.set(roll - chassis.rollRate * back, angle, pitch - pitchRate * back)
}

const PlaceVehicles = Game.System("Lunigiana/PlaceVehicles", {
  queries: { vehicles: Game.Query({ selection: { prev: Game.Query.read(PrevPose), pose: Game.Query.read(Pose), chassis: Game.Query.read(Chassis) } }) },
  services: { nodes: Game.System.service(Vehicles), clock: Game.System.service(RenderClock) }
}, ({ queries, services }) => {
  for (const { entity, data } of queries.vehicles.each()) {
    const node = services.nodes.get(entity.id)
    if (node !== undefined) placeVehicle(node, data.prev.get(), data.pose.get(), data.chassis.get(), services.clock.alpha)
  }
})

/** Lays the steps' Skid events as tyre marks and smoke, then moves both to the drawn moment's sim time. */
const DrawEffects = Game.System("Lunigiana/DrawEffects", {
  resources: { time: Game.System.readResource(Time) },
  events: { skids: Game.System.readEvent(Skid) },
  services: { effects: Game.System.service(Effects), nodes: Game.System.service(Vehicles), clock: Game.System.service(RenderClock) }
}, ({ resources, events, services }) => {
  const { marks, smoke } = services.effects
  for (const skid of events.skids.all()) {
    // A vehicle despawned since leaves no more marks.
    const node = services.nodes.get(skid.car)
    if (node === undefined) continue
    marks.add(skid, TREAD[node.model])
    smoke.add(skid)
  }
  const now = (resources.time.get().step + services.clock.alpha) * STEP.dt
  marks.update(now)
  smoke.update(now)
})

/** The render schedule, ticked once per animation frame after the fixed updates. */
export const render = Game.Schedule(SyncPeople, SyncVehicles, MarkDriven, PlacePeople, PlaceVehicles, DrawEffects)
