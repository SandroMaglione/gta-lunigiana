import { Ops, Random, Vec2 } from "@typeonce/ritmo-math"

import { carClear } from "../body.ts"
import { settle, uprightness } from "../chassis.ts"
import { MAP, roadClassOf, type Spawn } from "../map/index.ts"
import { roadOf, trafficIndex } from "../route.ts"
import { CarInput, Game, Motion, Person, Player, Pose, PrevPose, Rng, Vehicle } from "../schema.ts"
import { parkedCar, randomColor } from "../spawning.ts"
import type { VehicleModel } from "../vehicles.ts"

/**
 * Parked cars at setup, Carabinieri included: this many of the map's parked spots, picked at random so they
 * spread over the villages as the spots do (every vehicle costs a little in Contacts and TrafficAI each step).
 */
export const PARKED = 200
const TRUCKS = 2
const CARABINIERI_BLUE = 0x1d2b4f

/**
 * A vehicle that would stand tilted more than this (rad, 15°) on a spot is not parked there: the 4 m terrain puts some verges on a
 * bank. A spot too steep for a Panda is skipped; one too steep for the Ape or the truck the dice gave it gets a Panda instead.
 */
const LEVEL = 0.26
const level = (model: VehicleModel, spot: Spawn): boolean => uprightness(settle(model, spot)) > Ops.cos(LEVEL)
const spots = MAP.spawns.parked.filter((s) => level("panda", s))
const police = MAP.pois.find((p) => p.kind === "amenity=police")
const byPolice = police === undefined ? [] : spots
  .filter((s) => level("carabinieri", s))
  .sort((a, b) => Vec2.distanceSquared(a, police) - Vec2.distanceSquared(b, police))
  .slice(0, 2)
const civilian = spots.filter((s) => !byPolice.includes(s))
const parkedCount = Math.min(PARKED, spots.length)
const onTertiary = (s: Vec2.Vec2) => roadClassOf(roadOf(trafficIndex.nearest(s.x, s.y))) === "tertiary"

/** Setup: the player at the map spawn, the Carabinieri at their station, and parked cars picked with the world's Rng. */
export const SpawnWorld = Game.System("Lunigiana/SpawnWorld", {
  resources: { rng: Game.System.writeResource(Rng) },
  commands: Game.System.commands(Game.System.spawns(Player, Person, Pose, PrevPose, Motion, Vehicle, CarInput))
}, ({ resources, commands }) => {
  const random = Random.draw(resources.rng)
  const start = MAP.spawns.player
  commands.spawn(Game.Command.spawn(
    [Player, {}],
    [Pose, start],
    [PrevPose, start],
    [Motion, { vx: 0, vy: 0, spin: 0 }],
    [Person, { skin: 0xe7b896, hair: 0x2b1d14, shirt: 0xf0c93c, pants: 0x1d2b4f, age: "adult", female: false, outfit: "trousers", hairdo: "short", height: 1.78 }]
  ))
  for (const spot of byPolice) commands.spawn(parkedCar("carabinieri", CARABINIERI_BLUE, spot))
  let trucks = 0
  for (const spot of random.shuffle(civilian).slice(0, parkedCount - byPolice.length)) {
    const roll = random.next()
    const truck = trucks < TRUCKS && roll < 0.1 && onTertiary(spot) && carClear("truck", spot) && level("truck", spot)
    if (truck) trucks++
    const model = truck ? "truck" : roll >= 0.8 && level("ape", spot) ? "ape" : "panda"
    commands.spawn(parkedCar(model, randomColor(random), spot))
  }
})
