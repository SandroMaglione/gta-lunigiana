import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import { test } from "node:test"

// What the schema and the sky's pure modules load, recorded before anything imports them: none may decode the map, so a page
// that never loads monzone.bin (the audio lab) and the HUD's tests can use them.
const loaded = new Array<string>()
registerHooks({
  resolve: (specifier, context, next) => {
    const resolved = next(specifier, context)
    loaded.push(resolved.url)
    return resolved
  }
})

test("map-free: the schema and the sky's calendar, astronomy, climate, regimes, clock, local weather and readout load no map", async () => {
  for (const module of ["../schema.ts", "./regimes.ts", "./clock.ts", "./calendar.ts", "./astro.ts", "./day.ts", "./climate.ts", "./local.ts", "./readout.ts"]) {
    await import(module)
  }
  assert.ok(loaded.some((url) => url.endsWith("/sky/local.ts")), "the hook saw the imports")
  assert.deepEqual(loaded.filter((url) => url.endsWith("/map/index.ts") || url.endsWith("/map/packed.ts")), [])
})

test("map-free: the sky's ORIGIN is the shipped map's origin", async () => {
  const { ORIGIN } = await import("../map/kinds.ts")
  const { MAP } = await import("../map/index.ts")
  assert.deepEqual({ ...MAP.origin }, { ...ORIGIN })
})
