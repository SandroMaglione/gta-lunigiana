import assert from "node:assert/strict"
import { test } from "node:test"

import { Color, Object3D, Vector3 } from "three"

import { linear } from "../../geometry.ts"
import {
  aimToward,
  CLEAR,
  easeLog,
  keyDirection,
  luminance,
  SHADOW_FLOOR,
  skyLight,
  type SkyInput,
  sunLight,
} from "../light.ts"
import { throughClouds } from "../surface.ts"

/** The fixed light before the day cycle: the sun 0xfff0d8 × 2 from (−0.75, 1, 0.35), the hemisphere 0xdbe8f5 / 0x9a8a68 × 1.8. */
const HOME_SUN = new Vector3(-0.75, 1, 0.35).normalize()
const HOME_ELEVATION = (Math.asin(HOME_SUN.y) * 180) / Math.PI
/** Clockwise from north (three −z): 244.98°, west-south-west. */
const HOME_AZIMUTH = 360 + (Math.atan2(HOME_SUN.x, -HOME_SUN.z) * 180) / Math.PI
const near = (a: number, b: number, eps: number, what: string) =>
  assert.ok(Math.abs(a - b) <= eps, `${what}: ${a} vs ${b}`)

/** A clear sky with the sun at `elevation` (azimuth 245°, west-south-west) and no moon. */
const sky = (elevation: number, more: Partial<SkyInput> = {}): SkyInput => ({
  sun: { elevation, azimuth: 245 },
  moon: { elevation: -30, azimuth: 0 },
  moonLit: 0,
  ...CLEAR,
  ...more,
})

test("at today's sun (50.4° up, clear) the light is exactly today's settled look: sun 0xfff0d8 × 2, hemisphere × 1.8, exposure 1", () => {
  const sun = linear(0xfff0d8)
  const light = skyLight(sky(HOME_ELEVATION))
  assert.equal(light.key.body, "sun")
  for (let c = 0; c < 3; c++)
    near(light.key.color[c]! * light.key.intensity, sun[c]! * 2, 1e-9, `sun channel ${c}`)
  for (let c = 0; c < 3; c++)
    near(light.sky[c]! * light.hemisphere, linear(0xdbe8f5)[c]! * 1.8, 1e-9, `sky channel ${c}`)
  for (let c = 0; c < 3; c++)
    near(
      light.ground[c]! * light.hemisphere,
      linear(0x9a8a68)[c]! * 1.8,
      1e-9,
      `ground channel ${c}`,
    )
  near(light.exposure, 1, 1e-9, "exposure")
  assert.deepEqual([light.night, light.grey, light.lamps], [0, 0, 0], "no grade, no lamps")
})

test("the sun reddens and weakens toward the horizon and is gone just under it; its hue follows the true elevation", () => {
  let last = Infinity
  for (const e of [60, 40, 20, 10, 5, 2, 0.5]) {
    const { color, intensity } = sunLight(e)
    assert.ok(intensity < last, `weaker at ${e}°`)
    last = intensity
    assert.equal(Math.max(...color), color[0], `red leads at ${e}°`)
  }
  const [r, g, b] = sunLight(5).color
  assert.ok(b / r < 0.35 && g / r < 0.75, `golden at 5°: ${[r, g, b]}`)
  assert.equal(sunLight(-1).intensity, 0)
  assert.ok(sunLight(3).intensity > 0.3, "the golden hour still warms the walls facing it")
})

