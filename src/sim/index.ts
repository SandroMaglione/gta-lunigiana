import { Clock, HostClock } from "@typeonce/ritmo"
import type { RuntimeServices } from "@typeonce/ritmo/Runtime"
import { InputCapture, Keyboard } from "@typeonce/ritmo-browser"
import type * as Lint from "@typeonce/ritmo-devtools/Lint"
import { InputAxis, Random } from "@typeonce/ritmo-math"

import { clampKnob, DEFAULT_HANDLING } from "./handling.ts"
import { bindings, Game, Handling, Input, KeyboardInput, Pose, PrevPose, Root, SetHandling, STEP, Time, View } from "./schema.ts"
import { Contacts, Recover } from "./systems/contacts.ts"
import { PlayerDrive, RideAlong } from "./systems/drive.ts"
import { Animals, Startle } from "./systems/animals.ts"
import { EnterExit } from "./systems/enter-exit.ts"
import { PlayerFoot } from "./systems/foot.ts"
import { Pedestrians } from "./systems/pedestrians.ts"
import { Perceive } from "./systems/perceive.ts"
import { VehiclePhysics } from "./systems/physics.ts"
import { FillPeople, Populate } from "./systems/populate.ts"
import { FillAnimals, PopulateAnimals } from "./systems/populate-animals.ts"
import { SpawnWorld } from "./systems/spawn.ts"
import { TrafficAI } from "./systems/traffic.ts"

export * from "./schema.ts"
export { HandlingView, PlayerView, type PlayerViewModel } from "./views.ts"

const AdvanceTime = Clock.system(Game, { name: "Lunigiana/AdvanceTime", resource: Time })
const CaptureInput = InputCapture.system(Game, { name: "Lunigiana/CaptureInput", source: KeyboardInput, resource: Input })

/** Copies each pose into PrevPose at the start of the step, for render interpolation. */
const StorePrevious = Game.System("Lunigiana/StorePrevious", {
  queries: { all: Game.Query({ selection: { prev: Game.Query.write(PrevPose), pose: Game.Query.read(Pose) } }) }
}, ({ queries }) => {
  for (const { data } of queries.all.each()) data.prev.set(data.pose.get())
})

/** The turn keys swing the view a quarter left or right; on foot, the movement keys follow it. */
const TurnView = Game.System("Lunigiana/TurnView", {
  resources: { input: Game.System.readResource(Input), view: Game.System.writeResource(View) }
}, ({ resources }) => {
  const keys = resources.input.get()
  const turn = InputAxis.axis(keys.turnRight.pressed, keys.turnLeft.pressed)
  if (turn !== 0) resources.view.update(({ turns }) => ({ turns: turns + turn }))
})

/** Each `SetHandling` request sets its knob, kept inside the knob's range (a switch to 0 or 1); one that is not a number is dropped. */
const ApplyHandling = Game.System("Lunigiana/ApplyHandling", {
  resources: { handling: Game.System.writeResource(Handling) },
  events: { requests: Game.System.readEvent(SetHandling) }
}, ({ resources, events }) => {
  for (const { key, value } of events.requests.all()) {
    const valid = clampKnob(key, value)
    if (valid !== undefined) resources.handling.update((handling) => ({ ...handling, [key]: valid }))
  }
})

/**
 * Ticked once after the runtime is made. ApplyHandling runs here too so it is listening before the host can send: a request sent
 * before the first update would otherwise be dropped by whichever schedule ticks first. The first fill of people and animals
 * runs once the player stands at the start, so the world is peopled from the first frame.
 */
export const setup = Game.Schedule(SpawnWorld, ApplyHandling, Game.Schedule.applyDeferred(), FillPeople, FillAnimals, Game.Schedule.applyDeferred())
/** One fixed step of the game. */
export const update = Game.Schedule(
  AdvanceTime,
  CaptureInput,
  StorePrevious,
  TurnView,
  ApplyHandling,
  EnterExit,
  Game.Schedule.applyDeferred(),
  PlayerFoot,
  PlayerDrive,
  TrafficAI,
  Pedestrians,
  Animals,
  VehiclePhysics,
  Contacts,
  RideAlong,
  Recover,
  // After the contacts: this step's hits and crashes are events, which a save drops, so they are taken in the step they happen.
  Perceive,
  Startle,
  Populate,
  PopulateAnimals,
  Game.Schedule.applyDeferred()
)

/** A new game from `seed`. The host passes every service: KeyboardInput plus its own (render registries, clocks). */
export const makeRuntime = <const Services extends RuntimeServices<any>>(options: {
  readonly seed: number
  readonly services: Services
  readonly debug?: { readonly hostClock: HostClock.HostClock }
}) => Game.Runtime.make({
  services: options.services,
  resources: { Time: Clock.start(STEP), Rng: Random.seed(options.seed), Score: { stolen: 0, knocked: 0 }, View: { turns: 0 }, Handling: DEFAULT_HANDLING, Input: Keyboard.idle(bindings) },
  debug: options.debug
})

/** The runtime and schedules `ritmo-devtools lint` checks; the render and audio schedules are described, not run. */
export const lintTarget = async (): Promise<Lint.Target<typeof Game.schema, typeof Root>> => {
  const made = makeRuntime({
    seed: 1,
    services: Game.Runtime.services(Game.Runtime.service(KeyboardInput, Keyboard.scripted(bindings, []))),
    debug: { hostClock: HostClock.test() }
  })
  if (!made.ok) throw new Error(`invalid runtime: ${JSON.stringify(made.error)}`)
  // Loaded here, not at the top: the render and audio schedules are host code, outside the simulation.
  // oxlint-disable-next-line no-restricted-imports -- the lint target describes the render schedule
  const { render } = await import("../render/index.ts")
  // oxlint-disable-next-line no-restricted-imports -- and the audio schedule, the reader of the sim's events
  const { audio } = await import("../audio/index.ts")
  // The host's handling store (src/hud/handling.ts, behind the settings and the dev debug menu) sends SetHandling with runtime.send.
  return { runtime: made.value, schedules: { setup, update }, describe: { render, audio }, hostEvents: [SetHandling] }
}
