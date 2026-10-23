import { Clock } from "@typeonce/ritmo"
import { Vec2 } from "@typeonce/ritmo-math"

import { carCircles, carRadius, moveCar, walkBy, wallsAlong } from "../body.ts"
import {
  Dead,
  Down,
  Driving,
  Game,
  Impact,
  Motion,
  Pedestrian,
  Person,
  Player,
  Pose,
  Route,
  Score,
  STEP,
  Time,
  Vehicle,
} from "../schema.ts"
import { KNOCK_SPEED, PERSON_RADIUS } from "../tuning.ts"
import { VEHICLES, type VehicleModel } from "../vehicles.ts"
import { FLEE_TIME, runFrom } from "./pedestrians.ts"

/** How long a knocked-down person stays on the ground. */
export const DOWN_TIME = Clock.duration(STEP, 2.5)
/** Car-to-car restitution. */
const RESTITUTION = 0.2
/** A knocked person slides with this share of the car's velocity, plus this push away from it (m/s). */
const CARRY = 0.6
const THROW = 3

/** The deepest overlap between two circle sets: penetration, unit normal from `b` to `a`, and the contact point (px, py) on `b`'s surface. */
const deepest = (
  as: ReadonlyArray<Vec2.Vec2>,
  ra: number,
  bs: ReadonlyArray<Vec2.Vec2>,
  rb: number,
) => {
  let depth = 0,
    nx = 0,
    ny = 0,
    px = 0,
    py = 0
  for (const a of as)
    for (const b of bs) {
      const dx = a.x - b.x,
        dy = a.y - b.y
      const d = Math.sqrt(dx * dx + dy * dy)
      const pen = ra + rb - d
      if (pen <= depth) continue
      depth = pen
      nx = d > 1e-9 ? dx / d : 1
      ny = d > 1e-9 ? dy / d : 0
      px = b.x + nx * rb
      py = b.y + ny * rb
    }
  return { depth, nx, ny, px, py }
}

/** A body's working copy for this step (written back once, if `moved`). */
interface Mover {
  x: number
  y: number
  vx: number
  vy: number
  moved: boolean
}
interface Car extends Mover {
  readonly model: VehicleModel
  /** Tonnes, as Impact carries it. */
  readonly mass: number
  readonly r: number
  readonly reach: number
  readonly angle: number
}
interface Body extends Mover {
  down: boolean
}

/** Moves `body` `by` metres along (nx, ny), as far as `move` lets it go; returns how far it got. */
const shove = (
  body: Mover,
  nx: number,
  ny: number,
  by: number,
  move: (delta: Vec2.Vec2) => Vec2.Vec2,
): number => {
  const position = move({ x: nx * by, y: ny * by })
  const got = (position.x - body.x) * nx + (position.y - body.y) * ny
  body.x = position.x
  body.y = position.y
  body.moved = true
  return got
}
/** Shoves a car without passing through (or deeper into) drive walls. */
const shoveCar = (car: Car, nx: number, ny: number, by: number): number =>
  shove(
    car,
    nx,
    ny,
    by,
    (delta) =>
      moveCar(
        car.model,
        car,
        car.angle,
        delta,
        wallsAlong("drive", car.x, car.y, delta.x, delta.y, car.reach + 0.5),
      )?.position ?? car,
  )
/** Shoves a person without passing through walk walls. */
const shovePerson = (person: Body, nx: number, ny: number, by: number): number =>
  shove(person, nx, ny, by, (delta) => walkBy(person, delta).position)
/** A standing person stops walking into what pushed them along (nx, ny), so a walker can tell it is blocked. */
const stopInto = (person: Body, nx: number, ny: number) => {
  const into = person.vx * nx + person.vy * ny
  if (person.down || into >= 0) return
  person.vx -= into * nx
  person.vy -= into * ny
}

/**
 * Bodies touching after physics, never shoved through walls: vehicles shove
 * each other (mass-weighted separation and an impulse); a vehicle hitting a
 * standing person faster than KNOCK_SPEED knocks them down and throws them (a
 * point for the player when it was their car), slower it pushes them aside,
 * and a person pinned against a wall stops the vehicle instead; people step apart.
 * Vehicles closing on each other, knockdowns and a vehicle stopped against a
 * wall through a pinned person (faster than KNOCK_SPEED) are Impact events.
 */
