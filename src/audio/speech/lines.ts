/**
 * What people say: a small Italian lexicon (greetings, fillers, cries) and a gibberish generator
 * that follows Italian phonotactics (open CV syllables, words ending in a vowel, geminates between
 * vowels, /ɛ ɔ/ only under stress, mostly penultimate stress), so chat sounds Italian without
 * being it, The Sims' way, with a real word now and then and never a profanity. `lineFor` picks
 * a line for a situation.
 *
 * @module audio/speech/lines
 */
import { lineSeconds } from "./plan.ts"
import { INHERENTLY_LONG, tokenize } from "./phonemes.ts"
import type { Line, Situation, Speaker, Tune } from "./types.ts"

/** A fixed phrase: its spelling, its transcription (words by spaces, a phrase break as "|"), its tune. */
interface Phrase {
  readonly text: string
  readonly ipa: string
  readonly tune: Tune
}
const phrase = (text: string, ipa: string, tune: Tune = "exclaim"): Phrase => ({ text, ipa, tune })

/** Real fillers dropped into chat (spelling without punctuation, transcription). */
export const FILLERS: ReadonlyArray<readonly [string, string]> = [
  ["allora", "alːˈora"], ["boh", "bˈɔ"], ["dai", "dˈai"], ["magari", "magˈari"], ["eh già", "ˈɛ dʒˈa"], ["sì sì", "sˈi sˈi"],
  ["no no", "nˈɔ nˈɔ"], ["va bene", "va bˈɛne"], ["certo", "tʃˈɛrto"], ["infatti", "infˈatːi"], ["comunque", "komˈunkwe"],
  ["insomma", "insˈomːa"], ["però", "perˈɔ"], ["beh", "bˈɛ"], ["mah", "mˈa"], ["senti", "sˈɛnti"], ["guarda", "gwˈarda"],
  ["figurati", "figˈurati"], ["davvero", "davːˈero"], ["ma dai", "ma dˈai"], ["che ne so", "ke ne sˈɔ"], ["pazienza", "patsjˈɛntsa"],
  ["appunto", "apːˈunto"], ["vabbè", "vabːˈɛ"], ["esatto", "ezˈatːo"], ["ecco", "ˈɛkːo"], ["niente", "njˈɛnte"], ["capito", "kapˈito"]
]
/** Fillers that open a reply. */
const ANSWERS: ReadonlyArray<readonly [string, string]> = [
  ["sì", "sˈi"], ["no", "nˈɔ"], ["eh", "ˈɛ"], ["beh", "bˈɛ"], ["mah", "mˈa"], ["certo", "tʃˈɛrto"], ["infatti", "infˈatːi"], ["boh", "bˈɔ"], ["eh già", "ˈɛ dʒˈa"]
]

const CHIAMATE = phrase("Chiamate un'ambulanza!", "kjamˈate unambulˈantsa", "call")
const MADONNA = phrase("Madonna!", "madˈɔnːa"), ODDIO = phrase("Oddio!", "odːˈio"), OH_NO = phrase("Oh no!", "ˈo nˈɔ")
/** What a stranger asks after someone struck down, before the address that fits them. */
const ASK = [phrase("Tutto bene?", "tˈutːo bˈɛne", "ask"), phrase("Respira?", "respˈira", "ask"), CHIAMATE]

