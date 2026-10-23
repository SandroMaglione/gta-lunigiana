/**
 * The HUD's clock and weather readout: Rome's wall-clock time as a 24-hour "HH:MM", and the weather
 * where the player stands as a word and the air's temperature there ("Rain · 9 °C"). Pure functions
 * of the SkyView model and a position, through the sim's own `conditionsAt` and `describeWeather`,
 * so the HUD reads the weather as the physics and the sound do.
 *
 * @module hud/clock
 */
import type { SkyViewModel } from "../sim/index.ts"
import { conditionsAt } from "../sim/sky/local.ts"
import { describeWeather } from "../sim/sky/readout.ts"

/** The time of day `secondOfDay` seconds after midnight as a 24-hour "HH:MM", the minutes cut as a clock cuts them. */
export const clockText = (secondOfDay: number): string => {
  const minutes = Math.floor(secondOfDay / 60)
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`
}

/** The HUD's weather readout for a player at (x, y) and `z` m a.s.l.: the word for the weather there and the air's temperature, to the whole degree. */
export const weatherText = (sky: Pick<SkyViewModel, "seconds" | "weather">, x: number, y: number, z: number): string => {
  const here = conditionsAt(sky.seconds, sky.weather, x, y, z)
  return `${describeWeather(sky.weather, here)} · ${Math.round(here.celsius)} °C`
}
