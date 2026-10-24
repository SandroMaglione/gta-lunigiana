import assert from "node:assert/strict"
import { test } from "node:test"

import { civilFromDays, DAY, daysFromCivil, romeDay, utcFromRome } from "../../sky/calendar.ts"
import { advanceWeather, initialWeather } from "../../sky/weather.ts"
import { FLOW, initialRivers, petAt, riversAfter, specificDischarge } from "../flow.ts"

// Calibration: 30 years of the game's weather at the shipped map's place, an hour a step, through the catchment model, against the
// Torrente Aulella at Soliera (208 km², ARPAL Annali Idrologici 2017, part II: the 1956–2012 years it was gauged). Its December and
// January run 21 % and 42 % low: the gauge's winters carry the autumn's water over (January's runoff is 1.45 times its rain), which
// two reservoirs fitted to the whole year do not.

/** Soliera's monthly mean flows, January to December, m³/s, and the flows exceeded on so many days a year (its duration curve). */
const SOLIERA = {
  area: 208,
  mean: 8.51,
  months: [15.49, 11.81, 9.0, 10.99, 7.69, 4.74, 2.53, 2.94, 4.39, 7.02, 12.01, 13.86],
  duration: [
    [10, 44.2],
    [30, 20.25],
    [60, 12.49],
    [91, 8.95],
    [135, 6.56],
    [182, 4.78],
    [274, 2.47],
    [355, 1.07],
  ],
} as const
const YEARS = 30,
  STEP = 3600

/** Hourly flows at Soliera over YEARS years from 2001 (after a year's run-in), with each hour's month, and the year's evapotranspiration. */
const run = (() => {
  const from = utcFromRome(daysFromCivil(2000, 1, 1) * DAY),
    start = from + 365 * DAY
  let weather = initialWeather(from, 12345),
    rivers = { snow: 0, soil: FLOW.capacity / 2, quick: 0, slow: 0 }
  const flows: Array<number> = [],
    months: Array<number> = []
  let pet = 0
  for (let t = from + STEP; t < start + YEARS * 365.25 * DAY; t += STEP) {
    const before = weather.precip
    weather = advanceWeather(weather, t, STEP)
    rivers = riversAfter(
      rivers,
      { precip: (before + weather.precip) / 2, anomaly: weather.anomaly },
      t,
      STEP,
    )
    if (t < start) continue
    flows.push(specificDischarge(rivers, FLOW) * SOLIERA.area)
    months.push(civilFromDays(romeDay(t).day).month - 1)
    pet += petAt(t)
  }
  return { flows, months, pet: pet / YEARS }
})()

test("the rivers' mean and their seasons: the Aulella at Soliera within 10 % over the year, wet winters, low summers", () => {
  const mean = run.flows.reduce((a, b) => a + b, 0) / run.flows.length
  assert.ok(
    Math.abs(mean / SOLIERA.mean - 1) < 0.1,
    `${mean.toFixed(2)} m³/s against ${SOLIERA.mean}`,
  )
  const monthly = SOLIERA.months.map((_, m) => {
    let sum = 0,
      n = 0
    run.months.forEach((month, k) => {
      if (month === m) [sum, n] = [sum + run.flows[k]!, n + 1]
    })
    return sum / n
  })
  monthly.forEach((q, m) =>
    // Within half again either way, three quarters below: the winters run low (above).
    assert.ok(
      q / SOLIERA.months[m]! < 1.5 && SOLIERA.months[m]! / q < 1.75,
      `month ${m + 1}: ${q.toFixed(2)} m³/s against ${SOLIERA.months[m]}`,
    ),
  )
  const winter = (monthly[10]! + monthly[11]! + monthly[0]! + monthly[1]!) / 4,
    summer = (monthly[6]! + monthly[7]!) / 2
  assert.ok(
    winter > 3 * summer,
    `November–February ${winter.toFixed(2)}, July–August ${summer.toFixed(2)}`,
  )
})

test("the rivers' flow-duration curve: each flow exceeded on so many days a year within a quarter of Soliera's", () => {
  const sorted = [...run.flows].sort((a, b) => b - a)
  for (const [days, flow] of SOLIERA.duration) {
    const q = sorted[Math.floor((days / 365) * sorted.length)]!
    assert.ok(
      Math.abs(q / flow - 1) < 0.25,
      `exceeded ${days} days a year: ${q.toFixed(2)} against ${flow}`,
    )
  }
})

test("evapotranspiration: Thornthwaite's from the climate's normals at the catchments' mean height is 685 mm a year", () => {
  assert.ok(Math.abs(run.pet - 685) < 5, `${run.pet.toFixed(0)} mm`)
})

test("a new game's rivers: the year before its start under the same weather, the same for the same start and seed", () => {
  const start = utcFromRome(daysFromCivil(2026, 10, 22) * DAY + 8 * 3600)
  assert.deepEqual(initialRivers(start, 7), initialRivers(start, 7))
  const spread = [1, 2, 3, 4, 5, 6].map(
    (seed) => specificDischarge(initialRivers(start, seed), FLOW) * SOLIERA.area,
  )
  // Late October: from a dry autumn's trickle to a spate after a wet week, around the month's 7 m³/s.
  assert.ok(Math.min(...spread) > 0.5 && Math.max(...spread) < 60, spread.join(", "))
  assert.ok(new Set(spread).size > 1, "the weather before differs by seed")
})
