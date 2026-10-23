import assert from "node:assert/strict"
import { test } from "node:test"

import { NO_SNOW } from "../sim/sky/climate.ts"
import { MAX_RATE, setClock } from "../sim/sky/clock.ts"
import { windAt } from "../sim/sky/local.ts"
import { describeWeather } from "../sim/sky/readout.ts"
import { initialWeather } from "../sim/sky/weather.ts"
import { compass, fallingText, RATES, regimeText, snowLineText, spanText, windText } from "./debug-sky.ts"

test("the rate buttons offer rates the sim holds as they are, from a still clock to a game hour a real second", () => {
  for (const { rate } of RATES) assert.equal(setClock({ seconds: 0, rate: 1 }, { rate })?.rate, rate, String(rate))
  assert.deepEqual(RATES.map(({ rate }) => rate), [0, 1, 10, 60])
  assert.ok(RATES.every(({ rate }) => rate <= MAX_RATE))
})

test("the wind reads as the compass point it blows from: the Libeccio, moving north-east, from the south-west", () => {
  const toward = (radians: number) => windAt({ wind: 5, windAngle: radians }, 250)
  assert.equal(compass(toward(Math.PI / 4).x, toward(Math.PI / 4).y), "SW", "Libeccio")
  assert.equal(compass(toward((-3 * Math.PI) / 4).x, toward((-3 * Math.PI) / 4).y), "NE", "Tramontana")
  assert.equal(compass(0, -1), "N", "air moving south comes from the north")
  assert.equal(compass(-1, 0), "E")
  assert.equal(compass(0.1, 1), "S", "rounds to the nearest point")
  assert.equal(windText(toward(Math.PI / 4), 1.7), "from SW 5.0 m/s, gusts 8.5")
  assert.equal(windText({ x: 0, y: 0 }, 1.4), "calm")
})

test("game spans read in hours and minutes, and the snow line reads none while it stands above the map", () => {
  assert.deepEqual([spanText(0), spanText(45 * 60), spanText(80 * 60), spanText(3 * 3600 + 29)], ["0 min", "45 min", "1 h 20 min", "3 h 0 min"])
  assert.equal(spanText(-30), "0 min", "a countdown run out")
  assert.deepEqual([snowLineText(1449.6), snowLineText(NO_SNOW)], ["1450 m", "none"])
})

// Regression: the menu cut anything under 0.05 mm/h, so a settled overcast's 0.03 mm/h read "Drizzle" on the HUD and nothing falling
// in "Air here".
test("what falls reads by kind, sleet as both, faint drizzle to the hundredth, and from just the amount the HUD's word names it", () => {
  assert.deepEqual([fallingText(3, 0), fallingText(0.4, 1.2), fallingText(0, 1.5), fallingText(0.03, 0), fallingText(0.012, 0.016), fallingText(0, 0)],
    ["rain 3.0 mm/h", "rain 0.4 + snow 1.2 mm/h", "snow 1.5 mm/h", "rain 0.03 mm/h", "rain 0.01 + snow 0.02 mm/h", ""])
  const calm = { cloud: 0, storm: 0, wind: 0 }
  for (const mm of [0.005, 0.0199, 0.02, 0.021, 0.05, 0.1]) {
    assert.equal(fallingText(mm, 0) !== "", describeWeather(calm, { rain: mm, snow: 0, fog: 0 }) === "Drizzle", `${mm} mm/h`)
  }
})

// Regression: over the paused map, Rain showed pressed while the readout still said the game's "Overcast, next draw in 1 h 27 min".
test("the regime readout says what the game holds, and a pin the paused game has not taken yet as what it takes on resume", () => {
  const overcast = { ...initialWeather(1792648800), regime: "overcast" as const, left: 87 * 60 }, rain = { ...overcast, regime: "rain" as const, forced: true }
  assert.equal(regimeText(overcast, null, "overcast"), "Overcast, next draw in 1 h 27 min")
  assert.equal(regimeText(rain, "rain", "rain"), "Rain, held")
  assert.equal(regimeText(overcast, "rain", "rain"), "Rain, held (on resume)")
  assert.equal(regimeText(rain, "storm", "storm"), "Thunderstorm, held (on resume)")
  assert.equal(regimeText(rain, null, "rain"), "Rain, left to chance (on resume)")
  assert.equal(regimeText(overcast, null, "rain"), "Rain, left to chance (on resume)", "Rain, then Auto")
})
