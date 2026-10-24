/**
 * How much water the rivers carry: one catchment model for the whole map, fed by the weather's
 * precipitation at the catchments' mean height, giving the discharge per km² of catchment that
 * every river and stream runs at (the drainage-area ratio: a reach carries it times the area
 * upstream of it). A snowpack (degree-day melt), a soil store (HBV: the wetter the soil the more of
 * the rain runs off; it dries by evapotranspiration, Thornthwaite's from the climate's normals) and
 * two linear reservoirs: quick runoff over hours, groundwater over weeks. Fitted to the Torrente
 * Aulella at Soliera (208 km², ARPAL Annali Idrologici 2017, part II): its monthly mean flows and
 * flow-duration curve under 30 years of the game's own weather (flow.test.ts).
 *
 * @module water/flow
 */
import { Ops } from "@typeonce/ritmo-math"

import type { RiversValue, WeatherValue } from "../schema.ts"
import { civilFromDays, DAY, daysFromCivil, romeDay } from "../sky/calendar.ts"
import { dailyMean, normalsAt, orographic, snowShare } from "../sky/climate.ts"
import { place } from "../sky/place.ts"
import { advanceWeather, initialWeather } from "../sky/weather.ts"

/** The model's parameters. */
export interface FlowParams {
  /** Precipitation over the catchment for each mm/h of the weather's at its mean height. */
  readonly gain: number
  /** Soil field capacity, mm. */
  readonly capacity: number
  /** HBV's shape: runoff share = (soil / capacity)^beta. */
  readonly beta: number
  /** Evapotranspiration runs at the full potential rate down to this share of capacity. */
  readonly lp: number
  /** Share of the runoff that runs off quickly; the rest recharges the groundwater. */
  readonly split: number
  /** Time constants of the quick and slow reservoirs, game seconds. */
  readonly quickTau: number
  readonly slowTau: number
  /** Degree-day snowmelt, mm per °C above 0 per game second. */
  readonly melt: number
}

/** 1 mm/h over 1 km² in m³/s. */
const MM_PER_HOUR = 1000 / 3600

/** Discharge per km² of catchment (m³/s) leaving `c`'s two reservoirs. */
export const specificDischarge = (c: RiversValue, p: FlowParams): number =>
  (c.quick / p.quickTau + c.slow / p.slowTau) * 3600 * MM_PER_HOUR

/** A reservoir of `store` mm with time constant `tau` after `seconds` of `inflow` mm/s: exact for constant inflow. */
const drain = (store: number, inflow: number, tau: number, seconds: number): number => {
  const balance = inflow * tau
  return balance + (store - balance) * Ops.exp(-seconds / tau)
}

/**
 * The catchment after `seconds` of `precip` mm/h falling (the weather's at its mean height) with
 * a `snowShare` of it as snow, the air at `celsius` there and the potential evapotranspiration
 * `pet` mm/h. The snowpack takes the snow and melts above 0 °C; rain and melt fill the soil, of
 * which (soil / capacity)^beta runs off; the runoff splits between the two reservoirs.
 */
const catchmentAfter = (
  c: RiversValue,
  p: FlowParams,
  weather: {
    readonly precip: number
    readonly snowShare: number
    readonly celsius: number
    readonly pet: number
  },
  seconds: number,
): RiversValue => {
  if (seconds <= 0) return c
  const hours = seconds / 3600,
    fall = weather.precip * p.gain * hours
  const snowed = c.snow + fall * weather.snowShare,
    melted = Math.min(snowed, p.melt * Math.max(0, weather.celsius) * seconds)
  const wetting = fall * (1 - weather.snowShare) + melted
  const runoff = wetting * Ops.pow(Math.min(1, Math.max(0, c.soil / p.capacity)), p.beta)
  const dried = weather.pet * hours * Math.min(1, c.soil / (p.lp * p.capacity))
  const soil = Math.max(0, Math.min(p.capacity, c.soil + wetting - runoff - dried))
  const spill = Math.max(0, c.soil + wetting - runoff - dried - p.capacity),
    out = runoff + spill
  return {
    snow: snowed - melted,
    soil,
    quick: drain(c.quick, (out * p.split) / seconds, p.quickTau, seconds),
    slow: drain(c.slow, (out * (1 - p.split)) / seconds, p.slowTau, seconds),
  }
}

/**
 * The fit (flow.test.ts checks it): the gain is the Soliera catchment's 1668 mm of rain a year
 * (the Annali's mean "afflusso") over the 1312 mm the game's weather drops at its mean height, and
 * the melt a common degree-day factor, 3 mm per °C a day; the rest were fitted to the gauge's
 * monthly means and flow-duration curve.
 */
