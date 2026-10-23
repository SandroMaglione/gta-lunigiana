import { Clock } from "@typeonce/ritmo"
import { Ops, Random, Vec2 } from "@typeonce/ritmo-math"

import { forwardSpeed, wrapAngle } from "../body.ts"
import { GRAVITY, rigFor, RIGS } from "../chassis.ts"
import { type HandlingValue, REAL_HANDLING } from "../handling.ts"
import { graph } from "../map/index.ts"
import {
  allowsModel,
  alongLane,
  cruiseSpeed,
  distanceToEdge,
  edgeIndex,
  endNode,
  facesForward,
  type Lane,
  laneOf,
  lanePoint,
  laneSide,
  leadsToDeadEnd,
  nextTrafficEdge,
  roadOf,
  walkSide,
} from "../route.ts"
import {
  Autopilot,
  CarInput,
  Chassis,
  type ChassisValue,
  Dead,
  Driving,
  Game,
  Handling,
  Honk,
  Motion,
  Person,
  Pose,
  Rng,
  Route,
  STEP,
  Time,
  Traffic,
  Vehicle,
} from "../schema.ts"
import { PERSON_RADIUS } from "../tuning.ts"
import { VEHICLES, type VehicleModel } from "../vehicles.ts"
import { steerLimit } from "./physics.ts"

/** Look-ahead along the route: base metres plus seconds of speed. */
const LOOK_BASE = 6
const LOOK_TIME = 0.6
/** Braking cone: base metres plus seconds of speed ahead, half-width. */
const CONE_BASE = 8
const CONE_TIME = 1.2
const CONE_HALF_WIDTH = 1.8
/** Gap kept to whatever is ahead, m. */
const GAP = 2
/** Corner approach: slowest corner speed and the speed allowed per metre before the corner. */
const CORNER_MIN = 3
const CORNER_RAMP = 0.5
/** Below STUCK_SPEED (m/s) a car counts as stuck until it is faster than MOVING_SPEED again. */
const STUCK_SPEED = 1
const MOVING_SPEED = 2.5
/** Steps stuck before unsticking, and steps reversing then. */
const STUCK_STEPS = Clock.steps(Clock.duration(STEP, 3))
/** Waiting for a person ahead on the road counts as stuck only every this many steps (12 s instead of 3 s): they usually move on. */
const PERSON_PATIENCE = 4
const REVERSE_STEPS = Clock.steps(Clock.duration(STEP, 1.5))
/** Stuck steps after which the driver sounds the horn, once per stuck episode (half-way to unsticking). */
export const HONK_STEPS = Clock.steps(Clock.duration(STEP, 1.5))
/** Heading within this cosine of the lane counts as lined up with it. */
const LINED_UP = 0.7
/** Unstick attempts after which a car always turns round (dead end or not), and after which Populate gives up on it. */
const TURN_TRIES = 2
export const GIVE_UP_TRIES = 4
/**
 * AI drivers keep their sideways acceleration under this (m/s²), or under this share of what would
 * tip their vehicle over (the Ape, the laden truck): they slow for the curve they are steering.
 */
const COMFORT = 3.5
const COMFORT_TIP = 0.45
/**
 * Rolled sideways more than this share of its tipping angle (the Ape ≈ 14°, the laden truck ≈ 16°, a
 * Panda ≈ 26°), a wheel up a bank or the road falling away to one side, a driver brakes, and once
 * stopped holds the handbrake with the wheel straight, rather than tip over; stuck there, it backs off.
 */
const LEANING = 0.5
/** Speed backing up to get unstuck, m/s (negative: reverse). */
const REVERSE_SPEED = -3
/** Within this distance of its edge's end node a car moves on to the next edge, m. */
const ARRIVE = 4
/** Farther than this from its edge, a car finds the nearest road again, m. */
export const LOST = 12

const usable = (model: VehicleModel) =>
  edgeIndex(graph.trafficEdges.filter((e) => allowsModel(e, model)))
