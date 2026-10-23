import assert from "node:assert/strict"
import { test } from "node:test"

import { Ops, Random } from "@typeonce/ritmo-math"

import { heightAt, MAP } from "../map/index.ts"
import type { LightningValue, WeatherValue } from "../schema.ts"
import { screenAxes } from "../view.ts"
import { DAY, daysFromCivil } from "./calendar.ts"
import { airAt, celsiusAt, freezingLevel, NO_SNOW } from "./climate.ts"
import { MAX_RATE, SECONDS_RANGE, setClock } from "./clock.ts"
import { conditionsAt, DRY, fogAt, fogLayers, groundAt, snowCoverAt, windAt } from "./local.ts"
import { describeWeather } from "./readout.ts"
import { REGIME_SPECS, REGIMES } from "./regimes.ts"
import { advanceWeather, initialWeather, setWeather, stormStep } from "./weather.ts"

/** UTC second of `year`-`month`-`day` `hour`:`minute` UTC. */
const utc = (year: number, month: number, day: number, hour = 0, minute = 0) => daysFromCivil(year, month, day) * DAY + hour * 3600 + minute * 60
const OCTOBER = 1792648800
const JANUARY = utc(2027, 1, 15, 13)
/** Draws that fail the test: a step that should draw nothing. */
const never: Random.Random = { ...Random.make(0), next: () => assert.fail("drew a number") }
/** `weather` forced to `regime` and settled at `t`. */
const settledAt = (weather: WeatherValue, regime: (typeof REGIMES)[number], t: number) => setWeather(weather, { regime, settle: true }, t)!
/** `weather` run `seconds` game seconds from `t` in steps of `rate`. */
const run = (weather: WeatherValue, t: number, seconds: number, rate: number, random = Random.make(3)) => {
  let w = weather
  for (let s = rate; s <= seconds; s += rate) w = advanceWeather(w, t + s, rate, random)
  return w
}

test("regimes: each has a name, a description, targets in range and a duration of 1.5–6 game hours, and leads only to regimes", () => {
  for (const id of REGIMES) {
    const spec = REGIME_SPECS[id]
    assert.ok(spec.label.length > 0 && spec.description.length >= 60 && spec.description.endsWith("."), id)
    assert.ok(spec.cloud >= 0 && spec.cloud <= 1 && spec.fog >= 0 && spec.fog <= 1 && spec.storm >= 0 && spec.storm <= 1 && spec.gust >= 1, id)
    assert.ok(spec.hours[0] >= 1.5 && spec.hours[1] <= 6 && spec.hours[0] < spec.hours[1], id)
    assert.ok(Object.keys(spec.next).every((next) => (REGIMES as ReadonlyArray<string>).includes(next)), id)
  }
})

test("a new game: clear and calm at the clear regime's targets, 90 game minutes before the first change, dry, the season's snow line", () => {
  const october = initialWeather(OCTOBER)
  assert.deepEqual(
    [october.regime, october.left, october.forced, october.cloud, october.precip, october.storm, october.wet, october.anomaly, october.snowLine],
    ["clear", 5400, false, REGIME_SPECS.clear.cloud, 0, 0, 0, 0, NO_SNOW]
  )
  assert.equal(initialWeather(JANUARY).snowLine, 1300, "January starts with snow on the ridges")
  assert.ok(Ops.hypot(october.cellX, october.cellY) > 50000, "no storm near")
})

test("setClock: seconds rounded and kept in range, the rate a whole number from 0 to an hour a step; a request with no number in it is dropped", () => {
  const clock = { seconds: OCTOBER, rate: 1 }
  /** A request with both numbers, whatever they are. */
  const both = (seconds: number, rate: number) => ({ seconds, rate })
  assert.deepEqual(setClock(clock, { rate: 60.4 }), { seconds: OCTOBER, rate: 60 })
  assert.deepEqual(setClock(clock, { seconds: OCTOBER + 0.6 }), { seconds: OCTOBER + 1, rate: 1 })
  assert.deepEqual(setClock(clock, { seconds: 0, rate: -3 }), { seconds: SECONDS_RANGE.min, rate: 0 })
  assert.deepEqual(setClock(clock, { seconds: 1e12, rate: 1e9 }), { seconds: SECONDS_RANGE.max, rate: MAX_RATE })
  assert.deepEqual(setClock(clock, both(Number.NaN, 10)), { seconds: OCTOBER, rate: 10 }, "the number in it still applies")
  assert.equal(setClock(clock, {}), undefined)
  assert.equal(setClock(clock, both(Infinity, Number.NaN)), undefined)
})

