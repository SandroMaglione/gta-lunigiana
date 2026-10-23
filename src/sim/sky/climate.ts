/**
 * The climate of the Lucido valley as a small model over the map's heights: the monthly temperature
 * normals with height, the daily cycle (a sine by day, a decay through the night), the weather's part
 * in them, how the share of snow in falling precipitation follows the air's temperature, how
 * precipitation grows with height, and the regime odds each month that the weather draws from. Pure functions of the game time, a height and the
 * `Weather` resource; render, audio and the HUD call them too.
 *
 * @module climate
 */
import { Ops } from "@typeonce/ritmo-math"

import { ORIGIN } from "../map/kinds.ts"
import type { WeatherValue } from "../schema.ts"
import type { SunPlace } from "./astro.ts"
import { civilFromDays, DAY, daysFromCivil } from "./calendar.ts"
import { SUNRISE_ELEVATION, sunOver } from "./day.ts"
import type { Regime } from "./regimes.ts"

/** One month's temperature normals. */
export interface MonthClimate {
  /** Daily mean at sea level (°C), as the inland stations extrapolate it. */
  readonly mean: number
  /** Fall of the daily mean with height up to 1100 m and above it, K/km. */
  readonly lapse: number
  readonly lapseUp: number
  /** Daily range (max − min, °C) on the valley floor (250 m and below) and on the ridges (1100 m and above). */
  readonly rangeValley: number
  readonly rangeRidge: number
}

/**
 * Monthly temperature normals for 1991–2020, January first, from the two licensed sources only.
 * - Up to 1100 m the daily mean runs straight from ISPRA SCIA's Pontremoli depuratore (290 m, the
 *   Magra's floor, 1991–2020 normals, CC BY 4.0) to the Aeronautica Militare's Passo della Cisa (1048 m,
 *   Atlante Climatico 1971–2000). SCIA has no other temperature station in Lunigiana, Garfagnana or the
 *   Apuan Alps.
 * - Above 1100 m the lapse runs on to Monte Cimone (2173 m): SCIA's 1991–2020 max, and the Aeronautica
 *   Militare's 1971–2000 min.
 * - The Aeronautica Militare's 1971–2000 values are brought to 1991–2020 by the change SCIA measures
 *   between the two periods at Pontremoli depuratore, Ligonchio, Sestola and Diga del Brugneto (max
 *   +0.15 to +1.9 °C, min +0.15 to +1.0 °C by month).
 * - The valley range is Pontremoli depuratore's mean max − min, and the ridges' is the mean of Cisa's
 *   and Cimone's.
 */
const CLIMATE: ReadonlyArray<MonthClimate> = [
  { mean: 7.5, lapse: 6.8, lapseUp: 3.1, rangeValley: 9.2, rangeRidge: 4.4 },
  { mean: 8.1, lapse: 7.1, lapseUp: 3.8, rangeValley: 10.6, rangeRidge: 4.8 },
  { mean: 10.7, lapse: 6.5, lapseUp: 5.1, rangeValley: 11.7, rangeRidge: 5.3 },
  { mean: 13.5, lapse: 6.2, lapseUp: 6.1, rangeValley: 12.5, rangeRidge: 5.9 },
  { mean: 17.3, lapse: 5.2, lapseUp: 6.4, rangeValley: 13.0, rangeRidge: 6.4 },
  { mean: 21.0, lapse: 5.1, lapseUp: 6.0, rangeValley: 13.9, rangeRidge: 7.1 },
  { mean: 23.3, lapse: 4.5, lapseUp: 6.1, rangeValley: 14.9, rangeRidge: 7.4 },
  { mean: 23.3, lapse: 4.2, lapseUp: 6.3, rangeValley: 14.9, rangeRidge: 7.1 },
  { mean: 19.5, lapse: 5.1, lapseUp: 6.0, rangeValley: 12.8, rangeRidge: 5.6 },
  { mean: 15.6, lapse: 5.8, lapseUp: 4.5, rangeValley: 10.5, rangeRidge: 4.7 },
  { mean: 11.4, lapse: 6.3, lapseUp: 3.8, rangeValley: 9.0, rangeRidge: 4.1 },
  { mean: 7.9, lapse: 6.1, lapseUp: 3.4, rangeValley: 9.0, rangeRidge: 4.2 }
]

