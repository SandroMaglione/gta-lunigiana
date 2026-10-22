import assert from "node:assert/strict"
import { test } from "node:test"

import { DEFAULT_HANDLING, HANDLING, HANDLING_KEYS, HANDLING_PRESETS, type HandlingKey, type HandlingValue } from "../sim/handling.ts"
import { makeHandlingStore } from "./handling.ts"

const STORED = "gta-lunigiana/handling"

/**
 * A store over a fake game and a fake localStorage holding `stored`. The game's knobs stay at `game`, as the real one's do until its
 * next step: what the store sends is collected in `sent`.
 */
const fakes = (stored: string | null = null, game: HandlingValue = DEFAULT_HANDLING) => {
  const sent: Array<[HandlingKey, number]> = [], items = new Map<string, string>()
  if (stored !== null) items.set(STORED, stored)
  const storage = { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value) }
  const store = makeHandlingStore({ read: () => game, set: (key, value) => void sent.push([key, value]), storage })
  return { store, sent, stored: () => items.get(STORED) }
}

/** The first knob of `kind`, so the tests follow the table. */
const knobOf = (kind: "scale" | "share" | "switch"): HandlingKey => HANDLING_KEYS.find((key) => HANDLING[key].kind === kind)!

test("a first load plays the game's knobs, a new game's balanced preset, and sends and stores nothing", () => {
  const { store, sent, stored } = fakes()
  assert.deepEqual(store.values(), DEFAULT_HANDLING)
  assert.equal(store.preset(), "balanced")
  assert.deepEqual([sent, stored()], [[], undefined])
})

test("choosing a preset sets every knob it changes, stores its name, and tells every listener", () => {
  const { store, sent, stored } = fakes()
  let told = 0
  store.subscribe(() => told++)
  store.choose("arcade")
  const arcade = HANDLING_PRESETS.arcade.values
  assert.deepEqual(sent, HANDLING_KEYS.filter((key) => arcade[key] !== DEFAULT_HANDLING[key]).map((key) => [key, arcade[key]]))
  assert.deepEqual([store.values(), store.preset(), stored(), told], [arcade, "arcade", JSON.stringify("arcade"), 1])
})

test("a stored preset name loads the preset's knobs of today, so a retuned preset reaches the player", () => {
  const { store, sent } = fakes(JSON.stringify("simulation"))
  assert.deepEqual([store.values(), store.preset()], [HANDLING_PRESETS.simulation.values, "simulation"])
  assert.equal(sent.length, HANDLING_KEYS.filter((key) => HANDLING_PRESETS.simulation.values[key] !== DEFAULT_HANDLING[key]).length, "sent at once")
})

test("a knob set by hand leaves every preset and stores the knobs off a new game's; set back, the preset's name is stored again", () => {
  const { store, stored } = fakes()
  store.change("grip", 1.5)
  assert.deepEqual([store.preset(), stored()], [undefined, JSON.stringify({ grip: 1.5 })])
  store.change("grip", DEFAULT_HANDLING.grip)
  assert.deepEqual([store.preset(), stored()], ["balanced", JSON.stringify("balanced")])
  store.change("grip", 1e9)
  assert.equal(store.values().grip, HANDLING.grip.max, "kept in range, as the game keeps it")
  store.change("grip", Number.NaN)
  assert.equal(store.values().grip, HANDLING.grip.max, "not a number: ignored")
  // Reloaded, the mix comes back over a new game's knobs.
  assert.deepEqual(fakes(stored()).store.values(), { ...DEFAULT_HANDLING, grip: HANDLING.grip.max })
})

// Regression: reopening the debug menu read the game's knobs again, but the game applies a change only on its next step (never while
// the map pauses it), so the menu showed the old value and the next change stored without the earlier one.
test("the store keeps the knobs it set, not the game's copy that lags a step behind: each change stores every knob set so far", () => {
  const { store, sent, stored } = fakes(JSON.stringify({ drag: 0.5 }))
  assert.deepEqual(sent, [["drag", 0.5]], "the stored knobs are set at once")
  store.change("grip", 1.5)
  store.change("brakes", 2)
  assert.deepEqual(JSON.parse(stored()!), { grip: 1.5, brakes: 2, drag: 0.5 })
  assert.equal(store.values().grip, 1.5)
})

test("stored data is untrusted: anything not a preset's name or a JSON object, unknown keys and non-numbers read as nothing; values come back in range", () => {
  const scale = knobOf("scale"), share = knobOf("share"), aid = knobOf("switch")
  const loaded = (text: string) => fakes(text).store.values()
  for (const text of ["", "{", "null", "7", "\"turbo\"", "\"toString\"", "\"grip\"", "[1.5]", "{}"]) assert.deepEqual(loaded(text), DEFAULT_HANDLING, text)
  assert.deepEqual(loaded(JSON.stringify({ wings: 2, [scale]: "1.5", [share]: null, [aid]: true })), DEFAULT_HANDLING, "unknown key, string, null, boolean")
  assert.deepEqual(loaded(JSON.stringify({ [scale]: 1e9, [share]: -4, [aid]: 0.7 })),
    { ...DEFAULT_HANDLING, [scale]: HANDLING[scale].max, [share]: HANDLING[share].min, [aid]: 1 })
  assert.deepEqual(loaded(`{"${scale}": 1e999}`), DEFAULT_HANDLING, "Infinity")
})

test("storage the browser blocks or that is full: the game plays the knobs the player sets, unstored", () => {
  const broken = () => {
    throw new Error("SecurityError")
  }
  const store = makeHandlingStore({ read: () => DEFAULT_HANDLING, set: () => {}, storage: { getItem: broken, setItem: broken } })
  store.choose("arcade")
  assert.equal(store.preset(), "arcade")
})
