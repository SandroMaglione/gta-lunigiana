import assert from "node:assert/strict"
import { test } from "node:test"

import type { PlanValue } from "../schema.ts"
import { civilFromDays, DAY, daysFromCivil, romeDay, utcFromRome } from "./calendar.ts"
import { AIR_MASS } from "./climate.ts"
import { oddsAt, WET_PERSISTENCE } from "./odds.ts"
import { type Place, providePlace, REFERENCE_PLACE } from "./place.ts"
import { calmPlan, planFor, rainingAt, regimeAt, untilChange } from "./plan.ts"
import { type Regime, REGIME_SPECS } from "./regimes.ts"

const HOUR = 3600
/** Rome's midnight starting day `day` (days since 1970-01-01). */
const midnight = (day: number) => utcFromRome(day * DAY)
/** How long Rome day `day` lasts, s. */
const lengthOf = (day: number) => midnight(day + 1) - midnight(day)
const FIRST = daysFromCivil(2001, 1, 1)
const DAYS_IN = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
/** Lowland places at the calibration latitudes: Sicily, Lazio, the Po plain. */
const PLACES: ReadonlyArray<Place> = [{ lat: 38, lon: 15, floor: 0, downslope: 0 }, { lat: 42, lon: 12.5, floor: 0, downslope: 0 }, { lat: 45.5, lon: 9.2, floor: 0, downslope: 0 }]
/** A plan for the day before `day`, drawn and dry: what a jump or the next midnight draws after. */
const dryBefore = (day: number): PlanValue => ({ ...calmPlan(midnight(day - 1)), drawn: true, from: 0 })

/** `days` plans from 2001-01-01, each drawn at its Rome midnight under the weather seed `seed`, starting from a new game's. */
const plans = (days: number, seed: number): Array<PlanValue> => {
  const list: Array<PlanValue> = []
  let plan = calmPlan(midnight(FIRST))
  for (let d = 0; d < days; d++) list.push(plan = planFor(plan, midnight(FIRST + d), seed))
  return list
}

/** How much of `plan`'s day counts in the Aeronautica Militare's way at 06 and 18 UTC, each half a day, as clear-ish or overcast. */
const sky = (plan: PlanValue, counts: (regime: Regime) => boolean) => [6, 18].reduce((sum, hour) => sum + (counts(regimeAt(plan, plan.day * DAY + hour * HOUR)) ? 0.5 : 0), 0)
/** 4/8 cloud or less; 7/8 or more, the sky seen (a stratus's fog is the fog row's). */
const clearish = (regime: Regime) => REGIME_SPECS[regime].cloud <= 4 / 8
const overcast = (regime: Regime) => regime !== "fog" && REGIME_SPECS[regime].cloud >= 7 / 8

test("plan: a new game's holds clear and calm for 90 game minutes; the first step draws the day, its rain and wind starting after the calm", () => {
  const start = 1792648800, calm = calmPlan(start), { day, second } = romeDay(start)
  assert.deepEqual([calm.drawn, calm.day, calm.from, calm.wet, calm.airMass], [false, day, second + 90 * 60, false, 0])
  assert.equal(regimeAt(calm, start + 89 * 60), "clear")
  assert.equal(untilChange(calm, start + 180), 87 * 60)
  for (let seed = 0; seed < 300; seed++) {
    const plan = planFor(calm, start + 1, seed)
    assert.ok(plan.drawn && plan.day === day && plan.from === calm.from, `seed ${seed}`)
    assert.equal(regimeAt(plan, start + 89 * 60), "clear", `seed ${seed}: still calm`)
    assert.ok(!plan.wet || plan.start - 1.5 * HOUR >= plan.from, `seed ${seed}: the sky thickens only after the calm`)
    assert.ok(plan.windyTo === 0 || plan.windyFrom >= plan.from, `seed ${seed}`)
    assert.notEqual(plan.fog, "morning", "the calm start's morning is past")
  }
})

test("plan: the same weather seed draws the same days, another seed others; a day drawn again after the same day before is the same", () => {
  assert.deepEqual(plans(400, 7), plans(400, 7))
  assert.notDeepEqual(plans(400, 7), plans(400, 8))
  const list = plans(400, 9)
  for (let k = 1; k < list.length; k++) assert.deepEqual(planFor(list[k - 1]!, midnight(list[k]!.day) + 7 * HOUR, 9), list[k], `day ${k}`)
  assert.equal(planFor(list[399]!, midnight(list[399]!.day) + 5 * HOUR, 9), list[399], "the same day: the same plan")
})