test("setWeather: forces a regime, settles it at once when asked, hands the weather back to chance; a regime that is none is dropped", () => {
  const start = initialWeather(OCTOBER)
  const forced = setWeather(start, { regime: "rain" }, OCTOBER)!
  assert.deepEqual([forced.regime, forced.forced, forced.cloud, forced.precip], ["rain", true, start.cloud, 0], "forced: the values still ease")
  const rain = settledAt(start, "rain", OCTOBER)
  assert.deepEqual([rain.cloud, rain.precip, rain.wet, rain.anomaly], [1, REGIME_SPECS.rain.precip, 1, REGIME_SPECS.rain.anomaly])
  assert.deepEqual(setWeather(rain, { regime: null }, OCTOBER), { ...rain, forced: false })
  // @ts-expect-error -- the dev console can send anything
  assert.equal(setWeather(start, { regime: "hail" }, OCTOBER), undefined)
  const snow = settledAt(initialWeather(JANUARY), "snow", JANUARY)
  assert.ok(Math.abs(snow.snowLine - freezingLevel(airAt(JANUARY, snow))) < 1e-6 && snow.snowLine < 1300, `settled snow lies down to the freezing level: ${snow.snowLine} m`)
})

test("advance: the clock standing still changes nothing and draws nothing; a forced regime never draws", () => {
  const start = initialWeather(OCTOBER)
  assert.equal(advanceWeather(start, OCTOBER, 0, never), start)
  const forced = { ...settledAt(start, "storm", OCTOBER), left: 10 }
  const later = advanceWeather(forced, OCTOBER + 600, 600, never)
  assert.deepEqual([later.regime, later.left], ["storm", 0])
})

test("advance: every value eases toward its regime's targets over game time, in one long step as in many short ones; rain waits for the clouds", () => {
  const rain = { ...initialWeather(OCTOBER), regime: "rain" as const, forced: true }
  const once = advanceWeather(rain, OCTOBER + 1800, 1800, never), steps = run(rain, OCTOBER, 1800, 1, never)
  for (const key of ["cloud", "wind", "fog", "anomaly"] as const) assert.ok(Math.abs(once[key] - steps[key]) < 1e-9, key)
  // Cloud eases with a 30-minute time constant: 63% of the way in half an hour.
  assert.ok(Math.abs((once.cloud - rain.cloud) / (1 - rain.cloud) - (1 - Ops.exp(-1))) < 1e-9)
  const early = run(rain, OCTOBER, 600, 60, never)
  assert.ok(early.cloud < 0.7 && early.precip === 0, "no rain from a clear sky in ten minutes")
  const hour = run(rain, OCTOBER, 7200, 60, never)
  assert.ok(hour.precip > 1.5 && hour.wet > 0.5, `after two hours: ${hour.precip} mm/h, wet ${hour.wet}`)
})

test("ground: rain soaks the road within half an hour, and it dries over hours in the sun", () => {
  const rain = settledAt({ ...initialWeather(OCTOBER), wet: 0 }, "rain", OCTOBER)
  const soaked = run({ ...rain, wet: 0 }, OCTOBER, 1800, 60, never)
  assert.ok(soaked.wet > 0.9, `${soaked.wet}`)
  const sun = settledAt({ ...initialWeather(OCTOBER), wet: 1 }, "clear", OCTOBER)
  const hour = run({ ...sun, wet: 1 }, utc(2026, 10, 22, 9), 3600, 60, never)
  assert.ok(hour.wet > 0.6 && hour.wet < 0.85, `an hour of October sun: ${hour.wet}`)
  assert.ok(run({ ...sun, wet: 1 }, utc(2026, 10, 22, 9), 6 * 3600, 60, never).wet < 0.2, "six hours")
})

test("ground: overcast drizzle damps a dry road slowly, over hours, and never soaks it", () => {
  for (const t of [OCTOBER, JANUARY]) {
    const drizzle = { ...settledAt(initialWeather(t), "overcast", t), wet: 0 }
    const hour = run(drizzle, t, 3600, 60, never).wet, six = run(drizzle, t, 6 * 3600, 60, never).wet
    assert.ok(hour > 0.03 && hour < 0.15 && six > 0.2 && six < 0.5, `${t}: an hour ${hour}, six hours ${six}`)
    assert.ok(settledAt(initialWeather(t), "overcast", t).wet > six && settledAt(initialWeather(t), "overcast", t).wet < 0.6, "settled: the balance")
  }
})

