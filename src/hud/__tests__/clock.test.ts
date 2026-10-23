import assert from "node:assert/strict"
import { test } from "node:test"

import { DAY, daysFromCivil, utcFromRome } from "../../sim/sky/calendar.ts"
import { airAt, celsiusAt } from "../../sim/sky/climate.ts"
import { conditionsAt } from "../../sim/sky/local.ts"
import { describeWeather } from "../../sim/sky/readout.ts"
import { initialWeather, setWeather } from "../../sim/sky/weather.ts"
import { clockText, weatherText } from "../clock.ts"

/** The Monzone spawn, on the valley floor (x east, y north, z m a.s.l.), and the top of Monte Sagro. */
const SPAWN = { x: -412.9, y: 438.1, z: 209 } as const
const SAGRO = { x: 2364, y: -5129, z: 1748 } as const
/** 15 January 2027, 13:00 in Rome. */
const JANUARY = utcFromRome(daysFromCivil(2027, 1, 15) * DAY + 13 * 3600)

test("the clock reads a 24-hour HH:MM, the minutes cut as a clock cuts them", () => {
  assert.equal(clockText(0), "00:00")
  assert.equal(clockText(23400), "06:30")
  assert.equal(clockText(86399), "23:59")
  assert.equal(clockText(12 * 3600 + 30 * 60 + 59), "12:30", "a second before 12:31")
})

test("the weather readout gives the sim's word for the weather where the player stands and the air's temperature there, to the whole degree", () => {
  const weather = setWeather(initialWeather(JANUARY, 1), { regime: "rain", settle: true }, JANUARY)!
  const sky = { seconds: JANUARY, weather }
  for (const { x, y, z } of [SPAWN, SAGRO]) {
    const word = describeWeather(weather, conditionsAt(JANUARY, weather, x, y, z))
    assert.equal(
      weatherText(sky, x, y, z),
      `${word} · ${Math.round(celsiusAt(airAt(JANUARY, weather), z))} °C`,
    )
  }
  assert.match(
    weatherText(sky, SPAWN.x, SPAWN.y, SPAWN.z),
    /^Rain · \d+ °C$/,
    "rain on the valley floor",
  )
  assert.match(
    weatherText(sky, SAGRO.x, SAGRO.y, SAGRO.z),
    /^Snow · (0|-?[1-9]\d*) °C$/,
    "snow on the crest, at 0 °C, never a negative zero",
  )
})
