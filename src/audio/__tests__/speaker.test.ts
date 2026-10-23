import assert from "node:assert/strict"
import { test } from "node:test"

import { SILENCE_DB } from "../mixer.ts"
import { crowded, makeSpeaker } from "../speaker.ts"
import type { Shots, Voices } from "../types.ts"

test("one-shots past the cap replace the quietest, or are dropped if no louder", () => {
  const playing = [{ gain: 0.3 }, { gain: 0.1 }, { gain: 0.5 }]
  assert.equal(crowded(playing, 0.01, 4), undefined)
  assert.equal(crowded(playing, 0.1, 3), "drop")
  assert.equal(crowded(playing, 0.2, 3), playing[1])
})

test("the speaker stays silent and inert until a trusted gesture", (t) => {
  const errors = t.mock.method(console, "error", () => {})
  const host = Object.assign(new EventTarget(), {
    document: Object.assign(new EventTarget(), { hidden: false }),
    navigator: {},
  })
  const speaker = makeSpeaker(host as unknown as Window, {} as Voices, {} as Shots)
  // Scripted events are untrusted: they must not try to build an AudioContext (Node has none).
  host.dispatchEvent(new Event("keydown"))
  const at = { gain: 1, pan: 0, cutoff: 20000, cents: 0, wet: 0 }
  speaker.hold("car:1", { kind: "siren" }, at)
  speaker.play({ kind: "bark", big: true }, at, 0)
  speaker.flush()
  speaker.pause(true)
  assert.equal(speaker.context(), undefined)
  assert.equal(speaker.now(), 0)
  assert.equal(speaker.level(), SILENCE_DB)
  assert.equal(errors.mock.callCount(), 0)
})

// Regression: a browser without navigator.userActivation still starts the sound on a trusted gesture.
test("a trusted gesture starts the speaker unless the browser reports no user activation", (t) => {
  const errors = t.mock.method(console, "error", () => {})
  const attempts = (navigator: object): number => {
    const listeners: Array<(event: Event) => void> = []
    const host = Object.assign(new EventTarget(), {
      document: Object.assign(new EventTarget(), { hidden: false }),
      navigator,
      addEventListener: (_: string, listener: (event: Event) => void) => listeners.push(listener),
      removeEventListener: () => {},
    })
    makeSpeaker(host as unknown as Window, {} as Voices, {} as Shots)
    const before = errors.mock.callCount()
    // Node has no AudioContext: an attempt to start fails and logs "audio: cannot start".
    listeners[0]?.({ isTrusted: true } as Event)
    return errors.mock.callCount() - before
  }
  assert.equal(attempts({}), 1, "no userActivation flag: starts")
  assert.equal(attempts({ userActivation: { isActive: true } }), 1, "active: starts")
  assert.equal(attempts({ userActivation: { isActive: false } }), 0, "inactive: waits")
})
