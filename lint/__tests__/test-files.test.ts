import assert from "node:assert/strict"
import { test } from "node:test"

import { misplacedTest } from "../test-files.ts"

test("a test belongs directly in a __tests__ folder; other files are not checked", () => {
  assert.equal(misplacedTest("/repo/src/sim/__tests__/walls.test.ts"), false)
  assert.equal(misplacedTest("/repo/src/sim/walls.test.ts"), true)
  assert.equal(misplacedTest("/repo/src/sim/__tests__/deep/walls.test.ts"), true)
  assert.equal(misplacedTest("/repo/src/sim/__tests__/helpers.ts"), false)
  assert.equal(misplacedTest("/repo/src/sim/walls.ts"), false)
})