export const FLOW: FlowParams = {
  gain: 1.27,
  capacity: 78,
  beta: 1.9,
  lp: 0.71,
  split: 0.5,
  quickTau: 7.4 * 3600,
  slowTau: 49.5 * DAY,
  melt: 3 / DAY,
}

/** The catchments' mean height, m a.s.l.: the Soliera gauge's (ARPAL), which the model is fitted to. */
const CATCHMENT_HEIGHT = 667

/** Thornthwaite's heat index and exponent from the twelve months' normals at `CATCHMENT_HEIGHT` and latitude `lat`, and the months' mean day lengths (h). */
const thornthwaite = (lat: number) => {
  const months = Array.from({ length: 12 }, (_, m) => {
    const mid = daysFromCivil(2001, m + 1, 15),
      celsius = dailyMean(normalsAt(mid * DAY, lat), CATCHMENT_HEIGHT)
    // The sun's declination and the hours it is up at mid-month (FAO 56, eqs. 24 and 25).
    const yearDay = mid - daysFromCivil(2001, 1, 1) + 1,
      declination = 0.409 * Ops.sin((2 * Math.PI * yearDay) / 365 - 1.39),
      rise = Ops.acos(
        Math.max(-1, Math.min(1, -Ops.tan((lat * Math.PI) / 180) * Ops.tan(declination))),
      )
    return { celsius, hours: (24 / Math.PI) * rise }
  })
  const heat = months.reduce(
    (sum, m) => sum + (m.celsius > 0 ? Ops.pow(m.celsius / 5, 1.514) : 0),
    0,
  )
  const a = 6.75e-7 * heat * heat * heat - 7.71e-5 * heat * heat + 1.792e-2 * heat + 0.49239
  return { heat, a, hours: months.map((m) => m.hours) }
}
const thornthwaites = new Map<number, ReturnType<typeof thornthwaite>>()

/**
 * The potential evapotranspiration over the catchments at UTC second `t`, mm/h: Thornthwaite's
 * (1948) from the day's normal at their mean height, 16 (10 T / I)^a mm a 30-day month of 12-hour
 * days, I the heat index of the year's normals; none below 0 °C. 685 mm a year on the shipped map.
 */
export const petAt = (t: number, lat: number = place().lat): number => {
  const tw = thornthwaites.get(lat) ?? thornthwaite(lat)
  thornthwaites.set(lat, tw)
  const celsius = dailyMean(normalsAt(t, lat), CATCHMENT_HEIGHT)
  if (celsius <= 0) return 0
  const month = civilFromDays(romeDay(t).day).month - 1
  return (16 * (tw.hours[month]! / 12) * Ops.pow((10 * celsius) / tw.heat, tw.a)) / (30 * 24)
}

/** The catchments after `seconds` of `weather` ending at UTC second `t`: its precipitation and air at their mean height. */
export const riversAfter = (
  c: RiversValue,
  weather: Pick<WeatherValue, "precip" | "anomaly">,
  t: number,
  seconds: number,
): RiversValue => {
  const celsius = dailyMean(normalsAt(t), CATCHMENT_HEIGHT) + weather.anomaly
  return catchmentAfter(
    c,
    FLOW,
    {
      precip: weather.precip * orographic(CATCHMENT_HEIGHT),
      snowShare: snowShare(celsius),
      celsius,
      pet: petAt(t),
    },
    seconds,
  )
}

/** How far back a new game's rivers start, and the step they are brought on in (game seconds): a year, far past the groundwater's 49.5 days, an hour at a time. */
const SPIN = 365 * DAY,
  SPIN_STEP = 3600
const spun = new Map<string, RiversValue>()

/**
 * The rivers a new game starts with at UTC second `start` under the weather seed `seed`: the year
 * before it run under the weather those days' plans bring (each day's plan comes from the seed and
 * the day alone), so the rivers carry what the season and the last weeks' rain left. The same for
 * the same start, seed and place (kept: about 28 ms each).
 */
export const initialRivers = (start: number, seed: number): RiversValue => {
  const key = `${start}:${seed}:${JSON.stringify(place())}`,
    known = spun.get(key)
  if (known !== undefined) return known
  const from = start - SPIN
  let weather = initialWeather(from, seed),
    c: RiversValue = { snow: 0, soil: FLOW.capacity / 2, quick: 0, slow: 0 }
  for (let t = from + SPIN_STEP; t <= start; t += SPIN_STEP) {
    const before = weather.precip
    weather = advanceWeather(weather, t, SPIN_STEP)
    c = riversAfter(
      c,
      { precip: (before + weather.precip) / 2, anomaly: weather.anomaly },
      t,
      SPIN_STEP,
    )
  }
  spun.set(key, c)
  return c
}
