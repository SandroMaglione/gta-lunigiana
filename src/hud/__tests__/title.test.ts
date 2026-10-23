import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

import { titleReady } from "../title.ts"

const html = readFileSync(new URL("../../../index.html", import.meta.url), "utf8")
const readme = readFileSync(new URL("../../../README.md", import.meta.url), "utf8")
/** Whether index.html's markup hides the element with `id` before any script runs. */
const hiddenAtLoad = (id: string) => new RegExp(`id="${id}"[^>]*\\shidden[\\s>]`).test(html)

/** The title card's elements as plain event targets, as index.html starts them, in a window whose events tests dispatch. */
const page = () => {
  const nodes = new Map(["title", "title-load", "title-go"].map((id) => [id, Object.assign(new EventTarget(), { hidden: hiddenAtLoad(id) })]))
  const window = Object.assign(new EventTarget(), { document: { getElementById: (id: string) => nodes.get(id) ?? null } })
  return { window: window as unknown as Window, node: (id: string) => nodes.get(id)! }
}

// Regression: the card said "Press any key" while the game was still downloading, and keys did nothing.
test("the card shows the bar until the game is ready, then asks for a key and hides on the first one", () => {
  const { window, node } = page()
  assert.deepEqual([node("title").hidden, node("title-load").hidden, node("title-go").hidden], [false, false, true], "loading: the bar, no Press any key")
  titleReady(window)
  assert.deepEqual([node("title-load").hidden, node("title-go").hidden], [true, false], "ready: Press any key")
  window.dispatchEvent(new Event("keydown"))
  assert.equal(node("title").hidden, true)
})

// Regression: hidden on the press, the card let the tap's click land on the minimap under it, which opened the map.
test("a tap hides the card on its click, not its press, so the click lands on the card", () => {
  const { window, node } = page()
  titleReady(window)
  window.dispatchEvent(new Event("pointerdown"))
  assert.equal(node("title").hidden, false, "pressed: still showing")
  node("title").dispatchEvent(new Event("click"))
  assert.equal(node("title").hidden, true)
})

// The opening warning should only say the game is early, not that it crashes or is rough.
test("the opening warning only says the game is in early development", () => {
  const warning = readme.match(/> \[!WARNING\]\n(?:> .+\n)+/)?.[0] ?? ""
  assert.match(html, /Il gioco è in fase di sviluppo iniziale/)
  assert.match(html, /early development/)
  assert.match(warning, /is in early development/)
  for (const [name, text] of [["title card", html], ["README warning", warning]] as const) {
    assert.doesNotMatch(text, /\bbugs?\b|\bcrashes?\b|\brough edges\b|\bglitch/i, name)
  }
})
