/**
 * What the weather is at one point of the map: the air's temperature, the rain and snow falling, how wet
 * and how white the ground is, the fog, and the wind. Pure functions of the game time, the `Weather`
 * resource and a position (x east, y north, z m a.s.l.); the physics, the traffic, the render, the audio
 * and the HUD all read the weather through them.
 *
 * @module local
 */
import { Ops } from "@typeonce/ritmo-math"

import type { WeatherValue } from "../schema.ts"
import { DAY, romeOffset } from "./calendar.ts"
import { type Air, airAt, celsiusAt, monthOf, NO_SNOW, orographic, SEASONS, snowShare } from "./climate.ts"

/** The ground under a wheel or a foot: how wet (0…1, where no snow lies) and how snow-covered (0…1). */
export interface GroundWeather {
  readonly wet: number
  readonly snow: number
}
/** Dry, bare ground. */
export const DRY: GroundWeather = { wet: 0, snow: 0 }

/** A whole-number hash of lattice point (i, j) to [−1, 1): 32-bit integer arithmetic only, so a shader with `uint` maths gets the same value. */
const lattice = (i: number, j: number): number => {
  let h = Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h ^= h >>> 13
  return (h >>> 0) / 2147483648 - 1
}

/** Smooth value noise in [−1, 1] over a lattice of `cell` m. */
const noise = (x: number, y: number, cell: number): number => {
  const fx = x / cell, fy = y / cell, i = Math.floor(fx), j = Math.floor(fy)
  const tx = fx - i, ty = fy - j, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty)
  const south = lattice(i, j) + (lattice(i + 1, j) - lattice(i, j)) * sx
  const north = lattice(i, j + 1) + (lattice(i + 1, j + 1) - lattice(i, j + 1)) * sx
  return south + (north - south) * sy
}

/** The snow line's ragged edge: two octaves of value noise, ±45 m over 80 m cells and ±15 m over 20 m cells (render's snow draws the same). */
export const EDGE = [{ cell: 80, height: 45 }, { cell: 20, height: 15 }] as const
/** The snow cover fades in over this many metres of height to either side of its edge. */
export const FEATHER = 10
/** Below the snow's edge meltwater wets a band this many metres deep where the air is above freezing, fully from `MELT_FULL` °C. */
export const MELT_BAND = 100
/** The air's temperature (°C) from which the meltwater band is fully wet; it wets in proportion from 0 °C up. */
export const MELT_FULL = 1
/** How far the snow's edge reaches either side of the snow line, m: its wander (the EDGE heights) and its fade (FEATHER). */
export const REACH = EDGE.reduce((sum, { height }) => sum + height, 0) + FEATHER

/** How many metres the snow line's edge stands lower at (x, y) (a fixed, world-locked pattern, the same every game; negative where it stands higher). */
export const snowEdge = (x: number, y: number): number => EDGE.reduce((sum, { cell, height }) => sum + height * noise(x, y, cell), 0)

/** How much snow covers ground `above` m over the snow line's ragged edge: none below it, all of it above, fading over ±`FEATHER` m. */
const coverAbove = (above: number): number => {
  const s = Math.max(0, Math.min(1, (above + FEATHER) / (2 * FEATHER)))
  return s * s * (3 - 2 * s)
}

/** How much snow covers ground at (x, y, z) under a snow line at `snowLine` m a.s.l.: 0 below its ragged edge, 1 above it. */
export const snowCoverAt = (snowLine: number, x: number, y: number, z: number): number =>
  snowLine >= NO_SNOW || z < snowLine - REACH ? 0 : coverAbove(z + snowEdge(x, y) - snowLine)

/**
 * The ground at (x, y, z) under `weather`, the air `air` (`airAt`): snow above the snow line's ragged edge; where none lies, the
 * weather's wetness, and, where the air at z is above freezing, wetter toward the edge from `MELT_BAND` m below it, where meltwater
 * runs (only there: the snowmelt wets no other ground). In a frost the ground below the snow stays as dry as the weather left it.
 */
export const groundAt = (weather: Pick<WeatherValue, "wet" | "snowLine">, x: number, y: number, z: number, air: Air): GroundWeather => {
  const { snowLine, wet } = weather
  if (snowLine >= NO_SNOW || z < snowLine - REACH - MELT_BAND) return wet === 0 ? DRY : { wet, snow: 0 }
  const above = z + snowEdge(x, y) - snowLine, snow = coverAbove(above)
  const thaw = Math.max(0, Math.min(1, celsiusAt(air, z) / MELT_FULL))
  return { wet: Math.max(wet, thaw * Math.max(0, Math.min(1, 1 + above / MELT_BAND))) * (1 - snow), snow }
}

/** The fog over the map: the valleys' fog up to `valleyTop` m a.s.l. at `valleyDensity` (0…1), and the cloud down to `cloudBase` m a.s.l. at `cloudDensity` (0…1). */
export interface FogLayers {
  readonly valleyTop: number
  readonly valleyDensity: number
  readonly cloudBase: number
  readonly cloudDensity: number
}

/** A day's hash in [0, 1): which mornings of a month bring radiation fog. */
const dayChance = (day: number): number => (lattice(day, 0x5f3759df) + 1) / 2

