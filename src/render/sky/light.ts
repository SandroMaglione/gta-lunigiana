/**
 * The sky's light, pure: from the sun's and the moon's places, the moon's phase and the weather at
 * the focus, the key light (the sun by day, the moon by night: one DirectionalLight, so the light
 * count and every program stay the same), the hemisphere's sky and ground, the exposure the eye
 * adapts to, and the night and lamp levels. Anchored on the settled look: with the sun 50.4° up in a
 * clear sky it gives exactly the fixed light the game had before the day cycle (sun 0xfff0d8 × 2,
 * hemisphere 0xdbe8f5 / 0x9a8a68 × 1.8, exposure 1).
 *
 * Units: a light's colour × intensity is three's (r186, physical: a face's radiance is albedo × light
 * / π). "Irradiance" here is the light an upward face gets, luminance-weighted, without the π.
 *
 * @module render/sky/light
 */
import { type Vector3 } from "three"

import { skyDirection } from "../../sim/sky/astro.ts"
import { linear } from "../geometry.ts"
import { PALETTE } from "../palette.ts"
import { throughClouds } from "./surface.ts"

/** A linear RGB colour. */
export type Rgb = readonly [number, number, number]

/** Rec. 709 luminance of a linear colour. */
export const luminance = (c: Rgb): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]

const RAD = Math.PI / 180
/** `x` past `from` toward `to` (either order), smoothed, 0..1. */
const smooth = (from: number, to: number, x: number): number => {
  const s = Math.max(0, Math.min(1, (x - from) / (to - from)))
  return s * s * (3 - 2 * s)
}
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
]
const scale = (a: Rgb, k: number): Rgb => [a[0] * k, a[1] * k, a[2] * k]

/** The settled look's fixed sun from before the day cycle, (−0.75, 1, 0.35) normalised: its elevation (50.39°) and intensity, where `sunLight` gives its colour back. */
const REFERENCE = {
  elevation: Math.asin(1 / Math.hypot(0.75, 1, 0.35)) / RAD,
  intensity: 2,
} as const
/** Clear-sky optical depth toward the zenith for red, green and blue (Rayleigh plus Ångström aerosol at 0.68, 0.55, 0.44 µm). */
const TAU: Rgb = [0.14, 0.228, 0.417]
/**
 * How much of the sun's real dimming toward the horizon is kept, as the power of its luminance ratio:
 * 0.5 keeps the hue but half the fall (in decibels), so the golden hour still warms the walls it faces.
 */
const GOLDEN = 0.5
/** The sun's disc sets over these elevations, degrees: its light fades from full to none. */
const SETTING = [2, -1] as const
/** Below this sun elevation, degrees, the key light is the moon; it fades in as the sun sinks from SWAP to MOON_IN. */
const SWAP = -4
const MOON_IN = -8
/** Full moon high in a clear sky: the key light's intensity (exaggerated, as films shoot day for night), × lit fraction^1.5. */
const MOON_INTENSITY = 0.17
/** The moon's light fades in as it rises over these elevations, degrees. */
const MOONRISE = [-1, 8] as const
/**
 * The key light never casts from lower than this, degrees: long low shadows stay legible and inside the streamed chunks, and a
 * shadow edge across a wall stays a clean stair of shadow-map texels (at 15° its texels broke off as light dashes in the browser).
 * Its colour follows the true elevation.
 */
export const SHADOW_FLOOR = 20
/** The key light's aim moves only when the body has moved this far, degrees (every 3–4 real seconds at the normal clock), so hard shadow edges do not crawl. */
const AIM_STEP = 0.75

/**
 * The hemisphere by the sun's elevation, degrees: its sky and ground colours and `light`, the
 * irradiance an upward face gets from it (the noon row is today's: 0xdbe8f5 / 0x9a8a68 × 1.8). Between
 * rows the colours mix in linear RGB and the light follows its own line, so dusk dims steadily.
 */
