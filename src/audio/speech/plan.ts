/**
 * A line and a speaker to a timeline the formant synth follows: a run of targets (each phoneme, a
 * stop's burst and aspiration, the pauses) with their formants, source amplitudes and noise band,
 * a pitch contour for the tune, and the speaker's voice quality. Pure and deterministic: the same
 * line in the same voice always lasts the same, so `lineSeconds` is the rendered length.
 *
 * @module audio/speech/plan
 */
import { type Band, INHERENTLY_LONG, parseToken, type Phoneme, type Token } from "./phonemes.ts"
import type { Line, Speaker, Tune } from "./types.ts"

/** One stretch of the timeline: the synth holds these values in its middle and glides between neighbours. */
export interface Target {
  /** The phoneme's symbol, or "burst", "aspiration", "pause". */
  readonly label: string
  readonly start: number
  readonly end: number
  readonly vowel: boolean
  readonly stressed: boolean
  /** F1–F4, Hz, in this speaker's tract. */
  readonly formants: readonly [number, number, number, number]
  /** Voicing, aspiration (through the formants) and frication (through `noise`) amplitudes, 0…1. */
  readonly av: number
  readonly ah: number
  readonly af: number
  readonly noise: Band
  /** Nasal antiformant, Hz: `pole` (cancelling it) when oral. */
  readonly zero: number
  /** Trill contacts (amplitude dips) inside the stretch. */
  readonly contacts: number
}

/** How a speaker's voice sounds. */
export interface Quality {
  /** Formant scale re an adult male tract. */
  readonly tract: number
  /** Nasal pole (the murmur's low resonance), Hz, in this tract. */
  readonly pole: number
  /** Open quotient of the glottal pulse: higher is breathier and darker. */
  readonly oq: number
  /** Corner of the extra source tilt (one-pole low-pass), Hz: higher is brighter (more effort). */
  readonly tilt: number
  /** Aspiration noise riding on voicing, re the voicing. */
  readonly breath: number
  /** Cycle-to-cycle F0 (jitter) and amplitude (shimmer) perturbation, relative standard deviation. */
  readonly jitter: number
  readonly shimmer: number
  /** Slow F0 wander, relative (Klatt & Klatt 1990 "flutter"). */
  readonly flutter: number
}

/** What the synth renders. */
export interface Plan {
  readonly targets: ReadonlyArray<Target>
  /** F0 breakpoints (time s, Hz), linear between, held past the ends. */
  readonly pitch: ReadonlyArray<readonly [number, number]>
  readonly quality: Quality
  /** Length, s, silent pads included. */
  readonly seconds: number
}

/** The silent stretch (a `pause` target) before and after a line, s: the render starts at rest and rings out to rest. */
export const PAD = 0.03
/** A phrase break (an empty word), s (estimate: short intra-turn pauses run ≈ 150–250 ms). */
const PAUSE = 0.18
/** A laugh call's vowel and the gap after it, s (before the tempo): with the /h/, ≈ 4.5 calls/s (estimate after Bachorowski, Smoski & Owren 2001, JASA 110). */
const LAUGH_VOWEL = 0.13,
  LAUGH_GAP = 0.07
/** Mean F0 by age and sex, Hz (Titze 1994, Principles of Voice Production: men ≈ 115, women ≈ 210, children ≈ 270; elders converge: men rise, women fall). */
const F0 = { kid: [270, 270], adult: [115, 210], elder: [125, 190] } as const
/** Formant scale re an adult male tract (women ≈ 15 % shorter tract, children ≈ 30 %: Peterson & Barney 1952 means). */
const TRACT = { kid: [1.3, 1.3], adult: [1, 1.15], elder: [1, 1.15] } as const
/** The nasal murmur's low pole, Hz, adult male (Fujimura 1962: ≈ 250–300 Hz; Klatt 1980's FNP 250). */
const NASAL_POLE = 270
/** TUNED: scales every inherent duration so adult chat runs at Italian's ≈ 7 syllables/s (Pellegrino, Coupé & Marsico 2011: 6.99), pauses aside. */
const TEMPO = 0.8
/** Duration scale: children and elders speak more slowly (estimate: ≈ 10–15 % fewer syllables/s). */
const RATE = { kid: 1.15, adult: 1, elder: 1.12 } as const
/** A yell: F0 up ≈ 60 % and F1 up ≈ 10 % (jaw lower), vowels longer (Schulman 1989, JASA 85 "Articulatory dynamics of loud and normal speech"). */
const LOUD_F0 = 1.6,
  LOUD_F1 = 1.1,
  LOUD_VOWEL = 1.25