test("plan: a wet day rains in one window inside its day under an overcast sky, a summer thunderstorm in the afternoon out of a fair one; a dry day keeps its sky, its stratus till it lifts and its wind", () => {
  for (const plan of plans(3000, 11)) {
    const month = civilFromDays(plan.day).month - 1, length = lengthOf(plan.day), at = (second: number) => regimeAt(plan, midnight(plan.day) + second)
    if (plan.wet) {
      assert.ok(plan.start >= 0 && plan.end <= length && plan.end > plan.start, JSON.stringify(plan))
      const total = (plan.precip * (plan.end - plan.start)) / HOUR
      const [low, high] = { ordinary: [1.5, 9], heavy: [11, 18.5], rainstorm: [22, 80] }[plan.intensity]
      assert.ok(total >= low - 1e-9 && total <= high + 1e-9 && plan.precip <= 15 + 1e-9, `${plan.intensity}: ${total} mm at ${plan.precip} mm/h`)
      if (plan.event === "snow") assert.ok(month === 11 || month <= 2)
      if (plan.event === "storm" && month >= 2 && month <= 8) {
        assert.ok(plan.start >= 13 * HOUR && plan.start <= 18 * HOUR && plan.sky === "fair", JSON.stringify(plan))
        assert.deepEqual([at(plan.start - 1.5 * HOUR - 1), at(plan.start - 1), at(plan.start), at(plan.end - 1), at(plan.end)], ["fair", "cloudy", "storm", "storm", "cloudy"])
      } else {
        assert.equal(plan.sky, "overcast")
        assert.deepEqual([at(plan.start), at(plan.end - 1)], [plan.event, plan.event])
        assert.ok((plan.start === 0 || at(plan.start - 1) === "overcast") && (plan.end === length || at(plan.end) === "overcast"), JSON.stringify(plan))
      }
    } else {
      assert.ok(["clear", "fair", "cloudy", "overcast"].includes(plan.sky) && plan.precip === 0)
      const clear = plan.sky === "clear" || plan.sky === "fair"
      if (plan.windyTo > 0) assert.ok(clear && plan.fog === "none" && plan.windyTo - plan.windyFrom >= 6 * HOUR && plan.windyTo <= length && at(plan.windyFrom) === "windy", JSON.stringify(plan))
      if (plan.fog === "morning") assert.ok(clear)
      if (plan.fog === "stratus") assert.ok(!clear && at(0) === "fog" && (plan.lift === length || (plan.lift >= 10 * HOUR && plan.lift <= 14 * HOUR)), JSON.stringify(plan))
      if (plan.fog === "stratus" && plan.lift === length) assert.ok(month >= 10 || month <= 1)
      assert.equal(at(15 * HOUR), plan.windyTo > 15 * HOUR && plan.windyFrom <= 15 * HOUR ? "windy" : plan.fog === "stratus" && plan.lift > 15 * HOUR ? "fog" : plan.sky)
    }
  }
})

// Regression: every wet day's rain fell between 01:30 and 23:00, so no rain fell around midnight and every wet spell stopped there.
test("plan: rain falls at any hour, and on days of steady rain in a row about half the spells rain on through the midnight between them", () => {
  const list = plans(30 * 365, 5), hours = Array.from({ length: 24 }, () => 0)
  let wet = 0, pairs = 0, through = 0
  list.forEach((plan, k) => {
    if (!plan.wet) return
    wet++
    for (let hour = 0; hour < 24; hour++) hours[hour]! += rainingAt(plan, midnight(plan.day) + hour * HOUR + 1800) ? 1 : 0
    const next = list[k + 1]
    if (next === undefined || !next.wet || plan.event === "storm" || next.event === "storm") return
    pairs++
    through += plan.end === lengthOf(plan.day) && next.start === 0 ? 1 : 0
  })
  assert.ok(hours.every((n) => n / wet > 0.05), `the share of wet days raining at each hour: ${hours.map((n) => (n / wet).toFixed(2)).join(" ")}`)
  assert.ok(pairs > 500 && Math.abs(through / pairs - 0.5) < 0.05, `${through} of ${pairs} pairs rain on through midnight`)
})