// Regression: snowmelt on the ridges wet the whole map in the share of its ground under the snow, sunny valley roads 1000 m below
// it too.
test("ground: snow melting on a mild day wets only the band under its edge, the valleys below stay dry; in a frost nothing gets wet", () => {
  // A new game on 15 January (the snow line at 1300 m), clear all day: it thaws from 08:00 to 14:00.
  const morning = utc(2027, 1, 15, 7), afternoon = morning + 6 * 3600
  const january = run(settledAt(initialWeather(morning), "clear", morning), morning, 6 * 3600, 60, never), air = airAt(afternoon, january)
  assert.ok(january.snowLine > 1300 && january.wet === 0, `a thaw from 1300 m: line ${january.snowLine} m, wet ${january.wet}`)
  const band = Array.from({ length: 200 }, (_, k) => groundAt(january, k * 7, 0, january.snowLine - 40, air))
  assert.ok(celsiusAt(air, january.snowLine) > 1 && band.some((g) => g.wet > 0.5), "meltwater just under the snow")
  assert.deepEqual(groundAt(january, 0, 0, 300, air), DRY, "the valley floor 1000 m below")
  // Snow down to 400 m: the band runs just above the valley floors, which stay dry.
  const low = run({ ...settledAt(initialWeather(morning), "clear", morning), snowLine: 400 }, morning, 4 * 3600, 60, never)
  assert.ok(low.snowLine > 400 && low.wet === 0, `four hours of a thaw from 400 m: line ${low.snowLine} m, wet ${low.wet}`)
  assert.deepEqual(groundAt(low, 0, 0, 250, airAt(morning + 4 * 3600, low)), DRY)
  const evening = utc(2027, 1, 16, 19), frost = run({ ...settledAt(initialWeather(evening), "windy", evening), anomaly: -12, wet: 0, snowLine: 400 }, evening, 4 * 3600, 60, never)
  assert.ok(frost.snowLine === 400 && frost.wet === 0, `a hard frost at night: line ${frost.snowLine} m, wet ${frost.wet}`)
})

test("ground: in January snow covers the mountains down toward the freezing level and thaws again slowly, never below the map", () => {
  const morning = utc(2027, 1, 15, 9), snowing = { ...settledAt(initialWeather(morning), "snow", morning), snowLine: NO_SNOW }
  const after = run(snowing, morning, 4 * 3600, 60, never)
  const level = freezingLevel(airAt(morning + 4 * 3600, after))
  // It follows the freezing level down as it falls by night and morning; the noon thaw has barely begun on it.
  assert.ok(after.snowLine < 1600 && Math.abs(after.snowLine - level) < 100, `four hours of snow: line at ${after.snowLine} m, freezing level ${level} m`)
  const thaw = run({ ...settledAt(after, "clear", JANUARY), snowLine: 900 }, utc(2027, 1, 16, 8), 8 * 3600, 60, never)
  assert.ok(thaw.snowLine > 900 && thaw.snowLine < 1200, `a sunny January day: snow line ${thaw.snowLine} m`)
  const deep = run({ ...snowing, anomaly: -20, snowLine: 200 }, JANUARY, 3600, 60, never)
  assert.ok(deep.snowLine >= 147 - 50 - 1e-9 && deep.snowLine < 200, "bounded just under the lowest ground")
})

