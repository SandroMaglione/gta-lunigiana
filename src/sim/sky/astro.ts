/**
 * Where the sun and the moon stand in the sky over the map, from the game clock: pure, deterministic
 * low-precision astronomy in degrees, azimuth clockwise from north and elevation geometric (no
 * refraction). The sun follows NOAA's Solar Calculator equations (Meeus, Astronomical Algorithms ch. 25;
 * https://gml.noaa.gov/grad/solcalc/main.js), the moon the Astronomical Almanac's low-precision series
 * with the topocentric parallax, both turned to the horizon through Greenwich mean sidereal time.
 * Checked against JPL Horizons and USNO at the reference site, 44.16175 N, 10.13 E: the sun within 0.02°, the moon within 0.7° (see
 * astro.test.ts). Time is Unix UTC seconds; TT − UT (about 69 s) is ignored.
 *
 * @module astro
 */
import { Ops } from "@typeonce/ritmo-math"

import { DAY } from "./calendar.ts"

const RAD = Math.PI / 180
const sind = (deg: number): number => Ops.sin(deg * RAD)
const cosd = (deg: number): number => Ops.cos(deg * RAD)
/** `x` in [0, 360). */
const wrap360 = (x: number): number => x - 360 * Math.floor(x / 360)
/** `x` in [−180, 180). */
const wrap180 = (x: number): number => wrap360(x + 180) - 180

/** Days since J2000.0 (2000-01-01 12:00 UTC, 10957.5 days after the Unix epoch) at UTC second `t`. */
const daysJ2000 = (t: number): number => t / DAY - 10957.5
/** Greenwich mean sidereal time, degrees (USNO's approximation, 0.1 s a century). */
const gmst = (d: number): number => wrap360(280.46061837 + 360.98564736629 * d)

/** A body's place in the sky: elevation and azimuth (degrees, azimuth clockwise from north), right ascension, declination and ecliptic longitude (degrees). */
export interface SkyPlace {
  readonly elevation: number
  readonly azimuth: number
  readonly rightAscension: number
  readonly declination: number
  readonly longitude: number
}

/** The sun's place, with its hour angle (degrees, 0 at the local solar noon, negative in the morning). */
export interface SunPlace extends SkyPlace {
  readonly hourAngle: number
}

/** Hour angle `H`, declination `dec` and latitude `lat` (degrees) to elevation and azimuth (degrees, azimuth clockwise from north). */
const horizontal = (
  H: number,
  dec: number,
  lat: number,
): { readonly elevation: number; readonly azimuth: number } => {
  const sinEl = sind(lat) * sind(dec) + cosd(lat) * cosd(dec) * cosd(H)
  // Clamped: rounding can push the sine a hair past 1.
  const elevation = Ops.asin(Math.max(-1, Math.min(1, sinEl))) / RAD
  const azimuth = wrap360(
    Ops.atan2(-cosd(dec) * sind(H), sind(dec) * cosd(lat) - cosd(dec) * sind(lat) * cosd(H)) / RAD,
  )
  return { elevation, azimuth }
}

/** The sun at UTC second `t` seen from latitude `lat`, longitude `lon` (degrees, east positive). */
export const sunAt = (t: number, lat: number, lon: number): SunPlace => {
  const T = daysJ2000(t) / 36525
  const L0 = wrap360(280.46646 + T * (36000.76983 + T * 0.0003032))
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T)
  const C =
    sind(M) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
    sind(2 * M) * (0.019993 - 0.000101 * T) +
    sind(3 * M) * 0.000289
  const omega = 125.04 - 1934.136 * T
  const longitude = L0 + C - 0.00569 - 0.00478 * sind(omega)
  const eps =
    23 +
    (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60 +
    0.00256 * cosd(omega)
  const rightAscension = wrap360(Ops.atan2(cosd(eps) * sind(longitude), cosd(longitude)) / RAD)
  const declination = Ops.asin(sind(eps) * sind(longitude)) / RAD
  const hourAngle = wrap180(gmst(daysJ2000(t)) + lon - rightAscension)
  return {
    ...horizontal(hourAngle, declination, lat),
    rightAscension,
    declination,
    longitude,
    hourAngle,
  }
}

/** The moon at UTC second `t` seen from latitude `lat`, longitude `lon` (degrees, east positive); the elevation is topocentric (parallax ≈ 1°). */
export const moonAt = (t: number, lat: number, lon: number): SkyPlace => {
  const T = daysJ2000(t) / 36525
  const longitude = wrap360(
    218.32 +
      481267.881 * T +
      6.29 * sind(135.0 + 477198.87 * T) -
      1.27 * sind(259.3 - 413335.36 * T) +
      0.66 * sind(235.7 + 890534.22 * T) +
      0.21 * sind(269.9 + 954397.74 * T) -
      0.19 * sind(357.5 + 35999.05 * T) -
      0.11 * sind(186.5 + 966404.03 * T),
  )
  const beta =
    5.13 * sind(93.3 + 483202.02 * T) +
    0.28 * sind(228.2 + 960400.89 * T) -
    0.28 * sind(318.3 + 6003.15 * T) -
    0.17 * sind(217.6 - 407332.21 * T)
  const parallax =
    0.9508 +
    0.0518 * cosd(135.0 + 477198.87 * T) +
    0.0095 * cosd(259.3 - 413335.36 * T) +
    0.0078 * cosd(235.7 + 890534.22 * T) +
    0.0028 * cosd(269.9 + 954397.74 * T)
  const eps = 23.439291 - 0.0130042 * T
  // Ecliptic to equatorial.
  const x = cosd(beta) * cosd(longitude)
  const y = cosd(eps) * cosd(beta) * sind(longitude) - sind(eps) * sind(beta)
  const z = sind(eps) * cosd(beta) * sind(longitude) + cosd(eps) * sind(beta)
  const rightAscension = wrap360(Ops.atan2(y, x) / RAD),
    declination = Ops.asin(Math.max(-1, Math.min(1, z))) / RAD
  const geo = horizontal(wrap180(gmst(daysJ2000(t)) + lon - rightAscension), declination, lat)
  // Topocentric: the observer stands one Earth radius off the centre.
  return {
    elevation: geo.elevation - parallax * cosd(geo.elevation),
    azimuth: geo.azimuth,
    rightAscension,
    declination,
    longitude,
  }
}

/** The moon's phase: lit fraction 0…1, age 0 (new) → 0.5 (full) → 1, and whether it is waxing. */
export interface MoonPhase {
  readonly illuminated: number
  readonly age: number
  readonly waxing: boolean
}

/** The moon's phase from the sun's and the moon's places at the same instant. */
export const moonPhase = (sun: SkyPlace, moon: SkyPlace): MoonPhase => {
  const cosPsi =
    sind(sun.declination) * sind(moon.declination) +
    cosd(sun.declination) * cosd(moon.declination) * cosd(sun.rightAscension - moon.rightAscension)
  // The phase angle is 180° less the elongation ψ (within 0.15°).
  const age = wrap360(moon.longitude - sun.longitude) / 360
  return { illuminated: (1 - cosPsi) / 2, age, waxing: age < 0.5 }
}

/** The unit vector toward azimuth `azimuth` (clockwise from north) and elevation `elevation` (degrees), in the sim's frame: x east, y north, z up. */
export const skyDirection = (
  azimuth: number,
  elevation: number,
): { readonly x: number; readonly y: number; readonly z: number } => {
  const flat = cosd(elevation)
  return { x: sind(azimuth) * flat, y: cosd(azimuth) * flat, z: sind(elevation) }
}
