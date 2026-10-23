import assert from "node:assert/strict"
import { test } from "node:test"

import type { SkyViewModel } from "../sim/index.ts"
import { DAY, daysFromCivil, romeTime } from "../sim/sky/calendar.ts"
import { type ClockRequest, MAX_RATE, SECONDS_RANGE, setClock } from "../sim/sky/clock.ts"
import type { Regime } from "../sim/sky/regimes.ts"
import { initialWeather, setWeather, type WeatherRequest } from "../sim/sky/weather.ts"
import { dateText, makeSkyStore, parseDate, romeSeconds } from "./sky.ts"

/** 2026-10-22 08:00 in Rome, a new game's default start. */
const START = 1792648800

/** The sky a game at `seconds` and `rate` shows, the weather a new game's unless given. */
const sky = (seconds: number, rate = 1, weather = initialWeather(START)): SkyViewModel => ({ seconds, rate, local: romeTime(seconds), weather })

/** A store over a fake game whose sky stays `game` until `become` moves it, as the real one's does until its next step: what the store sends is collected. */
const fakes = (game: SkyViewModel = sky(START)) => {
  const clocks: Array<ClockRequest> = [], weathers: Array<WeatherRequest> = []
  let now = game
  const store = makeSkyStore({ read: () => now, setClock: (request) => void clocks.push(request), setWeather: (request) => void weathers.push(request) })
  return { store, clocks, weathers, become: (next: SkyViewModel) => void (now = next) }
}

test("a new store shows the game's sky, its rate and its regime left to chance, and sends nothing", () => {
  const { store, clocks, weathers } = fakes()
  assert.deepEqual(store.now(), sky(START))
  assert.deepEqual([store.rate(), store.regime(), clocks, weathers], [1, null, [], []])
  const forced = fakes(sky(START, 0, { ...initialWeather(START), regime: "fog", forced: true })).store
  assert.deepEqual([forced.rate(), forced.regime()], [0, "fog"], "a game already pinned shows its pins")
})

test("each request is kept in range exactly as the sim keeps it, and one the sim would drop is never sent", () => {
  const { store, clocks, weathers } = fakes()
  const game = { seconds: START, rate: 1 }
  for (const [rate, held] of [[1e9, MAX_RATE], [2.4, 2], [-3, 0], [60, 60]] as const) {
    store.setRate(rate)
    assert.deepEqual([store.rate(), clocks.at(-1)], [held, { rate: held }], String(rate))
    assert.equal(setClock(game, { rate })?.rate, held, "the sim's own answer")
  }
  store.setSeconds(-1e12)
  assert.deepEqual([store.now().seconds, clocks.at(-1)], [SECONDS_RANGE.min, { seconds: SECONDS_RANGE.min }])
  const sent = clocks.length
  store.setRate(Number.NaN)
  store.setSeconds(Number.POSITIVE_INFINITY)
  store.force("tornado" as Regime)
  assert.deepEqual([clocks.length, weathers, store.rate(), store.regime()], [sent, [], 60, null], "not numbers, not a regime: dropped")
  store.force("rain")
  store.force(null)
  assert.deepEqual(weathers, [{ regime: "rain" }, { regime: null }])
  for (const regime of ["tornado", "toString", "", "RAIN"]) assert.equal(setWeather(initialWeather(START), { regime: regime as Regime }, START), undefined, "the sim drops it too")
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
  assert.deepEqual([store.now().seconds, store.now().local.hour, store.now().local.minute, store.now().rate, store.regime()], [sent, 20, 30, 0, "rain"])
  store.setDate({ year: 2026, month: 12, day: 21 })
  assert.deepEqual([store.now().local.month, store.now().local.day, store.now().local.hour, store.now().local.minute], [12, 21, 20, 30], "the date keeps the time of day sent")
  const stepped = sky(romeSeconds({ year: 2026, month: 12, day: 21 }, 20 * 3600 + 30 * 60), 0)
  become(stepped)
  assert.deepEqual(store.now(), stepped)
  become(sky(stepped.seconds + 3600, 0))
  assert.equal(store.now().seconds, stepped.seconds + 3600, "a time set later from elsewhere (a restored save) shows")
})

test("Settle now settles the pinned regime; in Auto it settles the regime the weather is moving toward and leaves it to chance", () => {
  const { store, weathers } = fakes(sky(START, 1, { ...initialWeather(START), regime: "cloudy" }))
  store.settle()
  assert.deepEqual(weathers, [{ regime: "cloudy", settle: true }, { regime: null }])
  store.force("storm")
  store.settle()
  assert.deepEqual(weathers.slice(2), [{ regime: "storm" }, { regime: "storm", settle: true }])
})

// Regression: over the paused map (or in one console line), Rain then Auto then Settle now re-forced and settled the regime before
// Rain, which the game still showed, and Rain was lost.
test("Settle now in Auto, after a regime forced and handed back to chance that the game has not taken yet, settles that regime", () => {
  const before = { ...initialWeather(START), regime: "overcast" as const }
  const { store, weathers, become } = fakes(sky(START, 1, before))
  store.force("rain")
  store.force(null)
  assert.deepEqual([store.regime(), store.heading()], [null, "rain"])
  store.settle()
  assert.deepEqual(weathers, [{ regime: "rain" }, { regime: null }, { regime: "rain", settle: true }, { regime: null }])
  // The game stepped, took Rain, and its chance has drawn on since: the regime it moves toward now is the one to settle.
  for (const game of [sky(START + 60, 1, { ...before, regime: "cloudy" }), sky(START, 0, { ...before, regime: "cloudy", left: 3 * 3600 })]) {
    const next = fakes(sky(START, game.rate, before))
    next.store.force("rain")
    next.store.force(null)
    next.become(game)
    assert.equal(next.store.heading(), "cloudy", `rate ${game.rate}`)
    next.store.settle()
    assert.deepEqual(next.weathers.slice(2), [{ regime: "cloudy", settle: true }, { regime: null }], `rate ${game.rate}`)
  }
  become(sky(START + 60, 1, { ...before, regime: "rain" }))
  assert.equal(store.regime(), null, "Auto, as the game holds it")
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
  assert.equal(store.rate(), 1, "the game stepped and holds another rate (a later request, a restored save)")
  const held = fakes(sky(START, 0)), told: Array<number> = []
  held.store.subscribe(() => told.push(held.store.rate()))
  held.store.setRate(0)
  held.become(sky(START, 1))
  assert.deepEqual([told, held.store.rate()], [[0], 1], "Stopped sent under the card, then the card's release taken")
})

test("dates read and write as an input[type=date] value; anything else is no date", () => {
  assert.equal(dateText({ year: 2026, month: 3, day: 9 }), "2026-03-09")
  assert.deepEqual(parseDate("2026-12-21"), { year: 2026, month: 12, day: 21 })
  for (const text of ["", "2026-02-30", "2026-13-01", "21/12/2026", "2026-1-5"]) assert.equal(parseDate(text), undefined, text)
})

test("Rome's wall clock on a date: summer time in summer, the hour skipped in March read an hour later", () => {
  assert.equal(romeSeconds({ year: 2026, month: 10, day: 22 }, 8 * 3600), START)
  assert.equal(romeSeconds({ year: 2026, month: 12, day: 21 }, 12 * 3600), daysFromCivil(2026, 12, 21) * DAY + 11 * 3600)
  assert.equal(romeSeconds({ year: 2026, month: 3, day: 29 }, 2.5 * 3600), daysFromCivil(2026, 3, 29) * DAY + 1.5 * 3600)
})