test("local: snow lies above the snow line's ragged edge only, and wet ground under it is snow, not water", () => {
  assert.equal(snowCoverAt(NO_SNOW, 0, 0, 1700), 0)
  assert.equal(snowCoverAt(1000, 0, 0, 900), 0)
  assert.equal(snowCoverAt(1000, 0, 0, 1100), 1)
  // Along the 1000 m contour the edge wanders by tens of metres: some points white, some bare.
  const along = Array.from({ length: 200 }, (_, k) => snowCoverAt(1000, k * 7, 0, 1000))
  assert.ok(along.some((c) => c === 0) && along.some((c) => c === 1), "a ragged edge")
  // Meltwater: dry weather, but where the air thaws the road just below the snow is wet, drier further down; in a frost it is dry.
  const mild = airAt(JANUARY, { cloud: 0, wind: 2, anomaly: 4 }), frost = airAt(JANUARY, { cloud: 0, wind: 2, anomaly: -8 })
  assert.ok(celsiusAt(mild, 920) > 1 && celsiusAt(frost, 1000) < 0)
  assert.deepEqual(groundAt({ wet: 0, snowLine: NO_SNOW }, 0, 0, 300, mild), DRY)
  assert.deepEqual(groundAt({ wet: 0.8, snowLine: 1000 }, 0, 0, 1100, mild), { wet: 0, snow: 1 })
  assert.deepEqual(groundAt({ wet: 0.8, snowLine: 1000 }, 0, 0, 300, mild), { wet: 0.8, snow: 0 })
  const slush = Array.from({ length: 200 }, (_, k) => groundAt({ wet: 0, snowLine: 1000 }, k * 7, 0, 920, mild))
  assert.ok(slush.every((g) => g.wet <= 1 && g.snow === 0) && slush.some((g) => g.wet > 0.5) && slush.some((g) => g.wet < 0.5), "a wet band below the snow")
  assert.ok(Array.from({ length: 200 }, (_, k) => groundAt({ wet: 0, snowLine: 1000 }, k * 7, 0, 920, frost)).every((g) => g.wet === 0), "frozen: no meltwater")
  assert.deepEqual(groundAt({ wet: 0, snowLine: 1000 }, 0, 0, 700, mild), DRY)
})

test("local: in a January snowfall it snows on the ridges and rains in the valley; the wind grows to 2.5 times the valley's on the crests", () => {
  const weather = settledAt(initialWeather(JANUARY), "snow", JANUARY)
  const valley = conditionsAt(JANUARY, weather, 0, 0, 250), ridge = conditionsAt(JANUARY, weather, 0, 0, 1700)
  assert.ok(valley.rain > valley.snow && ridge.snow > 0 && ridge.rain === 0, `${JSON.stringify(valley)} ${JSON.stringify(ridge)}`)
  assert.ok(ridge.snow > valley.rain, "more falls on the mountains")
  assert.ok(Math.abs(celsiusAt(airAt(JANUARY, weather), 250) - valley.celsius) < 1e-12)
  const speed = (z: number) => Ops.hypot(windAt(weather, z).x, windAt(weather, z).y) / weather.wind
  assert.deepEqual([speed(150), speed(250), speed(1800)].map((v) => Math.round(v * 1e9) / 1e9), [1, 1, 2.5])
  assert.ok(speed(1040) > 1.7 && speed(1040) < 1.8, `${speed(1040)} at 1040 m`)
})

test("local: radiation fog fills the valleys on a clear calm winter morning and is gone by the afternoon; a clear sky keeps the ridges free", () => {
  const clear = settledAt(initialWeather(JANUARY), "clear", JANUARY)
  // The month's foggy mornings: some days of January bring it, others not.
  const mornings = Array.from({ length: 31 }, (_, d) => fogLayers(utc(2027, 1, 1 + d, 7), clear))
  const foggy = mornings.filter((f) => f.valleyDensity > 0.5)
  assert.ok(foggy.length >= 8 && foggy.length <= 25, `${foggy.length} foggy mornings`)
  const day = mornings.indexOf(foggy[0]!) + 1
  assert.ok(fogAt(fogLayers(utc(2027, 1, day, 7), clear), 250) > 0.5 && fogAt(fogLayers(utc(2027, 1, day, 7), clear), 600) === 0, "in the valley, not above it")
  assert.equal(fogLayers(utc(2027, 1, day, 14), clear).valleyDensity, 0, "burnt off by the afternoon")
  assert.ok(fogLayers(JANUARY, clear).cloudBase > 2000, "clear: no cloud on the ridges")
})

