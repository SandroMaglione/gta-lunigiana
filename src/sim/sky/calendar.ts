/**
 * The Gregorian calendar and Italy's civil time as exact integer arithmetic (no `Date`, no `Intl`): the
 * game clock counts whole Unix UTC seconds (`GameClock`), and these turn it into the date and the
 * Europe/Rome wall clock the HUD shows and the bells strike. Day numbers count from 1970-01-01. The
 * calendar is Howard Hinnant's `days_from_civil` / `civil_from_days`
 * (https://howardhinnant.github.io/date_algorithms.html); Rome keeps CET (UTC+1), and CEST (UTC+2) from
 * 01:00 UTC on the last Sunday of March to 01:00 UTC on the last Sunday of October, the EU rule Italy has
 * followed since 1996.
 *
 * @module calendar
 */

/** Seconds in a day. */
export const DAY = 86400

/** Days since 1970-01-01 of the Gregorian date `year`-`month`-`day` (month 1–12). */
export const daysFromCivil = (year: number, month: number, day: number): number => {
  const y = month <= 2 ? year - 1 : year
  const era = Math.floor(y / 400), yoe = y - era * 400
  const doy = Math.floor((153 * (month > 2 ? month - 3 : month + 9) + 2) / 5) + day - 1
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy
  return era * 146097 + doe - 719468
}

/** A Gregorian date. */
export interface CivilDate {
  readonly year: number
  /** 1–12. */
  readonly month: number
  /** 1–31. */
  readonly day: number
}

/** The Gregorian date of day `days` since 1970-01-01. */
export const civilFromDays = (days: number): CivilDate => {
  const z = days + 719468
  const era = Math.floor(z / 146097), doe = z - era * 146097
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365)
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const month = mp < 10 ? mp + 3 : mp - 9
  return { year: yoe + era * 400 + (month <= 2 ? 1 : 0), month, day: doy - Math.floor((153 * mp + 2) / 5) + 1 }
}

/** The weekday of day `days` since 1970-01-01 (a Thursday): 0 Sunday … 6 Saturday. */
export const weekday = (days: number): number => ((days % 7) + 11) % 7

/** UTC second of 01:00 UTC on the last Sunday of March (3) or October (10) of `year`: both months have 31 days. */
const euSwitch = (year: number, month: 3 | 10): number => {
  const last = daysFromCivil(year, month, 31)
  return (last - weekday(last)) * DAY + 3600
}

/** Europe/Rome's offset from UTC at UTC second `t`: 7200 in summer time, else 3600. */
export const romeOffset = (t: number): number => {
  const { year } = civilFromDays(Math.floor(t / DAY))
  return t >= euSwitch(year, 3) && t < euSwitch(year, 10) ? 7200 : 3600
}

/**
 * The UTC second of a Rome wall-clock reading, given as local seconds since 1970-01-01 local
 * (`daysFromCivil(y, m, d) * DAY + hour * 3600 + minute * 60`): the hour skipped in March reads an hour
 * later, the hour repeated in October as its first (summer-time) pass.
 */
export const utcFromRome = (local: number): number => (romeOffset(local - 7200) === 7200 ? local - 7200 : local - 3600)

/** A Europe/Rome wall-clock reading: the date and the time of day. */
export interface RomeTime extends CivilDate {
  readonly hour: number
  readonly minute: number
  /** Whole seconds for a whole `t`; a fractional `t` (the host's `seconds + alpha · rate`) keeps its fraction here. */
  readonly second: number
}

/** The Europe/Rome wall clock at UTC second `t`. */
export const romeTime = (t: number): RomeTime => {
  const local = t + romeOffset(t), days = Math.floor(local / DAY), into = local - days * DAY
  return { ...civilFromDays(days), hour: Math.floor(into / 3600), minute: Math.floor((into % 3600) / 60), second: into % 60 }
}