const HEMISPHERE = [
  { elevation: -18, sky: PALETTE.skyNight, ground: PALETTE.groundNight, light: 0.09 },
  { elevation: -12, sky: PALETTE.skyNautical, ground: PALETTE.groundNautical, light: 0.12 },
  { elevation: -6, sky: PALETTE.skyBlueHour, ground: PALETTE.groundBlueHour, light: 0.2 },
  { elevation: 0, sky: PALETTE.skySunset, ground: PALETTE.groundSunset, light: 0.42 },
  { elevation: 3, sky: PALETTE.skyGolden, ground: PALETTE.groundGolden, light: 0.7 },
  { elevation: 10, sky: PALETTE.skyLow, ground: PALETTE.groundLow, light: 1.1 },
  {
    elevation: 30,
    sky: PALETTE.skyNoon,
    ground: PALETTE.groundNoon,
    light: 1.8 * luminance(linear(PALETTE.skyNoon)),
  },
] as const

/**
 * Weather dimming. The clouds take the direct light only where their shadows fall (`surface.ts`: a
 * `cover` share of the ground, all of it overcast), so the key light keeps the clear sky's and the
 * mean light counts `throughClouds`. The overcast share of the cover (`cloud` from 0.5 to 1) greys
 * and dims the sky light; precipitation (up to 8 mm/h at the focus) and thunderstorm activity darken
 * it more; fog veils the sun (and the moon) and the sky. At night the weather dims the sky light less
 * (low cloud glows with the valley's lights).
 */
const DIM = {
  overcast: [0.5, 1] as const,
  grey: 0.8,
  sky: 0.4,
  rain: 0.4,
  rainFull: 8,
  storm: 0.25,
  fogSun: 0.6,
  fogSky: 0.15,
  night: 0.15,
} as const
/** Snow cover throws this share of the sky's light back up to the walls (the hemisphere's ground colour). */
const SNOW_BOUNCE = 0.6
/** Partial adaptation: the exposure follows (reference / clear-sky light)^DAY and (clear-sky / weather-dimmed light)^WEATHER, clamped. */
const ADAPT = { day: 0.6, weather: 0.15, most: 4 } as const
/** Lamps: on as the light (relative to the settled noon) falls through `dusk`, in a storm (`storm` activity) and in thick fog. */
const LAMPS = {
  dusk: [0.125, 0.08] as const,
  storm: [0.3, 0.7] as const,
  fog: [0.45, 0.75] as const,
}
/** The night grade: none with the sun at `day` degrees, full at `night`; a thunderstorm's gloom adds up to `storm`. */
const NIGHT = { day: 3, night: -9, storm: 0.2 } as const
/** The weather's flat light takes this much colour out of the picture: an overcast sky's (`cloud` 0.5 → 1) and the rain's (up to 8 mm/h). */
const GREY = { overcast: 0.4, rain: 0.2 } as const

const SUN = linear(PALETTE.sun)
const MOON = linear(PALETTE.moonlight)
const OVERCAST = linear(PALETTE.skyOvercast)

/** Kasten & Young (1989) relative air mass at elevation `e` degrees (held at −0.5°, under the horizon). */
const airMass = (e: number): number => {
  const z = 90 - Math.max(e, -0.5)
  return 1 / (Math.cos(z * RAD) + 0.50572 * (96.07995 - z) ** -1.6364)
}
/** Direct sunlight's transmittance per channel at elevation `e`. */
const transmit = (e: number): Rgb => {
  const m = airMass(e)
  return [Math.exp(-TAU[0] * m), Math.exp(-TAU[1] * m), Math.exp(-TAU[2] * m)]
}
const T0 = transmit(REFERENCE.elevation)

/** The sun's light at elevation `e` degrees: colour (brightest channel 1) and intensity; 0xfff0d8 × 2 at 50.4°, redder and weaker lower, none once set. */
export const sunLight = (e: number): { readonly color: Rgb; readonly intensity: number } => {
  const t = transmit(e)
  const raw: Rgb = [SUN[0] * (t[0] / T0[0]), SUN[1] * (t[1] / T0[1]), SUN[2] * (t[2] / T0[2])]
  const kept = scale(raw, (luminance(raw) / luminance(SUN)) ** (GOLDEN - 1))
  const peak = Math.max(...kept)
  return {
    color: scale(kept, 1 / peak),
    intensity: REFERENCE.intensity * peak * smooth(SETTING[1], SETTING[0], e),
  }
}