export const Contacts = Game.System(
  "Lunigiana/Contacts",
  {
    queries: {
      vehicles: Game.Query({
        selection: {
          pose: Game.Query.write(Pose),
          motion: Game.Query.write(Motion),
          vehicle: Game.Query.read(Vehicle),
        },
      }),
      people: Game.Query({
        selection: {
          pose: Game.Query.write(Pose),
          motion: Game.Query.write(Motion),
          down: Game.Query.optional(Down),
        },
        with: [Person],
        without: [Driving],
      }),
      driver: Game.Query({ selection: { driving: Game.Query.read(Driving) }, with: [Player] }),
    },
    resources: { score: Game.System.writeResource(Score), time: Game.System.readResource(Time) },
    commands: Game.System.commands(Game.System.inserts(Down)),
    events: { impact: Game.System.writeEvent(Impact) },
  },
  ({ queries, resources, commands, events }) => {
    const mine = new Set(
      queries.driver.each().map(({ data }) => Game.Entity.id(data.driving.get().vehicle)),
    )
    const cars = queries.vehicles.each().map((match) => {
      const pose = match.data.pose.get(),
        motion = match.data.motion.get()
      const { model } = match.data.vehicle.get()
      const car: Car = {
        model,
        mass: VEHICLES[model].mass / 1000,
        r: carRadius(model),
        reach: VEHICLES[model].length / 2,
        x: pose.x,
        y: pose.y,
        angle: pose.angle,
        vx: motion.vx,
        vy: motion.vy,
        moved: false,
      }
      return { match, car }
    })
    const circlesOf = (car: Car) =>
      carCircles(car.model, car.angle).map((o) => ({ x: car.x + o.x, y: car.y + o.y }))

    for (let i = 0; i < cars.length; i++)
      for (let j = i + 1; j < cars.length; j++) {
        const a = cars[i]!.car,
          b = cars[j]!.car
        if (Vec2.distanceSquared(a, b) > (a.reach + b.reach) ** 2) continue
        const { depth, nx, ny, px, py } = deepest(circlesOf(a), a.r, circlesOf(b), b.r)
        if (depth <= 0) continue
        // a takes its mass share of the separation; b the rest, including what a's walls refused.
        const share = depth * (b.mass / (a.mass + b.mass))
        const rest = depth - shoveCar(a, nx, ny, share)
        shoveCar(b, -nx, -ny, rest)
        const closing = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny
        if (closing < 0) {
          const impulse = (-(1 + RESTITUTION) * closing) / (1 / a.mass + 1 / b.mass)
          a.vx += (nx * impulse) / a.mass
          a.vy += (ny * impulse) / a.mass
          b.vx -= (nx * impulse) / b.mass
          b.vy -= (ny * impulse) / b.mass
          const mass = 1 / (1 / a.mass + 1 / b.mass)
          events.impact.emit({
            hit: "car",
            x: px,
            y: py,
            speed: -closing,
            mass,
            car: cars[i]!.match.entity.id,
            other: cars[j]!.match.entity.id,
          })
        }
      }

    const { step } = resources.time.get()
    const people = queries.people.each().map((match) => {
      const pose = match.data.pose.get(),
        motion = match.data.motion.get()
      const body: Body = {
        x: pose.x,
        y: pose.y,
        vx: motion.vx,
        vy: motion.vy,
        down: match.data.down.present,
        moved: false,
      }
      return { match, body }
    })
    for (const { match, body: person } of people)
      for (const { match: owner, car } of cars) {
        if (Vec2.distanceSquared(person, car) > (car.reach + PERSON_RADIUS) ** 2) continue
        const { depth, nx, ny } = deepest([person], PERSON_RADIUS, circlesOf(car), car.r)
        if (depth <= 0) continue
        // The car's own speed decides: running into a parked car must not floor the runner. Taken before a pin stops the car.
        const speed2 = car.vx * car.vx + car.vy * car.vy
        const knocked = !person.down && car.vx * nx + car.vy * ny > 0 && speed2 > KNOCK_SPEED ** 2
        // Out of the car's way; whatever a wall behind them refuses, the car gives back.
        const want = depth + 0.01
        const short = want - shovePerson(person, nx, ny, want)
        if (short > 1e-3) {
          shoveCar(car, -nx, -ny, short)
          const into = car.vx * nx + car.vy * ny
          if (into > 0) {
            car.vx -= into * nx
            car.vy -= into * ny
          }
          // Pinned, the person stops the car against the wall behind them: a wall hit as hard as it was going into it.
          if (into > KNOCK_SPEED) {
            events.impact.emit({
              hit: "wall",
              x: person.x + nx * PERSON_RADIUS,
              y: person.y + ny * PERSON_RADIUS,
              speed: into,
              mass: car.mass,
              car: owner.entity.id,
            })
          }
        }
        if (!knocked) {
          stopInto(person, nx, ny)
          continue
        }
        person.down = true
        person.vx = car.vx * CARRY + nx * THROW
        person.vy = car.vy * CARRY + ny * THROW
        commands.insert(match.entity, [Down, { until: step + Clock.steps(DOWN_TIME) }])
        events.impact.emit({
          hit: "person",
          x: person.x,
          y: person.y,
          speed: Math.sqrt(speed2),
          mass: car.mass,
          car: owner.entity.id,
          other: match.entity.id,
        })
        if (mine.has(owner.entity.id))
          resources.score.update((score) => ({ ...score, knocked: score.knocked + 1 }))
      }

    for (let i = 0; i < people.length; i++)
      for (let j = i + 1; j < people.length; j++) {
        const a = people[i]!.body,
          b = people[j]!.body
        const dx = a.x - b.x,
          dy = a.y - b.y
        const d2 = dx * dx + dy * dy
        if (d2 >= (2 * PERSON_RADIUS) ** 2) continue
        const d = Math.sqrt(d2)
        const push = (2 * PERSON_RADIUS - d) * 0.25
        const nx = d > 1e-9 ? dx / d : 1,
          ny = d > 1e-9 ? dy / d : 0
        shovePerson(a, nx, ny, push)
        shovePerson(b, -nx, -ny, push)
        stopInto(a, nx, ny)
        stopInto(b, -nx, -ny)
      }

    for (const { match, car } of cars) {
      if (!car.moved) continue
      match.data.pose.set({ x: car.x, y: car.y, angle: car.angle })
      match.data.motion.update((motion) => ({ ...motion, vx: car.vx, vy: car.vy }))
    }
    for (const { match, body } of people) {
      if (!body.moved) continue
      match.data.pose.update((pose) => ({ ...pose, x: body.x, y: body.y }))
      match.data.motion.update((motion) => ({ ...motion, vx: body.vx, vy: body.vy }))
    }
  },
)

