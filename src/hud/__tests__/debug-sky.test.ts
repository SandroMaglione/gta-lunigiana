import assert from "node:assert/strict"
import { test } from "node:test"

import { DAY, daysFromCivil, utcFromRome } from "../../sim/sky/calendar.ts"
import { NO_SNOW } from "../../sim/sky/climate.ts"
import { MAX_RATE, setClock } from "../../sim/sky/clock.ts"
import { windAt } from "../../sim/sky/local.ts"
import { type DayOdds, oddsAt } from "../../sim/sky/odds.ts"
import { place } from "../../sim/sky/place.ts"
import { calmPlan, planFor, regimeAt, untilChange } from "../../sim/sky/plan.ts"
import { describeWeather } from "../../sim/sky/readout.ts"
import { initialWeather } from "../../sim/sky/weather.ts"
import {
  compass,
  fallingText,
  oddsReadout,
  oddsText,
  RATES,
  regimeText,
  seedText,
  snowLineText,
  spanText,
  windText,
} from "../debug-sky.ts"

/** 2026-10-22 08:00 in Rome, a new game's default start. */
const START = 1792648800

test("the rate buttons offer rates the sim holds as they are, from a still clock to a game hour a real second", () => {
  for (const { rate } of RATES)
    assert.equal(setClock({ seconds: 0, rate: 1 }, { rate })?.rate, rate, String(rate))
  assert.deepEqual(
    RATES.map(({ rate }) => rate),
    [0, 1, 10, 60],
  )
  assert.ok(RATES.every(({ rate }) => rate <= MAX_RATE))
})

test("the wind reads as the compass point it blows from: a south-westerly, moving north-east, from the south-west", () => {
  const toward = (radians: number) => windAt({ wind: 5, windAngle: radians }, 0)
  assert.equal(compass(toward(Math.PI / 4).x, toward(Math.PI / 4).y), "SW", "a south-westerly")
  assert.equal(
    compass(toward((-3 * Math.PI) / 4).x, toward((-3 * Math.PI) / 4).y),
    "NE",
    "a north-easterly",
  )
  assert.equal(compass(0, -1), "N", "air moving south comes from the north")
  assert.equal(compass(-1, 0), "E")
  assert.equal(compass(0.1, 1), "S", "rounds to the nearest point")
  assert.equal(windText(toward(Math.PI / 4), 1.7), "from SW 5.0 m/s, gusts 8.5")
  assert.equal(windText({ x: 0, y: 0 }, 1.4), "calm")
})

test("game spans read in hours and minutes, and the snow line reads none while it stands above the map", () => {
  assert.deepEqual(
    [spanText(0), spanText(45 * 60), spanText(80 * 60), spanText(3 * 3600 + 29)],
    ["0 min", "45 min", "1 h 20 min", "3 h 0 min"],
  )
  assert.equal(spanText(-30), "0 min", "a countdown run out")
  assert.deepEqual([snowLineText(1449.6), snowLineText(NO_SNOW)], ["1450 m", "none"])
})

// Regression: the menu cut anything under 0.05 mm/h, so a settled overcast's 0.03 mm/h read "Drizzle" on the HUD and nothing falling
// in "Air here".
test("what falls reads by kind, sleet as both, faint drizzle to the hundredth, and from just the amount the HUD's word names it", () => {
  assert.deepEqual(
    [
      fallingText(3, 0),
      fallingText(0.4, 1.2),
      fallingText(0, 1.5),
      fallingText(0.03, 0),
      fallingText(0.012, 0.016),
      fallingText(0, 0),
    ],
    [
      "rain 3.0 mm/h",
      "rain 0.4 + snow 1.2 mm/h",
      "snow 1.5 mm/h",
      "rain 0.03 mm/h",
      "rain 0.01 + snow 0.02 mm/h",
      "",
    ],
  )
  const calm = { cloud: 0, storm: 0, wind: 0 }
  for (const mm of [0.005, 0.0199, 0.02, 0.021, 0.05, 0.1]) {
    assert.equal(
      fallingText(mm, 0) !== "",
      describeWeather(calm, { rain: mm, snow: 0, fog: 0 }) === "Drizzle",
      `${mm} mm/h`,
    )
  }
})

// Regression: over the paused map, Rain showed pressed while the readout still said the game's "Overcast, next draw in 1 h 27 min" (now "next change").
test("the regime readout says what the game holds, and a pin the paused game has not taken yet as what it takes on resume", () => {
  // A new game's plan holds its calm start for 90 game minutes: 3 minutes in, 87 are left.
  const at = START + 180,
    overcast = { ...initialWeather(START, 1), regime: "overcast" as const },
    rain = { ...overcast, regime: "rain" as const, forced: true }
  assert.equal(regimeText(overcast, null, "overcast", at), "Overcast, next change in 1 h 27 min")
  assert.equal(regimeText(rain, "rain", "rain", at), "Rain, held")
  assert.equal(regimeText(overcast, "rain", "rain", at), "Rain, held (on resume)")
  assert.equal(regimeText(rain, "storm", "storm", at), "Thunderstorm, held (on resume)")
  assert.equal(regimeText(rain, null, "rain", at), "Rain, left to chance (on resume)")
  assert.equal(
    regimeText(overcast, null, "rain", at),
    "Rain, left to chance (on resume)",
    "Rain, then Auto",
  )
})

