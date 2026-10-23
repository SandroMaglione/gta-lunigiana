import assert from "node:assert/strict"
import { test } from "node:test"

import { lineFor } from "../lines.ts"
import { lineSeconds, PAD, type Plan, planLine } from "../plan.ts"
import { seeded } from "../testing.ts"
import type { Line, Speaker, Tune } from "../types.ts"

const MAN: Speaker = { voice: 0.5, age: "adult", female: false }
const line = (ipa: string, tune: Tune = "say"): Line => ({
  text: ipa,
  words: ipa
    .split(" ")
    .map((w) => (w === "|" ? [] : [...w.matchAll(/ˈ?(tʃ|dʒ|ts|dz|.)ː?/gu)].map((m) => m[0]))),
  tune,
})
const length = (plan: Plan, label: string, nth = 0) => {
  const target = plan.targets.filter((t) => t.label === label)[nth]!
  return target.end - target.start
}

test("the timeline is contiguous, padded with silent pauses that hold the formants beside them, and lasts lineSeconds", () => {
  const random = seeded(1)
  for (const situation of ["chat", "greet", "laugh", "helpWoman", "thief"] as const) {
    const l = lineFor(situation, random),
      plan = planLine(l, MAN),
      [first, second] = plan.targets,
      [before, last] = plan.targets.slice(-2)
    assert.equal(first!.start, 0)
    for (const [pad, beside] of [
      [first!, second!],
      [last!, before!],
    ] as const) {
      assert.deepEqual(
        [pad.label, pad.av, pad.ah, pad.af, pad.formants],
        ["pause", 0, 0, 0, beside.formants],
      )
      assert.ok(Math.abs(pad.end - pad.start - PAD) < 1e-12)
    }
    plan.targets.forEach((t, i) => {
      assert.ok(t.end > t.start, `${t.label} in ${l.text}`)
      if (i > 0) assert.ok(Math.abs(t.start - plan.targets[i - 1]!.end) < 1e-12)
    })
    assert.ok(Math.abs(plan.seconds - last!.end) < 1e-12)
    assert.equal(lineSeconds(l, MAN), plan.seconds)
  }
})

test("durations follow Italian timing: geminates, stress, phrase-final lengthening", () => {
  // A geminate's closure doubles (Esposito & Di Benedetto 1999).
  assert.ok(
    Math.abs(
      length(planLine(line("ˈatːa"), MAN), "t") / length(planLine(line("ˈata"), MAN), "t") - 2,
    ) < 1e-9,
  )
  // A stressed open-syllable vowel outlasts an unstressed one, and outlasts itself in a closed syllable.
  const open = planLine(line("pˈapapa"), MAN),
    closed = planLine(line("pˈapːapa"), MAN)
  assert.ok(length(open, "a", 0) > 1.5 * length(open, "a", 1))
  assert.ok(length(closed, "a", 0) < length(open, "a", 0))
  // The last vowel of a phrase stretches.
  assert.ok(length(open, "a", 2) > length(open, "a", 1))
  // /ʃ ɲ ʎ ts dz/ are long between vowels without a mark.
  assert.ok(
    length(planLine(line("ˈaʃa"), MAN), "ʃ") > 1.7 * length(planLine(line("ʃˈa"), MAN), "ʃ"),
  )
  // A singleton r is one tap, a geminate a trill of three contacts.
  assert.equal(planLine(line("ˈara"), MAN).targets.find((t) => t.label === "r")!.contacts, 1)
  assert.equal(planLine(line("ˈarːa"), MAN).targets.find((t) => t.label === "r")!.contacts, 3)
})

test("chat runs near Italian's ≈ 7 syllables a second", () => {
  // Pellegrino, Coupé & Marsico 2011: Italian 6.99 syllables/s; pauses and pads excluded.
  const random = seeded(2)
  let syllables = 0,
    seconds = 0
  for (let k = 0; k < 100; k++) {
    const plan = planLine(lineFor("chat", random), MAN)
    syllables += plan.targets.filter((t) => t.vowel).length
    seconds += plan.targets
      .filter((t) => t.label !== "pause")
      .reduce((s, t) => s + t.end - t.start, 0)
  }
  const rate = syllables / seconds
  assert.ok(rate > 6.3 && rate < 7.7, `${rate.toFixed(2)} syllables/s`)
})

test("children and elders speak slower; a yell holds its vowels longer", () => {
  const l = line("bwondʒˈorno")
  assert.ok(lineSeconds(l, { voice: 0.5, age: "kid", female: false }) > lineSeconds(l, MAN))
  assert.ok(
    lineSeconds(l, { voice: 0.5, age: "elder", female: true }) >
      lineSeconds(l, { voice: 0.5, age: "adult", female: true }),
  )
  assert.ok(lineSeconds(l, MAN, true) > lineSeconds(l, MAN))
  // `call` holds its last vowel.
  assert.ok(
    lineSeconds(line("lˈadro", "call"), MAN) > lineSeconds(line("lˈadro", "exclaim"), MAN) + 0.1,
  )
})

test("each tune has its melody", () => {
  const ends = (tune: Tune, loud = false) => {
    const { pitch } = planLine(line("ma ke kˈɔza mi dˈitʃi", tune), MAN, loud)
    return {
      first: pitch[0]![1],
      last: pitch.at(-1)![1],
      mean: pitch.reduce((s, p) => s + p[1], 0) / pitch.length,
    }
  }
  const say = ends("say"),
    ask = ends("ask"),
    exclaim = ends("exclaim")
  assert.ok(say.last < say.first, "a statement falls")
  assert.ok(ask.last > ask.first * 1.2, "a question rises")
  assert.ok(exclaim.mean > say.mean * 1.1, "an exclamation is higher")
  assert.ok(Math.abs(ends("say", true).mean / say.mean - 1.6) < 0.01, "a yell is ≈ 60 % higher")
})

test("each speaker keeps one voice: pitch from sex and age, ±10 % by voice", () => {
  const f0 = (speaker: Speaker) => planLine(line("ˈa"), speaker).pitch[0]![1],
    man = f0(MAN)
  assert.ok(Math.abs(f0({ ...MAN, female: true }) / man - 210 / 115) < 0.01)
  assert.ok(Math.abs(f0({ voice: 0.5, age: "kid", female: true }) / man - 270 / 115) < 0.01)
  assert.ok(Math.abs(f0({ ...MAN, voice: 1 }) / man - 1.1) < 0.01)
  assert.deepEqual(
    planLine(line("tʃˈao"), { ...MAN, voice: 0.3 }),
    planLine(line("tʃˈao"), { ...MAN, voice: 0.3 }),
  )
  // The tract (formants) scales: women ≈ ×1.15, children ≈ ×1.3.
  const f1 = (speaker: Speaker) => planLine(line("ˈa"), speaker).targets[0]!.formants[0]
  assert.ok(
    f1({ voice: 0.5, age: "kid", female: false }) > f1({ voice: 0.5, age: "adult", female: true }),
  )
  assert.ok(f1({ voice: 0.5, age: "adult", female: true }) > f1(MAN))
})

test("a laugh's calls are high, breathy and spaced", () => {
  const plan = planLine(lineFor("laugh", seeded(3)), MAN)
  assert.ok(plan.quality.breath >= 0.35)
  assert.ok(plan.pitch[0]![1] > 1.7 * 115)
  assert.ok(plan.targets.slice(1, -1).some((t) => t.label === "pause"))
})
