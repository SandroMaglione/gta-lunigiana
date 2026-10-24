import assert from "node:assert/strict"
import { test } from "node:test"

import type { SkyViewModel } from "../../sim/index.ts"
import { DAY, daysFromCivil, romeTime } from "../../sim/sky/calendar.ts"
import { type ClockRequest, MAX_RATE, SECONDS_RANGE, setClock } from "../../sim/sky/clock.ts"
import { calmPlan } from "../../sim/sky/plan.ts"
import type { Regime } from "../../sim/sky/regimes.ts"
import { initialWeather, setWeather, type WeatherRequest } from "../../sim/sky/weather.ts"
import { dateText, makeSkyStore, parseDate, romeSeconds } from "../sky.ts"

/** 2026-10-22 08:00 in Rome, a new game's default start. */
const START = 1792648800

/** The sky a game at `seconds` and `rate` shows, the weather a new game's unless given. */
const sky = (seconds: number, rate = 1, weather = initialWeather(START, 1)): SkyViewModel => ({
  seconds,
  rate,
  local: romeTime(seconds),
  weather,
  flow: 0.04,
})

/** A store over a fake game whose sky stays `game` until `become` moves it, as the real one's does until its next step: what the store sends is collected. */
const fakes = (game: SkyViewModel = sky(START)) => {
  const clocks: Array<ClockRequest> = [],
    weathers: Array<WeatherRequest> = []
  let now = game
  const store = makeSkyStore({
    read: () => now,
    setClock: (request) => void clocks.push(request),
    setWeather: (request) => void weathers.push(request),
  })
  return { store, clocks, weathers, become: (next: SkyViewModel) => void (now = next) }
}

test("a new store shows the game's sky, its rate and its regime left to chance, and sends nothing", () => {
  const { store, clocks, weathers } = fakes()
  assert.deepEqual(store.now(), sky(START))
  assert.deepEqual([store.rate(), store.regime(), clocks, weathers], [1, null, [], []])
  const forced = fakes(
    sky(START, 0, { ...initialWeather(START, 1), regime: "fog", forced: true }),
  ).store
  assert.deepEqual(
    [forced.rate(), forced.regime()],
    [0, "fog"],
    "a game already pinned shows its pins",
  )
})

test("each request is kept in range exactly as the sim keeps it, and one the sim would drop is never sent", () => {
  const { store, clocks, weathers } = fakes()
  const game = { seconds: START, rate: 1 }
  for (const [rate, held] of [
    [1e9, MAX_RATE],
    [2.4, 2],
    [-3, 0],
    [60, 60],
  ] as const) {
    store.setRate(rate)
    assert.deepEqual([store.rate(), clocks.at(-1)], [held, { rate: held }], String(rate))
    assert.equal(setClock(game, { rate })?.rate, held, "the sim's own answer")
  }
  store.setSeconds(-1e12)
  assert.deepEqual(
    [store.now().seconds, clocks.at(-1)],
    [SECONDS_RANGE.min, { seconds: SECONDS_RANGE.min }],
  )
  const sent = clocks.length
  store.setRate(Number.NaN)
  store.setSeconds(Number.POSITIVE_INFINITY)
  store.force("tornado" as Regime)
  assert.deepEqual(
    [clocks.length, weathers, store.rate(), store.regime()],
    [sent, [], 60, null],
    "not numbers, not a regime: dropped",
  )
  store.force("rain")
  store.force(null)
  assert.deepEqual(weathers, [{ regime: "rain" }, { regime: null }])
  for (const regime of ["tornado", "toString", "", "RAIN"])
    assert.equal(
      setWeather(initialWeather(START, 1), { regime: regime as Regime }, START),
      undefined,
      "the sim drops it too",
    )
})

test("every change tells each listener once; a request dropped tells no one", () => {
  const { store } = fakes()
  let told = 0
  store.subscribe(() => told++)
  store.setRate(10)
  store.setTime(20 * 3600)
  store.setDate({ year: 2026, month: 12, day: 21 })
  store.force("snow")
  assert.equal(told, 4)
  store.setRate(Number.NaN)
  store.force("tornado" as Regime)
  assert.equal(told, 4)
})

// The game applies a request only on its next step, never while the full map or the settings pause it: read from the game, the menu
// open over the map would show the old time, rate and regime.
test("the store keeps what it sent while the game lags, and shows the game's sky again once the game has stepped", () => {
  const { store, become } = fakes()
  store.setTime(20 * 3600 + 30 * 60)
  store.setRate(0)
  store.force("rain")
  const sent = romeSeconds({ year: 2026, month: 10, day: 22 }, 20 * 3600 + 30 * 60)
  assert.deepEqual(
    [
      store.now().seconds,
      store.now().local.hour,
      store.now().local.minute,
      store.now().rate,
      store.regime(),
    ],
    [sent, 20, 30, 0, "rain"],
  )
  store.setDate({ year: 2026, month: 12, day: 21 })
  assert.deepEqual(
    [
      store.now().local.month,
      store.now().local.day,
      store.now().local.hour,
      store.now().local.minute,
    ],
    [12, 21, 20, 30],
    "the date keeps the time of day sent",
  )
  const stepped = sky(romeSeconds({ year: 2026, month: 12, day: 21 }, 20 * 3600 + 30 * 60), 0)
  become(stepped)
  assert.deepEqual(store.now(), stepped)
  become(sky(stepped.seconds + 3600, 0))
  assert.equal(
    store.now().seconds,
    stepped.seconds + 3600,
    "a time set later from elsewhere (a restored save) shows",
  )
})

