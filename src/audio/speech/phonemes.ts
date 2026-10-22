/**
 * The Italian phoneme inventory the speech synth says: 7 vowels and 23 consonants of Standard
 * Italian, plus /h/ for laughter. Each carries what the formant synth needs: its manner, voicing,
 * inherent duration in connected speech, formant targets (a vowel's steady state, a consonant's
 * locus or murmur) for an adult male tract, and the noise band of its frication or release burst.
 *
 * A line spells a word as tokens: a symbol, `ˈ` before a stressed vowel, `ː` after a long
 * (geminate) consonant: "alːˈora" is ["a", "lː", "ˈo", "r", "a"].
 *
 * @module audio/speech/phonemes
 */

/** How a phoneme is made. */
export type Manner = "vowel" | "stop" | "fricative" | "affricate" | "nasal" | "lateral" | "trill" | "glide" | "breath"

/** A noise band: centre and bandwidth (Hz, adult male tract) and level (linear, relative between phonemes; `render.ts` sets the overall frication level). */
export interface Band {
  readonly hz: number
  readonly bw: number
  readonly gain: number
}

/** One phoneme: what the plan and the renderer need. */
export interface Phoneme {
  readonly manner: Manner
  readonly voiced: boolean
  /** Inherent duration of a short, unstressed realisation in connected speech, s (a stop's or affricate's closure). */
  readonly dur: number
  /** F1–F4 targets, Hz, adult male: a vowel's steady state, a consonant's locus or murmur. */
  readonly formants: readonly [number, number, number, number]
  /** Frication (fricatives, affricates) or release burst (stops). */
  readonly noise?: Band
  /** A nasal's antiformant (the zero of the side branch), Hz. */
  readonly zero?: number
  /** A stop's voice-onset time after the burst (aspiration), s. */
  readonly vot?: number
  /** Formants are the next vowel's (velars and /h/ take the vowel's shape: their locus moves with it). */
  readonly anticipates?: boolean
}

// Vowels: rounded from the adult-male means usually quoted from Ferrero (1972), "Caratteristiche
// acustiche dei fonemi vocalici italiani", Parole e metodi 3 (estimate: not checked against the
// original table); F4 ≈ 3.5 kHz for a 17 cm tract (Fant 1960). Unstressed vowels last ≈ 60–70 ms at
// Italian's ≈ 7 syllables/s (Pellegrino, Coupé & Marsico 2011, Language 87: Italian 6.99 syll/s).
const vowel = (f1: number, f2: number, f3: number): Phoneme => ({ manner: "vowel", voiced: true, dur: 0.068, formants: [f1, f2, f3, 3500] })

// Consonant loci: F2 ≈ 800 Hz labial, ≈ 1800 alveolar (Delattre, Liberman & Cooper 1955, JASA 27);
// velars take the next vowel's F2 (their locus moves with it). Release bursts: diffuse-falling for
// labials, diffuse-rising for alveolars (≈ 4 kHz), compact mid for velars (Stevens & Blumstein 1978,
// JASA 64). Italian voiceless stops are unaspirated, short-lag VOT ≈ 10–35 ms, longest for /k/
// (estimate after Esposito 2002, Phonetica 59). Stop closures ≈ 60–80 ms singleton; a geminate
// doubles it (Esposito & Di Benedetto 1999, JASA 106: closure ratio ≈ 2).
const LABIAL = [250, 800, 2200, 3500] as const, ALVEOLAR = [250, 1800, 2600, 3500] as const, POSTALVEOLAR = [250, 2000, 2700, 3500] as const

