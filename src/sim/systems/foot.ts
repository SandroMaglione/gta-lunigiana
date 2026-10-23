import { InputAxis, Ops, Vec2 } from "@typeonce/ritmo-math"

import { walkBy } from "../body.ts"
import { Down, Driving, Game, Input, Motion, Player, Pose, Time, View } from "../schema.ts"
import { SPRINT_SPEED, WALK_SPEED } from "../tuning.ts"
import { screenAxes } from "../view.ts"

/** On-foot acceleration toward the wanted velocity, m/s². */
const FOOT_ACCEL = 30
/** Deceleration of a knocked-down person sliding on the ground, m/s². */
const SLIDE_DECEL = 10

/** A knocked-down body's velocity after one step of ground friction. */
export const slide = (velocity: Vec2.Vec2, dt: number): Vec2.Vec2 =>
  Vec2.moveToward(velocity, Vec2.zero, SLIDE_DECEL * dt)

/**
 * The player on foot: arrow keys move along the screen axes of the turned view (up key = screen-up),
 * sprint held runs, the body faces where the keys point. Knocked down, it only slides.
 */
export const PlayerFoot = Game.System(
  "Lunigiana/PlayerFoot",
  {
    queries: {
      player: Game.Query({
        selection: {
          pose: Game.Query.write(Pose),
          motion: Game.Query.write(Motion),
          down: Game.Query.optional(Down),
        },
        with: [Player],
        without: [Driving],
      }),
    },
    resources: {
      input: Game.System.readResource(Input),
      view: Game.System.readResource(View),
      time: Game.System.thisTick(Game.System.readResource(Time)),
    },
  },
  ({ queries, resources }) => {
    const { dt } = resources.time.get()
    const keys = resources.input.get()
    const { up, right } = screenAxes(resources.view.get().turns)
    for (const { data } of queries.player.each()) {
      const pose = data.pose.get()
      const motion = data.motion.get()
      const current = { x: motion.vx, y: motion.vy }
      const ix = InputAxis.axis(keys.left.held, keys.right.held)
      const iy = InputAxis.axis(keys.down.held, keys.up.held)
      const wish = data.down.present
        ? Vec2.zero
        : Vec2.normalizeOr({ x: right.x * ix + up.x * iy, y: right.y * ix + up.y * iy }, Vec2.zero)
      const velocity = data.down.present
        ? slide(current, dt)
        : Vec2.moveToward(
            current,
            Vec2.scale(wish, keys.sprint.held ? SPRINT_SPEED : WALK_SPEED),
            FOOT_ACCEL * dt,
          )
      const moved = walkBy(pose, Vec2.scale(velocity, dt))
      // Velocity is what actually happened, so walls stop it instead of storing it up.
      const real =
        dt > 0
          ? { x: (moved.position.x - pose.x) / dt, y: (moved.position.y - pose.y) / dt }
          : velocity
      const kept = Vec2.lengthSquared(real) < Vec2.lengthSquared(velocity) ? real : velocity
      const facing = wish.x !== 0 || wish.y !== 0 ? Ops.atan2(wish.y, wish.x) : pose.angle
      data.pose.set({ x: moved.position.x, y: moved.position.y, angle: facing })
      data.motion.set({ vx: kept.x, vy: kept.y, spin: 0 })
    }
  },
)
