import { Clock, HostClock } from "@typeonce/ritmo"
import type { RuntimeServices } from "@typeonce/ritmo/Runtime"
import { InputCapture, Keyboard } from "@typeonce/ritmo-browser"
import type * as Lint from "@typeonce/ritmo-devtools/Lint"
import { InputAxis, Random } from "@typeonce/ritmo-math"

import { clampKnob, DEFAULT_HANDLING } from "./handling.ts"
import {
  bindings, Game, GameClock, Handling, Input, KeyboardInput, Pose, PrevPose, Root, SetClock, SetHandling, SetWeather, STEP, Time, View, Weather
} from "./schema.ts"
import { setClock } from "./sky/clock.ts"
import { initialWeather, setWeather } from "./sky/weather.ts"
import { Contacts, Recover } from "./systems/contacts.ts"
import { PlayerDrive, RideAlong } from "./systems/drive.ts"
import { EnterExit } from "./systems/enter-exit.ts"
import { PlayerFoot } from "./systems/foot.ts"
import { Pedestrians } from "./systems/pedestrians.ts"
import { VehiclePhysics } from "./systems/physics.ts"
import { Populate } from "./systems/populate.ts"
import { AdvanceClock, AdvanceWeather } from "./systems/sky.ts"
import { SpawnWorld } from "./systems/spawn.ts"
import { TrafficAI } from "./systems/traffic.ts"

export * from "./schema.ts"
export { HandlingView, PlayerView, type PlayerViewModel, SkyView, type SkyViewModel } from "./views.ts"

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

/** Each `SetClock` request sets the game time and/or its rate, kept in range; one with no number in it is dropped. */
const ApplyClock = Game.System("Lunigiana/ApplyClock", {
  resources: { clock: Game.System.writeResource(GameClock) },
  events: { requests: Game.System.readEvent(SetClock) }
}, ({ resources, events }) => {
  for (const request of events.requests.all()) {
    const next = setClock(resources.clock.get(), request)
    if (next !== undefined) resources.clock.set(next)
  }
})

/** Each `SetWeather` request forces its regime (settled at once when asked) or hands the weather back to chance; one naming no regime is dropped. */
const ApplyWeather = Game.System("Lunigiana/ApplyWeather", {
  resources: { clock: Game.System.readResource(GameClock), weather: Game.System.writeResource(Weather) },
  events: { requests: Game.System.readEvent(SetWeather) }
}, ({ resources, events }) => {
  for (const request of events.requests.all()) {
    const next = setWeather(resources.weather.get(), request, resources.clock.get().seconds)
    if (next !== undefined) resources.weather.set(next)
  }
})

/**
 * Ticked once after the runtime is made. The apply systems run here too so they are listening before the host can send: a request
 * sent before the first update would otherwise be dropped by whichever schedule ticks first.
 */
export const setup = Game.Schedule(SpawnWorld, ApplyHandling, ApplyClock, ApplyWeather, Game.Schedule.applyDeferred())
/** One fixed step of the game. */
export const update = Game.Schedule(
  AdvanceTime,
  CaptureInput,
  StorePrevious,
  TurnView,
  ApplyHandling,
  ApplyClock,
  ApplyWeather,
  AdvanceClock,
  AdvanceWeather,
  EnterExit,
  Game.Schedule.applyDeferred(),
  PlayerFoot,
  PlayerDrive,
  TrafficAI,
  Pedestrians,
  VehiclePhysics,
  Contacts,
  RideAlong,
  Recover,
  Populate,
  Game.Schedule.applyDeferred()
)

/** A new game's start when the host gives none: 2026-10-22 08:00 CEST (Unix UTC seconds), so tests replay the same day. */
export const DEFAULT_START = 1792648800
/**
 * Mixed into the seed for the weather's stream. mulberry32 steps through every 32-bit state in one cycle, so `WeatherRng` and `Rng`
 * are the same sequence at an offset the seed sets. Measured over all 2³² seeds, the offset is as good as random: two streams of N
 * draws each overlap for about 2N/2³² of the seeds (1 in 2000 at a million draws); the closest is 7179 draws (seed 137 773 472), and
 * every seed from 0 to 200 000 is at least 1.2 million apart. Where they overlap the weather only repeats numbers the world drew: it
 * never changes traffic, pedestrians or parking.
 */
const WEATHER_SEED = 0x9e3779b9

/**
 * A new game from `seed`, starting at `start` (Unix UTC seconds, a whole number: the host's today at 08:00 in Rome;
 * `DEFAULT_START` when omitted). The host passes every service: KeyboardInput plus its own (render registries, clocks).
 */
export const makeRuntime = <const Services extends RuntimeServices<any>>(options: {
  readonly seed: number
  readonly start?: number
  readonly services: Services
  readonly debug?: { readonly hostClock: HostClock.HostClock }
}) => {
  const start = options.start ?? DEFAULT_START
  return Game.Runtime.make({
    services: options.services,
    resources: {
      Time: Clock.start(STEP), Rng: Random.seed(options.seed), WeatherRng: Random.seed(options.seed ^ WEATHER_SEED), Score: { stolen: 0, knocked: 0 }, View: { turns: 0 },
      Handling: DEFAULT_HANDLING, GameClock: { seconds: start, rate: 1 }, Weather: initialWeather(start), Input: Keyboard.idle(bindings)
    },
    debug: options.debug
  })
}

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
  // The host's handling store (src/hud/handling.ts, behind the settings and the dev debug menu) sends SetHandling with runtime.send;
  // the host sends SetClock to hold the clock behind the title card (holdClock, src/hud/title.ts), and the dev debug menu sends
  // SetClock and SetWeather.
  return { runtime: made.value, schedules: { setup, update }, describe: { render, audio }, hostEvents: [SetHandling, SetClock, SetWeather] }
}