/** Per model, the traffic edges it may drive, for finding the road again. */
const usableByModel = {
  panda: usable("panda"),
  ape: usable("ape"),
  truck: usable("truck"),
  carabinieri: usable("carabinieri"),
} satisfies Record<VehicleModel, ReturnType<typeof edgeIndex>>

/**
 * The fastest an AI driver takes the curve it steers with `steer` at `speed` (m/s): its sideways acceleration within comfort. The
 * wheels turn as far as the physics turns them under `handling`; the comfort is the vehicle's real one.
 */
export const comfortSpeed = (
  model: VehicleModel,
  steer: number,
  speed: number,
  handling: HandlingValue = REAL_HANDLING,
): number => {
  const rig = RIGS[model],
    wheel = Math.abs(steer) * steerLimit(rigFor(model, handling), Math.abs(speed))
  return wheel < 1e-3
    ? Number.MAX_VALUE
    : Math.sqrt(
        (Math.min(COMFORT, COMFORT_TIP * rig.tipping * GRAVITY) * rig.wheelbase) / Ops.tan(wheel),
      )
}

/** Whether a vehicle rolls far enough over to fear tipping (a wheel up a bank, down a stream's edge). */
export const leans = (model: VehicleModel, chassis: Pick<ChassisValue, "roll">): boolean =>
  Math.abs(chassis.roll) > LEANING * Ops.atan(RIGS[model].tipping)

/** Lifted roads: a bridge deck or a tunnel. */
const lifted = (edge: number): boolean =>
  roadOf(edge).bridge === true || roadOf(edge).tunnel === true

/** Whether a car may turn round on `edge`: never on a bridge or in a tunnel, nor on an edge next to one (a circle there leaves the deck). */
export const roomToTurn = (edge: number): boolean =>
  !lifted(edge) &&
  [graph.edges[edge]!.a, graph.edges[edge]!.b].every((node) => !graph.adjacency[node]!.some(lifted))

/** Throttle (or brake) toward a wanted speed. */
const throttleFor = (want: number, speed: number): number =>
  Math.max(-1, Math.min(1, (want - speed) * 0.4))

/**
 * Past the lane's end, close to its end node (so a car circling a U-turn
 * still moves on), or nearer the next edge than this one (a corner cut short).
 */
const arrived = (
  lane: Lane,
  along: number,
  at: { readonly x: number; readonly y: number },
  edge: number,
  next: number,
): boolean => {
  const end = lanePoint(lane, lane.length, 0)
  return (
    along >= lane.length - 0.5 ||
    Vec2.distanceSquared(end, at) < ARRIVE ** 2 ||
    distanceToEdge(next, at.x, at.y) < distanceToEdge(edge, at.x, at.y)
  )
}

/**
 * AI drivers on graph.trafficEdges: keep right (Route.side), steer at a point
 * ahead along this edge and the next, pick the next edge at random at each
 * node, slow for sharp turns and for anything in a cone ahead, and back up
 * along the lane after standing still for 3 s (sometimes turning round, and
 * always from its second time on, dead end or not); waiting for a person
 * ahead on the carriageway counts four times slower. Half-way to backing up
 * it honks, once (a Honk event).
 */
