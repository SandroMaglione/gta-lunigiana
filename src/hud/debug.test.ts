import assert from "node:assert/strict"
import { test } from "node:test"

import { HANDLING, HANDLING_KEYS, type HandlingKey } from "../sim/handling.ts"
import { isDebugKey } from "./debug.ts"
import { formatKnob, sections } from "./debug-handling.ts"

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