// Regression: a jump to 15:00 on 16 Dec 2026 drew a stratus lifting at 13:04, before the plan took over; back at 10:00 the readout
// counted down to 13:04, where the sky stayed clear, then jumped back up to 15:00.
test("the regime readout counts down to when the plan takes over, past a stratus that lifted before then, and runs out only on a change", () => {
  const day = daysFromCivil(2026, 12, 16),
    into = (second: number) => utcFromRome(day * DAY + second)
  const plan = {
    ...calmPlan(into(0)),
    drawn: true,
    from: 15 * 3600,
    sky: "overcast" as const,
    fog: "stratus" as const,
    lift: 47089,
  }
  const clear = { ...initialWeather(into(0), 1), plan },
    overcast = { ...clear, regime: "overcast" as const }
  assert.deepEqual(
    [regimeAt(plan, into(13 * 3600 + 300)), regimeAt(plan, into(15 * 3600))],
    ["clear", "overcast"],
  )
  assert.equal(regimeText(clear, null, "clear", into(10 * 3600)), "Clear, next change in 5 h 0 min")
  assert.equal(
    regimeText(clear, null, "clear", into(13 * 3600 + 300)),
    "Clear, next change in 1 h 55 min",
  )
  assert.equal(
    regimeText(overcast, null, "overcast", into(15 * 3600)),
    "Overcast, next change in 9 h 0 min",
  )
  assert.equal(
    untilChange(calmPlan(into(23 * 3600)), into(23 * 3600)),
    3600,
    "a calm start running past midnight ends there, as the next day's plan takes over",
  )
  // Every plan a new game draws at any hour of a winter, a spring and a summer day, some with a stratus lifting before it takes over,
  // and the whole day a jump into it draws: its regime holds until the countdown runs out, and the countdown runs out only when the plan
  // takes over or the regime changes.
  let early = 0
  for (const date of [day, daysFromCivil(2027, 4, 20), daysFromCivil(2027, 7, 10)]) {
    const at = (second: number) => utcFromRome(date * DAY + second),
      yesterday = { ...calmPlan(at(0)), drawn: true, day: date - 1 }
    for (let seed = 0; seed < 30; seed++) {
      for (let hour = 0; hour <= 24; hour++) {
        const drawn =
          hour < 24
            ? planFor(calmPlan(at(hour * 3600)), at(hour * 3600 + 1), seed)
            : planFor(yesterday, at(1), seed)
        early += drawn.fog === "stratus" && drawn.lift < drawn.from ? 1 : 0
        for (let second = 0; second < DAY; second += 900) {
          const end = second + untilChange(drawn, at(second)),
            label = `${JSON.stringify(drawn)} at ${second} s`
          assert.equal(regimeAt(drawn, at(end - 1)), regimeAt(drawn, at(second)), label)
          if (end < DAY && end !== drawn.from)
            assert.notEqual(regimeAt(drawn, at(end)), regimeAt(drawn, at(end - 1)), label)
        }
      }
    }
  }
  assert.ok(early > 0, "the sweep meets a stratus lifting before its plan takes over")
})

test("each event's odds read as a percentage, whole from 10 %, to the tenth under it, and a chance too small to show not as none", () => {
  const odds: DayOdds = {
    rain: 0.272,
    heavy: 0.0996,
    rainstorm: 0.046,
    thunder: 1,
    snow: 0.0004,
    fog: 0,
    clear: 0.522,
    overcast: 0.352,
    windy: 0.028,
  }
  assert.deepEqual(oddsText(odds, 209.4), {
    rain: "27 %, 1 mm or more",
    heavy: "10 %, 10 mm or more",
    rainstorm: "4.6 %, 20 mm or more",
    thunder: "100 %",
    snow: "< 0.1 % at 209 m",
    fog: "0 %, on the low ground",
    clear: "52 %, 4/8 cloud or less",
    overcast: "35 %, rain days included",
    windy: "2.8 %, over 20 knots",
  })
  assert.equal(oddsText({ ...odds, snow: 0.0021 }, 1748).snow, "0.2 % at 1748 m")
})

test("the odds the menu shows are the sim's own for Rome's month at the map's latitude, snowfall at the player's height, the ones each day is drawn from", () => {
  for (const z of [209, 1748]) {
    const shown = oddsReadout(START, z),
      odds = oddsAt(START, place().lat, z)
    assert.deepEqual(shown.rows, oddsText(odds, z), `at ${z} m`)
    assert.equal(shown.title, "Odds (October)")
  }
  assert.ok(
    oddsAt(START, place().lat, 1748).snow > oddsAt(START, place().lat, 209).snow,
    "higher up, more of it falls as snow",
  )
  assert.ok(
    oddsReadout(START, 0).about.includes(`${place().lat.toFixed(2)}° N`),
    "names the latitude",
  )
  // 23:30 UTC on 31 October 2026 is already 1 November in Rome: the month the day's plan belongs to.
  assert.equal(
    oddsReadout(daysFromCivil(2026, 10, 31) * DAY + 23.5 * 3600, 0).title,
    "Odds (November)",
  )
  assert.equal(
    oddsReadout(utcFromRome(daysFromCivil(2027, 1, 15) * DAY + 12 * 3600), 0).title,
    "Odds (January)",
  )
})

test("the weather seed reads as the 32-bit state it is, in hex", () => {
  assert.deepEqual(
    [seedText(0x9e3779b8), seedText(5), seedText(0xffffffff)],
    ["0x9e3779b8", "0x00000005", "0xffffffff"],
  )
})