test("plan: across a clock jump the chain runs on as many days, so a long jump forgets yesterday: wet at the month's odds, the air mass at its full spread", () => {
  providePlace(PLACES[1]!)
  try {
    const wet = { ...plans(1, 1)[0]!, drawn: true, wet: true, airMass: 6 }
    let wets = 0, sum = 0, squares = 0
    const n = 20000, day = daysFromCivil(2003, 1, 20)
    for (let seed = 0; seed < n; seed++) {
      const plan = planFor({ ...wet, day: day - 40 }, midnight(day), seed)
      wets += plan.wet ? 1 : 0
      sum += plan.airMass
      squares += plan.airMass ** 2
    }
    const f = oddsAt(midnight(day), 42).rain, spread = Math.sqrt(squares / n - (sum / n) ** 2)
    assert.ok(Math.abs(wets / n - f) < 0.015, `${wets / n} wet after 40 days, against ${f}`)
    assert.ok(Math.abs(sum / n) < 0.06 && Math.abs(spread - AIR_MASS.spread) < 0.06, `air mass ${sum / n} ± ${spread}`)
    // The next day instead: wet again at the month's persistence, the air mass 0.8 of yesterday's.
    let again = 0, mass = 0
    for (let seed = 0; seed < n; seed++) {
      const plan = planFor({ ...wet, day: day - 1 }, midnight(day), seed)
      again += plan.wet ? 1 : 0
      mass += plan.airMass
    }
    assert.ok(Math.abs(again / n - WET_PERSISTENCE[0]!) < 0.015 && Math.abs(mass / n - 0.8 * 6) < 0.05, `${again / n} wet, air mass ${mass / n}`)
  } finally {
    providePlace(REFERENCE_PLACE)
  }
})

// Regression: a new game's first plan took its calm start for a dry yesterday with no air mass, so the first day was wet 0.19 of the
// time against October's 0.27, its air mass spread 1.5 °C against 2.5.
test("plan: a new game's first day, with no day known before it, is wet at the month's odds and its air mass at its full spread", () => {
  const start = 1792648800, n = 20000
  let wets = 0, sum = 0, squares = 0
  for (let seed = 0; seed < n; seed++) {
    const plan = planFor(calmPlan(start), start + 1, seed)
    wets += plan.wet ? 1 : 0
    sum += plan.airMass
    squares += plan.airMass ** 2
  }
  const f = oddsAt(start).rain, spread = Math.sqrt(squares / n - (sum / n) ** 2), error = Math.sqrt((f * (1 - f)) / n)
  assert.ok(Math.abs(wets / n - f) < 4 * error, `${wets / n} wet, against ${f}`)
  assert.ok(Math.abs(spread - AIR_MASS.spread) < 0.06, `air mass ± ${spread}`)
})

// Regression: a jump into another day planned it only from the jump's hour: the hours before it read Clear whatever the day's sky, and
// a jump late in the day was almost never wet (Jan at 42 N: 0.17 wet from 16:00, 0.01 from 20:00, against 0.25).
test("plan: a clock jump into another day draws the whole day, the same at whatever hour it lands, wet at the month's odds", () => {
  providePlace(PLACES[1]!)
  try {
    const day = daysFromCivil(2027, 1, 15), n = 4000
    let wets = 0
    for (let seed = 0; seed < n; seed++) {
      const whole = planFor(dryBefore(day), midnight(day), seed)
      for (const hour of [9, 16, 20]) assert.deepEqual(planFor(dryBefore(day), midnight(day) + hour * HOUR, seed), whole, `seed ${seed}, a jump to ${hour}:00`)
      assert.equal(whole.from, 0)
      wets += whole.wet ? 1 : 0
    }
    const f = oddsAt(midnight(day), 42).rain, p01 = (f * (1 - WET_PERSISTENCE[0]!)) / (1 - f), error = Math.sqrt((p01 * (1 - p01)) / n)
    assert.ok(Math.abs(wets / n - p01) < 4 * error, `${wets / n} wet after a dry day, against ${p01}`)
  } finally {
    providePlace(REFERENCE_PLACE)
  }
})

