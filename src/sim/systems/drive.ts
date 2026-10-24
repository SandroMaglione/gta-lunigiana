import { InputAxis } from "@typeonce/ritmo-math"

import { CarInput, Driving, Game, Input, Motion, Player, Pose, Vehicle } from "../schema.ts"

/** The player's keys drive their vehicle: throttle up − down, steer left − right (left turns CCW), handbrake. */
export const PlayerDrive = Game.System(
  "Lunigiana/PlayerDrive",
  {
    queries: {
      player: Game.System.thisTick(
        Game.Query({ selection: { driving: Game.Query.read(Driving) }, with: [Player] }),
      ),
      vehicles: Game.Query({ selection: { input: Game.Query.write(CarInput) }, with: [Vehicle] }),
    },
    resources: { input: Game.System.readResource(Input) },
  },
  ({ queries, resources }) => {
    const keys = resources.input.get()
    for (const { data } of queries.player.each()) {
      const car = queries.vehicles.getHandle(data.driving.get().vehicle)
      if (!car.ok) continue
      car.value.data.input.set({
        throttle: InputAxis.axis(keys.actions.down.held, keys.actions.up.held),
        steer: InputAxis.axis(keys.actions.right.held, keys.actions.left.held),
        handbrake: keys.actions.handbrake.held,
      })
    }
  },
)

/** After physics, the driving player rides along: their Pose and Motion are the vehicle's, so the camera follows the car. */
export const RideAlong = Game.System(
  "Lunigiana/RideAlong",
  {
    queries: {
      player: Game.Query({
        selection: {
          pose: Game.Query.write(Pose),
          motion: Game.Query.write(Motion),
          driving: Game.Query.read(Driving),
        },
        with: [Player],
      }),
      vehicles: Game.Query({
        selection: { pose: Game.Query.read(Pose), motion: Game.Query.read(Motion) },
        with: [Vehicle],
      }),
    },
  },
  ({ queries }) => {
    for (const { data } of queries.player.each()) {
      const car = queries.vehicles.getHandle(data.driving.get().vehicle)
      if (!car.ok) continue
      data.pose.set(car.value.data.pose.get())
      data.motion.set(car.value.data.motion.get())
    }
  },
)