/** A snow line above everything on the map (m a.s.l.): no snow lies anywhere. */
export const NO_SNOW = 3000

/** One month's design values for the weather, calibrated against the climate normals (climate.test.ts). */
export interface Season {
  /** How likely each regime is drawn this month, before its neighbours (`REGIME_SPECS[...].next`) weigh it. */
  readonly odds: Readonly<Record<Regime, number>>
  /** The chance that a clear, calm morning brings radiation fog to the valley floors. */
  readonly valleyFog: number
  /** The lowest ground with snow cover a new game starts with (m a.s.l.; `NO_SNOW` for none). */
  readonly snowLine: number
}

/** Each month's regime odds, valley-fog chance and starting snow line, January first: the storm odds give the design value of 40 thunder days a year (climate.test.ts). */
export const SEASONS: ReadonlyArray<Season> = [
  { odds: { clear: 3, fair: 2.5, cloudy: 5.4, overcast: 3.1, fog: 4.5, rain: 0.89, storm: 0.26, windy: 2, snow: 0.42 }, valleyFog: 0.57, snowLine: 1300 },
  { odds: { clear: 3, fair: 2.5, cloudy: 4, overcast: 2.25, fog: 2.9, rain: 0.68, storm: 0.34, windy: 2, snow: 0.27 }, valleyFog: 0.41, snowLine: 1300 },
  { odds: { clear: 3, fair: 3, cloudy: 4.2, overcast: 2.35, fog: 1.2, rain: 0.75, storm: 0.46, windy: 1.5, snow: 0.43 }, valleyFog: 0.27, snowLine: 1500 },
  { odds: { clear: 3, fair: 3.5, cloudy: 2.9, overcast: 1.55, fog: 0.6, rain: 1, storm: 0.43, windy: 1, snow: 0.11 }, valleyFog: 0.18, snowLine: 1700 },
  { odds: { clear: 3, fair: 3.4, cloudy: 2.95, overcast: 1.35, fog: 0.28, rain: 0.69, storm: 0.47, windy: 0.5, snow: 0 }, valleyFog: 0.06, snowLine: NO_SNOW },
  { odds: { clear: 3, fair: 3, cloudy: 2.35, overcast: 0.8, fog: 0.16, rain: 0.37, storm: 0.45, windy: 0.33, snow: 0 }, valleyFog: 0.06, snowLine: NO_SNOW },
  { odds: { clear: 3, fair: 2.25, cloudy: 1.8, overcast: 0.29, fog: 0.07, rain: 0.04, storm: 0.45, windy: 0.25, snow: 0 }, valleyFog: 0.02, snowLine: NO_SNOW },
  { odds: { clear: 3, fair: 2.45, cloudy: 1.85, overcast: 0.45, fog: 0.11, rain: 0.08, storm: 0.43, windy: 0.27, snow: 0 }, valleyFog: 0.04, snowLine: NO_SNOW },
  { odds: { clear: 3, fair: 2.7, cloudy: 1.95, overcast: 0.78, fog: 0.36, rain: 0.46, storm: 0.46, windy: 0.67, snow: 0 }, valleyFog: 0.14, snowLine: NO_SNOW },
  { odds: { clear: 3, fair: 2.6, cloudy: 2.25, overcast: 1.25, fog: 1.2, rain: 0.81, storm: 0.5, windy: 1.3, snow: 0.03 }, valleyFog: 0.34, snowLine: NO_SNOW },
  { odds: { clear: 3, fair: 2.5, cloudy: 4, overcast: 2.45, fog: 3.5, rain: 0.97, storm: 0.56, windy: 1.5, snow: 0.17 }, valleyFog: 0.6, snowLine: 1700 },
  { odds: { clear: 3, fair: 2.5, cloudy: 5.75, overcast: 3.45, fog: 5, rain: 0.89, storm: 0.55, windy: 2, snow: 0.48 }, valleyFog: 0.86, snowLine: 1500 }
]

