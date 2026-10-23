import assert from "node:assert/strict"
import { test } from "node:test"

import { groundZ } from "../../../sim/map/ground.ts"
import { surfaceAt } from "../../../sim/map/surface.ts"
import { CABIN, dbToGain, gainToDb, SPEED_OF_SOUND } from "../../acoustics.ts"
import type { Happening } from "../../types.ts"
import { HEIGHT, LEVELS, MOST_DB } from "../levels.ts"
import { away, car, MEADOW, person, rig, SOUTH, wallHit, WEST_FLANK, world } from "../testing.ts"

/** Wreck `id`, a Panda, blowing up at `at`, its centre of mass a vehicle's height over the ground. */
const blast = (at: { readonly x: number; readonly y: number }, id = 1): Happening => ({
  kind: "explosion",
  car: id,
  x: at.x,
  y: at.y,
  z: groundZ(at.x, at.y) + HEIGHT.vehicle,
})

test("a burning car's fire is held where it lies and its engine, horn and siren are dead; an intact car does not burn", () => {
  const director = rig()
  const wreck = car(1, "panda", away(MEADOW, 20), {
      damage: 1,
      running: false,
      rpm: 0,
      burning: true,
    }),
    intact = car(2, "panda", away(MEADOW, 25), { damage: 0.9 })
  const giulia = (damage: number, horn: boolean) =>
    director.hear(
      world(
        MEADOW,
        {
          vehicles: [
            wreck,
            intact,
            car(7, "carabinieri", MEADOW, {
              mine: true,
              damage,
              running: damage < 1,
              burning: damage >= 1,
            }),
          ],
          horn,
        },
        7,
      ),
    )
  giulia(0, true)
  assert.equal(director.held().has("siren:7"), true)
  giulia(1, false)
  const held = director.held()
  assert.deepEqual(
    ["fire:1", "engine:1", "fire:2", "engine:2", "fire:7", "engine:7", "siren:7"].map((key) =>
      held.has(key),
    ),
    [true, false, false, true, true, false, false],
  )
  assert.deepEqual(held.get("fire:1")?.sound, { kind: "fire" })
  // The listener's own burning car is heard through its cabin, like its horn.
  assert.equal(held.get("fire:7")!.at.cutoff, CABIN.carabinieri.cutoff)

  const panda = rig()
  panda.hear(
    world(
      MEADOW,
      {
        vehicles: [
          car(8, "panda", MEADOW, { mine: true, damage: 1, running: false, burning: true }),
        ],
        horn: true,
      },
      8,
    ),
  )
  assert.equal(panda.held().has("horn:8"), false, "a destroyed car's horn is dead")
})

test("at most two fires burn at once, the nearest", () => {
  const director = rig()
  director.hear(
    world(MEADOW, {
      vehicles: [30, 10, 40, 20].map((metres, i) =>
        car(i + 1, "panda", away(MEADOW, metres, SOUTH), {
          damage: 1,
          running: false,
          burning: true,
        }),
      ),
    }),
  )
  assert.deepEqual([...director.held().keys()].filter((key) => key.startsWith("fire:")).sort(), [
    "fire:2",
    "fire:4",
  ])
})

test("a wreck burns until it blows up: the blast plays once at once from its centre of mass, at its level, its debris on the ground under it, and the fire is out", () => {
  const director = rig(),
    at = away(MEADOW, 20, SOUTH)
  const wreck = (burning: boolean) =>
    car(1, "panda", at, { damage: 1, running: false, rpm: 0, burning })
  director.hear(world(MEADOW, { vehicles: [wreck(true)] }))
  assert.equal(director.held().has("fire:1"), true)
  director.hear(world(MEADOW, { vehicles: [wreck(false)], happenings: [blast(at)] }))
  const [played, ...more] = director.take("explosion")
  assert.ok(
    played !== undefined && more.length === 0 && played.delay === 0,
    JSON.stringify(director.plays),
  )
  assert.deepEqual(played.sound, { kind: "explosion", surface: surfaceAt(at.x, at.y) })
  assert.equal(director.held().has("fire:1"), false, "the charred shell burns no more")
  // A crash from the same point, as far away: the blast plays its level's difference over it, compressed by the mix's 0.6.
  const crash = rig()
  crash.hear(world(MEADOW, { vehicles: [wreck(false)], happenings: [wallHit(at, 15)] }))
  const [hit] = crash.take("crash")
  assert.ok(
    Math.abs(
      gainToDb(played.at.gain / hit!.at.gain) - 0.6 * (LEVELS.explosion.db - LEVELS.crash.db),
    ) < 1e-6,
    `${gainToDb(played.at.gain / hit!.at.gain)} dB`,
  )
})

test("thrown out by their own car's blast, the listener hears the blast and no door", () => {
  const director = rig()
  director.hear(
    world(
      MEADOW,
      {
        vehicles: [
          car(1, "panda", MEADOW, { mine: true, damage: 1, running: false, rpm: 0, burning: true }),
        ],
      },
      1,
    ),
  )
  director.take("door")
  const thrown = person(9, away(MEADOW, 1.5), { player: true, down: true })
  director.hear(
    world(away(MEADOW, 1.5), {
      vehicles: [car(1, "panda", MEADOW, { damage: 1, running: false, rpm: 0 })],
      people: [thrown],
      happenings: [blast(MEADOW)],
    }),
  )
  assert.equal(director.take("door").length, 0, "no getting-out door")
  assert.equal(director.take("explosion").length, 1)
})

test("a blast 300 m away arrives after its travel time; under a rock face it echoes, later and fainter; 5 m away it plays at its cap", () => {
  const heard = (spot: { readonly x: number; readonly y: number }, metres: number) => {
    const director = rig()
    director.hear(world(spot, { happenings: [blast(away(spot, metres, SOUTH))] }))
    return director.take("explosion")
  }
  const [far] = heard(MEADOW, 300)
  assert.ok(
    far !== undefined && Math.abs(far.delay - 300 / SPEED_OF_SOUND) < 0.02,
    `${far?.delay} s`,
  )
  const [direct, ...echoes] = heard(WEST_FLANK, 10)
  assert.ok(
    echoes.length > 0 &&
      echoes.every(
        (e) => e.delay > direct!.delay + 0.1 && e.at.gain < direct!.at.gain / 2 && e.at.wet === 0,
      ),
    `${echoes.length} echoes`,
  )
  const [near] = heard(MEADOW, 5)
  assert.equal(near?.at.gain, dbToGain(MOST_DB.explosion))
})