/** The fixed lines of each situation that has them. */
export const PHRASES: Readonly<Record<Exclude<Situation, "chat" | "reply" | "laugh">, ReadonlyArray<Phrase>>> = {
  greet: [phrase("Ciao!", "tʃˈao"), phrase("Buongiorno!", "bwondʒˈorno"), phrase("Salve!", "sˈalve", "say"), phrase("Ehilà!", "eilˈa")],
  farewell: [phrase("Ciao ciao!", "tʃˈao tʃˈao"), phrase("A dopo!", "a dˈɔpo"), phrase("Arrivederci!", "arːivedˈertʃi"), phrase("Ci vediamo!", "tʃi vedjˈamo")],
  fright: [phrase("Aiuto!", "ajˈuto", "call"), phrase("Attento!", "atːˈɛnto"), phrase("No!", "nˈɔ")],
  shock: [ODDIO, MADONNA, OH_NO, CHIAMATE],
  pity: [phrase("Povera bestia!", "pˈɔvera bˈɛstja"), ODDIO, MADONNA, OH_NO],
  anger: [
    phrase("Vai piano!", "vˈai pjˈano"), phrase("Ma sei matto?", "ma sˈɛi mˈatːo", "ask"), phrase("Rallenta!", "ralːˈɛnta"), phrase("Ehi!", "ˈɛi", "call"),
    phrase("Guarda dove vai!", "gwˈarda dˈove vˈai")
  ],
  surprise: [phrase("Mamma mia!", "mˈamːa mˈia"), MADONNA, phrase("Ma che…", "ma kˈe", "ask")],
  helpMan: [...ASK, phrase("Signore, mi sente?", "siɲˈore | mi sˈɛnte", "ask")],
  helpWoman: [...ASK, phrase("Signora, mi sente?", "siɲˈora | mi sˈɛnte", "ask")],
  // A child is spoken to with "tu".
  helpKid: [...ASK, phrase("Mi senti?", "mi sˈɛnti", "ask")],
  grieve: [phrase("No, no, no!", "nˈɔ | nˈɔ | nˈɔ"), phrase("Ti prego!", "ti prˈɛgo", "say"), phrase("Svegliati!", "zvˈeʎati"), phrase("Amore!", "amˈore", "call")],
  mum: [phrase("Mamma!", "mˈamːa", "call")],
  dad: [phrase("Papà!", "papˈa", "call")],
  nonna: [phrase("Nonna!", "nˈɔnːa", "call")],
  nonno: [phrase("Nonno!", "nˈɔnːo", "call")],
  thief: [phrase("Ladro!", "lˈadro", "call"), phrase("Ehi! La mia macchina!", "ˈɛi | la mˈia mˈakːina"), phrase("Fermo!", "fˈermo", "call"), phrase("Al ladro!", "al lˈadro", "call")]
}

/** Draws from `weights` (value → weight). */
const pick = <T extends string>(random: () => number, weights: Readonly<Record<T, number>>): T => {
  const entries = Object.entries(weights) as Array<[T, number]>
  let x = random() * entries.reduce((sum, [, w]) => sum + w, 0)
  for (const [value, w] of entries) if ((x -= w) < 0) return value
  return entries[entries.length - 1]![0]
}
const one = <T>(random: () => number, list: ReadonlyArray<T>): T => list[Math.floor(random() * list.length)]!

// Gibberish weights: estimates after Italian letter frequencies (e, a, i, o ≈ 10–12 % each, u ≈ 3 %;
// n, l, r, t, s, c, d ≈ 4–7 %, then p, m, v, g, f, b, z: the Wikipedia "Letter frequency" table).
/** Stressed vowels: /ɛ ɔ/ occur only under stress in Standard Italian (Krämer 2009). */
const STRESSED = { a: 25, e: 14, ɛ: 10, i: 17, o: 12, ɔ: 10, u: 7 }
/** Unstressed vowels inside a word. */
const UNSTRESSED = { a: 27, e: 27, i: 20, o: 20, u: 6 }
/** A word's last (unstressed) vowel: Italian words end in /a e i o/, rarely /u/. */
const FINAL = { a: 30, e: 30, i: 20, o: 20 }
/** Single onsets. The always-long /ʃ ɲ ʎ ts dz/ (and /z/, intervocalic in the north) only between vowels. */
const ONSETS = { t: 10, r: 8, n: 8, l: 7, s: 6, k: 7, d: 6, m: 5, p: 5, v: 4, tʃ: 3, dʒ: 2, g: 2, f: 2, b: 2 }
const MEDIAL = { ...ONSETS, ts: 1.5, ʎ: 0.8, ɲ: 0.8, ʃ: 1, dz: 0.7, z: 1 }
/** Onset clusters: obstruent + liquid, /s/ + stop, consonant + glide (pr, st, pj, kw…). */
export const CLUSTERS = ["pr", "tr", "kr", "br", "dr", "gr", "fr", "pl", "kl", "bl", "fl", "sp", "st", "sk", "pj", "kj", "bj", "nj", "kw", "gw"]
/** Consonants that may close a syllable (Italian codas: sonorants and /s/ before a consonant). */
const CODAS = { n: 4, r: 3, l: 2, s: 2 }
/** Onsets after a coda: stops and affricates (the commonest heterosyllabic clusters: nt, rt, lp, sk, ntʃ). */
const AFTER_CODA = { t: 5, k: 4, p: 3, d: 3, tʃ: 2, dʒ: 1, g: 1, b: 1 }
/** After /s/: only voiceless stops (/s/ voices before a voiced one, and a /z/ coda is not in the inventory's spelling). */
const VOICELESS = { t: 5, k: 4, p: 3 }
/** Consonants that double (a geminate between vowels: ≈ 1 intervocalic consonant in 5, estimate). */
const GEMINABLE = new Set(["p", "b", "t", "d", "k", "g", "f", "v", "s", "tʃ", "dʒ", "m", "n", "l", "r"])
/** Syllables per gibberish word (estimate: short function words are frequent; content words 2–4). */
const SYLLABLES = { 1: 22, 2: 36, 3: 28, 4: 14 }
/** Stress position (≈ 80 % of Italian words stress the penultimate, ≈ 15 % the antepenultimate, few the last: Krämer 2009). */
const PENULT = 0.8, ANTEPENULT = 0.15
/** Share of chat words that are real fillers (the brief: ≈ 15 %). */
const FILLER_SHARE = 0.15

