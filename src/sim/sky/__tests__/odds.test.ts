import assert from "node:assert/strict"
import { test } from "node:test"

import { DAY, daysFromCivil, utcFromRome } from "../calendar.ts"
import { oddsAt, romeMonth } from "../odds.ts"

/** Noon in Rome on the 15th of `month` (1–12), 2026. */
const midMonth = (month: number) => utcFromRome(daysFromCivil(2026, month, 15) * DAY + 12 * 3600)
const MONTHS = Array.from({ length: 12 }, (_, m) => m + 1)
/** Within half a unit of the table's last decimal (three). */
const near = (a: number, b: number) => Math.abs(a - b) <= 0.0015

// The consolidated odds the research built at 42 N (generic-climate.md §2.0) and at 38 and 45.5 N (its odds.txt), interpolating the
// latitude anchors: ISPRA SCIA 1991–2020 rain days, ISPRA's national shares of heavy rain and rainstorms, and the Aeronautica
// Militare's 1971–2000 fog days and clear-ish days.
const AT_42 = {
  rain: [0.254, 0.26, 0.246, 0.253, 0.211, 0.141, 0.095, 0.105, 0.213, 0.231, 0.299, 0.291],
  heavy: [0.071, 0.07, 0.076, 0.073, 0.063, 0.045, 0.029, 0.035, 0.081, 0.086, 0.117, 0.096],
  rainstorm: [0.028, 0.026, 0.027, 0.025, 0.023, 0.017, 0.01, 0.016, 0.036, 0.039, 0.054, 0.035],
  fog: [0.149, 0.108, 0.09, 0.068, 0.059, 0.033, 0.021, 0.034, 0.051, 0.107, 0.126, 0.138],
  clear: [0.476, 0.485, 0.475, 0.442, 0.527, 0.644, 0.783, 0.764, 0.648, 0.541, 0.482, 0.482],
  // At 30 thunder days a year: the game has 40.
  thunder: [0.048, 0.06, 0.063, 0.074, 0.079, 0.087, 0.091, 0.098, 0.109, 0.112, 0.093, 0.069],
} as const
const AT_38 = {
  rain: [0.297, 0.301, 0.245, 0.203, 0.123, 0.067, 0.039, 0.061, 0.193, 0.226, 0.293, 0.329],
  fog: [0.029, 0.03, 0.029, 0.021, 0.035, 0.008, 0.01, 0.005, 0.007, 0.023, 0.023, 0.033],
} as const
const AT_45_5 = {
  rain: [0.174, 0.188, 0.19, 0.29, 0.297, 0.267, 0.216, 0.223, 0.243, 0.248, 0.283, 0.213],
  clear: [0.44, 0.52, 0.51, 0.44, 0.46, 0.52, 0.63, 0.63, 0.58, 0.51, 0.45, 0.46],
} as const
/** The mean of the Aeronautica Militare's four lowland groups' share of observations over 20 knots (%), one national row. */
const STRONG_WIND = [3.05, 2.83, 2.94, 2.42, 1.14, 0.95, 0.75, 0.61, 0.86, 1.38, 2.18, 3.03]

test("odds: each month's chances at 42 N are the national table's, thunder at 40 days a year but never above the rain days, a strong-wind day twice the share of windy observations", () => {
  for (const month of MONTHS) {
    const odds = oddsAt(midMonth(month), 42),
      m = month - 1
    for (const key of ["rain", "heavy", "rainstorm", "fog", "clear"] as const)
      assert.ok(near(odds[key], AT_42[key][m]!), `${key} in month ${month}: ${odds[key]}`)
    assert.ok(
      Math.abs(odds.thunder - Math.min(odds.rain, (AT_42.thunder[m]! * 40) / 30)) < 0.003,
      `thunder in month ${month}: ${odds.thunder}`,
    )
    assert.ok(Math.abs(odds.windy - (2 * STRONG_WIND[m]!) / 100) < 1e-12)
    assert.ok(
      odds.rainstorm <= odds.heavy &&
        odds.heavy <= odds.rain &&
        odds.thunder <= odds.rain &&
        odds.overcast >= odds.rain &&
        odds.overcast <= 1,
    )
  }
  for (const month of MONTHS) {
    const m = month - 1,
      south = oddsAt(midMonth(month), 38),
      north = oddsAt(midMonth(month), 45.5)
    assert.ok(
      near(south.rain, AT_38.rain[m]!) && near(south.fog, AT_38.fog[m]!),
      `38 N, month ${month}`,
    )
    assert.ok(
      near(north.rain, AT_45_5.rain[m]!) && near(north.clear, AT_45_5.clear[m]!),
      `45.5 N, month ${month}`,
    )
    // Held south of the southernmost anchors; snowfall follows the daily range too, which the national fit carries on with latitude.
    assert.deepEqual(
      { ...oddsAt(midMonth(month), 36.6, 0), snow: 0 },
      { ...oddsAt(midMonth(month), 38, 0), snow: 0 },
      "held south of the southernmost anchors",
    )
  }
})

test("odds: thunder days come to 40 a year less the months whose rain days cap them; the north's peak in summer, the south's in autumn and winter", () => {
  const year = (lat: number) =>
    MONTHS.reduce(
      (sum, month) =>
        sum +
        oddsAt(midMonth(month), lat).thunder *
          (daysFromCivil(2026, month + 1, 1) - daysFromCivil(2026, month, 1)),
      0,
    )
  for (const lat of [38, 42, 45.5])
    assert.ok(year(lat) > 37 && year(lat) <= 40.1, `${year(lat)} thunder days at ${lat} N`)
  const july = (lat: number) => oddsAt(midMonth(7), lat).thunder,
    november = (lat: number) => oddsAt(midMonth(11), lat).thunder
  assert.ok(july(45.5) > 2 * november(45.5) && november(38) > 2 * july(38))
})

test("odds: snowfall grows with height and northward, never at sea level from June to September; the far south's coasts see none", () => {
  for (const lat of [38, 42, 45.5]) {
    for (const month of MONTHS) {
      const [sea, hill, mountain] = [0, 879, 1220].map((z) => oddsAt(midMonth(month), lat, z).snow)
      assert.ok(
        sea! <= hill! && hill! <= mountain! && mountain! <= oddsAt(midMonth(month), lat).rain,
        `${lat} N, month ${month}`,
      )
      if (month >= 6 && month <= 9) assert.ok(sea! < 1e-4, `${lat} N, month ${month}: ${sea}`)
    }
    assert.ok(
      oddsAt(midMonth(1), lat, 1220).snow > oddsAt(midMonth(1), Math.max(38, lat - 3), 1220).snow ||
        lat === 38,
    )
  }
  assert.ok(
    MONTHS.every((month) => oddsAt(midMonth(month), 38, 0).snow < 0.005),
    "the south's coasts: about none",
  )
})

test("odds: a day belongs to Rome's calendar month, so the 1st just after Rome's midnight is the new month's", () => {
  const first = utcFromRome(daysFromCivil(2026, 11, 1) * DAY + 30 * 60)
  assert.deepEqual([romeMonth(first), romeMonth(first - 3600)], [10, 9])
  assert.notDeepEqual(oddsAt(first, 42), oddsAt(first - 3600, 42))
})