/** The hemisphere's sky and ground colours and its up-face light at sun elevation `e`. */
const hemisphereAt = (
  e: number,
): { readonly sky: Rgb; readonly ground: Rgb; readonly light: number } => {
  const rows = HEMISPHERE,
    first = rows[0],
    last = rows.at(-1)!
  if (e <= first.elevation)
    return { sky: linear(first.sky), ground: linear(first.ground), light: first.light }
  if (e >= last.elevation)
    return { sky: linear(last.sky), ground: linear(last.ground), light: last.light }
  let k = 1
  while (rows[k]!.elevation < e) k++
  const a = rows[k - 1]!,
    b = rows[k]!,
    t = (e - a.elevation) / (b.elevation - a.elevation)
  return {
    sky: mix(linear(a.sky), linear(b.sky), t),
    ground: mix(linear(a.ground), linear(b.ground), t),
    light: a.light + (b.light - a.light) * t,
  }
}

/** The weather at the focus that the light depends on. */
export interface SkyWeather {
  /** Sky cover, 0..1. */
  readonly cloud: number
  /** Rain and snow falling at the focus, mm/h (liquid). */
  readonly precip: number
  /** Thunderstorm activity, 0..1. */
  readonly storm: number
  /** Fog at the focus, 0..1. */
  readonly fog: number
  /** Snow lying at the focus, 0..1. */
  readonly snowCover: number
}
/** A clear, calm, dry sky. */
export const CLEAR: SkyWeather = { cloud: 0, precip: 0, storm: 0, fog: 0, snowCover: 0 }

/** Where the sun and the moon stand (degrees, azimuth clockwise from north), how much of the moon is lit, and the weather at the focus. */
export interface SkyInput extends SkyWeather {
  readonly sun: { readonly elevation: number; readonly azimuth: number }
  readonly moon: { readonly elevation: number; readonly azimuth: number }
  readonly moonLit: number
}

/** The sky's light this frame (before any lightning flash). */
export interface Lighting {
  /** The key light above the clouds: which body, its colour (brightest channel 1), intensity and true place (degrees). */
  readonly key: {
    readonly body: "sun" | "moon"
    readonly color: Rgb
    readonly intensity: number
    readonly azimuth: number
    readonly elevation: number
  }
  /** The share of the key light that reaches the ground through the clouds, on average (their shadows take the rest, per texel). */
  readonly direct: number
  /** The hemisphere: sky and ground colours (linear) and its intensity. */
  readonly sky: Rgb
  readonly ground: Rgb
  readonly hemisphere: number
  /** Light on an upward face (key at its shadow elevation + sky), and what a clear sky would give now. */
  readonly irradiance: number
  readonly clear: number
  /** The exposure the eye adapts to (1..4). */
  readonly exposure: number
  /** The night grade, 0..1, the weather's grey (the share of colour the post pass takes out), and the lamps' target, 0..1. */
  readonly night: number
  readonly grey: number
  readonly lamps: number
}

/** The key light and hemisphere for `input`, dimmed by `weather` (CLEAR: the clear sky). */
const lightsFor = (input: SkyInput, weather: SkyWeather) => {
  const e = input.sun.elevation,
    overcast = smooth(DIM.overcast[0], DIM.overcast[1], weather.cloud)
  const dark = smooth(0, -12, e),
    soften = (k: number) => 1 - (1 - k) * (1 + (DIM.night - 1) * dark)
  const veiled = 1 - DIM.fogSun * weather.fog,
    direct = throughClouds(weather.cloud)
  const moonUp = input.moon.elevation
  const key =
    e > SWAP
      ? { body: "sun" as const, ...sunLight(e), azimuth: input.sun.azimuth, elevation: e }
      : {
          body: "moon" as const,
          color: MOON,
          azimuth: input.moon.azimuth,
          elevation: moonUp,
          intensity:
            MOON_INTENSITY *
            Math.max(0, input.moonLit) ** 1.5 *
            smooth(MOONRISE[0], MOONRISE[1], moonUp) *
            smooth(SWAP, MOON_IN, e),
        }
  const h = hemisphereAt(e)
  const sky = mix(
    h.sky,
    scale(OVERCAST, luminance(h.sky) / luminance(OVERCAST)),
    DIM.grey * overcast,
  )
  const light =
    h.light *
    soften(
      (1 - DIM.sky * overcast) *
        (1 - DIM.rain * smooth(0, DIM.rainFull, weather.precip)) *
        (1 - DIM.storm * weather.storm) *
        (1 - DIM.fogSky * weather.fog),
    )
  const hemisphere = light / luminance(sky)
  const ground = mix(h.ground, sky, SNOW_BOUNCE * weather.snowCover)
  const intensity = key.intensity * veiled
  const irradiance =
    intensity *
      direct *
      luminance(key.color) *
      Math.sin(Math.max(key.elevation, SHADOW_FLOOR) * RAD) +
    light
  return { key: { ...key, intensity }, direct, sky, ground, hemisphere, irradiance }
}

