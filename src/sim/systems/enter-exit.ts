import { Clock } from "@typeonce/ritmo"
import { Ops, Random, Vec2 } from "@typeonce/ritmo-math"

import { clearOf, vehicleInReach, walkBy, wallsAlong } from "../body.ts"
import { facesForward, laneOf, roadOf, walkIndex, walkSide } from "../route.ts"
import {
  Autopilot, CarInput, Chassis, Down, Driving, Game, Input, Motion, Pedestrian, Person, Player, Pose, type PoseValue, PrevPose, Rng, Route, Score, Stolen,
  Time, Traffic, Vehicle
} from "../schema.ts"
import { pedestrian, randomLook } from "../spawning.ts"
import { PERSON_RADIUS } from "../tuning.ts"
import { VEHICLES, type VehicleModel } from "../vehicles.ts"
import { FLEE_TIME } from "./pedestrians.ts"

/** Gap between the body and a person getting out, m. */
const DOOR_GAP = 0.6

/** Where a person stands to get out of a vehicle: left door (the driver's, in Italy), right door, front, back. */
const doors = (pose: PoseValue, model: VehicleModel) => {
  const { length, width } = VEHICLES[model]
  const fx = Ops.cos(pose.angle), fy = Ops.sin(pose.angle)
  const side = width / 2 + DOOR_GAP, end = length / 2 + DOOR_GAP
  return [
    { x: pose.x - fy * side, y: pose.y + fx * side },
    { x: pose.x + fy * side, y: pose.y - fx * side },
    { x: pose.x + fx * end, y: pose.y + fy * end },
    { x: pose.x - fx * end, y: pose.y - fy * end }
  ]
}

const clearSpot = (at: Vec2.Vec2) =>
  clearOf(wallsAlong("walk", at.x, at.y, 0, 0, PERSON_RADIUS + 0.5), at.x, at.y, PERSON_RADIUS)

/** The first door someone can get out at: clear of walk walls, with no wall between it and the vehicle's centre. */
const freeDoor = (pose: PoseValue, model: VehicleModel) =>
  doors(pose, model).find((door) => clearSpot(door) && !walkBy(pose, Vec2.subtract(door, pose)).blocked)

/**
 * The action key (once per press): on foot, enter the vehicle in reach
 * (vehicleInReach: within ENTER_GAP of its body, no wall in between), carjacking
 * a traffic driver, who flees out of the first free door; the first entry of a
 * vehicle scores a theft. Driving, get out at the first free door (none: stay
 * in) and leave the vehicle on its handbrake.
 */
export const EnterExit = Game.System("Lunigiana/EnterExit", {
  queries: {
    player: Game.Query({
      selection: { pose: Game.Query.write(Pose), motion: Game.Query.write(Motion), driving: Game.Query.optional(Driving), down: Game.Query.optional(Down) },
      with: [Player]
    }),
    vehicles: Game.Query({
      selection: {
        pose: Game.Query.read(Pose),
        chassis: Game.Query.read(Chassis),
        vehicle: Game.Query.read(Vehicle),
        input: Game.Query.write(CarInput),
        traffic: Game.Query.optional(Traffic),
        stolen: Game.Query.optional(Stolen)
      },
      without: [Pedestrian]
    })
  },
  resources: {
    input: Game.System.readResource(Input),
    score: Game.System.writeResource(Score),
    rng: Game.System.writeResource(Rng),
    time: Game.System.thisTick(Game.System.readResource(Time))
  },
  commands: Game.System.commands(
    Game.System.inserts(Driving, Stolen),
    Game.System.removes(Driving, Traffic, Route, Autopilot),
    Game.System.spawns(Pedestrian, Person, Pose, PrevPose, Motion, Route)
  )
}, ({ queries, resources, commands }) => {
  if (!resources.input.get().action.pressed) return
  for (const { entity, data } of queries.player.each()) {
    if (data.down.present) continue
    const driving = data.driving.value()
    if (driving !== undefined) {
      const car = queries.vehicles.getHandle(driving.vehicle)
      if (!car.ok) continue
      const pose = car.value.data.pose.get()
      const door = freeDoor(pose, car.value.data.vehicle.get().model)
      if (door === undefined) continue
      data.pose.set({ x: door.x, y: door.y, angle: pose.angle })
      data.motion.set({ vx: 0, vy: 0, spin: 0 })
      car.value.data.input.set({ throttle: 0, steer: 0, handbrake: true })
      commands.remove(entity, Driving)
      continue
    }
    const near = vehicleInReach(data.pose.get(), queries.vehicles.each(), (v) => ({ model: v.data.vehicle.get().model, pose: v.data.pose.get(), chassis: v.data.chassis.get() }))
    if (near === undefined) continue
    commands.insert(entity, [Driving, { vehicle: Game.Entity.handle(near.entity, Vehicle) }])
    data.motion.set({ vx: 0, vy: 0, spin: 0 })
    if (!near.data.stolen.present) {
      commands.insert(near.entity, [Stolen, {}])
      resources.score.update((score) => ({ ...score, stolen: score.stolen + 1 }))
    }
    if (!near.data.traffic.present) continue
    commands.remove(near.entity, Traffic, Route, Autopilot)
    const pose = near.data.pose.get()
    const door = freeDoor(pose, near.data.vehicle.get().model)
    if (door === undefined) continue
    const edge = walkIndex.nearest(door.x, door.y)
    const forward = facesForward(edge, pose.angle)
    const lane = laneOf(edge, forward)
    // The verge on the door's side of the car, so the driver does not run back through it.
    const right = (door.x - pose.x) * lane.rx + (door.y - pose.y) * lane.ry > 0
    const random = Random.draw(resources.rng)
    commands.spawn(pedestrian(
      randomLook(random),
      { x: door.x, y: door.y, angle: Ops.atan2(door.y - pose.y, door.x - pose.x) },
      { edge, forward, side: (right ? 1 : -1) * walkSide(roadOf(edge)) },
      { mood: "flee", until: resources.time.get().step + Clock.steps(FLEE_TIME), fx: pose.x, fy: pose.y }
    ))
  }
})