/**
 * Knocked-down people get up when their time is over; a pedestrian then runs off along its route, away from the nearest vehicle.
 * The dead stay down.
 */
export const Recover = Game.System(
  "Lunigiana/Recover",
  {
    queries: {
      peds: Game.Query({
        selection: {
          down: Game.Query.read(Down),
          pose: Game.Query.read(Pose),
          ped: Game.Query.write(Pedestrian),
          route: Game.Query.write(Route),
        },
        without: [Dead],
      }),
      others: Game.Query({
        selection: { down: Game.Query.read(Down) },
        without: [Pedestrian, Dead],
      }),
      vehicles: Game.Query({ selection: { pose: Game.Query.read(Pose) }, with: [Vehicle] }),
    },
    resources: { time: Game.System.thisTick(Game.System.readResource(Time)) },
    commands: Game.System.commands(Game.System.removes(Down)),
  },
  ({ queries, resources, commands }) => {
    const { step } = resources.time.get()
    for (const { entity, data } of queries.peds.each()) {
      if (step < data.down.get().until) continue
      commands.remove(entity, Down)
      const at = data.pose.get()
      let threat: Vec2.Vec2 | undefined,
        best = Number.MAX_VALUE
      for (const { data: car } of queries.vehicles.each()) {
        const p = car.pose.get()
        const d = Vec2.distanceSquared(p, at)
        if (d < best) [threat, best] = [p, d]
      }
      if (threat !== undefined) data.route.set(runFrom(data.route.get(), at, threat))
      data.ped.set({ mood: "flee", until: step + Clock.steps(FLEE_TIME), blocked: 0 })
    }
    for (const { entity, data } of queries.others.each())
      if (step >= data.down.get().until) commands.remove(entity, Down)
  },
)