/** Every phoneme the synth says, by symbol. */
export const PHONEMES: Readonly<Record<string, Phoneme>> = {
  i: vowel(280, 2250, 2900),
  e: vowel(400, 2050, 2650),
  ɛ: vowel(550, 1900, 2550),
  a: vowel(750, 1300, 2500),
  ɔ: vowel(580, 950, 2500),
  o: vowel(430, 820, 2500),
  u: vowel(300, 700, 2400),

  p: { manner: "stop", voiced: false, dur: 0.075, formants: LABIAL, noise: { hz: 1200, bw: 2000, gain: 0.25 }, vot: 0.012 },
  b: { manner: "stop", voiced: true, dur: 0.062, formants: LABIAL, noise: { hz: 1200, bw: 2000, gain: 0.15 }, vot: 0 },
  t: { manner: "stop", voiced: false, dur: 0.07, formants: ALVEOLAR, noise: { hz: 4000, bw: 2500, gain: 0.45 }, vot: 0.018 },
  d: { manner: "stop", voiced: true, dur: 0.058, formants: ALVEOLAR, noise: { hz: 4000, bw: 2500, gain: 0.28 }, vot: 0 },
  k: { manner: "stop", voiced: false, dur: 0.075, formants: [250, 1800, 2500, 3500], noise: { hz: 2200, bw: 900, gain: 0.45 }, vot: 0.032, anticipates: true },
  g: { manner: "stop", voiced: true, dur: 0.062, formants: [250, 1800, 2500, 3500], noise: { hz: 2200, bw: 900, gain: 0.28 }, vot: 0, anticipates: true },

  // Fricative noise: /s/ peaks ≈ 4–7 kHz, /ʃ/ ≈ 2.5–3.5 kHz, /f v/ weak and flat (Jongman, Wayland &
  // Wong 2000, JASA 108); Italian fricatives last ≈ 80–110 ms singleton (estimate).
  f: { manner: "fricative", voiced: false, dur: 0.085, formants: LABIAL, noise: { hz: 6000, bw: 5000, gain: 0.12 } },
  v: { manner: "fricative", voiced: true, dur: 0.06, formants: LABIAL, noise: { hz: 6000, bw: 5000, gain: 0.06 } },
  s: { manner: "fricative", voiced: false, dur: 0.095, formants: ALVEOLAR, noise: { hz: 5500, bw: 2000, gain: 0.55 } },
  z: { manner: "fricative", voiced: true, dur: 0.07, formants: ALVEOLAR, noise: { hz: 5500, bw: 2000, gain: 0.3 } },
  ʃ: { manner: "fricative", voiced: false, dur: 0.1, formants: POSTALVEOLAR, noise: { hz: 2900, bw: 1400, gain: 0.55 } },
  // Affricates: a closure, then the fricative's noise (the half-and-half split is an estimate).
  tʃ: { manner: "affricate", voiced: false, dur: 0.095, formants: POSTALVEOLAR, noise: { hz: 2900, bw: 1400, gain: 0.5 } },
  dʒ: { manner: "affricate", voiced: true, dur: 0.08, formants: POSTALVEOLAR, noise: { hz: 2900, bw: 1400, gain: 0.3 } },
  ts: { manner: "affricate", voiced: false, dur: 0.095, formants: ALVEOLAR, noise: { hz: 5500, bw: 2000, gain: 0.5 } },
  dz: { manner: "affricate", voiced: true, dur: 0.08, formants: ALVEOLAR, noise: { hz: 5500, bw: 2000, gain: 0.3 } },

  // Nasal murmur: a low pole near 250 Hz and an antiformant at ≈ 0.75–1.25 kHz for /m/, ≈ 1.45–2.2 kHz
  // for /n/, higher for /ɲ/ (Fujimura 1962, JASA 34).
  m: { manner: "nasal", voiced: true, dur: 0.065, formants: [250, 1000, 2200, 3300], zero: 1000 },
  n: { manner: "nasal", voiced: true, dur: 0.055, formants: [250, 1500, 2500, 3300], zero: 1700 },
  ɲ: { manner: "nasal", voiced: true, dur: 0.07, formants: [250, 2000, 2700, 3300], zero: 2800 },
  // Laterals: Italian /l/ is clear (F2 ≈ 1.3–1.5 kHz); /ʎ/ palatal, F2 near /i/'s (estimate).
  l: { manner: "lateral", voiced: true, dur: 0.055, formants: [360, 1400, 2700, 3500] },
  ʎ: { manner: "lateral", voiced: true, dur: 0.07, formants: [300, 2100, 2800, 3500] },
  // The alveolar trill: one or two tongue contacts singleton (a tap), three or more geminate, at
  // 24–29 contacts/s (Ladefoged & Maddieson 1996, The Sounds of the World's Languages).
  r: { manner: "trill", voiced: true, dur: 0.035, formants: [450, 1400, 2400, 3400] },
  j: { manner: "glide", voiced: true, dur: 0.045, formants: [280, 2200, 2900, 3500] },
  w: { manner: "glide", voiced: true, dur: 0.045, formants: [320, 650, 2300, 3300] },
  // Not Italian: the breath of a laugh's "ha", shaped by the vowel after it.
  h: { manner: "breath", voiced: false, dur: 0.07, formants: [750, 1300, 2500, 3500], anticipates: true }
}

/** Consonants Italian always doubles between vowels, marked or not (Krämer 2009, The Phonology of Italian). */
export const INHERENTLY_LONG: ReadonlySet<string> = new Set(["ʃ", "ɲ", "ʎ", "ts", "dz"])

/** A phoneme as a line spells it: which one, stressed (a vowel), long (a geminate consonant). */
export interface Token {
  readonly symbol: string
  readonly phoneme: Phoneme
  readonly stressed: boolean
  readonly long: boolean
}

/** Reads a token ("ˈa", "tː", "dʒ"); undefined when its symbol is not in `PHONEMES` or the marks do not fit it. */
export const parseToken = (token: string): Token | undefined => {
  const stressed = token.startsWith("ˈ"), long = token.endsWith("ː")
  const symbol = token.slice(stressed ? 1 : 0, long ? -1 : undefined), phoneme = PHONEMES[symbol]
  if (phoneme === undefined || (stressed && phoneme.manner !== "vowel") || (long && phoneme.manner === "vowel")) return undefined
  return { symbol, phoneme, stressed, long }
}

/** The two-letter symbols, matched before single letters. */
const DIGRAPHS = ["tʃ", "dʒ", "ts", "dz"]

/** Splits one word's transcription ("alːˈora") into tokens; throws on a symbol not in `PHONEMES` (lexicon entries are checked by the tests). */
export const tokenize = (ipa: string): Array<string> => {
  const tokens: Array<string> = []
  for (let i = 0; i < ipa.length; ) {
    const stress = ipa[i] === "ˈ" ? "ˈ" : ""
    i += stress.length
    const symbol = DIGRAPHS.find((d) => ipa.startsWith(d, i)) ?? ipa[i]!
    if (PHONEMES[symbol] === undefined) throw new Error(`unknown phoneme "${symbol}" in "${ipa}"`)
    i += symbol.length
    const long = ipa[i] === "ː" ? "ː" : ""
    i += long.length
    tokens.push(stress + symbol + long)
  }
  return tokens
}
