import assert from "node:assert/strict"
import { test } from "node:test"

import { Triangles } from "../geometry.ts"
import { hasHipRoof, hipRoof, orientedBox } from "../roof.ts"

const rotated = (w: number, d: number, angle: number): Array<number> => {
  const c = Math.cos(angle),
    s = Math.sin(angle)
  return [
    [-w, -d],
    [w, -d],
    [w, d],
    [-w, d],
  ].flatMap(([x, y]) => [10 + x! * c - y! * s, 5 + x! * s + y! * c])
}

test("orientedBox recovers a rotated rectangle, long axis first", () => {
  const box = orientedBox(rotated(6, 2, 0.5))
  assert.ok(Math.abs(box.a - 6) < 1e-9 && Math.abs(box.b - 2) < 1e-9)
  assert.ok(Math.abs(box.cx - 10) < 1e-9 && Math.abs(box.cy - 5) < 1e-9)
  assert.ok(Math.abs(Math.abs(box.ux * Math.cos(0.5) + box.uy * Math.sin(0.5)) - 1) < 1e-9)
})

test("rectangles get hip roofs; L shapes and deep blocks stay flat", () => {
  assert.ok(hasHipRoof(rotated(6, 2, 1)))
  assert.ok(!hasHipRoof([0, 0, 10, 0, 10, 4, 4, 4, 4, 10, 0, 10]))
  assert.ok(!hasHipRoof(rotated(30, 14, 0)))
})

test("every hip roof face looks up and the ridge sits above the eaves", () => {
  const tris = new Triangles()
  hipRoof(tris, orientedBox(rotated(6, 3, 0.3)), 10, 0xb0664b)
  for (let i = 1; i < tris.normal.length; i += 3)
    assert.ok(tris.normal[i]! >= 0, "no face points down")
  assert.ok(Math.max(...tris.position.filter((_, i) => i % 3 === 1)) > 10)
})
