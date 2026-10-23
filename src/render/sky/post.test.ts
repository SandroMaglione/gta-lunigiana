import assert from "node:assert/strict"
import { test } from "node:test"

import { linear } from "../geometry.ts"
import { yOf } from "../ground.ts"
import { PALETTE } from "../palette.ts"
import { type Atmosphere, atmosphere, makePost, POST_GLSL, writePost } from "./post.ts"

/** A number the GLSL holds, by the pattern around it. */
const read = (pattern: RegExp, group = 1): number => {
  const found = pattern.exec(POST_GLSL)?.[group]
  assert.ok(found !== undefined, `${pattern} in POST_GLSL`)
  return Number(found)
}
/** The shader's `atmosphere` veil on the CPU, its constants read out of the GLSL: at render height `y`, `dist` m from the camera along the view, `fromFocus` m from the focus on the ground. */
const fogVeil = (() => {
  const path = { near: read(/clamp\(([\d.]+) \+ beyond/), least: read(/\+ beyond, ([\d.]+), ([\d.]+)\)/), most: read(/\+ beyond, ([\d.]+), ([\d.]+)\)/, 2) }
  const focusDepth = read(/beyond = dist - ([\d.]+);/)
  const far = read(/mix\(uFogMost, ([\d.]+), smoothstep\(0\.0, ([\d.]+), beyond\)\)/), over = read(/mix\(uFogMost, ([\d.]+), smoothstep\(0\.0, ([\d.]+), beyond\)\)/, 2)
  const bubble = /mix\(([\d.]+), 1\.0, smoothstep\(([\d.]+), ([\d.]+), length\(p\.xz - uFocus\.xz\)\)\)/
  const least = read(bubble), from = read(bubble, 2), to = read(bubble, 3)
  const post = makePost(), hv = post.uValley.value.z, hc = post.uCloud.value.z
  const smooth = (a: number, b: number, x: number) => {
    const s = Math.max(0, Math.min(1, (x - a) / (b - a)))
    return s * s * (3 - 2 * s)
  }
  return (a: Atmosphere, y: number, dist: number, fromFocus: number): number => {
    const beyond = dist - focusDepth, b = y + 0.5 * Math.max(path.least, Math.min(path.most, path.near + beyond))
    const { top } = a.valley, { base } = a.cloud
    const valley = Math.max(Math.min(b, top) - y, 0) + hv * (Math.exp(-Math.max(y - top, 0) / hv) - Math.exp(-Math.max(b - top, 0) / hv))
    const cloud = Math.max(b - Math.max(y, base), 0) + hc * (Math.exp(-(base - Math.min(b, base)) / hc) - Math.exp(-(base - Math.min(y, base)) / hc))
    const tau = 2 * (a.valley.density * valley + a.cloud.density * cloud) + a.haze.veil + a.haze.perMetre * Math.max(beyond, 0)
    const most = a.most + (far - a.most) * smooth(0, over, beyond)
    return Math.min(1 - Math.exp(-tau), most) * (least + (1 - least) * smooth(from, to, fromFocus))
  }
})()

/**
 * What reaches the canvas from texel colour `c` (linear, after the fog): the shader's exposure, grades and limit, their
 * constants read out of the GLSL, then the canvas's own clamp of each channel to 1.
 */
const onScreen = (() => {
  const smooth = (a: number, b: number, x: number) => {
    const s = Math.max(0, Math.min(1, (x - a) / (b - a)))
    return s * s * (3 - 2 * s)
  }
  const grey = /c = mix\(c, vec3\(l\), uGrey \* \(1\.0 - smoothstep\(([\d.]+), ([\d.]+), l\)\)\);/
  const night = /(?:c =|return) mix\(c, l \* vec3\(([\d.]+), ([\d.]+), ([\d.]+)\), ([\d.]+) \* uNight \* \(1\.0 - smoothstep\(([\d.]+), ([\d.]+), l\)\)\);/
  const g = [read(grey), read(grey, 2)], tint = [read(night), read(night, 2), read(night, 3)], n = [read(night, 4), read(night, 5), read(night, 6)]
  assert.ok(POST_GLSL.includes("c *= uExposure;"))
  const limited = POST_GLSL.includes("return c / max(1.0, max(c.r, max(c.g, c.b)));")
  return (c: readonly number[], view: { readonly exposure: number; readonly night: number; readonly grey: number }): Array<number> => {
    let out = c.map((v) => v * view.exposure)
    const l = 0.2126 * out[0]! + 0.7152 * out[1]! + 0.0722 * out[2]!
    const wg = view.grey * (1 - smooth(g[0]!, g[1]!, l)), wn = n[0]! * view.night * (1 - smooth(n[1]!, n[2]!, l))
    out = out.map((v) => v + (l - v) * wg).map((v, k) => v + (l * tint[k]! - v) * wn)
    const top = limited ? Math.max(1, ...out) : 1
    return out.map((v) => Math.min(1, v / top))
  }
})()

