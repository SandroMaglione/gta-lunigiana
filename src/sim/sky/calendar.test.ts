import assert from "node:assert/strict"
import { test } from "node:test"

import { civilFromDays, DAY, daysFromCivil, romeOffset, romeTime, utcFromRome, weekday } from "./calendar.ts"

/** UTC second of `year`-`month`-`day` `hour`:`minute` UTC. */
const utc = (year: number, month: number, day: number, hour = 0, minute = 0) => daysFromCivil(year, month, day) * DAY + hour * 3600 + minute * 60

test("calendar: day numbers and dates round-trip every day from 1900 to 2100, and known days land where they should", () => {
  for (let z = daysFromCivil(1900, 1, 1); z <= daysFromCivil(2100, 12, 31); z++) {
    const { year, month, day } = civilFromDays(z)
    assert.equal(daysFromCivil(year, month, day), z)
  }
  assert.equal(daysFromCivil(1970, 1, 1), 0)
  assert.equal(daysFromCivil(2026, 10, 22), 20748)
  assert.deepEqual(civilFromDays(daysFromCivil(2024, 2, 29) + 1), { year: 2024, month: 3, day: 1 }, "a leap day")
  assert.deepEqual(civilFromDays(daysFromCivil(2100, 2, 28) + 1), { year: 2100, month: 3, day: 1 }, "2100 is no leap year")
  assert.deepEqual(civilFromDays(-1), { year: 1969, month: 12, day: 31 })
  // 1970-01-01 was a Thursday, 2026-10-22 is a Thursday, 2000-01-01 was a Saturday.
  assert.deepEqual([weekday(0), weekday(20748), weekday(daysFromCivil(2000, 1, 1)), weekday(-1)], [4, 4, 6, 3])
})

test("Rome: summer time runs from 01:00 UTC on the last Sunday of March to 01:00 UTC on the last Sunday of October (IANA Europe/Rome)", () => {
  for (const [year, march, october] of [[2026, 29, 25], [2027, 28, 31], [2032, 28, 31]] as const) {
    assert.equal(romeOffset(utc(year, 3, march, 1) - 1), 3600, `${year}: winter until the March switch`)
    assert.equal(romeOffset(utc(year, 3, march, 1)), 7200, `${year}: summer from it`)
    assert.equal(romeOffset(utc(year, 10, october, 1) - 1), 7200, `${year}: summer until the October switch`)
    assert.equal(romeOffset(utc(year, 10, october, 1)), 3600, `${year}: winter from it`)
  }
  assert.equal(utcFromRome(utc(2026, 10, 22, 12)), utc(2026, 10, 22, 10), "noon in October summer time is 10:00 UTC")
  assert.equal(utcFromRome(utc(2026, 12, 21, 12)), utc(2026, 12, 21, 11), "noon in December is 11:00 UTC")
  assert.equal(utcFromRome(utc(2026, 3, 29, 2, 30)), utc(2026, 3, 29, 1, 30), "the skipped hour reads an hour later (03:30 summer time)")
  assert.equal(utcFromRome(utc(2026, 10, 25, 2, 30)), utc(2026, 10, 25, 0, 30), "the repeated hour reads as its first, summer-time pass")
})

test("Rome: the wall clock at a UTC second", () => {
  assert.deepEqual(romeTime(1792648800), { year: 2026, month: 10, day: 22, hour: 8, minute: 0, second: 0 })
  assert.deepEqual(romeTime(utc(2026, 12, 31, 23, 30) + 59), { year: 2027, month: 1, day: 1, hour: 0, minute: 30, second: 59 })
  assert.equal(romeTime(utc(2026, 6, 21, 11, 21) + 0.5).second, 0.5, "a fractional second keeps its fraction")
})