test("local: each regime its own cloud base: the crests in cloud under any full cover, most roads below it in rain and storms, a thick low stratus in fog", () => {
  const heights = MAP.roads.flatMap((road) => Array.from({ length: road.pts.length / 2 }, (_, k) => heightAt(road.pts[2 * k]!, road.pts[2 * k + 1]!)))
  /** The share of road vertices inside the hill fog (half its thickness or more) under `regime`, settled. */
  const inCloud = (regime: (typeof REGIMES)[number]) => {
    const layers = fogLayers(JANUARY, settledAt(initialWeather(JANUARY), regime, JANUARY))
    return { layers, roads: heights.filter((z) => layers.cloudDensity * (z > layers.cloudBase + 25 ? 1 : 0) > 0).length / heights.length }
  }
  const rain = inCloud("rain"), storm = inCloud("storm"), fog = inCloud("fog"), overcast = inCloud("overcast")
  assert.ok(rain.roads < 0.25 && storm.roads < 0.15, `roads in the cloud: rain ${rain.roads}, storm ${storm.roads}`)
  assert.ok(storm.layers.cloudBase >= 1200 && rain.layers.cloudBase < storm.layers.cloudBase && overcast.layers.cloudBase < 1700, `${rain.layers.cloudBase}, ${storm.layers.cloudBase}`)
  assert.ok([rain, storm, overcast].every(({ layers }) => fogAt(layers, 1750) > 0.5 && layers.cloudDensity < 1), "the crests hidden, but no thick fog")
  assert.ok(fog.layers.cloudBase < 700 && fog.layers.cloudDensity > 0.95, `fog: a low stratus at ${fog.layers.cloudBase} m`)
})

test("storm: the cell starts 6 km upwind of the player, drifts downwind 90 m a real second, and draws nothing without a storm", () => {
  const witness = { x: 100, y: -200, ...screenAxes(0) }
  const calm = initialWeather(OCTOBER)
  assert.deepEqual(stormStep(calm, witness, 1 / 60, 1, never), { weather: calm, lightning: undefined })
  const storm = settledAt(calm, "storm", OCTOBER), wind = { x: Ops.cos(storm.windAngle), y: Ops.sin(storm.windAngle) }
  const first = stormStep(storm, witness, 1 / 60, 1, Random.make(5)).weather
  const upwind = (first.cellX - witness.x) * wind.x + (first.cellY - witness.y) * wind.y
  assert.ok(Math.abs(upwind + 6000) < 1e-6 && Ops.hypot(first.cellX - witness.x, first.cellY - witness.y) < 6100, `${first.cellX}, ${first.cellY}`)
  const next = stormStep(first, witness, 1 / 60, 2, Random.make(6)).weather
  assert.ok(Math.abs((next.cellX - first.cellX) * wind.x + (next.cellY - first.cellY) * wind.y - 1.5) < 1e-9, "1.5 m a step")
})

// Regression: a storm after the first began where the last one had faded, overhead or already past the player.
test("storm: a later storm starts 6 km upwind too, not where the last one faded; a calm sky is left unchanged", () => {
  const witness = { x: -1000, y: -2000, ...screenAxes(0) }, random = Random.make(9)
  let w = settledAt(initialWeather(OCTOBER), "storm", OCTOBER), t = OCTOBER, step = 0
  /** One step as AdvanceWeather takes it: a game second of weather, then a sixtieth of a real second of the storm. */
  const tick = () => {
    t++
    w = stormStep(advanceWeather(w, t, 1, random), witness, 1 / 60, ++step, random).weather
  }
  // Half a minute of storm, then cloud: it fades with its cell about 3 km past the player, short of where a new cell would start.
  for (let k = 0; k < 60 * 30; k++) tick()
  w = setWeather(w, { regime: "cloudy" }, t)!
  while (w.storm >= 0.01) tick()
  for (let k = 0; k < 60 * 120; k++) tick()
  assert.equal(stormStep(w, witness, 1 / 60, step, never).weather, w, "calm: nothing to write, nothing drawn")
  w = setWeather(w, { regime: "storm" }, t)!
  while (w.storm < 0.01) tick()
  const wind = { x: Ops.cos(w.windAngle), y: Ops.sin(w.windAngle) }
  const upwind = (w.cellX - witness.x) * wind.x + (w.cellY - witness.y) * wind.y
  assert.ok(Math.abs(upwind + 6000) < 1e-6, `the next storm starts ${upwind} m along the wind from the player`)
})

