import assert from "node:assert/strict"
import { test } from "node:test"

import { moonAt, moonPhase, skyDirection, sunAt } from "../astro.ts"
import { DAY, daysFromCivil } from "../calendar.ts"
import { SUNRISE_ELEVATION, sunOver, sunTimes } from "../day.ts"
import { place, REFERENCE_PLACE } from "../place.ts"

// The reference values belong to the reference site, not to whichever map is loaded; this file loads none, so the sky's place is it.
const { lat, lon } = REFERENCE_PLACE
assert.deepEqual(place(), REFERENCE_PLACE)
/** UTC second of `year`-`month`-`day` `hour`:`minute` UTC. */
const utc = (year: number, month: number, day: number, hour = 0, minute = 0) =>
  daysFromCivil(year, month, day) * DAY + hour * 3600 + minute * 60
/** `a − b` in degrees, the short way round. */
const turn = (a: number, b: number) => ((((a - b) % 360) + 540) % 360) - 180

// Reference values: JPL Horizons (airless, topocentric at 44.16175 N, 10.13 E, 0.3 km) and the USNO Astronomical Applications API,
// fetched for this check; tolerances as measured over 192 sun and 303 moon samples (sun 0.011°, moon 0.34° elevation, 0.59° azimuth).

test("sun: azimuth and elevation within 0.02° of JPL Horizons at Monzone on 22 October 2026", () => {
  for (const [hour, azimuth, elevation] of [
    [9, 145.098, 27.978],
    [12, 196.498, 33.235],
    [15, 239.714, 13.116],
  ] as const) {
    const sun = sunAt(utc(2026, 10, 22, hour), lat, lon)
    assert.ok(
      Math.abs(turn(sun.azimuth, azimuth)) < 0.02 && Math.abs(sun.elevation - elevation) < 0.02,
      `${hour}:00 UTC: ${sun.azimuth}, ${sun.elevation}`,
    )
  }
})

test("sun: the noon elevation (69.3° at the June solstice, 22.4° at the December one) and sunrise and sunset within a minute of USNO", () => {
  const highest = (year: number, month: number, day: number) => {
    let most = -90
    for (let minute = 9 * 60; minute < 14 * 60; minute++)
      most = Math.max(most, sunAt(utc(year, month, day) + minute * 60, lat, lon).elevation)
    return most
  }
  for (const [month, day, noon] of [
    [6, 21, 69.275],
    [10, 22, 34.695],
    [12, 21, 22.399],
  ] as const) {
    assert.ok(
      Math.abs(highest(2026, month, day) - noon) < 0.02,
      `${month}-${day}: ${highest(2026, month, day)}°`,
    )
  }
  // USNO rise and set, UTC, to the minute: sunTimes for the Rome day at noon.
  for (const [month, day, rise, set] of [
    [6, 21, [3, 36], [19, 7]],
    [10, 22, [5, 43], [16, 24]],
    [12, 21, [6, 51], [15, 44]],
    [3, 20, [5, 23], [17, 32]],
  ] as const) {
    const day0 = utc(2026, month, day),
      times = sunTimes(day0 + 12 * 3600)!
    assert.ok(Number.isInteger(times.sunrise) && Number.isInteger(times.sunset))
    assert.ok(
      Math.abs(times.sunrise - (day0 + rise[0] * 3600 + rise[1] * 60)) <= 60,
      `${month}-${day} sunrise off by ${times.sunrise - (day0 + rise[0] * 3600 + rise[1] * 60)} s`,
    )
    assert.ok(
      Math.abs(times.sunset - (day0 + set[0] * 3600 + set[1] * 60)) <= 60,
      `${month}-${day} sunset off by ${times.sunset - (day0 + set[0] * 3600 + set[1] * 60)} s`,
    )
    assert.ok(
      Math.abs(sunOver(times.sunrise).elevation - SUNRISE_ELEVATION) < 0.01,
      "the sun's centre at −0.833°",
    )
  }
})

test("moon: within 0.7° in azimuth and 0.4° in elevation of JPL Horizons, its lit fraction within 0.01", () => {
  const vectors = [
    [utc(2026, 10, 22, 18), 137.48, 31.567, 0.863],
    [utc(2026, 10, 22, 21), 191.749, 41.022, 0.869],
    [utc(2026, 10, 23, 0), 239.944, 22.971, 0.875],
    [utc(2026, 12, 21, 18), 104.776, 49.198, 0.922],
    [utc(2026, 12, 21, 21), 179.734, 70.404, 0.928],
    [utc(2026, 12, 22, 0), 255.978, 49.862, 0.933],
  ] as const
  for (const [t, azimuth, elevation, lit] of vectors) {
    const moon = moonAt(t, lat, lon),
      phase = moonPhase(sunAt(t, lat, lon), moon)
    assert.ok(
      Math.abs(turn(moon.azimuth, azimuth)) < 0.7 && Math.abs(moon.elevation - elevation) < 0.4,
      `${t}: ${moon.azimuth}, ${moon.elevation}`,
    )
    assert.ok(Math.abs(phase.illuminated - lit) < 0.01, `${t}: lit ${phase.illuminated}`)
  }
})

test("moon: the phase at USNO's 2026 new, first-quarter and full moons", () => {
  const at = (month: number, day: number, hour: number, minute: number) => {
    const t = utc(2026, month, day, hour, minute)
    return moonPhase(sunAt(t, lat, lon), moonAt(t, lat, lon))
  }
  const fresh = at(10, 10, 15, 50),
    quarter = at(10, 18, 16, 12),
    full = at(10, 26, 4, 12)
  assert.ok(fresh.illuminated < 0.01, `new: ${fresh.illuminated}`)
  assert.ok(
    Math.abs(quarter.illuminated - 0.5) < 0.01 &&
      Math.abs(quarter.age - 0.25) < 0.01 &&
      quarter.waxing,
    JSON.stringify(quarter),
  )
  assert.ok(full.illuminated > 0.99 && Math.abs(full.age - 0.5) < 0.01, JSON.stringify(full))
  assert.equal(at(10, 30, 0, 0).waxing, false, "waning after the full moon")
})

test("sky direction: azimuth clockwise from north and elevation to a unit vector, x east, y north, z up", () => {
  const close = (
    v: { readonly x: number; readonly y: number; readonly z: number },
    x: number,
    y: number,
    z: number,
  ) => Math.abs(v.x - x) < 1e-12 && Math.abs(v.y - y) < 1e-12 && Math.abs(v.z - z) < 1e-12
  assert.ok(close(skyDirection(0, 0), 0, 1, 0), "north on the horizon")
  assert.ok(close(skyDirection(90, 0), 1, 0, 0), "east")
  assert.ok(close(skyDirection(180, 30), 0, -Math.sqrt(3) / 2, 0.5), "south, 30° up")
  assert.ok(close(skyDirection(123, 90), 0, 0, 1), "the zenith")
})
