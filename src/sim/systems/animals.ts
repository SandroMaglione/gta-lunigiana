import { Clock } from "@typeonce/ritmo"
import { Ops, Random, Vec2 } from "@typeonce/ritmo-math"

import { walkBy } from "../body.ts"
import { FAUNA } from "../fauna.ts"
import { grazing, indoors, openGround } from "../population/farms.ts"
import {
  Animal,
  Cry,
  Dead,
  Down,
  Driving,
  type Feeling,
  Follows,
  Game,
  Honk,
  Impact,
  Motion,
  Pedestrian,
  Person,
  Player,
  Pose,
  type PoseValue,
  PrevPose,
  Rng,
  Roam,
  type RoamValue,
  Route,
  type Species,
  STEP,
  Time,
  Vehicle,
} from "../schema.ts"
import { slide } from "./foot.ts"
import { followVelocity, placeBeside } from "./pedestrians.ts"

/** How long each species stands between walks, s (TUNED): a cat sits, a dog sniffs about, a cow grazes, a pig roots. */
const IDLE = { cat: [4, 20], dog: [3, 12], cow: [8, 40], pig: [4, 15] } as const satisfies Record<
  Species,
  readonly [number, number]
>
/** How long a scared animal runs, s; scared again while running, it runs at least `FLEE[0]` s more. */
const FLEE = [2, 5] as const
/**
 * What scares each species into running (TUNED; 0 is never): a vehicle faster than `speed` m/s within `car` m, a person
 * within `person` m (only one on the move for a cat), a horn within `horn` m, a crash or a struck body within `crash` m (`Startle`).
 */
const FEARS = {
  cat: { speed: 3, car: 8, person: 2.5, horn: 0, crash: 20 },
  dog: { speed: 8, car: 6, person: 0, horn: 0, crash: 0 },
  cow: { speed: 8, car: 10, person: 0, horn: 15, crash: 0 },
  pig: { speed: 5, car: 8, person: 3, horn: 0, crash: 20 },
} as const satisfies Record<
  Species,
  {
    readonly speed: number
    readonly car: number
    readonly person: number
    readonly horn: number
    readonly crash: number
  }
>
/** A scared animal cries out (the audio voices it) this often: a cat's hiss, a dog's yelp, a cow's moo, a pig's squeal (TUNED). */
const CRIES = {
  cat: { feeling: "fright", chance: 0.5 },
  dog: { feeling: "fright", chance: 0.3 },
  cow: { feeling: "surprise", chance: 0.5 },
  pig: { feeling: "fright", chance: 0.8 },
} as const satisfies Record<Species, { readonly feeling: Feeling; readonly chance: number }>
/** A person faster than this is on the move, m/s. */
const MOVING = 0.3
/** A vehicle hitting a wall, a car or the ground at this closing speed or more is a crash, m/s (TUNED). */
const CRASH_SPEED = 4
/**
 * A free dog barks (TUNED): at the player on foot within `player` m (`rate` times a second on average), at a pedestrian
 * coming within `person` m (`personChance` of them) or a vehicle faster than `vehicleSpeed` m/s coming within `vehicle` m
 * (`vehicleChance`); then it stands facing them for `hold` s, so it barks at most every `hold` s. A dog lying about
 * (idle) does not bother.
 */
const BARK = {
  player: 12,
  rate: 1,
  person: 6,
  personChance: 0.3,
  vehicle: 10,
  vehicleSpeed: 2,
  vehicleChance: 0.4,
  hold: 8,
} as const
/** A walking animal this close to its target has arrived, m. */
const ARRIVED = 0.3
/** Making less than this share of its walking speed counts as blocked; blocked this long, it picks another point. */
const PROGRESS = 0.5
const BLOCKED = Clock.duration(STEP, 1)
/** Points tried for each walk before standing a while longer. */
const TRIES = 4
/** A dog on a lead within this distance of its place by a standing walker stands too, m. */
const NEAR = 0.15
/** A dog whose owner was killed lies by the body this long before it wanders, s (TUNED). */
const MOURN = 60

/** `seconds` as whole steps. */
const stepsOf = (seconds: number): number => Math.round(seconds * STEP.hz)
/** The step a rest begun at `step` ends at: a random length in the species' `IDLE` range. */
const restUntil = (species: Species, step: number, random: Random.Random): number =>
  step + stepsOf(random.range(IDLE[species][0], IDLE[species][1]))

/** Where a species may walk to: herds keep to the grass, pigs to open ground, cats and dogs anywhere outdoors. */
const walkable = (species: Species, x: number, y: number): boolean =>
  species === "cow" ? grazing(x, y) : species === "pig" ? openGround(x, y) : !indoors(x, y)