export const TrafficAI = Game.System(
  "Lunigiana/TrafficAI",
  {
    queries: {
      cars: Game.Query({
        selection: {
          pose: Game.Query.read(Pose),
          motion: Game.Query.read(Motion),
          chassis: Game.Query.read(Chassis),
          vehicle: Game.Query.read(Vehicle),
          input: Game.Query.write(CarInput),
          route: Game.Query.write(Route),
          pilot: Game.Query.write(Autopilot),
        },
        with: [Traffic],
      }),
      vehicles: Game.Query({
        selection: { pose: Game.Query.read(Pose), vehicle: Game.Query.read(Vehicle) },
      }),
      // The dead are no one to wait for: a car nudges a body aside (Contacts) rather than queue behind it until it is gone.
      people: Game.Query({
        selection: { pose: Game.Query.read(Pose) },
        with: [Person],
        without: [Driving, Dead],
      }),
    },
    resources: {
      rng: Game.System.writeResource(Rng),
      time: Game.System.thisTick(Game.System.readResource(Time)),
      handling: Game.System.readResource(Handling),
    },
    events: { honk: Game.System.writeEvent(Honk) },
  },
  ({ queries, resources, events }) => {
    const { step } = resources.time.get(),
      handling = resources.handling.get()
    const random = Random.draw(resources.rng)
    const obstacles = [
      ...queries.vehicles.each().map(({ entity, data }) => ({
        id: entity.id,
        ...data.pose.get(),
        half: VEHICLES[data.vehicle.get().model].length / 2,
        person: false,
      })),
      ...queries.people.each().map(({ entity, data }) => ({
        id: entity.id,
        ...data.pose.get(),
        half: PERSON_RADIUS,
        person: true,
      })),
    ]
    for (const { entity, data } of queries.cars.each()) {
      const pose = data.pose.get()
      const { model } = data.vehicle.get()
      const spec = VEHICLES[model]
      const speed = forwardSpeed(data.motion.get(), pose.angle)
      let route = data.route.get()
      let pilot = data.pilot.get()
      if (distanceToEdge(route.edge, pose.x, pose.y) > LOST) {
        const edge = usableByModel[model].nearest(pose.x, pose.y)
        const forward = roadOf(edge).oneway === true || facesForward(edge, pose.angle)
        const after = nextTrafficEdge(endNode(edge, forward), edge, model, random)
        route = { edge, forward, side: laneSide({ edge, forward }, model) }
        pilot = { ...pilot, next: after.edge, nextForward: after.forward }
      }
      let lane = laneOf(route.edge, route.forward)
      let along = alongLane(lane, pose.x, pose.y)
      for (let hop = 0; hop < 2 && arrived(lane, along, pose, route.edge, pilot.next); hop++) {
        const after = nextTrafficEdge(
          endNode(pilot.next, pilot.nextForward),
          pilot.next,
          model,
          random,
        )
        route = {
          edge: pilot.next,
          forward: pilot.nextForward,
          side: laneSide({ edge: pilot.next, forward: pilot.nextForward }, model),
        }
        pilot = { ...pilot, next: after.edge, nextForward: after.forward }
        lane = laneOf(route.edge, route.forward)
        along = alongLane(lane, pose.x, pose.y)
      }
      const next = laneOf(pilot.next, pilot.nextForward)
      const ahead = Math.max(0, along) + LOOK_BASE + Math.max(0, speed) * LOOK_TIME
      const target =
        ahead <= lane.length
          ? lanePoint(lane, ahead, route.side)
          : lanePoint(
              next,
              Math.min(next.length, ahead - lane.length),
              laneSide({ edge: pilot.next, forward: pilot.nextForward }, model),
            )
      const error = wrapAngle(Ops.atan2(target.y - pose.y, target.x - pose.x) - pose.angle)
      const steer = Math.max(-1, Math.min(1, error * 2.5))

      if (step < pilot.reverseUntil) {
        // Backing up, the tail aims at a point behind on the lane (steering works mirrored in reverse).
        const behind = lanePoint(lane, along - LOOK_BASE, route.side)
        const tail = wrapAngle(
          Ops.atan2(behind.y - pose.y, behind.x - pose.x) - pose.angle - Math.PI,
        )
        data.input.set({
          throttle: throttleFor(REVERSE_SPEED, speed),
          steer: Math.max(-1, Math.min(1, -tail * 2.5)),
          handbrake: false,
        })
        data.route.set(route)
        data.pilot.set(pilot)
        continue
      }

      const cruise = cruiseSpeed(roadOf(route.edge))
      const sharp = (1 - (lane.dx * next.dx + lane.dy * next.dy)) / 2
      let want = Math.min(
        cruise,
        Math.max(CORNER_MIN, cruise * (1 - 1.2 * sharp)) +
          CORNER_RAMP * Math.max(0, lane.length - along),
      )
      // Pointing away from the target (turning round, a corner gone wide): corner speed, for the tightest circle.
      want = Math.min(want, CORNER_MIN + (cruise - CORNER_MIN) * Math.max(0, Ops.cos(error)))
      want = Math.min(want, comfortSpeed(model, steer, speed, handling))
      const fx = Ops.cos(pose.angle),
        fy = Ops.sin(pose.angle)
      const range = CONE_BASE + Math.max(0, speed) * CONE_TIME
      // The carriageway or its verge, where walkers keep (`walkSide`).
      const inWay = (edge: number, p: { readonly x: number; readonly y: number }) =>
        distanceToEdge(edge, p.x, p.y) <
        Math.max(roadOf(edge).w / 2, walkSide(roadOf(edge))) + PERSON_RADIUS
      const onRoad = (p: { readonly x: number; readonly y: number }) =>
        inWay(route.edge, p) || inWay(pilot.next, p)
      // Whether the nearest thing held back for is a person in the way (ahead of the bumper, on the carriageway or its verge), who moves on.
      let forPerson = false
      for (const other of obstacles) {
        if (other.id === entity.id) continue
        const rx = other.x - pose.x,
          ry = other.y - pose.y
        const front = rx * fx + ry * fy
        if (
          front <= 0 ||
          front > range + other.half ||
          Math.abs(ry * fx - rx * fy) >= CONE_HALF_WIDTH
        )
          continue
        const limit = Math.max(0, (front - spec.length / 2 - other.half - GAP) * 0.8)
        if (limit < want)
          [want, forPerson] = [limit, other.person && front > spec.length / 2 && onRoad(other)]
      }

      const holding = want < 0.5 && Math.abs(speed) < 0.5,
        slow = Math.abs(speed) < 0.5
      data.input.set(
        leans(model, data.chassis.get())
          ? { throttle: slow ? 0 : throttleFor(0, speed), steer: slow ? 0 : steer, handbrake: slow }
          : holding
            ? { throttle: 0, steer, handbrake: true }
            : { throttle: throttleFor(want, speed), steer, handbrake: false },
      )

      // Stopped (or grinding along a wall) counts up, waiting for a person in the way only every PERSON_PATIENCE steps; only real progress resets it.
      const counts = !forPerson || step % PERSON_PATIENCE === 0
      const stuck =
        Math.abs(speed) < STUCK_SPEED
          ? pilot.stuck + (counts ? 1 : 0)
          : Math.abs(speed) > MOVING_SPEED
            ? 0
            : pilot.stuck
      if (stuck >= HONK_STEPS && pilot.stuck < HONK_STEPS)
        events.honk.emit({ car: entity.id, model, x: pose.x, y: pose.y })
      if (stuck < STUCK_STEPS) pilot = { ...pilot, stuck }
      else {
        pilot = { ...pilot, stuck: 0, reverseUntil: step + REVERSE_STEPS, tries: pilot.tries + 1 }
        const back = { edge: route.edge, forward: !route.forward }
        // Turn round only when lined up with the route (mid-turn, backing up helps it round instead), and where there is room.
        const linedUp = lane.dx * fx + lane.dy * fy > LINED_UP
        // Trucks never do: they keep to loops of the network because they cannot.
        const turn =
          linedUp &&
          model !== "truck" &&
          roomToTurn(route.edge) &&
          (pilot.tries >= TURN_TRIES || (!leadsToDeadEnd(back, model) && random.next() < 0.5))
        if (roadOf(route.edge).oneway !== true && turn) {
          route = { ...route, forward: back.forward, side: laneSide(back, model) }
          const after = nextTrafficEdge(
            endNode(route.edge, route.forward),
            route.edge,
            model,
            random,
          )
          pilot = { ...pilot, next: after.edge, nextForward: after.forward }
        }
      }
      data.route.set(route)
      data.pilot.set(pilot)
    }
  },
)
