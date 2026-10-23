import assert from "node:assert/strict"
import { test } from "node:test"

import { Random } from "@typeonce/ritmo-math"

import { DAY, daysFromCivil, romeOffset, utcFromRome } from "./calendar.ts"
import { type Air, airAt, celsiusAt, freezingLevel, monthOf, normalsAt, orographic, snowShare } from "./climate.ts"
import { sunOver, sunTimes } from "./day.ts"
import { fogLayers } from "./local.ts"
import { advanceWeather, initialWeather } from "./weather.ts"

/** UTC second of `year`-`month`-`day` `hour`:00 UTC. */
const utc = (year: number, month: number, day: number, hour = 0) => daysFromCivil(year, month, day) * DAY + hour * 3600

test("temperature: mid-month normals give back the stations they are fitted to: Pontremoli depuratore's max and min, Passo della Cisa's and Monte Cimone's mean", () => {
  // [month, max and min at 290 m, mean at 1048 m, mean at 2173 m], 1991–2020: ISPRA SCIA's Pontremoli depuratore and the
  // Aeronautica Militare's 1971–2000 Cisa and Cimone, brought to 1991–2020 as CLIMATE says (Cimone's max is SCIA's own).
  const stations = [[1, 10.1, 0.9, 0.34, -3.36], [4, 18.0, 5.5, 7.08, 0.26], [7, 29.4, 14.5, 18.55, 11.79], [10, 19.2, 8.7, 9.54, 4.41]] as const
  for (const [month, max, min, cisa, cimone] of stations) {
    const normals = normalsAt(utc(2026, month, 15, 12))
    const at = (swing: number, z: number) => celsiusAt({ normals, swing, anomaly: 0 } satisfies Air, z)
    assert.ok(Math.abs(at(0.5, 290) - max) < 0.25 && Math.abs(at(-0.5, 290) - min) < 0.25, `${month} at 290 m: ${at(0.5, 290).toFixed(2)} / ${at(-0.5, 290).toFixed(2)}`)
    assert.ok(Math.abs(at(0, 1048) - cisa) < 0.25 && Math.abs(at(0, 2173) - cimone) < 0.25, `${month}: ${at(0, 1048).toFixed(2)} at 1048 m, ${at(0, 2173).toFixed(2)} at 2173 m`)
  }
})

test("temperature: the day is coldest at sunrise and warmest at 14:30 solar time, and a clear calm day swings wider than an overcast one", () => {
  const day = utc(2026, 10, 22), clearCalm = { cloud: 0, wind: 0, anomaly: 0 }
  let coldest = { t: 0, v: 1 }, warmest = { t: 0, v: -1 }
  for (let t = day; t < day + DAY; t += 60) {
    const v = airAt(t, clearCalm).swing / 1.15
    if (v < coldest.v) coldest = { t, v }
    if (v > warmest.v) warmest = { t, v }
  }
  // USNO: sunrise 05:43 UTC; 14:30 local solar time at 10.13° E is 13:50 UTC less the equation of time (15.6 min).
  assert.ok(Math.abs(coldest.t - (day + 5 * 3600 + 43 * 60)) <= 120 && Math.abs(coldest.v + 0.5) < 1e-3, `coldest ${(coldest.t - day) / 3600} h`)
  assert.ok(Math.abs(warmest.t - (day + 13 * 3600 + 34 * 60)) <= 120 && Math.abs(warmest.v - 0.5) < 1e-3, `warmest ${(warmest.t - day) / 3600} h`)
  const swing = (cloud: number, wind: number) => {
    const at = (hour: number) => celsiusAt(airAt(day + hour * 3600, { cloud, wind, anomaly: 0 }), 250)
    return at(13.5) - at(5.7)
  }
  assert.ok(swing(0, 0) > swing(0, 8) && swing(0, 8) > swing(1, 3) * 2, `${swing(0, 0)}, ${swing(0, 8)}, ${swing(1, 3)} °C`)
})

