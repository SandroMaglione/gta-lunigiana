import assert from "node:assert/strict"
import { test } from "node:test"

import { DEFAULT_HANDLING, HANDLING, HANDLING_KEYS, type HandlingKey } from "../sim/handling.ts"
import { formatKnob, isDebugKey, knobModel, parseStored, sections } from "./debug.ts"

/** The first knob of `kind`, so the tests follow the table. */
const knobOf = (kind: "scale" | "share" | "switch"): HandlingKey => HANDLING_KEYS.find((key) => HANDLING[key].kind === kind)!

test("each kind of knob reads its own way: a scale as ×, a share as a plain number, a switch as On or Off", () => {
  assert.equal(formatKnob(knobOf("scale"), 1.25), "×1.25")
  assert.equal(formatKnob(knobOf("scale"), 1), "×1.00")
  assert.equal(formatKnob(knobOf("share"), 0.6), "0.60")
  assert.equal(formatKnob(knobOf("switch"), 1), "On")
  assert.equal(formatKnob(knobOf("switch"), 0), "Off")
})

test("the menu's sections follow the table: groups in the order their first knob comes, knobs in table order", () => {
  const all = sections()
  assert.deepEqual(all.flatMap(([, keys]) => keys), [...HANDLING_KEYS], "every knob once, in table order")
  assert.equal(new Set(all.map(([group]) => group)).size, all.length, "one section per group")
  for (const [group, keys] of all) for (const key of keys) assert.equal(HANDLING[key].group, group, key)
  // A group whose knobs are apart still makes one section, where its first knob comes.
  const [grip, power, looseGround] = ["grip", "power", "looseGround"] as const
  assert.deepEqual(sections([grip, power, looseGround]), [[HANDLING.grip.group, [grip, looseGround]], [HANDLING.power.group, [power]]])
})

test("stored knobs are untrusted: unknown keys, non-numbers and anything not a JSON object read as nothing; values come back in range", () => {
  const scale = knobOf("scale"), share = knobOf("share"), aid = knobOf("switch")
  for (const text of [null, "", "{", "null", "7", "\"grip\"", "[1.5]"]) assert.deepEqual(parseStored(text), {}, String(text))
  assert.deepEqual(parseStored(JSON.stringify({ [scale]: 1.5, [share]: 0.25 })), { [scale]: 1.5, [share]: 0.25 })
  assert.deepEqual(parseStored(JSON.stringify({ wings: 2, [scale]: "1.5", [share]: null, [aid]: true })), {}, "unknown key, string, null, boolean")
  assert.deepEqual(parseStored(JSON.stringify({ [scale]: 1e9, [share]: -4, [aid]: 0.7 })), { [scale]: HANDLING[scale].max, [share]: HANDLING[share].min, [aid]: 1 })
  assert.deepEqual(parseStored(`{"${scale}": 1e999}`), {}, "Infinity")
})

test("P opens the menu by the character it types, by its place where the layout types no ASCII there, never as a repeat or a chord", () => {
  const press = (patch: Partial<Pick<KeyboardEvent, "key" | "code" | "repeat" | "ctrlKey" | "metaKey" | "altKey">>) =>
    isDebugKey({ key: "p", code: "KeyP", repeat: false, ctrlKey: false, metaKey: false, altKey: false, ...patch })
  assert.equal(press({}), true)
  assert.equal(press({ key: "P" }), true, "with Shift (sprinting) held")
  assert.equal(press({ code: "KeyR" }), true, "Dvorak: P sits where QWERTY has R")
  assert.equal(press({ key: "l" }), false, "Dvorak: the key in QWERTY's P place types L")
  assert.equal(press({ key: "з" }), true, "Cyrillic: no ASCII character, so the key's place")
  assert.equal(press({ key: "m", code: "KeyM" }), false)
  for (const chord of ["ctrlKey", "metaKey", "altKey", "repeat"] as const) assert.equal(press({ [chord]: true }), false, chord)
})

// Regression: reopening the menu read the game's knobs again, but the game applies a change only on its next step (never while the map
// pauses it), so the menu showed the old value and the next change stored without the earlier one.
test("the menu keeps the knobs it set, not the game's copy that lags a step behind: each change stores every knob set so far", () => {
  const sent: Array<[HandlingKey, number]> = []
  const knobs = knobModel(() => DEFAULT_HANDLING, { drag: 0.5 }, (key, value) => sent.push([key, value]))
  assert.deepEqual(sent, [["drag", 0.5]], "the stored knobs are set at once")
  assert.equal(knobs.change("grip", 1.5), JSON.stringify({ grip: 1.5, drag: 0.5 }))
  assert.equal(knobs.change("brakes", 2), JSON.stringify({ grip: 1.5, brakes: 2, drag: 0.5 }))
  assert.equal(knobs.values().grip, 1.5)
  knobs.change("grip", 1)
  knobs.change("brakes", 1)
  assert.equal(knobs.change("drag", 1), undefined, "all at a new game's values: nothing to store")
})
