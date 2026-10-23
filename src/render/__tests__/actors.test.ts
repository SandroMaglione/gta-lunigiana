import assert from "node:assert/strict"
import { test } from "node:test"

import { Color, GreaterDepth, Group, ShaderMaterial } from "three"

import { VEHICLE_MODELS, VEHICLES } from "../../sim/vehicles.ts"
import { PersonNode, vehicleNode } from "../actors.ts"
import { solidMaterial } from "../geometry.ts"
import { makeRegistries } from "../index.ts"
import { PALETTE } from "../palette.ts"
import { vehicleLampMaterials } from "../sky/glow.ts"
import { SKY_UNIFORMS } from "../sky/uniforms.ts"

test("every vehicle model has white head lamps on its front face and red tail lamps on its back, inside its x-ray box", () => {
  const white = new Color(PALETTE.marbleWhite),
    red = new Color(PALETTE.signalRed)
  for (const model of VEHICLE_MODELS) {
    const node = vehicleNode(model, 0x3d6155, solidMaterial),
      lamps = node.lamps.geometry,
      half = VEHICLES[model].length / 2
    const position = lamps.getAttribute("position"),
      color = lamps.getAttribute("color")
    let heads = 0,
      tails = 0
    for (let i = 0; i < position.count; i++) {
      const is = (c: Color) =>
        Math.abs(color.getX(i) - c.r) +
          Math.abs(color.getY(i) - c.g) +
          Math.abs(color.getZ(i) - c.b) <
        1e-6
      const isWhite = is(white),
        isRed = is(red)
      assert.ok(isWhite || isRed, `${model}: lamp colours only`)
      if (isWhite) {
        heads++
        assert.ok(position.getX(i) > half - 0.1, `${model}: a head lamp at the front`)
      } else {
        tails++
        assert.ok(position.getX(i) < -half + 0.1, `${model}: a tail lamp at the back`)
      }
    }
    assert.ok(heads > 0 && tails > 0, `${model}: ${heads / 36} head and ${tails / 36} tail lamps`)
    assert.equal(node.lamps.parent, node.body, "they ride on the body (its cg offset)")
    node.xray.geometry.computeBoundingBox()
    lamps.computeBoundingBox()
    assert.ok(
      node.xray.geometry.boundingBox!.containsBox(lamps.boundingBox!),
      `${model}: inside the x-ray box`,
    )
  }
})

test("vehicle lamps: one geometry per model, never freed with a node; off until switched on", () => {
  const { vehicles } = makeRegistries(new Group())
  const a = vehicles.ensure(1, () => vehicleNode("panda", 0xb8312b, solidMaterial)),
    b = vehicleNode("panda", 0xf2efe6, solidMaterial)
  assert.equal(a.lamps.geometry, b.lamps.geometry, "shared across paints")
  a.lamps.geometry.addEventListener("dispose", () => assert.fail("shared lamps disposed"))
  assert.equal(a.lamps.material, vehicleLampMaterials.off)
  a.setLamps(true)
  assert.equal(a.lamps.material, vehicleLampMaterials.on)
  assert.ok(vehicles.remove(1))
})

// Regression: the x-ray was an unlit MeshBasicMaterial, so the post pass's night exposure (× 4) clipped its yellow to lemon (255, 255, 118).
test("the x-ray silhouette keeps its yellow on screen at any exposure: it divides by the post pass's, and shows only where the world hides the actor", () => {
  const car = vehicleNode("panda", 0xb8312b, solidMaterial),
    walker = new PersonNode(
      { skin: 0xe7b896, hair: 0x2b1d14, shirt: 0xf0c93c, pants: 0x1d2b4f },
      solidMaterial,
    )
  for (const node of [car, walker]) {
    const material = node.xray.material
    assert.ok(material instanceof ShaderMaterial, "a shader that reads the exposure")
    assert.equal(
      material.uniforms["uExposure"],
      SKY_UNIFORMS.uExposure,
      "the post pass's exposure cell itself",
    )
    assert.match(material.fragmentShader, /gl_FragColor = vec4\(uColor \/ uExposure, 1\.0\);/)
    assert.deepEqual(
      (material.uniforms["uColor"]!.value as Color).toArray(),
      new Color(PALETTE.signYellow).toArray(),
    )
    assert.equal(material.depthFunc, GreaterDepth)
    assert.equal(material.depthWrite, false)
  }
})