/** A moving vehicle: where it is and its velocity. */
interface Car {
  readonly x: number
  readonly y: number
  readonly vx: number
  readonly vy: number
  readonly speed: number
}
/** A person on their feet: where they are, where they were at the start of the step, and their speed. */
interface Folk {
  readonly x: number
  readonly y: number
  readonly px: number
  readonly py: number
  readonly speed: number
  readonly player: boolean
}

/**
 * The point to run from to get out of `car`'s way: beside the animal on the car's path ahead (running from it is running
 * off the path), or the car itself once it has passed; a side picked at random when the animal stands right on the path.
 */
const pathPoint = (car: Car, at: Vec2.Vec2, random: Random.Random): Vec2.Vec2 => {
  const ux = car.vx / car.speed,
    uy = car.vy / car.speed
  const along = (at.x - car.x) * ux + (at.y - car.y) * uy
  if (along <= 0) return car
  const off = (at.x - car.x) * -uy + (at.y - car.y) * ux
  const nudge = Math.abs(off) < 0.2 ? (random.next() < 0.5 ? -0.5 : 0.5) : 0
  return { x: car.x + ux * along + uy * nudge, y: car.y + uy * along - ux * nudge }
}

/**
 * Animals: each species idles, then walks to a random point near its home, and runs from what scares it (crying out
 * now and then); free dogs bark at strangers. A dog on a lead keeps its place by its walker and goes free (staying put)
 * when the walker is gone, down or dead. Down and dead animals slide to a stop.
 */
