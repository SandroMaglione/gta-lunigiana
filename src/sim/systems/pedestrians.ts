import { Clock } from "@typeonce/ritmo"
import { Ops, Random, Vec2 } from "@typeonce/ritmo-math"

import { walkBy } from "../body.ts"
import { alongLane, endNode, laneOf, lanePoint, nextWalkEdge, roadOf, walkSide } from "../route.ts"
import {
  Down,
  Game,
  Motion,
  Pedestrian,
  Pose,
  Rng,
  Route,
  type RouteValue,
  STEP,
  Time,
  Vehicle,
} from "../schema.ts"
import { slide } from "./foot.ts"

/** Walking and fleeing speeds, m/s. */
const WALK = 1.3
const RUN = 4.5
/** How long a scared pedestrian runs. */
export const FLEE_TIME = Clock.duration(STEP, 4)
/** A vehicle faster than this (m/s) passing within this distance (m) scares a walker. */
const SCARY_SPEED = 10
const SCARY_RANGE = 5
/** Walkers aim this far ahead along their lane, m. */
const LOOK = 1.5
/** Making less than this share of the wanted speed along the lane counts as blocked. */
const PROGRESS = 0.5
/** Every this long blocked, a walker tries the other verge, then turns back. */
const BLOCKED_STEPS = Clock.steps(Clock.duration(STEP, 0.5))
/** Blocked this long, a walker out of sight is despawned (Populate). */
export const GIVE_UP_STEPS = Clock.steps(Clock.duration(STEP, 5))

/** The same verge of `route`, travelled the other way. */
const turnBack = (route: RouteValue): RouteValue => ({
  ...route,
  forward: !route.forward,
  side: -route.side,
})

/** `route` turned, if need be, so that it leads from `at` away from `threat` (keeping to the same verge). */
export const runFrom = (route: RouteValue, at: Vec2.Vec2, threat: Vec2.Vec2): RouteValue => {
  const lane = laneOf(route.edge, route.forward)
  return lane.dx * (threat.x - at.x) + lane.dy * (threat.y - at.y) > 0 ? turnBack(route) : route
}

/**
 * Pedestrians: walk their lane along graph.walkEdges (random turns at nodes),
 * and run along it, away from a fast car, until `until`. Getting nowhere
 * (walls, parked cars, other people) they try the other verge, then turn back.
 * Knocked down, they slide.
 */
export const Pedestrians = Game.System(
  "Lunigiana/Pedestrians",
  {
    queries: {
      peds: Game.Query({
        selection: {
          pose: Game.Query.write(Pose),
          motion: Game.Query.write(Motion),
          route: Game.Query.write(Route),
          ped: Game.Query.write(Pedestrian),
          down: Game.Query.optional(Down),
        },
      }),
      vehicles: Game.Query({
        selection: { pose: Game.Query.read(Pose), motion: Game.Query.read(Motion) },
        with: [Vehicle],
      }),
    },
    resources: {
      rng: Game.System.writeResource(Rng),
      time: Game.System.thisTick(Game.System.readResource(Time)),
    },
  },
  ({ queries, resources }) => {
    const { step, dt } = resources.time.get()
    if (dt <= 0) return
    const random = Random.draw(resources.rng)
    const fast = queries.vehicles
      .each()
      .map(({ data }) => ({ ...data.pose.get(), ...data.motion.get() }))
      .filter((car) => car.vx * car.vx + car.vy * car.vy > SCARY_SPEED ** 2)
    for (const { data } of queries.peds.each()) {
      const pose = data.pose.get()
      const motion = data.motion.get()
      if (data.down.present) {
        const velocity = slide({ x: motion.vx, y: motion.vy }, dt)
        const moved = walkBy(pose, Vec2.scale(velocity, dt))
        const angle =
          Vec2.lengthSquared(velocity) > 0.01 ? Ops.atan2(velocity.y, velocity.x) : pose.angle
        data.pose.set({ x: moved.position.x, y: moved.position.y, angle })
        data.motion.set({ vx: velocity.x, vy: velocity.y, spin: 0 })
        continue
      }
      let mood = data.ped.get()
      let route = data.route.get()
      const scare =
        mood.mood === "walk"
          ? fast.find((car) => Vec2.distanceSquared(car, pose) < SCARY_RANGE ** 2)
          : undefined
      if (scare !== undefined) {
        mood = { mood: "flee", until: step + Clock.steps(FLEE_TIME), blocked: 0 }
        route = runFrom(route, pose, scare)
      } else if (mood.mood === "flee" && step >= mood.until)
        mood = { ...mood, mood: "walk", until: 0 }

      let lane = laneOf(route.edge, route.forward)
      let along = alongLane(lane, pose.x, pose.y)
      if (along >= lane.length - 0.3) {
        const next = nextWalkEdge(endNode(route.edge, route.forward), route.edge, random)
        route = { ...next, side: (route.side < 0 ? -1 : 1) * walkSide(roadOf(next.edge)) }
        lane = laneOf(route.edge, route.forward)
        along = alongLane(lane, pose.x, pose.y)
      }
      const target = lanePoint(lane, Math.min(lane.length, Math.max(0, along) + LOOK), route.side)
      const velocity = Vec2.scale(
        Vec2.normalizeOr(Vec2.subtract(target, pose), Vec2.zero),
        mood.mood === "flee" ? RUN : WALK,
      )

      // Motion is last step's real velocity (walls and Contacts' shoves included). Progress is measured along the lane:
      // crossing to the other verge counts, sliding sideways along a wall that blocks the way does not.
      const progress =
        (motion.vx * lane.dx + motion.vy * lane.dy) /
        Math.max(1e-9, velocity.x * lane.dx + velocity.y * lane.dy)
      const blocked = progress < PROGRESS ? mood.blocked + 1 : 0
      if (blocked > 0 && blocked % BLOCKED_STEPS === 0)
        route =
          (blocked / BLOCKED_STEPS) % 2 === 1 ? { ...route, side: -route.side } : turnBack(route)
      mood = { ...mood, blocked }

      const moved = walkBy(pose, Vec2.scale(velocity, dt))
      const real = Vec2.scale(Vec2.subtract(moved.position, pose), 1 / dt)
      const angle = Vec2.lengthSquared(real) > 0.01 ? Ops.atan2(real.y, real.x) : pose.angle
      data.pose.set({ x: moved.position.x, y: moved.position.y, angle })
      data.motion.set({ vx: real.x, vy: real.y, spin: 0 })
      data.route.set(route)
      data.ped.set(mood)
    }
  },
)