// Regression: a plan's window was counted on the wall clock, so on the day summer time starts a window over 02:00 rained an hour less
// than drawn, and on the day it ends an hour more: a total could leave its class.
test("plan: on the days the clocks change a day's rain falls as long as drawn", () => {
  for (const [year, month, date, hours] of [[2027, 3, 28, 23], [2027, 10, 31, 25]] as const) {
    // After a day of frontal rain (an overcast evening) the rain may start at midnight; the clocks change at 01:00 UTC.
    const day = daysFromCivil(year, month, date), yesterday = { ...dryBefore(day), wet: true, sky: "overcast", start: 10 * HOUR, end: 12 * HOUR, precip: 1 } as const
    const change = day * DAY + HOUR - midnight(day)
    assert.equal(lengthOf(day), hours * HOUR)
    let checked = 0
    for (let seed = 0; checked < 40 && seed < 20000; seed++) {
      const plan = planFor(yesterday, midnight(day), seed)
      if (!plan.wet || plan.start >= change || plan.end <= change) continue
      checked++
      let raining = 0
      for (let t = midnight(day); t < midnight(day + 1); t += 60) raining += rainingAt(plan, t) ? 60 : 0
      assert.ok(Math.abs(raining - (plan.end - plan.start)) <= 60, `${year}-${month}-${date}: ${raining} s of rain, against ${plan.end - plan.start}`)
    }
    assert.ok(checked === 40, `${checked} windows over the switch`)
  }
})

// Statistics of the plans alone, 300 years at each latitude: every event's days a month come out as the national table (oddsAt), the
// skies counted at 06 and 18 UTC, and the chain's persistence as the design's p11, each within its slack or four standard errors of
// what 300 years can resolve, whichever is wider: some 300 checks would see one past three by chance.
test("plan: over 300 years at 38, 42 and 45.5 N the days a month of rain, heavy rain, rainstorms, thunder, fog, strong wind and overcast, the clear-ish share and p11 are the table's", () => {
  try {
    for (const where of PLACES) {
      providePlace(where)
      const list = plans(Math.round(300 * 365.25), 2026)
      const months = Array.from({ length: 12 }, () => ({ days: 0, rain: 0, heavy: 0, rainstorm: 0, thunder: 0, fog: 0, windy: 0, overcast: 0, clear: 0, after: 0, again: 0 }))
      list.forEach((plan, k) => {
        const m = months[civilFromDays(plan.day).month - 1]!
        m.days++
        if (plan.wet) {
          m.rain++
          if (plan.intensity !== "ordinary") m.heavy++
          if (plan.intensity === "rainstorm") m.rainstorm++
          if (plan.event === "storm") m.thunder++
        }
        if (plan.fog !== "none") m.fog++
        if (plan.windyTo > 0) m.windy++
        m.overcast += sky(plan, overcast)
        m.clear += sky(plan, clearish)
        if (k > 0 && list[k - 1]!.wet) {
          m.after++
          if (plan.wet) m.again++
        }
      })
      let thunderYear = 0
      months.forEach((m, i) => {
        const odds = oddsAt(utcFromRome(daysFromCivil(2001, i + 1, 15) * DAY + 12 * HOUR), where.lat), per = DAYS_IN[i]! / m.days, label = `${where.lat} N, month ${i + 1}`
        // A month's days come in spells, which widens a binomial count's standard error by about half.
        const error = (chance: number) => 1.5 * DAYS_IN[i]! * Math.sqrt((chance * (1 - chance)) / m.days)
        const days = (count: number, chance: number, slack: number) =>
          assert.ok(Math.abs(count * per - chance * DAYS_IN[i]!) <= Math.max(slack, 4 * error(chance)), `${label}: ${count * per} days against ${chance * DAYS_IN[i]!}`)
        days(m.rain, odds.rain, 0.6)
        days(m.heavy, odds.heavy, 0.3)
        days(m.rainstorm, odds.rainstorm, 0.2)
        days(m.thunder, odds.thunder, 0.35)
        days(m.fog, odds.fog, 0.6)
        days(m.windy, odds.windy, 0.25)
        days(m.overcast, odds.overcast, 0.6)
        assert.ok(Math.abs(m.clear / m.days - odds.clear) <= 0.025, `${label}: clear-ish ${m.clear / m.days} against ${odds.clear}`)
        const p11 = m.again / m.after
        assert.ok(Math.abs(p11 - WET_PERSISTENCE[i]!) <= Math.max(0.04, 4 * Math.sqrt((p11 * (1 - p11)) / m.after)), `${label}: p11 ${p11} of ${m.after}`)
        thunderYear += m.thunder * per
      })
      assert.ok(Math.abs(thunderYear - 40) <= 4, `${where.lat} N: ${thunderYear} thunder days a year`)
    }
  } finally {
    providePlace(REFERENCE_PLACE)
  }
})
