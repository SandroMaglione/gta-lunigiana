import assert from "node:assert/strict"
import { test } from "node:test"

import { waterNear } from "../water.ts"

test("from Monzone station the Torrente Lucido is heard 67 m away, a calm river under the village noise", () => {
  const heard = waterNear(-493.8, 436.9, 400)
  const lucido = heard.find((w) => w.key === "water:Torrente Lucido")
  assert.ok(lucido !== undefined)
  assert.equal(lucido.body, "river")
  const d = Math.hypot(lucido.x + 493.8, lucido.y - 436.9)
  assert.ok(d > 60 && d < 75, `${d} m`)
  assert.ok(lucido.level > 45 && lucido.level < 55, `${lucido.level} dB`)
  assert.ok(lucido.flow > 0 && lucido.flow <= 1 && lucido.z > 150 && lucido.z < 250)
  assert.deepEqual(
    heard.map((w) => w.level),
    heard.map((w) => w.level).sort((a, b) => b - a),
    "loudest first",
  )
})

test("the Fontana di Aiola is a point source: 65 dB(A) at 1 m, 6 dB less per doubling, gone past the radius", () => {
  const near = waterNear(775.1, 122.9, 100).find((w) => w.body === "fountain" && w.x === 765.1)
  assert.ok(near !== undefined && Math.abs(near.level - 45) < 1e-9 && near.flow > 0.2)
  assert.ok(!waterNear(775.1, 122.9, 5).some((w) => w.body === "fountain"))
})