const lit = { key: [2, 1.74, 1.37] as const, sky: [1.27, 1.45, 1.64] as const, ground: [0.58, 0.45, 0.25] as const }
const none = { valleyTop: 250, valleyDensity: 0, cloudBase: 2600, cloudDensity: 0 }

test("a clear, dry sky leaves the picture alone: no fog, no haze", () => {
  const a = atmosphere(none, { rain: 0, snow: 0 }, lit)
  assert.equal(a.valley.density, 0)
  assert.equal(a.cloud.density, 0)
  assert.deepEqual([a.haze.veil, a.haze.perMetre], [0, 0])
  for (const y of [-50, 0, 300, 1500]) assert.equal(fogVeil(a, y, 500, 0), 0)
})

test("valley fog: a white sea in the valleys, thick under its top, thin a little above it, gone well over it; capped so the player stays visible", () => {
  const a = atmosphere({ valleyTop: 400, valleyDensity: 1, cloudBase: 2600, cloudDensity: 0 }, { rain: 0, snow: 0 }, lit)
  assert.equal(a.valley.top, yOf(400), "heights reach the GPU in render y")
  // Seen from a ridge: the valley floor 1 km deeper than the focus plane, the fog's top, 200 m over it.
  const deep = fogVeil(a, yOf(200), 1500, 1000), edge = fogVeil(a, yOf(400), 1500, 1000), over = fogVeil(a, yOf(600), 1500, 1000)
  assert.ok(deep > 0.85, `deep ${deep}`)
  assert.ok(edge > 0.1 && edge < deep, `at the top ${edge}`)
  assert.ok(over < 0.01, `200 m over it ${over}`)
  const thick = atmosphere({ valleyTop: 655, valleyDensity: 0.9, cloudBase: 2600, cloudDensity: 0 }, { rain: 0, snow: 0 }, lit)
  assert.ok(thick.most <= 0.75 && fogVeil(thick, yOf(200), 500, 200) === thick.most, "the veil is capped at the focus plane")
  assert.ok(fogVeil(thick, yOf(200), 500, 0) < 0.75 * thick.most, "thinner around the player")
  assert.ok(fogVeil(thick, yOf(200), 450, 200) < fogVeil(thick, yOf(200), 560, 200), "nearer the eye (down the screen) less, deeper more")
  const mist = atmosphere({ valleyTop: 385, valleyDensity: 0.3, cloudBase: 2600, cloudDensity: 0 }, { rain: 0, snow: 0 }, lit)
  assert.ok(fogVeil(mist, yOf(200), 500, 200) < 0.2, "a rain regime's mist is a light haze")
})

test("hill fog: ground in the cloud is veiled, ground under its base is clear", () => {
  const a = atmosphere({ valleyTop: 250, valleyDensity: 0, cloudBase: 900, cloudDensity: 1 }, { rain: 0, snow: 0 }, lit)
  assert.equal(a.cloud.base, yOf(900))
  assert.ok(fogVeil(a, yOf(1200), 500, 200) === a.most, "veiled to the cap")
  assert.ok(fogVeil(a, yOf(600), 500, 200) < 0.01)
})