/** Stems of Italian profanities and slurs, a `^` one only at a word's start. */
const PROFANE = [
  "cazz", "froc", "merd", "^cul", "fica", "figa", "troi", "putt", "stronz", "porc", "dio", "mona", "negr", "minchi", "cogli", "zoccol", "bastard", "terron",
  "checc", "mignott", "cagn", "fott", "vaff", "ncul", "suca", "tett", "^sega"
]
const PROFANITY = new RegExp(PROFANE.join("|"))

/** A gibberish word: its tokens, Italian phonotactics, redrawn while its spelling (accents aside) holds a profanity or a slur. */
export const gibberish = (random: () => number): Array<string> => {
  let tokens = draw(random)
  while (PROFANITY.test(spell(tokens).normalize("NFD").replace(/\p{M}/gu, ""))) tokens = draw(random)
  return tokens
}

/** A word drawn by Italian phonotactics, real or not. */
const draw = (random: () => number): Array<string> => {
  const count = Number(pick(random, SYLLABLES))
  const roll = random(), stress = count === 1 ? (random() < 0.3 ? 0 : -1) : roll < PENULT ? count - 2 : roll < PENULT + ANTEPENULT && count >= 3 ? count - 3 : count - 1
  const tokens: Array<string> = []
  let coda: string | undefined
  for (let s = 0; s < count; s++) {
    const stressed = s === stress, last = s === count - 1
    if (s === 0) {
      const r = random()
      if (r < 0.15 && count > 1) {
        /* a vowel-initial word */
      } else if (r < 0.27) tokens.push(...tokenize(one(random, CLUSTERS)))
      else tokens.push(pick(random, ONSETS))
    } else if (coda !== undefined) {
      const c: string = coda === "s" ? pick(random, VOICELESS) : pick(random, AFTER_CODA)
      // A nasal takes the place of the stop after it: /n/ before /p b/ is [m] (Krämer 2009).
      if (coda === "n" && (c === "p" || c === "b")) tokens[tokens.length - 1] = "m"
      tokens.push(c)
    } else {
      const c = pick(random, MEDIAL)
      tokens.push(INHERENTLY_LONG.has(c) || (GEMINABLE.has(c) && random() < 0.2) ? `${c}ː` : c)
    }
    const draw = () => (stressed ? pick(random, STRESSED) : last ? pick(random, FINAL) : pick(random, UNSTRESSED))
    let v: string = draw()
    // No glide into its own vowel ("wu", "ji").
    while ((tokens.at(-1) === "w" && v === "u") || (tokens.at(-1) === "j" && v === "i")) v = draw()
    tokens.push(stressed ? `ˈ${v}` : v)
    coda = !last && random() < 0.15 ? pick(random, CODAS) : undefined
    if (coda !== undefined) tokens.push(coda)
  }
  return tokens
}

/** The vowels' spelling, and their accented form when a word ends stressed. */
const VOWEL_LETTERS: Readonly<Record<string, readonly [string, string]>> = { a: ["a", "à"], e: ["e", "é"], ɛ: ["e", "è"], i: ["i", "ì"], o: ["o", "ó"], ɔ: ["o", "ò"], u: ["u", "ù"] }
const FRONT = new Set(["e", "ɛ", "i", "j"])

