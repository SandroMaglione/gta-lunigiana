import assert from "node:assert/strict"
import { test } from "node:test"

import { rmsDb, SILENCE_DB } from "../mixer.ts"

test("the level reads a full-scale sine at −3 dBFS and silence at the floor", () => {
  const sine = Float32Array.from({ length: 4800 }, (_, i) => Math.sin((2 * Math.PI * i) / 48))
  assert.ok(Math.abs(rmsDb(sine) + 3.0103) < 0.01)
  assert.equal(rmsDb(new Float32Array(2048)), SILENCE_DB)
})