/** A drawn plan for START's day: cloudy, and rain from 07:00 to 11:00 (at START, 08:00, it rains). */
const RAINY = {
  ...calmPlan(START),
  drawn: true,
  from: 0,
  wet: true,
  event: "rain",
  start: 7 * 3600,
  end: 11 * 3600,
  precip: 2,
  sky: "cloudy",
} as const

/** `weather` after the game has taken each of `requests` in turn at START, as `ApplyWeather` takes them. */
const taken = (weather: SkyViewModel["weather"], requests: ReadonlyArray<WeatherRequest>) =>
  requests.reduce((at, request) => setWeather(at, request, START) ?? at, weather)

test("Settle now settles the pinned regime; in Auto it hands the weather to the day's plan and settles on the plan's regime", () => {
  const auto = { ...initialWeather(START, 1), plan: RAINY, regime: "rain" as const }
  const { store, weathers } = fakes(sky(START, 1, auto))
  store.settle()
  assert.deepEqual(weathers, [{ regime: null, settle: true }])
  const settled = taken(auto, weathers)
  assert.deepEqual(
    [settled.regime, settled.forced, settled.precip],
    ["rain", false, RAINY.precip],
    "the plan's rain, at its rate",
  )
  store.force("storm")
  store.settle()
  assert.deepEqual(weathers.slice(1), [{ regime: "storm" }, { regime: "storm", settle: true }])
})

// Regression: the day's plan hands a forced weather back to its own regime at once, but over the paused map (or in one console line)
// Clear held, then Auto, then Settle now showed "Clear, left to chance" and settled Clear, which the game then left at once for the
// plan's Rain.
test("Auto sent but not taken yet heads for the day's plan, and Settle now settles that, whatever was held before", () => {
  const held = { ...initialWeather(START, 1), plan: RAINY, regime: "clear" as const, forced: true }
  const { store, weathers } = fakes(sky(START, 1, held))
  store.force(null)
  assert.deepEqual([store.regime(), store.heading()], [null, "rain"])
  store.settle()
  assert.deepEqual(
    taken(held, weathers),
    setWeather(held, { regime: null, settle: true }, START),
    "where the game lands: the plan's rain, settled",
  )
  const forced = fakes(sky(START, 0, { ...held, forced: false, regime: "rain" }))
  forced.store.force("fog")
  forced.store.force(null)
  assert.deepEqual(
    [forced.store.regime(), forced.store.heading()],
    [null, "rain"],
    "Fog then Auto: the plan, not Fog",
  )
})

// The host stands the clock still behind the title card (rate 0 after setup, 1 when the card goes) without the store: a rate the store
// read once and kept would show Stopped all game, or Normal under the card.
test("the store shows the game's rate as the game sets it, and a rate it sent only until the game has stepped and taken it", () => {
  const { store, become } = fakes()
  assert.equal(store.rate(), 1)
  become(sky(START, 0))
  assert.deepEqual([store.rate(), store.now().rate], [0, 0], "held behind the title card")
  become(sky(START, 1))
  assert.deepEqual([store.rate(), store.now().rate], [1, 1], "released when it goes")
  store.setRate(60)
  assert.deepEqual([store.rate(), store.now().rate], [60, 60], "sent, not taken yet")
  become(sky(START + 1, 1))
  assert.equal(
    store.rate(),
    1,
    "the game stepped and holds another rate (a later request, a restored save)",
  )
  const held = fakes(sky(START, 0)),
    told: Array<number> = []
  held.store.subscribe(() => told.push(held.store.rate()))
  held.store.setRate(0)
  held.become(sky(START, 1))
  assert.deepEqual(
    [told, held.store.rate()],
    [[0], 1],
    "Stopped sent under the card, then the card's release taken",
  )
})

test("dates read and write as an input[type=date] value; anything else is no date", () => {
  assert.equal(dateText({ year: 2026, month: 3, day: 9 }), "2026-03-09")
  assert.deepEqual(parseDate("2026-12-21"), { year: 2026, month: 12, day: 21 })
  for (const text of ["", "2026-02-30", "2026-13-01", "21/12/2026", "2026-1-5"])
    assert.equal(parseDate(text), undefined, text)
})

test("Rome's wall clock on a date: summer time in summer, the hour skipped in March read an hour later", () => {
  assert.equal(romeSeconds({ year: 2026, month: 10, day: 22 }, 8 * 3600), START)
  assert.equal(
    romeSeconds({ year: 2026, month: 12, day: 21 }, 12 * 3600),
    daysFromCivil(2026, 12, 21) * DAY + 11 * 3600,
  )
  assert.equal(
    romeSeconds({ year: 2026, month: 3, day: 29 }, 2.5 * 3600),
    daysFromCivil(2026, 3, 29) * DAY + 1.5 * 3600,
  )
})