test("temperature: a clear October evening on the valley floor cools fast after sunset, then slowly toward the minimum at sunrise, with no jump; cloud and wind flatten the night's fall", () => {
  // 22 October 2026 at the Monzone spawn (209 m): sunrise 07:42 and sunset 18:24 in Rome.
  const day = utcFromRome(daysFromCivil(2026, 10, 22) * DAY), sun = sunTimes(day)!
  const at = (t: number, cloud: number, wind: number) => celsiusAt(airAt(t, { cloud, wind, anomaly: 0 }), 209)
  let max = -Infinity, min = Infinity, jump = 0
  for (let t = day; t < day + DAY; t += 10) {
    const c = at(t, 0, 2)
    max = Math.max(max, c)
    min = Math.min(min, c)
    jump = Math.max(jump, Math.abs(at(t + 10, 0, 2) - c))
  }
  assert.ok(jump < 0.02, `the steepest 10 s change is ${jump} °C`)
  const evening = at(day + 21 * 3600, 0, 2)
  assert.ok(max > 18.7 && max < 20.2 && min > 7 && min < 8.5, `the day's max ${max} °C and min ${min} °C`)
  assert.ok(evening > 11.8 && evening < 13.3, `21:00 at ${evening} °C, the afternoon's max ${max} °C`)
  assert.ok(at(day + DAY, 0, 2) - min > 1.5 && at(sun.sunrise - 3600, 0, 2) - min < 0.3, "at midnight still above the minimum, the hour before sunrise just over it")
  // The share of the night's fall gone by 21:00, from sunset to the next sunrise's minimum.
  const gone = (cloud: number, wind: number) => {
    const sunset = at(sun.sunset, cloud, wind), sunrise = at(sun.sunrise + DAY, cloud, wind)
    return (sunset - at(day + 21 * 3600, cloud, wind)) / (sunset - sunrise)
  }
  assert.ok(gone(0, 2) > gone(0, 8) && gone(0, 8) > gone(1, 3) + 0.15, `${gone(0, 2)}, ${gone(0, 8)}, ${gone(1, 3)}`)
})

test("precipitation: rain above 1.5 °C, snow below 0.5 °C, half and half at 1.0 °C; the freezing level is where the air is at 1.0 °C; more falls higher up", () => {
  assert.deepEqual([snowShare(2), snowShare(1.5), snowShare(1), snowShare(0.5), snowShare(-3)], [0, 0, 0.5, 1, 1])
  for (const [month, anomaly] of [[1, 0], [1, -4], [7, 0], [4, 2]] as const) {
    const air = airAt(utc(2026, month, 15, 12), { cloud: 1, wind: 3, anomaly }), level = freezingLevel(air)
    assert.ok(Math.abs(celsiusAt(air, level) - 1) < 1e-6, `${month}, ${anomaly} °C: ${level} m`)
  }
  assert.deepEqual([orographic(100), orographic(250), orographic(5000)], [1, 1, 2.3])
  assert.ok(Math.abs(orographic(1100) - 1.8075) < 1e-9)
})

