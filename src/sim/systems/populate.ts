import { Clock } from "@typeonce/ritmo"
import { Ops, Random, Vec2 } from "@typeonce/ritmo-math"

import { carClear, clearOf, wallsAlong } from "../body.ts"
import { pointInRing } from "../collide.ts"
import { destroyed } from "../damage.ts"
import { buildingBoxes, buildingsIn, graph, MAP } from "../map/index.ts"
import {
  allowsModel,
  cruiseSpeed,
  distanceToEdge,
  edgeIndex,
  endNode,
  laneOf,
  lanePoint,
  laneSide,
  leadsToDeadEnd,
  nextTrafficEdge,
  roadOf,
  trafficIndex,
  walkSide,
} from "../route.ts"
import {
  Autopilot,
  CarInput,
  Damage,
  Dead,
  Driving,
  Game,
  Motion,
  Pedestrian,
  Person,
  Player,
  Pose,
  PrevPose,
  Rng,
  Route,
  STEP,
  Time,
  Traffic,
  Vehicle,
} from "../schema.ts"
import { pedestrian, randomColor, randomLook, trafficCar } from "../spawning.ts"
import { PERSON_RADIUS } from "../tuning.ts"
import type { VehicleModel } from "../vehicles.ts"
import { VIEW_REACH } from "../view.ts"
import { GIVE_UP_STEPS } from "./pedestrians.ts"
import { GIVE_UP_TRIES, LOST } from "./traffic.ts"

const PERIOD = Clock.duration(STEP, 0.5)
/**
 * Traffic: at most this many alive (all within `despawn` m of the player), spawned `spawn` m away, `spacing` m apart,
 * despawned beyond `despawn` m (or beyond `unseen` m, out of view, when lost off the road or given up unsticking).
 */
export const TRAFFIC = {
  max: 10,
  spawn: [110, 220],
  spacing: 15,
  despawn: 320,
  unseen: VIEW_REACH,
  perTick: 2,
} as const
/** Pedestrians: the same rules on walk edges, spawned out of view; one blocked for good goes once beyond `unseen` m. */
export const PEDESTRIANS = {
  max: 22,
  spawn: [VIEW_REACH, 120],
  despawn: 140,
  unseen: VIEW_REACH,
  perTick: 3,
} as const
/** Tries per spawn slot before giving up until the next period. */
const TRIES = 4

/** Pedestrians only spawn on walk edges with a building within this many metres of their midpoint: the villages and hamlets, not the woods between them. */
export const PEOPLED = 50
/** Whether (x, y) is inside a building (not in a courtyard): verges run into houses where they crowd the road. */
const indoors = (x: number, y: number): boolean => {
  let inside = false
  buildingsIn(x, y, x, y, (i) => {
    const { outer, holes } = MAP.buildings[i]!
    inside ||= pointInRing(x, y, outer) && !(holes ?? []).some((h) => pointInRing(x, y, h))
  })
  return inside
}
const peopled = edgeIndex(
  graph.walkEdges.filter((e) => {
    const lane = laneOf(e, true),
      m = lanePoint(lane, lane.length / 2, 0)
    let near = false
    buildingsIn(m.x - PEOPLED, m.y - PEOPLED, m.x + PEOPLED, m.y + PEOPLED, (i) => {
      const [x0, y0, x1, y1] = buildingBoxes[i]!
      const dx = Math.max(x0 - m.x, 0, m.x - x1),
        dy = Math.max(y0 - m.y, 0, m.y - y1)
      near ||= dx * dx + dy * dy <= PEOPLED * PEOPLED
    })
    return near
  }),
)

/** A random traffic model for `edge` (panda 75%, ape 15%, truck 10%), falling back to smaller ones that fit; undefined if none does. */
const pickModel = (random: Random.Random, edge: number): VehicleModel | undefined => {
  const roll = random.next()
  const choices: ReadonlyArray<VehicleModel> = [
    roll < 0.75 ? "panda" : roll < 0.9 ? "ape" : "truck",
    "panda",
    "ape",
  ]
  return choices.find((model) => allowsModel(edge, model))
}

/**
 * Every half second, keeps the world around the player alive: traffic on
 * random traffic edges and pedestrians on walk edges near buildings spawn
 * out of view and despawn once far behind, or out of sight when stuck for
 * good (never the player's own car); destroyed vehicles and the dead go once
 * out of sight too.
 */