/** The calendar month (0 January … 11 December) at UTC second `t`. */
export const monthOf = (t: number): number => civilFromDays(Math.floor(t / DAY)).month - 1

/** Where `t` falls between two months' middles: the month before (0–11), the month after, and how far from the first to the second (0…1). */
const between = (t: number): { readonly from: number; readonly to: number; readonly share: number } => {
  const days = Math.floor(t / DAY), { year, month, day } = civilFromDays(days)
  const length = daysFromCivil(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1, 1) - daysFromCivil(year, month, 1)
  const position = month - 1 + (day - 1 + (t - days * DAY) / DAY) / length - 0.5
  const from = Math.floor(position)
  return { from: (from + 12) % 12, to: (from + 13) % 12, share: position - from }
}

/** The temperature normals at UTC second `t`: linear between the middles of the months. */
export const normalsAt = (t: number): MonthClimate => {
  const { from, to, share } = between(t), a = CLIMATE[from]!, b = CLIMATE[to]!
  const mix = (x: number, y: number) => x + (y - x) * share
  return {
    mean: mix(a.mean, b.mean), lapse: mix(a.lapse, b.lapse), lapseUp: mix(a.lapseUp, b.lapseUp),
    rangeValley: mix(a.rangeValley, b.rangeValley), rangeRidge: mix(a.rangeRidge, b.rangeRidge)
  }
}

/** Where the inland valleys' mean lapse gives way to the ridges' gentler one (m), and where the daily range starts and stops shrinking with height. */
const KNEE = 1100
const RANGE_FROM = 250

/** The hour of local solar time when the day is warmest; the coldest is at sunrise. */
const WARMEST = 14.5

/**
 * How fast the night cools toward the next sunrise's minimum (Parton and Logan's `b`) under a clear sky
 * in a wind: 3.14, the generic value Felber, Stoeckli and Calanca (2017, Int. J. Biometeorol. 62:621,
 * CC BY 4.0) fit to clear-sky days at Swiss stations below 800 m. The weather's share of the range
 * (`rangeShare`) scales it: a still, clear night cools fastest just after sunset, a cloudy or windy one
 * more evenly.
 */
const NIGHT_DECAY = 3.14

/**
 * The day's temperature cycle with the sun at `sun` over the map, −0.5 at the minimum to +0.5 at the
 * maximum: Parton and Logan's (1981, Agric. Meteorol. 23:205) curve, closed as Felber et al. (2017) close
 * it. A sine rises from the minimum at sunrise to the maximum at 14:30 solar time and falls on to sunset;
 * the night then decays toward the next sunrise's minimum as e^(−decay·x) − x·e^(−decay), x the share of
 * the night gone, so it meets the minimum there with no jump. (Felber et al.'s generic fit has the minimum
 * 0.75 h after sunrise and the maximum at 14:43; the game keeps sunrise and 14:30.)
 */
const dailyCycle = (sun: SunPlace, decay: number): number => {
  const RAD = Math.PI / 180, dec = sun.declination * RAD, phi = ORIGIN.lat * RAD
  const cosRise = (Ops.sin(SUNRISE_ELEVATION * RAD) - Ops.sin(phi) * Ops.sin(dec)) / (Ops.cos(phi) * Ops.cos(dec))
  const rise = 12 - Ops.acos(Math.max(-1, Math.min(1, cosRise))) / RAD / 15, set = 24 - rise
  const span = set - rise + 2 * (WARMEST - 12), solar = 12 + sun.hourAngle / 15
  if (solar >= rise && solar <= set) return Ops.sin((Math.PI * (solar - rise)) / span) - 0.5
  const x = ((solar - set + 24) % 24) / (24 - (set - rise))
  return Ops.sin((Math.PI * (set - rise)) / span) * (Ops.exp(-decay * x) - x * Ops.exp(-decay)) - 0.5
}