/** A stressed vowel's lengthening in an open and a closed syllable (Italian lengthens stressed open-syllable vowels ≈ 1.5–2×: Bertinetto 1981; D'Imperio & Rosenthall 1999, Phonology 16). */
const STRESS_OPEN = 1.7,
  STRESS_CLOSED = 1.25
/** Phrase-final lengthening of the last syllable's vowel (estimate, ≈ 30–50 % in Romance). */
const FINAL = 1.4
/** A geminate's closure re a singleton's (Esposito & Di Benedetto 1999, JASA 106: ≈ 2). */
const GEMINATE = 2
/** `call`: the final vowel held (estimate: a called name's last vowel lasts 2–3× its spoken length). */
const CALL_HOLD = 3
/** Trill contacts per second (Ladefoged & Maddieson 1996: 24–29 Hz). */
const TRILL_RATE = 25
/** TUNED: a release burst's level re its band's gain: a 6–12 ms transient must reach ≈ −20 dB re the vowel to be heard as one. */
const BURST = 2.5
/** No frication. */
const NO_NOISE: Band = { hz: 1000, bw: 1000, gain: 0 }

/** One tune's pitch shape: start and end of the declination line, a stressed vowel's accent, the final movement (× the speaker's F0). */
interface Shape {
  readonly from: number
  readonly to: number
  readonly accent: number
  readonly final: number
}
const SHAPES: Readonly<Record<Exclude<Tune, "laugh">, Shape>> = {
  // A statement: declining, an accent peak on stressed syllables, a fall to the speaker's floor.
  say: { from: 1.08, to: 0.9, accent: 0.15, final: 0.78 },
  // A yes/no question: flatter, a low nucleus, a terminal rise (≈ +45 %, estimate).
  ask: { from: 1.02, to: 0.95, accent: 0.12, final: 1.45 },
  // An exclamation: high and wide, ending in a fall.
  exclaim: { from: 1.25, to: 1.05, accent: 0.35, final: 0.9 },
  // A call: high, a long final vowel stepping down (the vocative chant).
  call: { from: 1.2, to: 1.1, accent: 0.25, final: 1.05 },
}

/** The speaker's own variation from `voice` (0…1): pitch ±10 %, and tract ±4 % on an unrelated draw, so pitch and timbre vary apart. */
const vary = (voice: number) => ({
  pitch: 1 + 0.2 * (voice - 0.5),
  tract: 1 + 0.08 * (((voice * 7.31) % 1) - 0.5),
  rate: 1 + 0.1 * (((voice * 3.17) % 1) - 0.5),
})

/** The voice quality of `speaker`: women and children breathier (Klatt & Klatt 1990, JASA 87), elders breathier with more jitter and shimmer (Xue & Deliyski 2001, Am. J. Speech-Lang. Path. 10); a yell pressed and bright. */
const qualityOf = (speaker: Speaker, loud: boolean, tune: Tune, tract: number): Quality => {
  const { age, female } = speaker,
    elder = age === "elder",
    male = !female && age !== "kid"
  let oq = male ? 0.6 : 0.68,
    tilt = male ? 2500 : 2100,
    breath = male ? 0.04 : 0.1
  if (elder) breath += 0.08
  if (loud) [oq, tilt, breath] = [oq - 0.15, tilt * 2.4, breath * 0.5]
  if (tune === "laugh") breath = Math.max(breath, 0.35)
  return {
    tract,
    pole: NASAL_POLE * tract,
    oq,
    tilt,
    breath,
    jitter: elder ? 0.015 : 0.005,
    shimmer: elder ? 0.06 : 0.03,
    flutter: elder ? 0.025 : 0.01,
  }
}

/** A token or a phrase break, in line order. */
type Item =
  | { readonly token: Token; readonly word: number }
  | { readonly pause: true; readonly word: number }

const isVowel = (item: Item | undefined): boolean =>
  item !== undefined && "token" in item && item.token.phoneme.manner === "vowel"
const isConsonant = (item: Item | undefined): boolean =>
  item !== undefined && "token" in item && item.token.phoneme.manner !== "vowel"
/** A consonant that may close an onset cluster (pr, bl, pj, kw): the syllable before it stays open. */
const ONSET_SECOND = new Set(["r", "l", "j", "w"])

