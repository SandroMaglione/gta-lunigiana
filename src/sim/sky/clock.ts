/**
 * The requests to the game clock, checked: the range of dates and the fastest rate the clock runs at.
 * Two senders make them: the host, holding the clock still behind the title card (`holdClock`,
 * hud/title.ts), and the dev menu. Imports no data, so the HUD mirrors the same clamps without decoding
 * the map.
 *
 * @module clock
 */
import type { GameClockValue } from "../schema.ts"
import { DAY, daysFromCivil } from "./calendar.ts"

/** The game clock's range: from 2000-01-01 to 2100-01-01 UTC (Unix seconds), inside the calendar's EU summer-time rule. */
export const SECONDS_RANGE = { min: daysFromCivil(2000, 1, 1) * DAY, max: daysFromCivil(2100, 1, 1) * DAY } as const
/** The fastest the dev menu runs the clock: an hour of game time per step. */
export const MAX_RATE = 3600

/** A request to set the game time (Unix UTC seconds) and/or its rate (game seconds per step): the title card's hold or the dev menu's. */
export interface ClockRequest {
  readonly seconds?: number
  readonly rate?: number
}

/** `clock` with `request` applied: seconds rounded and kept in `SECONDS_RANGE`, rate a whole number in [0, `MAX_RATE`]; undefined when neither is a finite number. */
export const setClock = (clock: GameClockValue, request: ClockRequest): GameClockValue | undefined => {
  const within = (value: number | undefined, min: number, max: number) =>
    typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : undefined
  const seconds = within(request.seconds, SECONDS_RANGE.min, SECONDS_RANGE.max), rate = within(request.rate, 0, MAX_RATE)
  if (seconds === undefined && rate === undefined) return undefined
  return { seconds: seconds ?? clock.seconds, rate: rate ?? clock.rate }
}