/** The settled noon's irradiance: the exposure's reference. */
const NOON_LIGHT = lightsFor(
  {
    sun: { elevation: REFERENCE.elevation, azimuth: 245 },
    moon: { elevation: -90, azimuth: 0 },
    moonLit: 0,
    ...CLEAR,
  },
  CLEAR,
).irradiance

/** The sky's light for `input`: key, hemisphere, the exposure target and the night and lamp levels. */
export const skyLight = (input: SkyInput): Lighting => {
  const lit = lightsFor(input, input),
    clear = lightsFor(input, CLEAR).irradiance
  const exposure = Math.min(
    ADAPT.most,
    Math.max(1, (NOON_LIGHT / clear) ** ADAPT.day * (clear / lit.irradiance) ** ADAPT.weather),
  )
  const relative = lit.irradiance / NOON_LIGHT
  const night = Math.max(
    smooth(NIGHT.day, NIGHT.night, input.sun.elevation),
    NIGHT.storm * input.storm,
  )
  const grey =
    GREY.overcast * smooth(DIM.overcast[0], DIM.overcast[1], input.cloud) +
    GREY.rain * smooth(0, DIM.rainFull, input.precip)
  const lamps = Math.max(
    smooth(LAMPS.dusk[0], LAMPS.dusk[1], relative),
    smooth(LAMPS.storm[0], LAMPS.storm[1], input.storm),
    smooth(LAMPS.fog[0], LAMPS.fog[1], input.fog),
  )
  return { ...lit, clear, exposure, night, grey, lamps }
}

/** The settled noon's up-face light: a frame's `ambient` is its light over this. */
export const noonLight = (): number => NOON_LIGHT

/** Where the key light points (degrees, azimuth clockwise from north). */
export interface Aim {
  readonly azimuth: number
  readonly elevation: number
}

/** The angle between two sky places, degrees. */
const apart = (a: Aim, b: Aim): number => {
  const p = skyDirection(a.azimuth, a.elevation),
    q = skyDirection(b.azimuth, b.elevation)
  return Math.acos(Math.max(-1, Math.min(1, p.x * q.x + p.y * q.y + p.z * q.z))) / RAD
}

/** The key light's aim: `aim` held until the body at (`azimuth`, `elevation`) is AIM_STEP away, then moved there at once (so a clock jump lands at once too). */
export const aimToward = (aim: Aim | undefined, azimuth: number, elevation: number): Aim =>
  aim === undefined || apart(aim, { azimuth, elevation }) >= AIM_STEP ? { azimuth, elevation } : aim

/**
 * Writes into `out` the direction toward the key light (three space) for `aim`, cast from at least
 * SHADOW_FLOOR: where the body really stands over the map, whichever way the view looks. Sim (x east,
 * y north, z up) is three (x, z, −y).
 */
export const keyDirection = (aim: Aim, out: Vector3): Vector3 => {
  const d = skyDirection(aim.azimuth, Math.max(aim.elevation, SHADOW_FLOOR))
  return out.set(d.x, d.z, -d.y)
}

/** `current` eased toward `target` over `dt` s with time constant `tau` s, in log space (an exposure: halving and doubling take as long). */
export const easeLog = (current: number, target: number, dt: number, tau: number): number =>
  current * (target / current) ** (1 - Math.exp(-Math.max(0, dt) / tau))

/** `current` eased toward `target` over `dt` s with time constant `tau` s. */
export const ease = (current: number, target: number, dt: number, tau: number): number =>
  current + (target - current) * (1 - Math.exp(-Math.max(0, dt) / tau))
