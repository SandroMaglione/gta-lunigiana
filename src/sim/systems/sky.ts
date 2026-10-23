import { Random } from "@typeonce/ritmo-math"

import { Game, GameClock, Lightning, Player, Pose, Time, View, Weather, WeatherRng } from "../schema.ts"
import { advanceWeather, stormStep } from "../sky/weather.ts"
import { screenAxes } from "../view.ts"

/** Each step the game clock moves on by its rate (a game second at rate 1); at rate 0 it stands still and is not written. */
export const AdvanceClock = Game.System("Lunigiana/AdvanceClock", {
  resources: { clock: Game.System.writeResource(GameClock) }
}, ({ resources }) => {
  const { seconds, rate } = resources.clock.get()
  if (rate !== 0) resources.clock.set({ seconds: seconds + rate, rate })
})

/**
 * The weather over this step: over the clock's game seconds it follows the day's plan (drawn from the
 * weather seed) and eases toward the regime's targets, wetting, drying, snowing and thawing the ground
 * (nothing moves at rate 0; a clock moved to another day only takes that day's plan); over the step's real
 * time a thunderstorm's cell drifts downwind and throws Lightning around it, now and then in front of the
 * camera. The storm's draws come from `WeatherRng`.
 */
export const AdvanceWeather = Game.System("Lunigiana/AdvanceWeather", {
  queries: { player: Game.Query({ selection: { pose: Game.Query.read(Pose) }, with: [Player] }) },
  resources: {
    clock: Game.System.thisTick(Game.System.readResource(GameClock)), time: Game.System.thisTick(Game.System.readResource(Time)),
    view: Game.System.readResource(View), weather: Game.System.writeResource(Weather), rng: Game.System.writeResource(WeatherRng)
  },
  events: { lightning: Game.System.writeEvent(Lightning) }
}, ({ queries, resources, events }) => {
  const { seconds, rate } = resources.clock.get(), { dt, step } = resources.time.get()
  const random = Random.draw(resources.rng), weather = resources.weather.get()
  let next = advanceWeather(weather, seconds, rate)
  const found = queries.player.singleOptional()
  if (found.ok && found.value !== undefined) {
    const at = found.value.data.pose.get()
    const storm = stormStep(next, { x: at.x, y: at.y, ...screenAxes(resources.view.get().turns) }, dt, step, random)
    next = storm.weather
    if (storm.lightning !== undefined) events.lightning.emit(storm.lightning)
  }
  // Still at rate 0 with no storm: left unwritten, so a stopped sky reads as unchanged.
  if (next !== weather) resources.weather.set(next)
})