test("night: the moon takes over the key light once the sun is well down, as bright as its phase; a moonless night is dark but readable", () => {
  const full = skyLight(sky(-25, { moon: { elevation: 40, azimuth: 180 }, moonLit: 1 }))
  const half = skyLight(sky(-25, { moon: { elevation: 40, azimuth: 180 }, moonLit: 0.5 }))
  const none = skyLight(sky(-25))
  assert.equal(full.key.body, "moon")
  assert.deepEqual([full.key.azimuth, full.key.elevation], [180, 40])
  assert.ok(full.key.intensity > half.key.intensity && half.key.intensity > 0)
  assert.equal(none.key.intensity, 0, "no moon up: no key light")
  const clouded = skyLight(
    sky(-25, { moon: { elevation: 40, azimuth: 180 }, moonLit: 1, cloud: 1, precip: 5, storm: 1 }),
  )
  assert.ok(
    clouded.key.intensity * clouded.direct < 0.15 * full.key.intensity,
    "a storm's cloud hides the moon",
  )
  assert.equal(full.night, 1)
  assert.equal(full.lamps, 1)
  // On screen (scene light × exposure, relative to the settled noon), night sits between a tenth and a quarter of the day.
  const screen = (l: typeof none) =>
    (l.irradiance * l.exposure) / skyLight(sky(HOME_ELEVATION)).irradiance
  assert.ok(screen(none) > 0.08 && screen(none) < 0.2, `moonless night ${screen(none)}`)
  assert.ok(screen(full) > screen(none), "moonlight adds")
  assert.equal(none.exposure, 4, "the eye adapts at most 4×")
  // Around the swap (the sun at −4°) both bodies are dark, so the change of direction is never seen.
  assert.ok(
    skyLight(sky(-3.9, { moon: { elevation: 40, azimuth: 180 }, moonLit: 1 })).key.intensity < 1e-6,
  )
  assert.ok(
    skyLight(sky(-4.1, { moon: { elevation: 40, azimuth: 180 }, moonLit: 1 })).key.intensity < 0.01,
  )
})

test("dusk: the screen darkens steadily from noon to night, lamps come on after sunset, the night grade with the twilight", () => {
  const noon = skyLight(sky(HOME_ELEVATION)).irradiance
  let last = Infinity
  for (const e of [40, 20, 10, 5, 2, 0, -3, -6, -9, -12, -18]) {
    const l = skyLight(sky(e)),
      screen = (l.irradiance * l.exposure) / noon
    assert.ok(screen < last + 1e-9, `${e}°: ${screen}`)
    last = screen
  }
  assert.equal(skyLight(sky(1)).lamps, 0, "lamps off before sunset")
  assert.ok(skyLight(sky(-6)).lamps > 0.6, "on by the end of civil twilight")
  assert.equal(skyLight(sky(5)).night, 0)
  assert.equal(skyLight(sky(-10)).night, 1)
})

// Regression: the key light lost up to 88 % to the cloud cover and the surface's cloud shadows took their share again, so a cloudy
// sky's sunny gaps got only 0.81 of the sun.
test("clouds take the sun only where their shadows fall: a cloudy sky's gaps get the full sun, and the mean light follows the shadows' share", () => {
  const clear = skyLight(sky(35))
  for (const cloud of [0.3, 0.65, 0.9, 1]) {
    const l = skyLight(sky(35, { cloud }))
    near(l.key.intensity, clear.key.intensity, 1e-12, `the key light above a ${cloud} cover`)
    near(l.direct, throughClouds(cloud), 1e-12, `the share that reaches the ground under ${cloud}`)
  }
  assert.equal(clear.direct, 1)
  assert.ok(skyLight(sky(35, { cloud: 0.65 })).direct > 0.5, "a cloudy sky is still half sunny")
  assert.equal(skyLight(sky(35, { cloud: 1 })).direct, 0, "overcast: no direct light anywhere")
})

