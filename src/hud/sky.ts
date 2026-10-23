/**
 * The game's clock and weather for dev tools, one store for the debug menu's Time and Weather areas
 * and the console handle `gta.sky` (main.ts creates it in dev builds only), so each shows what the
 * other set. It sends the sim's `SetClock` and `SetWeather` requests, checked first as the sim checks
 * them (`setClock`, `isRegime`), and shows what it sent until the game takes it. Nothing is stored:
 * the clock and the weather are saved sim state that comes from the seed. Imports no map data, as
 * the sim's sky modules it uses.
 *
 * @module hud/sky
 */
import type { SkyViewModel } from "../sim/index.ts"
import { type CivilDate, civilFromDays, DAY, daysFromCivil, type RomeTime, romeTime, utcFromRome } from "../sim/sky/calendar.ts"
import { type ClockRequest, setClock } from "../sim/sky/clock.ts"
import { regimeAt } from "../sim/sky/plan.ts"
import { isRegime, type Regime } from "../sim/sky/regimes.ts"
import type { WeatherRequest } from "../sim/sky/weather.ts"

/** A date as an `input[type=date]` value: "2026-10-22". */
export const dateText = ({ year, month, day }: CivilDate): string =>
  `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`

/** The date an `input[type=date]` value holds, or undefined for anything that is not one (empty while half typed, 30 February). */
export const parseDate = (text: string): CivilDate | undefined => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (match === null) return undefined
  const date = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
  return dateText(civilFromDays(daysFromCivil(date.year, date.month, date.day))) === text ? date : undefined
}

/** The UTC second (the game clock's) at which Rome's wall clock reads `secondOfDay` on `date`. */
export const romeSeconds = (date: CivilDate, secondOfDay: number): number => utcFromRome(daysFromCivil(date.year, date.month, date.day) * DAY + secondOfDay)

/** What the store needs: the game's sky to read and the two requests to send. */
export interface SkyStoreHost {
  readonly read: () => SkyViewModel
  readonly setClock: (request: ClockRequest) => void
  readonly setWeather: (request: WeatherRequest) => void
}

/**
 * Whether the game's sky has moved off `from`, the sky it showed when a request was sent: it has stepped since, and each step
 * takes every request sent before it. A step that moves none of these (the clock stopped, the request already in force) leaves
 * the request showing what the game holds anyway.
 */
const moved = (from: SkyViewModel, game: SkyViewModel): boolean =>
  game.seconds !== from.seconds || game.rate !== from.rate
  || game.weather.regime !== from.weather.regime || game.weather.forced !== from.weather.forced

/**
 * The store over the game's sky. The game takes a request on its next step, and not at all while paused (the full map, the
 * settings), so the store shows what it sent (a time, a rate, the regime held or Auto) until the game has stepped, and the game's
 * own after that: what it shows is what the game will hold, whoever else sets the clock (the host holds it behind the title card).
 */
export const makeSkyStore = ({ read, setClock: sendClock, setWeather: sendWeather }: SkyStoreHost) => {
  const listeners: Array<() => void> = []
  /** One kind of request: the value last sent, while the game has not stepped since sending it. */
  const unapplied = <T>() => {
    let sent: { readonly value: T; readonly from: SkyViewModel } | undefined
    return {
      send: (value: T): void => void (sent = { value, from: read() }),
      get: (game: SkyViewModel) => {
        if (sent !== undefined && moved(sent.from, game)) sent = undefined
        return sent
      }
    }
  }
  // A time and a rate sent, and the regime held (null: Auto).
  const time = unapplied<number>(), pace = unapplied<number>(), held = unapplied<Regime | null>()
  const tell = () => {
    for (const listener of listeners) listener()
  }
  const now = (): SkyViewModel => {
    const game = read(), seconds = time.get(game)?.value ?? game.seconds, rate = pace.get(game)?.value ?? game.rate
    return seconds === game.seconds && rate === game.rate ? game : { ...game, seconds, rate, local: romeTime(seconds) }
  }
  const regime = (): Regime | null => {
    const game = read(), sent = held.get(game)
    return sent !== undefined ? sent.value : game.weather.forced ? game.weather.regime : null
  }
  const heading = (): Regime => {
    const game = read(), pinned = regime()
    if (pinned !== null) return pinned
    // Auto: the game hands a forced weather back to its day's plan at once (the sim's `setWeather`), so it heads where the plan is.
    return game.weather.forced ? regimeAt(game.weather.plan, now().seconds) : game.weather.regime
  }
  /** Sets the game time to UTC second `seconds`, kept in range; one that is not a number is dropped. */
  const setSeconds = (seconds: number): void => {
    const next = setClock(read(), { seconds })
    if (next === undefined) return
    time.send(next.seconds)
    sendClock({ seconds: next.seconds })
    tell()
  }
  /** Rome's wall clock now, seconds after midnight. */
  const timeOfDay = ({ hour, minute, second }: RomeTime) => hour * 3600 + minute * 60 + Math.floor(second)
  return {
    /** The game's sky, with a time and rate sent but not yet taken laid over it. */
    now,
    /** The rate the game runs at, or will once it steps: game seconds per step (1 is a game minute a real second, 0 stands still). */
    rate: (): number => now().rate,
    /** The regime the weather is held at, or null when it is left to chance (Auto). */
    regime,
    /** The regime the weather moves toward once the game takes what the store sent: the one held, else (Auto) the day's plan's now. */
    heading,
    setSeconds,
    /** Sets Rome's wall clock to `secondOfDay` on the date shown. */
    setTime: (secondOfDay: number): void => setSeconds(romeSeconds(now().local, secondOfDay)),
    /** Moves to `date`, Rome's wall clock keeping the time of day shown. */
    setDate: (date: CivilDate): void => setSeconds(romeSeconds(date, timeOfDay(now().local))),
    /** Sets the clock's rate in game seconds per step, kept in range; one that is not a number is dropped. */
    setRate: (value: number): void => {
      const next = setClock(read(), { rate: value })
      if (next === undefined) return
      pace.send(next.rate)
      sendClock({ rate: next.rate })
      tell()
    },
    /** Holds the weather at `to`, easing toward it, or hands it back to chance (null); a name that is no regime is dropped, as the sim's `setWeather` drops it. */
    force: (to: Regime | null): void => {
      if (to !== null && !isRegime(to)) return
      held.send(to)
      sendWeather({ regime: to })
      tell()
    },
    /** Jumps the weather to its regime's steady state: the regime held, else (Auto) the day's plan's now, still left to the plan. */
    settle: (): void => sendWeather({ regime: regime(), settle: true }),
    /** Calls `listener` after every change, so an open UI shows it. */
    subscribe: (listener: () => void): void => void listeners.push(listener)
  }
}

/** The game's clock and weather for dev tools, and the ways to set them. */
export type SkyStore = ReturnType<typeof makeSkyStore>