// Calibration: the regime chain run for many simulated years, every month against the climate it was fitted to (climate.ts, SEASONS).
// Targets, valley floor (250 m):
// - wet days (≥ 1 mm): ISPRA SCIA's 1991–2020 normals on the valley floors either side of the map, the mean of Pontremoli depuratore
//   (290 m, the Magra) and Gallicano (194 m, the Serchio);
// - thunder days: a design value of 40 a year (the user's choice: no licensed source counts thunder days here, and the Aeronautica
//   Militare's normals give none), spread over the months by the Aeronautica Militare's share of observations with cumulonimbus at
//   Sarzana-Luni, 09–18 UTC, 1973–2000 (winter 1.31 %, spring 3.52 %, summer 5.20 %, autumn 4.26 %), placed at January, April, July
//   and October and straight between: a summer peak over land and a long autumn, the seasons Morgenstern et al. (2023, Weather Clim.
//   Dynam. 4:489, CC BY 4.0) find over Italy;
// - valley-fog mornings: design estimates between Sarzana-Luni's 5 and Pisa's 56 fog days a year (Aeronautica Militare 1971–2000), most
//   in October–February;
// - relative sunshine: Pisa San Giusto's sunshine hours over the day's length (Aeronautica Militare 1961–1990);
// - days with snowfall (≥ 1 mm of water, about 1 cm of fresh snow) from November to April: 11.2 ± 1.9 at 650–1375 m (median 879 m) and
//   20.0 ± 5.4 at 1000–1430 m (median 1220 m), Capozzi et al. (2025, The Cryosphere 19:565, CC BY 4.0) for the central and southern
//   Apennines, 1971–2000; held within half either way, as the Apuan Alps are wetter and milder;
// - snow on January's wet days at 1040 m: emergent, the phase rule (T50 1.0 °C, Jennings et al. 2018) over the January normals there
//   (0.5 °C, CLIMATE's fit) and the regimes' anomalies; held only between 0.2 and 0.6, as that normal sits beside the rule's half
//   point;
// - snow-cover days a year: 35–60 at 1000–1300 m (Capozzi et al. 2025), and a design estimate of some 120–150 on the crests.
const WET_DAYS = [9.3, 8.65, 8.25, 10.15, 8.85, 6.65, 4.75, 5.15, 7.95, 10.65, 12.25, 10.9]
const CUMULONIMBUS = [1.31, 3.52, 5.2, 4.26]
const THUNDER_SHAPE = Array.from({ length: 12 }, (_, month) => {
  const season = Math.floor(month / 3), along = (month % 3) / 3
  return CUMULONIMBUS[season]! + (CUMULONIMBUS[(season + 1) % 4]! - CUMULONIMBUS[season]!) * along
})
/** Thunder days a year: a design value. */
const THUNDER_YEAR = 40
const THUNDER_DAYS = THUNDER_SHAPE.map((share) => (share * THUNDER_YEAR) / THUNDER_SHAPE.reduce((sum, s) => sum + s, 0))
const FOG_MORNINGS = [6, 4, 3, 2, 1, 1, 0.5, 1, 3, 6, 7, 7]
const SUNSHINE = [0.37, 0.41, 0.42, 0.48, 0.53, 0.57, 0.67, 0.64, 0.59, 0.52, 0.39, 0.34]
/** The two heights of the snowfall days' target, m (Capozzi et al.'s clusters' medians). */
const SNOWFALL = [879, 1220] as const
const DAYS_IN = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

/** One simulated day's record, Rome's calendar day. */
interface DayRecord {
  readonly month: number
  precip: number
  storm: number
  fog: boolean
  sun: number
  daylight: number
  high: number
  highSnow: number
  lowSnow: number
  readonly snowfall: Array<number>
  cover: readonly [boolean, boolean]
}