test("weather dims: cloud takes the direct sun, rain and storms the sky light; lamps come on in a storm and in thick fog, and the eye adapts only partly", () => {
  const clear = skyLight(sky(35)),
    overcast = skyLight(sky(35, { cloud: 0.95 }))
  const rain = skyLight(sky(35, { cloud: 1, precip: 3 })),
    storm = skyLight(sky(35, { cloud: 1, precip: 5, storm: 1 }))
  assert.ok(
    overcast.key.intensity * overcast.direct < 0.2 * clear.key.intensity,
    "overcast hides the sun",
  )
  assert.ok(rain.irradiance < overcast.irradiance && storm.irradiance < rain.irradiance)
  const screen = (l: typeof clear) => l.irradiance * l.exposure
  assert.ok(screen(storm) < 0.6 * screen(clear), "a storm looks dark on screen")
  assert.ok(storm.exposure > clear.exposure, "but the eye opens a little")
  assert.equal(clear.lamps, 0)
  assert.ok(
    overcast.grey > 0.25 && rain.grey > overcast.grey && clear.grey === 0,
    "flat grey light under an overcast sky, greyer in the rain",
  )
  assert.ok(storm.lamps > 0.9 && skyLight(sky(35, { cloud: 0.9, fog: 0.9 })).lamps > 0.9)
  assert.ok(storm.night > 0 && storm.night < 0.5, "a storm's gloom is a little blue")
  const snowy = skyLight(sky(35, { snowCover: 1 }))
  assert.ok(luminance(snowy.ground) > 1.5 * luminance(clear.ground), "snow throws light back up")
})

test("the key light's aim moves in steps of under a degree, at once after a clock jump, and the shadows never come from under SHADOW_FLOOR", () => {
  let aim = aimToward(undefined, 245, 30)
  assert.deepEqual(aim, { azimuth: 245, elevation: 30 })
  aim = aimToward(aim, 245.2, 30.1)
  assert.deepEqual(aim, { azimuth: 245, elevation: 30 }, "a fifth of a degree: held")
  aim = aimToward(aim, 245.6, 30.7)
  assert.deepEqual(aim, { azimuth: 245.6, elevation: 30.7 }, "past the step: moved")
  assert.deepEqual(aimToward(aim, 100, 5), { azimuth: 100, elevation: 5 }, "a jump moves at once")
  // The fixed sun before the day cycle stood at azimuth 245°, elevation 50.4°, turned with the view.
  const out = new Vector3()
  for (const yaw of [0, Math.PI / 2, -Math.PI]) {
    keyDirection({ azimuth: HOME_AZIMUTH, elevation: HOME_ELEVATION }, yaw, out)
    const home = HOME_SUN.clone().applyAxisAngle(Object3D.DEFAULT_UP, yaw)
    near(out.distanceTo(home), 0, 1e-9, `home sun at yaw ${yaw}`)
  }
  keyDirection({ azimuth: 90, elevation: 2 }, 0, out)
  near(
    Math.asin(out.y),
    (SHADOW_FLOOR * Math.PI) / 180,
    1e-9,
    "a low sun lights from the floor elevation",
  )
  assert.ok(out.x > 0.9, "from the east")
})

test("exposure eases in log space and settles; colours are finite everywhere", () => {
  let e = 1
  for (let f = 0; f < 60; f++) e = easeLog(e, 4, 1 / 60, 1.5)
  assert.ok(e > 1.5 && e < 2, `after a second: ${e}`)
  for (let f = 0; f < 60 * 20; f++) e = easeLog(e, 4, 1 / 60, 1.5)
  near(e, 4, 1e-3, "settled")
  for (let el = -90; el <= 90; el += 0.5) {
    const l = skyLight(
      sky(el, {
        moon: { elevation: -el, azimuth: 10 },
        moonLit: 0.7,
        cloud: 0.5,
        precip: 1,
        storm: 0.2,
        fog: 0.3,
        snowCover: 0.4,
      }),
    )
    for (const v of [
      ...l.key.color,
      l.key.intensity,
      ...l.sky,
      ...l.ground,
      l.hemisphere,
      l.exposure,
      l.night,
      l.lamps,
      l.irradiance,
    ]) {
      assert.ok(Number.isFinite(v) && v >= 0, `${el}°: ${v}`)
    }
    assert.ok(new Color(...l.key.color).getHex() >= 0)
  }
})