/** `x` past `from` toward `to`, smoothed, 0…1. */
const smooth = (from: number, to: number, x: number): number => {
  const s = Math.max(0, Math.min(1, (x - from) / (to - from)))
  return s * s * (3 - 2 * s)
}

/**
 * The cloud base (m a.s.l.): far above the ridges under a clear sky, lower as the cover thickens, a thunderstorm's raised again, and
 * down to a low stratus in thick mist. Each regime settles on its own: clear 2575, cloudy 1675, overcast 1225, rain 1150, snow about
 * 1100, storm 1400, fog 600. Design values that keep most of the valley and village roads out of the cloud in rain and in a storm
 * (weather.test.ts), and the crests (1700–1800 m) in it under any full cover.
 */
const BASE = { clear: 2650, cover: 1500, storm: 250, stratus: 700 } as const
/** Inside the cloud the fog reaches this much of its full thickness, all of it in thick mist (the fog regime). */
const CLOUD_FOG = 0.6

/**
 * The fog layers at UTC second `t` under `weather`. Radiation fog fills the valleys below about 400 m on
 * clear, calm mornings, on the month's share of days (`SEASONS[...].valleyFog`, most from October to
 * February): it forms from 01:00, is thickest from 05:00 and burns off from 09:00 to 11:00 local time.
 * The fog regime's low stratus fills them up to about 700 m. Above the cloud base (`BASE`) the hill fog
 * is `CLOUD_FOG` thick under a full cover, thick fog only in the fog regime's mist.
 */
export const fogLayers = (t: number, weather: Pick<WeatherValue, "cloud" | "storm" | "wind" | "fog">): FogLayers => {
  const local = t + romeOffset(t), day = Math.floor(local / DAY), hour = (local - day * DAY) / 3600
  const chance = SEASONS[monthOf(t)]!.valleyFog
  const clear = 1 - smooth(0.25, 0.55, weather.cloud), calm = 1 - smooth(2, 3.5, weather.wind)
  const radiation = dayChance(day) < chance ? clear * calm * smooth(1, 5, hour) * (1 - smooth(9, 11, hour)) : 0
  const valleyTop = Math.max(250 + 150 * radiation, 250 + 450 * weather.fog), mist = smooth(0.3, 0.9, weather.fog)
  return {
    valleyTop, valleyDensity: Math.max(radiation, weather.fog),
    cloudBase: BASE.clear - BASE.cover * weather.cloud + BASE.storm * weather.storm - BASE.stratus * mist,
    cloudDensity: smooth(0.5, 0.9, weather.cloud) * (CLOUD_FOG + (1 - CLOUD_FOG) * mist)
  }
}

/** How thick the fog is at `z` m a.s.l. in `layers`, 0…1: the valley fog's below its top, the cloud's above its base, each fading in over 50 m. */
export const fogAt = (layers: FogLayers, z: number): number =>
  Math.max(layers.valleyDensity * (1 - smooth(layers.valleyTop - 50, layers.valleyTop, z)), layers.cloudDensity * smooth(layers.cloudBase, layers.cloudBase + 50, z))

/** What the weather is like at one point: air temperature (°C), rain and snow falling (mm/h liquid-equivalent), ground wetness and snow cover (0…1), fog (0…1). */
export interface Conditions {
  readonly celsius: number
  readonly rain: number
  readonly snow: number
  readonly wet: number
  readonly snowCover: number
  readonly fog: number
}

/** The conditions at (x, y, z) at UTC second `t` under `weather`. */
export const conditionsAt = (t: number, weather: WeatherValue, x: number, y: number, z: number): Conditions => {
  const air = airAt(t, weather), celsius = celsiusAt(air, z), falling = weather.precip * orographic(z), share = snowShare(celsius)
  const ground = groundAt(weather, x, y, z, air)
  return { celsius, rain: falling * (1 - share), snow: falling * share, wet: ground.wet, snowCover: ground.snow, fog: fogAt(fogLayers(t, weather), z) }
}

/**
 * How much stronger the wind blows on exposed ground than on the valley floor: ×1 at 250 m, rising in a straight line to ×2.5 on the
 * 1800 m crests (×1.76 at 1040 m). A design value a little under the Aeronautica Militare's own pair (Atlante Climatico 1971–2000,
 * wind classes of 1–10, 11–20 and over 20 knots taken at 5.5, 15.5 and 25 kn): about 6.1 m/s at Passo della Cisa (1048 m) against
 * 3.0 m/s at Sarzana-Luni on the coast (whose 00 UTC table is empty), ×1.9–2.1 as the top class is taken at 22.5–30 kn.
 */
const WIND_UP = { floor: 250, crest: 1800, most: 2.5 } as const

/** The wind at `z` m a.s.l. under `weather`, m/s (x east, y north: the way the air moves): the valley's, stronger on exposed ground (`WIND_UP`). */
export const windAt = (weather: Pick<WeatherValue, "wind" | "windAngle">, z: number): { readonly x: number; readonly y: number } => {
  const speed = weather.wind * Math.max(1, Math.min(WIND_UP.most, 1 + ((WIND_UP.most - 1) * (z - WIND_UP.floor)) / (WIND_UP.crest - WIND_UP.floor)))
  return { x: Ops.cos(weather.windAngle) * speed, y: Ops.sin(weather.windAngle) * speed }
}
