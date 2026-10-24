import assert from "node:assert/strict"
import { test } from "node:test"

import { CUT_UNIFORMS } from "../../see-through.ts"
import { glowMaterial, vehicleLampMaterials } from "../glow.ts"
import { Precipitation } from "../precipitation.ts"
import { NOON } from "../testing.ts"
import { applyFrame, phaseLocked, SKY_UNIFORMS, TIME_WRAP } from "../uniforms.ts"

test("the glow and lamp materials hold the shared uniform cells themselves, so one write per frame reaches every program", () => {
  for (const material of [glowMaterial, vehicleLampMaterials.on, vehicleLampMaterials.off]) {
    assert.equal(material.uniforms["uLamps"], SKY_UNIFORMS.uLamps)
    assert.equal(material.uniforms["uAmbient"], SKY_UNIFORMS.uAmbient)
    assert.equal(
      material.uniforms["uExposure"],
      SKY_UNIFORMS.uExposure,
      "lamps shine as bright on screen whatever the exposure",
    )
  }
  assert.match(
    glowMaterial.fragmentShader,
    /if \(uLamps < [0-9.]+ \|\| cutAway\(vAt, vY\)\) discard;/,
    "panes are not drawn by day (the settled daytime look keeps its shutters), nor where the see-through cut takes their wall",
  )
  assert.equal(glowMaterial.uniforms["uCutRadius"], CUT_UNIFORMS.uCutRadius, "the cut's very cell")
  assert.ok("CUT_ABOVE" in glowMaterial.defines, "cut with the walls they lie on")
  assert.notEqual(
    vehicleLampMaterials.on.uniforms["uOn"],
    vehicleLampMaterials.off.uniforms["uOn"],
    "on and off differ only in their own switch",
  )
  assert.equal(vehicleLampMaterials.on.vertexShader, vehicleLampMaterials.off.vertexShader)
  assert.equal(
    vehicleLampMaterials.on.fragmentShader,
    vehicleLampMaterials.off.fragmentShader,
    "one program for both",
  )
})

test("applyFrame copies the frame into the shared cells, sim time wrapped for float32 shaders", () => {
  const cells = { ...SKY_UNIFORMS }
  applyFrame({ ...NOON, now: 3 * TIME_WRAP + 12.5, night: 0.8, lamps: 0.6, ambient: 0.2 }, 3.5)
  assert.deepEqual(
    [
      SKY_UNIFORMS.uNight.value,
      SKY_UNIFORMS.uLamps.value,
      SKY_UNIFORMS.uAmbient.value,
      SKY_UNIFORMS.uTime.value,
      SKY_UNIFORMS.uExposure.value,
    ],
    [0.8, 0.6, 0.2, 12.5, 3.5],
  )
  for (const key of Object.keys(cells) as Array<keyof typeof cells>)
    assert.equal(SKY_UNIFORMS[key], cells[key], `${key}: the same cell`)
  applyFrame(NOON)
})

/** Every `uTime * k` in a shader: its angular frequency k, rad/s. */
const frequencies = (source: string): Array<number> =>
  [...source.matchAll(/uTime\s*\*\s*([0-9.]+)/g)].map((m) => Number(m[1]))

// Regression: the snowflakes' wobble ran at 1.3 rad/s, 124.1 turns in TIME_WRAP, so every flake jumped sideways when uTime wrapped.
test("every sine on uTime turns a whole number of times in TIME_WRAP, so nothing jumps when uTime wraps", () => {
  const turns = (omega: number) => (omega * TIME_WRAP) / (2 * Math.PI)
  for (const omega of [0.01, 1.3, 1.7, 3.1, 40]) {
    const locked = phaseLocked(omega)
    assert.ok(
      Math.abs(turns(locked) - Math.round(turns(locked))) < 1e-9 &&
        Math.abs(locked - omega) <= Math.PI / TIME_WRAP + 1e-12,
      `${omega} → ${locked}`,
    )
  }
  const drops = new Precipitation()
  const sources = [
    drops.rain.material,
    drops.snow.material,
    glowMaterial,
    vehicleLampMaterials.on,
  ].flatMap((m) => [m.vertexShader, m.fragmentShader])
  const found = sources.flatMap(frequencies)
  assert.ok(found.length > 0, "the snow's wobble reads uTime")
  for (const omega of found)
    assert.ok(
      Math.abs(turns(omega) - Math.round(turns(omega))) < 1e-5,
      `uTime × ${omega}: ${turns(omega)} turns`,
    )
})