/** `years` of weather from 2026-01-01 in steps of `rate` game seconds, drawn from seed `seed`, day by day. */
const simulate = (years: number, rate: number, seed: number) => {
  const from = utc(2026, 1, 1), random = Random.make(seed), days = new Map<number, DayRecord>()
  let weather = initialWeather(from)
  for (let t = from; t < from + years * 365.25 * DAY; t += rate) {
    weather = advanceWeather(weather, t, rate, random)
    const local = t + romeOffset(t), d = Math.floor(local / DAY), hour = (local - d * DAY) / 3600
    const day = days.get(d) ?? { month: monthOf(t), precip: 0, storm: 0, fog: false, sun: 0, daylight: 0, high: 0, highSnow: 0, lowSnow: 0, snowfall: [0, 0], cover: [false, false] }
    days.set(d, day)
    const sun = sunOver(t), air = airAt(t, weather, sun), fog = fogLayers(t, weather), mm = (weather.precip * rate) / 3600
    day.precip += mm
    day.storm = Math.max(day.storm, weather.storm)
    if (Math.abs(hour - 8) < rate / 7200) day.fog = fog.valleyDensity >= 0.5 && fog.valleyTop > 260
    if (sun.elevation > 0) {
      day.sun += (1 - weather.cloud) * (fog.valleyDensity > 0.5 ? 0.3 : 1)
      day.daylight++
    }
    day.high += mm * orographic(1040)
    day.highSnow += mm * orographic(1040) * snowShare(celsiusAt(air, 1040))
    day.lowSnow += mm * snowShare(celsiusAt(air, 150))
    SNOWFALL.forEach((z, k) => { day.snowfall[k]! += mm * orographic(z) * snowShare(celsiusAt(air, z)) })
    if (Math.abs(hour - 12) < rate / 7200) day.cover = [weather.snowLine <= 1100, weather.snowLine <= 1750]
  }
  return Array.from({ length: 12 }, (_, month) => {
    const list = [...days.values()].filter((d) => d.month === month), per = DAYS_IN[month]! / list.length
    const wetHigh = list.filter((d) => d.high >= 1)
    return {
      wet: list.filter((d) => d.precip >= 1).length * per, thunder: list.filter((d) => d.storm >= 0.25).length * per, fog: list.filter((d) => d.fog).length * per,
      sunshine: list.reduce((s, d) => s + d.sun, 0) / list.reduce((s, d) => s + d.daylight, 0),
      snowHigh: wetHigh.filter((d) => d.highSnow >= d.high / 2).length / wetHigh.length, lowSnow: list.reduce((s, d) => s + d.lowSnow, 0),
      snowfall: SNOWFALL.map((_, k) => list.filter((d) => d.snowfall[k]! >= 1).length * per),
      cover: [list.filter((d) => d.cover[0]).length * per, list.filter((d) => d.cover[1]).length * per] as const
    }
  })
}

test("climate: sixteen simulated years match each month's wet days, thunder days, valley-fog mornings and sunshine; snow falls on the mountains about as often as on the Apennines' stations, never in summer", () => {
  const months = simulate(16, 900, 1)
  months.forEach((m, i) => {
    const month = `month ${i + 1}: ${JSON.stringify(m)}`
    assert.ok(Math.abs(m.wet - WET_DAYS[i]!) <= 3, `${month}: wet days, against ${WET_DAYS[i]}`)
    assert.ok(Math.abs(m.thunder - THUNDER_DAYS[i]!) <= 1.5, `${month}: thunder days, against ${THUNDER_DAYS[i]}`)
    assert.ok(Math.abs(m.fog - FOG_MORNINGS[i]!) <= 2, `${month}: fog mornings, against ${FOG_MORNINGS[i]}`)
    assert.ok(Math.abs(m.sunshine - SUNSHINE[i]!) <= 0.06, `${month}: sunshine, against ${SUNSHINE[i]}`)
  })
  const thunder = months.reduce((sum, m) => sum + m.thunder, 0)
  assert.ok(Math.abs(thunder - THUNDER_YEAR) <= 4, `${thunder} thunder days a year, against ${THUNDER_YEAR}`)
  assert.ok(months[0]!.snowHigh >= 0.2 && months[0]!.snowHigh <= 0.6, `January's wet days with snow at 1040 m: ${months[0]!.snowHigh}`)
  const winter = (k: 0 | 1) => [10, 11, 0, 1, 2, 3].reduce((sum, m) => sum + months[m]!.snowfall[k]!, 0)
  for (const [k, days] of [[0, 11.2], [1, 20.0]] as const) {
    assert.ok(winter(k) >= days / 2 && winter(k) <= days * 1.5, `${winter(k)} days with snowfall at ${SNOWFALL[k]} m from November to April, against ${days}`)
  }
  assert.deepEqual(months.slice(5, 9).map((m) => m.lowSnow), [0, 0, 0, 0], "no snow at 150 m from June to September")
  assert.deepEqual(months.slice(4, 10).map((m) => m.snowHigh), [0, 0, 0, 0, 0, 0], "no snowy day at 1040 m from May to October")
  const year = (k: 0 | 1) => months.reduce((sum, m) => sum + m.cover[k], 0)
  assert.ok(year(0) >= 25 && year(0) <= 70, `${year(0)} days of snow cover at 1100 m`)
  assert.ok(year(1) >= 90 && year(1) <= 170, `${year(1)} days of snow cover at 1750 m`)
})
