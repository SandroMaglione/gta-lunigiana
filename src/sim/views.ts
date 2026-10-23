import type { Vec2 } from "@typeonce/ritmo-math"

import { forwardSpeed, vehicleInReach } from "./body.ts"
import {
  Chassis,
  Down,
  Driving,
  Game,
  Handling,
  Motion,
  Player,
  Pose,
  type PoseValue,
  PrevPose,
  Score,
  Stolen,
  Traffic,
  Vehicle,
  View,
} from "./schema.ts"
import { VEHICLES } from "./vehicles.ts"

/** Plain view data for the camera and HUD. */
export interface PlayerViewModel {
  /** Player pose at the start and end of the last step (lerp with the frame alpha). */
  readonly prev: PoseValue
  readonly pose: PoseValue
  /** Player velocity, m/s (the vehicle's while driving; zero on the step they get in or out). */
  readonly velocity: Vec2.Vec2
  readonly mode: "foot" | "driving" | "down"
  /** The vehicle being driven: label, forward speed in m/s (negative when reversing). */
  readonly vehicle: { readonly label: string; readonly speed: number } | undefined
  /** The vehicle the action key would enter right now, when on foot (not knocked down). */
  readonly nearby:
    | { readonly label: string; readonly occupied: boolean; readonly stolen: boolean }
    | undefined
  readonly score: { readonly stolen: number; readonly knocked: number }
  /** Net quarter turns of the view to the left of its home seat (the `View` resource). */
  readonly turns: number
}

/** The one projection the host reads for the camera and HUD. */
export const PlayerView = Game.Inspector(
  "Lunigiana/PlayerView",
  {
    queries: {
      player: Game.Query({
        selection: {
          prev: Game.Query.read(PrevPose),
          pose: Game.Query.read(Pose),
          motion: Game.Query.read(Motion),
          driving: Game.Query.optional(Driving),
          down: Game.Query.optional(Down),
        },
        with: [Player],
      }),
      vehicles: Game.Query({
        selection: {
          vehicle: Game.Query.read(Vehicle),
          pose: Game.Query.read(Pose),
          chassis: Game.Query.read(Chassis),
          motion: Game.Query.read(Motion),
          traffic: Game.Query.optional(Traffic),
          stolen: Game.Query.optional(Stolen),
        },
      }),
    },
    resources: { score: Game.System.readResource(Score), view: Game.System.readResource(View) },
  },
  ({ queries, resources }): PlayerViewModel | undefined => {
    const found = queries.player.singleOptional()
    if (!found.ok || found.value === undefined) return undefined
    const { data } = found.value
    const pose = data.pose.get()
    const motion = data.motion.get()
    const driving = data.driving.value()
    const car = driving === undefined ? undefined : queries.vehicles.getHandle(driving.vehicle)
    const vehicle =
      car === undefined || !car.ok
        ? undefined
        : {
            label: VEHICLES[car.value.data.vehicle.get().model].label,
            speed: forwardSpeed(car.value.data.motion.get(), car.value.data.pose.get().angle),
          }
    const near =
      driving !== undefined || data.down.present
        ? undefined
        : vehicleInReach(pose, queries.vehicles.each(), ({ data: v }) => ({
            model: v.vehicle.get().model,
            pose: v.pose.get(),
            chassis: v.chassis.get(),
          }))
    return {
      prev: data.prev.get(),
      pose,
      velocity: { x: motion.vx, y: motion.vy },
      mode: driving !== undefined ? "driving" : data.down.present ? "down" : "foot",
      vehicle,
      nearby:
        near === undefined
          ? undefined
          : {
              label: VEHICLES[near.data.vehicle.get().model].label,
              occupied: near.data.traffic.present,
              stolen: near.data.stolen.present,
            },
      score: resources.score.get(),
      turns: resources.view.get().turns,
    }
  },
)

/** The handling knobs' current values, for the host's handling store (the settings and the dev debug menu). */
export const HandlingView = Game.Inspector(
  "Lunigiana/HandlingView",
  {
    resources: { handling: Game.System.readResource(Handling) },
  },
  ({ resources }) => resources.handling.get(),
)