/**
 * How much of the daily range the weather lets through: 0.4 under a full cloud cover, 1 under a clear
 * sky in a wind, 1.15 clear and calm (the valley floors cool most on still, clear nights).
 */
const rangeShare = (cloud: number, wind: number): number => {
  const calm = Math.max(0, Math.min(1, (6 - wind) / 4))
  return 0.4 + (1 - cloud) * (0.6 + 0.15 * calm)
}

/** The air over the map at one instant, before height: today's normals, where the day stands in its cycle (× the weather's share of the range), and the weather's anomaly (°C). */
export interface Air {
  readonly normals: MonthClimate
  readonly swing: number
  readonly anomaly: number
}

/** The air at UTC second `t` under `weather` (pass `sun`, `sunOver(t)`, when it is already worked out). */
export const airAt = (t: number, weather: Pick<WeatherValue, "cloud" | "wind" | "anomaly">, sun: SunPlace = sunOver(t)): Air => {
  const share = rangeShare(weather.cloud, weather.wind)
  return { normals: normalsAt(t), swing: dailyCycle(sun, NIGHT_DECAY * share) * share, anomaly: weather.anomaly }
}

/** The air's temperature at `z` m a.s.l., °C: the mean down its lapse rates, the daily range shrinking from the valley floor to the ridges, and the anomaly. */
export const celsiusAt = (air: Air, z: number): number => {
  const { mean, lapse, lapseUp, rangeValley, rangeRidge } = air.normals
  const daily = z <= KNEE ? mean - (lapse * z) / 1000 : mean - (lapse * KNEE) / 1000 - (lapseUp * (z - KNEE)) / 1000
  const s = Math.max(0, Math.min(1, (z - RANGE_FROM) / (KNEE - RANGE_FROM))), range = rangeValley + (rangeRidge - rangeValley) * s * s * (3 - 2 * s)
  return daily + range * air.swing + air.anomaly
}

/**
 * The share of precipitation falling as snow at `celsius`: all of it at or below 0.5 °C, none at or above
 * 1.5 °C, half at 1.0 °C, where Jennings et al. (2018, Nat. Commun. 9:1148, CC BY 4.0) find the rain–snow
 * threshold of the Northern Hemisphere's air temperature on average (a temperature-only phase rule).
 */
export const snowShare = (celsius: number): number => Math.max(0, Math.min(1, 1.5 - celsius))

/** Where `snowShare` is a half: 1.0 °C. */
const HALF_SNOW = 1

/** The height (m a.s.l.) where the air of `air` is at 1.0 °C, so half the precipitation falls as snow: found by bisection between −1000 and 5000 m, clamped to them. */
export const freezingLevel = (air: Air): number => {
  let low = -1000, high = 5000
  if (celsiusAt(air, low) <= HALF_SNOW) return low
  if (celsiusAt(air, high) >= HALF_SNOW) return high
  for (let k = 0; k < 30; k++) {
    const mid = (low + high) / 2
    if (celsiusAt(air, mid) > HALF_SNOW) low = mid
    else high = mid
  }
  return (low + high) / 2
}

/**
 * How much more precipitation falls at `z` m a.s.l. than on the valley floor (250 m): 0.95 more per km.
 * That is the least-squares line through the ISPRA SCIA 1991–2020 annual totals of the 11 gauges at
 * 141–1020 m in Lunigiana, the Serchio valley and on the Apuan Alps (Pontremoli depuratore 1654 mm at
 * 290 m up to Campagrina 2982 mm at 1020 m). Above about 1620 m it is held at 2.3, a design value, as
 * no gauge stands on the crests.
 */
export const orographic = (z: number): number => Math.max(1, Math.min(2.3, 1 + (0.95 * (z - 250)) / 1000))