/** Italian spelling of a gibberish word (for the lab and the tests): "ch" before front vowels, "gn", "gli", "sc", "z", doubled geminates, an accent on a final stress. */
export const spell = (tokens: ReadonlyArray<string>): string => {
  let text = ""
  tokens.forEach((token, i) => {
    const symbol = token.replace("ˈ", "").replace("ː", ""), long = token.endsWith("ː"), next = tokens[i + 1]?.replace("ˈ", "") ?? ""
    const front = FRONT.has(next.replace("ː", "")), vowelNext = next !== "" && VOWEL_LETTERS[next] !== undefined
    const vowel = VOWEL_LETTERS[symbol]
    if (vowel !== undefined) text += token.startsWith("ˈ") && i === tokens.length - 1 && tokens.length > 1 ? vowel[1] : vowel[0]
    else if (symbol === "k") text += (long ? "c" : "") + (next === "w" ? "q" : front ? "ch" : "c")
    else if (symbol === "g") text += (long ? "g" : "") + (front ? "gh" : "g")
    else if (symbol === "tʃ") text += (long ? "c" : "") + (front || !vowelNext ? "c" : "ci")
    else if (symbol === "dʒ") text += (long ? "g" : "") + (front || !vowelNext ? "g" : "gi")
    else if (symbol === "ʃ") text += front ? "sc" : "sci"
    else if (symbol === "ɲ") text += "gn"
    else if (symbol === "ʎ") text += next === "i" ? "gl" : "gli"
    else if (symbol === "ts" || symbol === "dz") text += "zz"
    else if (symbol === "z") text += "s"
    else if (symbol === "j") text += "i"
    else if (symbol === "w") text += "u"
    else text += long ? symbol + symbol : symbol
  })
  return text
}

/** A reference voice for sizing chat lines (they are 1–3 s in an adult's mouth). */
const REFERENCE: Speaker = { voice: 0.5, age: "adult", female: false }

/** A chatty line: gibberish with ≈ 15 % real fillers, phrase breaks after fillers and now and then, `min`–`max` s long. */
const babble = (random: () => number, min: number, max: number, opener?: ReadonlyArray<readonly [string, string]>): Line => {
  const goal = min + (max - min) * random(), tune = pick(random, { say: 65, ask: 20, exclaim: 15 }) as Tune
  /** Each drawn piece: its spelling and words, a trailing phrase break when it ends on a comma. */
  const pieces: Array<{ readonly text: string; readonly words: Array<Array<string>> }> = []
  const add = (text: string, words: Array<Array<string>>, pause: boolean) => pieces.push(pause ? { text: `${text},`, words: [...words, []] } : { text, words })
  const line = (): Line => {
    const words = pieces.flatMap((p) => p.words)
    return { text: finish(pieces.map((p) => p.text).join(" "), tune), words: words.at(-1)?.length === 0 ? words.slice(0, -1) : words, tune }
  }
  if (opener !== undefined) {
    const [text, ipa] = one(random, opener)
    add(text, ipa.split(" ").map(tokenize), true)
  }
  while (lineSeconds(line(), REFERENCE) < goal) {
    if (random() < FILLER_SHARE) {
      const [text, ipa] = one(random, FILLERS)
      add(text, ipa.split(" ").map(tokenize), random() < 0.5)
    } else {
      const tokens = gibberish(random)
      add(spell(tokens), [tokens], random() < 0.12)
    }
  }
  // The piece that crossed the goal may overshoot the longest line: drop it (what is left is under the goal but over `min`).
  if (pieces.length > 1 && lineSeconds(line(), REFERENCE) > max) pieces.pop()
  return line()
}

/** Capitalised, ending in the tune's punctuation (and no comma). */
const finish = (text: string, tune: Tune): string => {
  const bare = text.replace(/,$/, "")
  return bare.charAt(0).toUpperCase() + bare.slice(1) + (tune === "ask" ? "?" : tune === "say" ? "." : "!")
}

/** A laugh: 3–6 breathy calls on one vowel, "ah ah ah" or "eh eh eh" (Bachorowski et al. 2001: bouts of ≈ 3–5 calls). */
const laughLine = (random: () => number): Line => {
  const vowel = one(random, ["a", "ɛ", "a", "i", "ɔ"]), calls = 3 + Math.floor(random() * 4), letter = VOWEL_LETTERS[vowel]![0]
  return { text: Array.from({ length: calls }, () => `${letter}h`).join(" ").replace(/^./, (c) => c.toUpperCase()) + "!", words: Array.from({ length: calls }, () => ["h", `ˈ${vowel}`]), tune: "laugh" }
}

/** A line of `phrase`. */
const fixed = ({ text, ipa, tune }: Phrase): Line => ({ text, words: ipa.split(" ").map((w) => (w === "|" ? [] : tokenize(w))), tune })

/** A line to say in `situation`: chat ≈ 85 % gibberish words, ≈ 15 % real fillers, 1–3 s; replies shorter, often opening on a filler; everything else real Italian. */
export const lineFor = (situation: Situation, random: () => number): Line => {
  switch (situation) {
    case "chat":
      return babble(random, 1, 3)
    case "reply":
      return babble(random, 0.6, 1.8, random() < 0.5 ? ANSWERS : undefined)
    case "laugh":
      return laughLine(random)
    default:
      return fixed(one(random, PHRASES[situation]))
  }
}