test("rain hazes the far ground more than the near, heavier rain more, snow more than rain for the same water", () => {
  const rain = atmosphere(none, { rain: 3, snow: 0 }, lit), heavy = atmosphere(none, { rain: 10, snow: 0 }, lit), snow = atmosphere(none, { rain: 0, snow: 3 }, lit)
  const far = (a: typeof rain) => fogVeil(a, 0, 1500, 200), focus = (a: typeof rain) => fogVeil(a, 0, 500, 200)
  assert.ok(far(rain) > focus(rain) && focus(rain) > 0)
  assert.ok(far(heavy) > far(rain) && far(snow) > far(rain))
  assert.ok(far(heavy) < 0.93, "capped")
})

test("the fog is lit like the scene: darker at night, brighter in a flash", () => {
  const day = atmosphere(none, { rain: 0, snow: 0 }, lit).colour
  const night = atmosphere(none, { rain: 0, snow: 0 }, { key: [0, 0, 0], sky: [0.05, 0.07, 0.12], ground: [0.02, 0.02, 0.03] }).colour
  const flash = atmosphere(none, { rain: 0, snow: 0 }, { key: [0, 0, 0], sky: [0.65, 0.72, 0.9], ground: [0.32, 0.34, 0.45] }).colour
  assert.ok(night[1] < 0.1 * day[1] && flash[1] > 5 * night[1], `${day} ${night} ${flash}`)
})

test("the post uniforms: one set per view, written in place; the shader reads every one", () => {
  const post = makePost(), cells = { ...post }
  writePost(post, atmosphere({ valleyTop: 400, valleyDensity: 0.5, cloudBase: 900, cloudDensity: 0.3 }, { rain: 2, snow: 0 }, lit), { exposure: 2.5, night: 0.7, grey: 0.2, x: 1, y: 2, z: 3 })
  for (const key of Object.keys(cells) as Array<keyof typeof cells>) assert.equal(post[key], cells[key], `${key}: the same cell`)
  assert.equal(post.uExposure.value, 2.5)
  assert.equal(post.uNight.value, 0.7)
  assert.equal(post.uGrey.value, 0.2)
  assert.deepEqual(post.uFocus.value.toArray(), [1, 2, 3])
  assert.equal(post.uValley.value.x, yOf(400))
  for (const key of Object.keys(post)) assert.match(POST_GLSL, new RegExp(`uniform \\w+ ${key};`), `${key} declared`)
  writePost(post, atmosphere(none, { rain: 0, snow: 0 }, lit), { exposure: 1, night: 0, grey: 0, x: 0, y: 0, z: 0 })
  assert.deepEqual([post.uExposure.value, post.uNight.value, post.uGrey.value], [1, 0, 0])
})

// Regression: at the night exposure (4) a street lamp's pool clipped per channel, its amber turned pale lemon and the wall
// beside the lantern outshone it; a headlight's beam on the grass turned lemon green.
test("past full brightness a texel dims whole instead of clipping per channel: a lamp's pool keeps the lamp's colour", () => {
  const night = { exposure: 4, night: 1, grey: 0 }, lamp = linear(PALETTE.lampLight)
  // The pool's core on a pale wall: the lamp's own amber, 2.7 times past full brightness once exposed.
  assert.deepEqual(onScreen(lamp.map((v) => (2.7 * v) / 4), night).map((v) => v.toFixed(6)), lamp.map((v) => v.toFixed(6)), "the lamp's colour, not lemon")
  // A headlight's beam on the grass, 3 times past full brightness once exposed.
  const grass = [0.4, 0.75, 0.25], beam = onScreen(grass, night)
  assert.ok(Math.abs(beam[0]! / beam[1]! - 0.4 / 0.75) < 1e-9 && Math.abs(beam[2]! / beam[1]! - 0.25 / 0.75) < 1e-9, `grass green, not lemon: ${beam}`)
  // Within full brightness nothing changes: a clear dry day, and the pool's rim at night.
  assert.deepEqual(onScreen([0.8, 0.6, 0.3], { exposure: 1, night: 0, grey: 0 }), [0.8, 0.6, 0.3])
  const rim = lamp.map((v) => (0.8 * v) / 4)
  assert.deepEqual(onScreen(rim, night), rim.map((v) => v * 4))
})
