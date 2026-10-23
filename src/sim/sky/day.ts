/**
 * The sun over the map through a game day: where it stands (`sunOver`) and when it rises and sets on
 * a Rome calendar day (`sunTimes`), for the HUD's sunrise and sunset buttons. Takes the map's place
 * from `place()`, so it decodes no map.
 *
 * @module day
 */
import { sunAt, type SunPlace } from "./astro.ts"
import { DAY, romeOffset, utcFromRome } from "./calendar.ts"
import { place } from "./place.ts"

/** The sun's centre at sunrise and sunset, degrees: the disc's radius and the horizon's refraction (USNO's convention). */
export const SUNRISE_ELEVATION = -0.833

/** The sun over the map (its origin, `place()`) at UTC second `t`. */
export const sunOver = (t: number): SunPlace => {
  const { lat, lon } = place()
  return sunAt(t, lat, lon)
}

/** When the sun rises and sets on one day, UTC seconds (whole). */
export interface SunTimes {
  readonly sunrise: number
  readonly sunset: number
}

/** The UTC second within a second where the sun's elevation crosses `SUNRISE_ELEVATION` between `from` (on one side) and `to` (on the other). */
const crossing = (from: number, to: number): number => {
  const above = sunOver(from).elevation > SUNRISE_ELEVATION
  let low = from, high = to
  while (high - low > 0.5) {
    const mid = (low + high) / 2
    if (sunOver(mid).elevation > SUNRISE_ELEVATION === above) low = mid
    else high = mid
  }
  return Math.round((low + high) / 2)
}

/**
 * Sunrise and sunset over the map on the Rome calendar day holding UTC second `t` (the sun's centre at
 * −0.833°, within a minute of USNO's tables; astro.test.ts): found hour by hour from local midnight,
 * then by bisection. Undefined on a day the sun never crosses the horizon (never at Italy's latitudes).
 */
export const sunTimes = (t: number): SunTimes | undefined => {
  const local = t + romeOffset(t), midnight = utcFromRome(Math.floor(local / DAY) * DAY)
  let sunrise: number | undefined, sunset: number | undefined
  let before = sunOver(midnight).elevation > SUNRISE_ELEVATION
  for (let hour = 1; hour <= 24; hour++) {
    const at = midnight + hour * 3600, now = sunOver(at).elevation > SUNRISE_ELEVATION
    if (now !== before) {
      if (now) sunrise ??= crossing(at - 3600, at)
      else sunset ??= crossing(at - 3600, at)
    }
    before = now
  }
  return sunrise === undefined || sunset === undefined ? undefined : { sunrise, sunset }
}