/** The timeline of `line` in `speaker`'s voice, said or yelled (`loud`). */
export const planLine = (line: Line, speaker: Speaker, loud = false): Plan => {
  const own = vary(speaker.voice),
    sex = speaker.female ? 1 : 0
  const tract = TRACT[speaker.age][sex] * own.tract,
    f0 = F0[speaker.age][sex] * own.pitch * (loud ? LOUD_F0 : 1)
  const rate = TEMPO * RATE[speaker.age] * own.rate,
    quality = qualityOf(speaker, loud, line.tune, tract),
    laugh = line.tune === "laugh"
  const items: Array<Item> = []
  line.words.forEach((word, w) => {
    if (word.length === 0) items.push({ pause: true, word: w })
    for (const t of word) {
      const token = parseToken(t)
      if (token === undefined) throw new Error(`unknown token "${t}" in "${line.text}"`)
      items.push({ token, word: w })
    }
  })
  const lastVowel = items.findLastIndex(isVowel)

  const targets: Array<Target> = []
  let time = 0
  const push = (
    label: string,
    dur: number,
    fields: Partial<Omit<Target, "label" | "start" | "end">> & Pick<Target, "formants">,
  ) => {
    targets.push({
      label,
      start: time,
      end: time + dur,
      vowel: false,
      stressed: false,
      av: 0,
      ah: 0,
      af: 0,
      noise: NO_NOISE,
      zero: quality.pole,
      contacts: 0,
      ...fields,
    })
    time += dur
  }
  const scaled = (f: readonly number[]): [number, number, number, number] => [
    f[0]! * tract * (loud ? LOUD_F1 : 1),
    f[1]! * tract,
    f[2]! * tract,
    f[3]! * tract,
  ]
  const rest = scaled([500, 1500, 2500, 3500])
  /** The next vowel's phoneme after item `i`, within reach (for anticipating consonants). */
  const nextVowel = (i: number): Phoneme | undefined => {
    for (let j = i + 1; j < items.length; j++) {
      const it = items[j]!
      if (!("token" in it)) return undefined
      if (it.token.phoneme.manner === "vowel") return it.token.phoneme
    }
    return undefined
  }
  /** A pause holds the formants it follows (a neutral tract at the start), so nothing glides through silence. */
  const silent = () => targets.at(-1)?.formants ?? rest

  // The pads are silent stretches too, so the voice ramps in and out over the render's RAMP and the tract rings out into the
  // trailing one instead of stopping dead at full amplitude (a click). The leading one takes the first sound's formants below.
  push("pause", PAD, { formants: rest })
  items.forEach((item, i) => {
    if (!("token" in item)) {
      push("pause", PAUSE * rate, { formants: silent() })
      return
    }
    if (laugh && i > 0 && items[i - 1]!.word !== item.word)
      push("pause", LAUGH_GAP * rate, { formants: silent() })
    const { token } = item,
      ph = token.phoneme,
      ahead = nextVowel(i)
    const shape = scaled(
      ph.anticipates && ahead !== undefined
        ? ph.manner === "breath"
          ? ahead.formants
          : [ph.formants[0], ahead.formants[1], ahead.formants[2], ahead.formants[3]]
        : ph.formants,
    )
    const release = scaled(ahead?.formants ?? ph.formants)
    const band =
      ph.noise === undefined
        ? NO_NOISE
        : { hz: ph.noise.hz * tract, bw: ph.noise.bw * tract, gain: ph.noise.gain }
    const long =
      token.long ||
      (INHERENTLY_LONG.has(token.symbol) && isVowel(items[i - 1]) && isVowel(items[i + 1]))
    switch (ph.manner) {
      case "vowel": {
        // Closed: a geminate follows, or two consonants that are not an onset cluster (C + r l j w).
        const next = items[i + 1],
          after = items[i + 2]
        const closed =
          (next !== undefined && "token" in next && next.token.long) ||
          (isConsonant(next) &&
            after !== undefined &&
            "token" in after &&
            !isVowel(after) &&
            !ONSET_SECOND.has(after.token.symbol))
        // The last vowel before a phrase break or the end: the next non-consonant is none or a pause.
        const following = items.slice(i + 1).find((it) => !isConsonant(it)),
          phraseFinal = following === undefined || "pause" in following
        let dur =
          ph.dur *
          rate *
          (token.stressed ? (closed ? STRESS_CLOSED : STRESS_OPEN) : 1) *
          (phraseFinal ? FINAL : 1) *
          (loud ? LOUD_VOWEL : 1)
        if (line.tune === "call" && i === lastVowel) dur *= CALL_HOLD
        if (laugh) dur = LAUGH_VOWEL * rate
        push(token.symbol, dur, {
          vowel: true,
          stressed: token.stressed,
          formants: shape,
          av: token.stressed || loud ? 1 : phraseFinal ? 0.7 : 0.85,
        })
        return
      }
      case "stop": {
        push(token.symbol, ph.dur * rate * (long ? GEMINATE : 1), {
          formants: shape,
          av: ph.voiced ? 0.12 : 0,
        })
        push("burst", ph.anticipates ? 0.012 : 0.006, {
          formants: release,
          af: band.gain * BURST,
          noise: band,
          av: ph.voiced ? 0.3 : 0,
        })
        if (ph.vot! > 0) push("aspiration", ph.vot! * rate, { formants: release, ah: 0.35 })
        return
      }
      case "affricate": {
        const half = (ph.dur * rate) / 2
        push(token.symbol, half * (long ? 1 + GEMINATE : 1), {
          formants: shape,
          av: ph.voiced ? 0.12 : 0,
        })
        push(`${token.symbol}-noise`, half, {
          formants: shape,
          af: band.gain,
          noise: band,
          av: ph.voiced ? 0.25 : 0,
        })
        return
      }
      case "fricative":
        push(token.symbol, ph.dur * rate * (long ? 1.8 : 1), {
          formants: shape,
          af: band.gain,
          noise: band,
          av: ph.voiced ? 0.3 : 0,
        })
        return
      case "nasal":
        push(token.symbol, ph.dur * rate * (long ? 1.9 : 1), {
          formants: shape,
          av: 0.4,
          zero: ph.zero! * tract,
        })
        return
      case "trill": {
        const contacts = long ? 3 : 1
        push(token.symbol, long ? contacts / TRILL_RATE : ph.dur * rate, {
          formants: shape,
          av: 0.7,
          contacts,
        })
        return
      }
      case "lateral":
        push(token.symbol, ph.dur * rate * (long ? 1.9 : 1), { formants: shape, av: 0.55 })
        return
      case "glide":
        push(token.symbol, ph.dur * rate, { formants: shape, av: 0.75 })
        return
      case "breath":
        push(token.symbol, ph.dur * rate, { formants: shape, ah: 0.6, av: laugh ? 0.08 : 0 })
    }
  })
  targets[0] = { ...targets[0]!, formants: targets[1]?.formants ?? rest }
  push("pause", PAD, { formants: silent() })
  const seconds = time
  return { targets, pitch: contour(targets, line.tune, f0, seconds), quality, seconds }
}