export const Populate = Game.System(
  "Lunigiana/Populate",
  {
    queries: {
      player: Game.Query({
        selection: { pose: Game.Query.read(Pose), driving: Game.Query.optional(Driving) },
        with: [Player],
      }),
      traffic: Game.Query({
        selection: {
          pose: Game.Query.read(Pose),
          route: Game.Query.read(Route),
          pilot: Game.Query.read(Autopilot),
        },
        with: [Traffic],
      }),
      vehicles: Game.Query({ selection: { pose: Game.Query.read(Pose) }, with: [Vehicle] }),
      wrecks: Game.Query({
        selection: { pose: Game.Query.read(Pose), damage: Game.Query.read(Damage) },
        with: [Vehicle],
        without: [Traffic],
      }),
      peds: Game.Query({
        selection: {
          pose: Game.Query.read(Pose),
          ped: Game.Query.read(Pedestrian),
          dead: Game.Query.optional(Dead),
        },
      }),
    },
    resources: {
      rng: Game.System.writeResource(Rng),
      time: Game.System.thisTick(Game.System.readResource(Time)),
    },
    commands: Game.System.commands(
      Game.System.spawns(
        Vehicle,
        Pose,
        PrevPose,
        Motion,
        CarInput,
        Traffic,
        Route,
        Autopilot,
        Pedestrian,
        Person,
      ),
      Game.System.despawns(Traffic, Vehicle, Pedestrian),
    ),
  },
  ({ queries, resources, commands }) => {
    if (!Clock.every(resources.time.get(), PERIOD)) return
    const found = queries.player.singleOptional()
    if (!found.ok || found.value === undefined) return
    const at = found.value.data.pose.get()
    const driving = found.value.data.driving.value()
    const mine = driving === undefined ? undefined : Game.Entity.id(driving.vehicle)
    const far = (p: Vec2.Vec2, range: number) => Vec2.distanceSquared(p, at) > range * range
    const random = Random.draw(resources.rng)

    let cars = 0
    for (const { entity, data } of queries.traffic.each()) {
      const pose = data.pose.get()
      // A car wedged off the road or stuck for good goes too, once nobody can see it go.
      const lost =
        distanceToEdge(data.route.get().edge, pose.x, pose.y) > LOST ||
        data.pilot.get().tries >= GIVE_UP_TRIES
      const wrecked = lost && far(pose, TRAFFIC.unseen)
      if ((far(pose, TRAFFIC.despawn) || wrecked) && entity.id !== mine) commands.despawn(entity)
      else cars++
    }
    // A wreck, burning or a charred shell, stays where it stopped until nobody can see it go.
    for (const { entity, data } of queries.wrecks.each()) {
      if (destroyed(data.damage.get().amount) && far(data.pose.get(), TRAFFIC.unseen))
        commands.despawn(entity)
    }
    const taken = queries.vehicles.each().map(({ data }) => data.pose.get())
    const roads = trafficIndex.around(at.x, at.y, TRAFFIC.spawn)
    for (let slot = 0; slot < TRAFFIC.perTick && cars < TRAFFIC.max; slot++)
      for (let k = 0; k < TRIES; k++) {
        const edge = random.pick(roads)
        if (edge === undefined) break
        const model = pickModel(random, edge)
        if (model === undefined) continue
        const oneway = roadOf(edge).oneway === true
        const coin = oneway || random.next() < 0.5
        // Head out of dead-end spurs rather than into them.
        const forward = oneway || !leadsToDeadEnd({ edge, forward: coin }, model) ? coin : !coin
        const lane = laneOf(edge, forward)
        const side = laneSide({ edge, forward }, model)
        const pose = {
          ...lanePoint(lane, lane.length / 2, side),
          angle: Ops.atan2(lane.dy, lane.dx),
        }
        if (
          taken.some((p) => Vec2.distanceSquared(p, pose) < TRAFFIC.spacing ** 2) ||
          !carClear(model, pose)
        )
          continue
        const next = nextTrafficEdge(endNode(edge, forward), edge, model, random)
        commands.spawn(
          trafficCar(
            model,
            randomColor(random),
            pose,
            cruiseSpeed(roadOf(edge)) * 0.6,
            { edge, forward, side },
            next,
          ),
        )
        taken.push(pose)
        cars++
        break
      }

    let people = 0
    for (const { entity, data } of queries.peds.each()) {
      const pose = data.pose.get()
      const stranded = far(pose, PEDESTRIANS.unseen) && data.ped.get().blocked > GIVE_UP_STEPS
      // A body lies where it fell until nobody can see it go, and walks no one's share of the pavements.
      if (
        far(pose, PEDESTRIANS.despawn) ||
        stranded ||
        (data.dead.present && far(pose, PEDESTRIANS.unseen))
      )
        commands.despawn(entity)
      else if (!data.dead.present) people++
    }
    const paths = peopled.around(at.x, at.y, PEDESTRIANS.spawn)
    for (let slot = 0; slot < PEDESTRIANS.perTick && people < PEDESTRIANS.max; slot++)
      for (let k = 0; k < TRIES; k++) {
        const edge = random.pick(paths)
        if (edge === undefined) break
        const forward = random.next() < 0.5
        const lane = laneOf(edge, forward)
        const side = walkSide(roadOf(edge)) * (random.next() < 0.5 ? 1 : -1)
        const spot = lanePoint(lane, random.range(0, lane.length), side)
        // The edge's midpoint is in the band, but the spot may not be.
        if (!far(spot, PEDESTRIANS.spawn[0]) || far(spot, PEDESTRIANS.spawn[1])) continue
        if (
          indoors(spot.x, spot.y) ||
          !clearOf(wallsAlong("walk", spot.x, spot.y, 0, 0, 1), spot.x, spot.y, PERSON_RADIUS)
        )
          continue
        commands.spawn(
          pedestrian(
            randomLook(random),
            { ...spot, angle: Ops.atan2(lane.dy, lane.dx) },
            { edge, forward, side },
            { mood: "walk", until: 0 },
          ),
        )
        people++
        break
      }
  },
)