export const Animals = Game.System(
  "Lunigiana/Animals",
  {
    queries: {
      animals: Game.Query({
        selection: {
          pose: Game.Query.write(Pose),
          motion: Game.Query.write(Motion),
          roam: Game.Query.write(Roam),
          animal: Game.Query.read(Animal),
          follows: Game.Query.optional(Follows),
          down: Game.Query.optional(Down),
          dead: Game.Query.optional(Dead),
        },
      }),
      leaders: Game.Query({
        selection: {
          pose: Game.Query.read(Pose),
          motion: Game.Query.read(Motion),
          ped: Game.Query.read(Pedestrian),
          route: Game.Query.read(Route),
          down: Game.Query.optional(Down),
          dead: Game.Query.optional(Dead),
        },
      }),
      people: Game.Query({
        selection: {
          pose: Game.Query.read(Pose),
          prev: Game.Query.read(PrevPose),
          motion: Game.Query.read(Motion),
          player: Game.Query.optional(Player),
          down: Game.Query.optional(Down),
          dead: Game.Query.optional(Dead),
        },
        with: [Person],
        without: [Driving],
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
    events: { honks: Game.System.readEvent(Honk), cries: Game.System.writeEvent(Cry) },
    commands: Game.System.commands(Game.System.removes(Follows)),
  },
  ({ queries, resources, events, commands }) => {
    const { step, dt } = resources.time.get()
    if (dt <= 0) return
    const random = Random.draw(resources.rng)
    // Vehicles are where last step's physics left them; parked ones scare nobody.
    const cars: ReadonlyArray<Car> = queries.vehicles.each().flatMap(({ data }) => {
      const { x, y } = data.pose.get(),
        { vx, vy } = data.motion.get(),
        speed = Math.sqrt(vx * vx + vy * vy)
      return speed > 1 ? [{ x, y, vx, vy, speed }] : []
    })
    const folks: ReadonlyArray<Folk> = queries.people.each().flatMap(({ data }) => {
      if (data.down.present || data.dead.present) return []
      const { x, y } = data.pose.get(),
        prev = data.prev.get(),
        { vx, vy } = data.motion.get()
      return [
        {
          x,
          y,
          px: prev.x,
          py: prev.y,
          speed: Math.sqrt(vx * vx + vy * vy),
          player: data.player.present,
        },
      ]
    })
    const honks = events.honks.all()
    const within = (p: Vec2.Vec2, q: Vec2.Vec2, r: number) => Vec2.distanceSquared(p, q) <= r * r

    for (const { entity, data } of queries.animals.each()) {
      const pose = data.pose.get(),
        motion = data.motion.get(),
        { species, size } = data.animal.get(),
        fauna = FAUNA[species],
        r = fauna.radius * size
      const place = (velocity: Vec2.Vec2, facing?: Vec2.Vec2) => {
        const moved = walkBy(pose, Vec2.scale(velocity, dt), r)
        const real = Vec2.scale(Vec2.subtract(moved.position, pose), 1 / dt)
        const look = facing ?? (Vec2.lengthSquared(real) > 0.01 ? real : undefined)
        data.pose.set({
          x: moved.position.x,
          y: moved.position.y,
          angle: look === undefined ? pose.angle : Ops.atan2(look.y, look.x),
        })
        data.motion.set({ vx: real.x, vy: real.y, spin: 0 })
        return real
      }
      if (data.down.present || data.dead.present) {
        const velocity = slide({ x: motion.vx, y: motion.vy }, dt)
        const moved = walkBy(pose, Vec2.scale(velocity, dt), r)
        data.pose.set({ x: moved.position.x, y: moved.position.y, angle: pose.angle })
        data.motion.set({ vx: velocity.x, vy: velocity.y, spin: 0 })
        continue
      }

      const follows = data.follows.value()
      if (follows !== undefined) {
        const found = queries.leaders.getHandle(follows.leader)
        const leader = found.ok ? found.value.data : undefined
        // A leader on the ground, knocked down or dead (the dead are down too), lets go of the lead.
        if (leader === undefined || leader.down.present) {
          // Let go: it stays where it is, or lies by its owner's body for a while.
          commands.remove(entity, Follows)
          const body = leader?.dead.present === true ? leader.pose.get() : undefined
          const home = body ?? pose
          data.roam.set({
            mood: "idle",
            until: body === undefined ? restUntil(species, step, random) : step + stepsOf(MOURN),
            hx: home.x,
            hy: home.y,
            tx: home.x,
            ty: home.y,
          })
          place(Vec2.zero)
          continue
        }
        const at = leader.pose.get(),
          { vx, vy } = leader.motion.get(),
          spot = placeBeside(at, follows.side, follows.back)
        const still = vx * vx + vy * vy < 0.01 && Vec2.distanceSquared(spot, pose) < NEAR * NEAR
        const velocity = still
          ? Vec2.zero
          : followVelocity(pose, spot, at, { x: vx, y: vy }, fauna.run, leader.route.get())
        const real = place(
          velocity,
          still ? { x: Ops.cos(at.angle), y: Ops.sin(at.angle) } : undefined,
        )
        const mood =
          leader.ped.get().mood === "flee"
            ? "flee"
            : Vec2.lengthSquared(real) > 0.01
              ? "walk"
              : "idle"
        data.roam.set({ mood, until: step, hx: pose.x, hy: pose.y, tx: spot.x, ty: spot.y })
        continue
      }

      let roam: RoamValue = data.roam.get()
      let facing: Vec2.Vec2 | undefined
      const cry = (feeling: Feeling) =>
        events.cries.emit({ who: entity.id, x: pose.x, y: pose.y, feeling })
      const threat = scare(species, pose, cars, folks, honks, random)
      if (threat !== undefined) roam = fright(roam, species, threat, step, random, cry)
      else if (species === "dog" && (roam.mood === "walk" || step >= roam.until)) {
        const coming = (f: Folk, r: number) =>
          within(f, pose, r) && !within({ x: f.px, y: f.py }, pose, r)
        const stranger =
          folks.find(
            (f) => f.player && within(f, pose, BARK.player) && random.next() < BARK.rate * dt,
          ) ??
          folks.find(
            (f) =>
              !f.player &&
              f.speed > MOVING &&
              coming(f, BARK.person) &&
              random.next() < BARK.personChance,
          ) ??
          cars.find(
            (car) =>
              car.speed > BARK.vehicleSpeed &&
              within(car, pose, BARK.vehicle) &&
              !within({ x: car.x - car.vx * dt, y: car.y - car.vy * dt }, pose, BARK.vehicle) &&
              random.next() < BARK.vehicleChance,
          )
        if (stranger !== undefined) {
          cry("anger")
          roam = {
            ...roam,
            mood: "idle",
            until: step + stepsOf(BARK.hold),
            tx: stranger.x,
            ty: stranger.y,
          }
          facing = Vec2.subtract(stranger, pose)
        }
      }

      if (roam.mood === "flee" && step >= roam.until)
        roam = { ...roam, mood: "idle", until: restUntil(species, step, random) }
      const arrived = roam.mood === "walk" && within({ x: roam.tx, y: roam.ty }, pose, ARRIVED)
      if (arrived) roam = { ...roam, mood: "idle", until: restUntil(species, step, random) }
      else if (roam.mood !== "flee" && step >= roam.until)
        roam = wander(roam, species, pose, step, random)

      const speed = roam.mood === "flee" ? fauna.run : roam.mood === "walk" ? fauna.walk : 0
      const away =
        roam.mood === "flee"
          ? Vec2.subtract(pose, { x: roam.tx, y: roam.ty })
          : Vec2.subtract({ x: roam.tx, y: roam.ty }, pose)
      const heading = Vec2.normalizeOr(away, { x: Ops.cos(pose.angle), y: Ops.sin(pose.angle) })
      const real = place(Vec2.scale(heading, speed), facing)
      // Blocked on a walk: give it a second, then pick another point.
      if (roam.mood === "walk" && real.x * heading.x + real.y * heading.y < PROGRESS * speed)
        roam = { ...roam, until: Math.min(roam.until, step + Clock.steps(BLOCKED)) }
      data.roam.set(roam)
    }
  },
)

/** The walk after a rest: to a point within its home range it may stand on, or another rest when none is found. */
const wander = (
  roam: RoamValue,
  species: Species,
  at: PoseValue,
  step: number,
  random: Random.Random,
): RoamValue => {
  const { home, walk } = FAUNA[species]
  for (let k = 0; k < TRIES; k++) {
    const r = home * Math.sqrt(random.next()),
      a = random.range(0, 2 * Math.PI)
    const x = roam.hx + r * Ops.cos(a),
      y = roam.hy + r * Ops.sin(a)
    if (!walkable(species, x, y)) continue
    // As long as the walk should take, and a little more: it gives up on a point it cannot reach.
    return {
      ...roam,
      mood: "walk",
      until: step + stepsOf(Vec2.distance(at, { x, y }) / walk + 2),
      tx: x,
      ty: y,
    }
  }
  return { ...roam, mood: "idle", until: restUntil(species, step, random) }
}

/** Whether `p` is within `r` m of `at`; never when `r` is 0 (the species does not fear it). */
const near = (p: Vec2.Vec2, at: Vec2.Vec2, r: number) =>
  r > 0 && Vec2.distanceSquared(p, at) <= r * r

/** What `species` at `at` runs from this step, if anything: the point to run away from. */
const scare = (
  species: Species,
  at: Vec2.Vec2,
  cars: ReadonlyArray<Car>,
  folks: ReadonlyArray<Folk>,
  honks: ReadonlyArray<{ readonly x: number; readonly y: number }>,
  random: Random.Random,
): Vec2.Vec2 | undefined => {
  const fear = FEARS[species]
  const car = cars.find((c) => c.speed > fear.speed && near(c, at, fear.car))
  if (car !== undefined) return pathPoint(car, at, random)
  return (
    folks.find((f) => near(f, at, fear.person) && (species !== "cat" || f.speed > MOVING)) ??
    honks.find((h) => near(h, at, fear.horn))
  )
}

/**
 * `roam` running from `threat`: a fresh fright (crying out now and then) runs FLEE s, one already running runs at least
 * `FLEE[0]` s more.
 */
const fright = (
  roam: RoamValue,
  species: Species,
  threat: Vec2.Vec2,
  step: number,
  random: Random.Random,
  cry: (feeling: Feeling) => void,
): RoamValue => {
  if (roam.mood === "flee")
    return {
      ...roam,
      until: Math.max(roam.until, step + stepsOf(FLEE[0])),
      tx: threat.x,
      ty: threat.y,
    }
  if (random.next() < CRIES[species].chance) cry(CRIES[species].feeling)
  return {
    ...roam,
    mood: "flee",
    until: step + stepsOf(random.range(FLEE[0], FLEE[1])),
    tx: threat.x,
    ty: threat.y,
  }
}

/**
 * Cats and pigs run from a crash or a body struck within `FEARS[species].crash` m, in the step it happens: scheduled after
 * Contacts, it reads this step's Impact events, which a save does not keep (read a step later, a restored game would miss them).
 */
export const Startle = Game.System(
  "Lunigiana/Startle",
  {
    queries: {
      animals: Game.Query({
        selection: {
          pose: Game.Query.read(Pose),
          roam: Game.Query.write(Roam),
          animal: Game.Query.read(Animal),
        },
        without: [Follows, Down, Dead],
      }),
    },
    resources: {
      rng: Game.System.writeResource(Rng),
      time: Game.System.thisTick(Game.System.readResource(Time)),
    },
    events: {
      impacts: Game.System.thisTick(Game.System.readEvent(Impact)),
      cries: Game.System.writeEvent(Cry),
    },
  },
  ({ queries, resources, events }) => {
    const crashes = events.impacts
      .all()
      .filter((i) => i.hit === "person" || i.hit === "animal" || i.speed >= CRASH_SPEED)
    if (crashes.length === 0) return
    const { step } = resources.time.get()
    const random = Random.draw(resources.rng)
    // The struck animals themselves are down (their Down lands at the end of the step): Recover sends them running when they get up.
    const struck = new Set(crashes.map((i) => i.other))
    for (const { entity, data } of queries.animals.each()) {
      const at = data.pose.get(),
        { species } = data.animal.get()
      const crash = struck.has(entity.id)
        ? undefined
        : crashes.find((c) => near(c, at, FEARS[species].crash))
      if (crash === undefined) continue
      data.roam.set(
        fright(data.roam.get(), species, crash, step, random, (feeling) =>
          events.cries.emit({ who: entity.id, x: at.x, y: at.y, feeling }),
        ),
      )
    }
  },
)