/** The F0 breakpoints for `tune` over the vowels of `targets`, around the speaker's `f0`. */
const contour = (
  targets: ReadonlyArray<Target>,
  tune: Tune,
  f0: number,
  seconds: number,
): Array<readonly [number, number]> => {
  const vowels = targets.filter((t) => t.vowel),
    points: Array<readonly [number, number]> = []
  if (vowels.length === 0) return [[0, f0]]
  if (tune === "laugh") {
    // Laugh calls ≈ 2× speech F0, each falling, the run declining (Bachorowski, Smoski & Owren 2001: males ≈ 282 Hz, females ≈ 421 Hz).
    vowels.forEach((v, k) =>
      points.push([v.start, f0 * 1.8 * (1 - 0.06 * k)], [v.end, f0 * 1.45 * (1 - 0.06 * k)]),
    )
    return points
  }
  const shape = SHAPES[tune],
    last = vowels.at(-1)!,
    lastStressed = vowels.findLast((v) => v.stressed) ?? last
  const line = (t: number) => f0 * (shape.from + (shape.to - shape.from) * (t / seconds))
  for (const v of vowels) {
    const mid = (v.start + v.end) / 2
    if (v === last) break
    if (!v.stressed) points.push([mid, line(mid)])
    else if (tune === "ask" && v === lastStressed) points.push([mid, line(mid) * 0.92])
    else
      points.push(
        [v.start, line(v.start)],
        [mid, line(mid) * (1 + shape.accent)],
        [v.end, line(v.end) * (1 + shape.accent / 3)],
      )
  }
  const mid = (last.start + last.end) / 2
  switch (tune) {
    case "say":
    case "exclaim":
      if (last.stressed) points.push([last.start, line(last.start) * (1 + shape.accent)])
      points.push([last.end, f0 * shape.final])
      break
    case "ask":
      points.push(
        [last.start, line(last.start) * (last === lastStressed ? 0.92 : 1)],
        [last.end, f0 * shape.final],
      )
      break
    case "call":
      points.push(
        [last.start, line(last.start) * (1 + shape.accent)],
        [mid, line(mid) * (1 + shape.accent * 0.8)],
        [last.end, f0 * shape.final],
      )
      break
  }
  return points
}

/** How long `line` lasts said (or yelled, `loud`) by `speaker`, s: the rendered length. */
export const lineSeconds = (line: Line, speaker: Speaker, loud = false): number =>
  planLine(line, speaker, loud).seconds
