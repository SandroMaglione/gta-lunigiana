import assert from "node:assert/strict"
import { test } from "node:test"

import { PRESET_IDS } from "../../sim/handling.ts"
import { markPreset, settingsKey } from "../settings.ts"

test("a key in the settings: Esc cancels the browser's own close and goes on to the router; every other key stops there", () => {
  assert.equal(settingsKey({ key: "Escape" }), "cancel")
  for (const key of ["w", "ArrowDown", " ", "Enter", "p", "m"]) assert.equal(settingsKey({ key }), "stop", key)
})

test("the vehicle physics setting checks the current preset, or none with the Custom note for a hand-set mix of knobs", () => {
  const radios = PRESET_IDS.map((value) => ({ value, checked: false })), custom = { hidden: false }
  markPreset(radios, custom, "arcade")
  assert.deepEqual(radios.filter((radio) => radio.checked).map((radio) => radio.value), ["arcade"])
  assert.equal(custom.hidden, true)
  markPreset(radios, custom, undefined)
  assert.equal(radios.some((radio) => radio.checked), false)
  assert.equal(custom.hidden, false)
})