test("storm: lightning about 0.25 times a real second at full strength, 60% of it in the cloud, bolts on the map; near the cell a quarter of the bolts strike in front of the camera", () => {
  const { up, right } = screenAxes(1), witness = { x: -412, y: 438, up, right }
  const storm = settledAt(initialWeather(OCTOBER), "storm", OCTOBER)
  const flashes = (seed: number, steps: number, overhead: boolean) => {
    const random = Random.make(seed), list = []
    let w = storm
    for (let step = 0; step < steps; step++) {
      // Held over the player (or far off) to measure the placement there.
      w = overhead ? { ...w, cellX: witness.x, cellY: witness.y } : w
      const out = stormStep(w, witness, 1 / 60, step, random)
      w = out.weather
      if (out.lightning !== undefined) list.push(out.lightning)
    }
    return list
  }
  const all = flashes(7, 60 * 1800, false)
  assert.ok(all.length > 0.25 * 1800 * 0.9 && all.length < 0.25 * 1800 * 1.1, `${all.length} flashes in 30 real minutes`)
  const bolts = all.filter((l) => l.bolt).length / all.length
  assert.ok(bolts > 0.33 && bolts < 0.47, `${bolts} of them bolts`)
  assert.ok(all.every((l) => (!l.bolt || onMap(l)) && l.power >= 0.3 && l.power <= 1 && Number.isSafeInteger(l.seed) && Number.isFinite(l.x) && Number.isFinite(l.y)))
  assert.deepEqual(flashes(7, 600, false), all.filter((l) => l.step < 600), "the same draws give the same lightning")
  const near = flashes(8, 60 * 1200, true).filter((l) => l.bolt)
  const inView = near.filter((l) => {
    const dx = l.x - witness.x, dy = l.y - witness.y, toward = -(dx * up.x + dy * up.y), across = dx * right.x + dy * right.y
    return toward >= 60 && toward <= 600 && Math.abs(across) <= 40
  })
  assert.ok(inView.length / near.length > 0.17 && inView.length / near.length < 0.33, `${inView.length} of ${near.length} bolts in view`)
})

/** Whether a flash lies on the map, and whether exactly on its edge (where clamping once piled them). */
const onMap = (l: Pick<LightningValue, "x" | "y">) => l.x >= MAP.bounds.minX && l.x <= MAP.bounds.maxX && l.y >= MAP.bounds.minY && l.y <= MAP.bounds.maxY
const onEdge = (l: Pick<LightningValue, "x" | "y">) => l.x === MAP.bounds.minX || l.x === MAP.bounds.maxX || l.y === MAP.bounds.minY || l.y === MAP.bounds.maxY

test("storm: near the map's edge bolts strike only the map and none lie on its edge; flashes in the cloud stay where they were drawn, off the map too", () => {
  for (const [x, y] of [[-1751, 3360], [-412, 438], [1700, 800]] as const) {
    const witness = { x, y, ...screenAxes(0) }, list: Array<LightningValue> = []
    for (const seed of [1, 2, 3, 4]) {
      const random = Random.make(seed)
      let w = settledAt(initialWeather(OCTOBER), "storm", OCTOBER)
      for (let step = 0; step < 60 * 180; step++) {
        const out = stormStep(w, witness, 1 / 60, step, random)
        w = out.weather
        if (out.lightning !== undefined) list.push(out.lightning)
      }
    }
    const bolts = list.filter((l) => l.bolt)
    assert.ok(bolts.length > 20 && bolts.every(onMap) && !list.some(onEdge), `(${x}, ${y}): ${bolts.length} bolts`)
    if (x < -1000) assert.ok(list.some((l) => !l.bolt && !onMap(l)), "by the edge some flashes light the cloud off the map")
  }
})

test("readout: one word for the weather where the player stands, from what falls and the fog there before the regime's sky", () => {
  const at = (t: number, regime: (typeof REGIMES)[number], z: number) => {
    const weather = settledAt(initialWeather(t), regime, t)
    return describeWeather(weather, conditionsAt(t, weather, 0, 0, z))
  }
  assert.deepEqual(REGIMES.map((r) => at(OCTOBER, r, 300)), ["Clear", "Fair", "Cloudy", "Drizzle", "Fog", "Rain", "Storm", "Windy", "Rain"])
  assert.equal(at(JANUARY, "snow", 1700), "Snow", "snow on the ridge while the valley gets rain")
  assert.equal(at(JANUARY, "rain", 1300), "Rain", "in the cloud, but the rain is what one sees")
  assert.equal(describeWeather({ cloud: 1, storm: 0, wind: 2 }, { rain: 0.3, snow: 0.3, fog: 0 }), "Sleet")
  assert.equal(describeWeather({ cloud: 0.6, storm: 0, wind: 2 }, { rain: 0, snow: 0, fog: 0.8 }), "Fog")
})
