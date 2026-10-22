/**
 * The speech contract between the director (who says what, when) and the speech synth (how it
 * sounds): a speaker, a line of Italian phonemes with its tune, and the situations lines are
 * picked for.
 *
 * @module audio/speech/types
 */
import type { Age } from "../../sim/schema.ts"

/** Who speaks: `voice` 0…1 keeps one person's pitch and timbre, `age` and `female` set the register. */
export interface Speaker {
  readonly voice: number
  readonly age: Age
  readonly female: boolean
}

/**
 * The melody of a line: `say` (a statement, falling), `ask` (a question, rising at the end), `exclaim` (high and emphatic),
 * `call` (shouted across a distance, long final vowel) or `laugh`.
 */
export type Tune = "say" | "ask" | "exclaim" | "call" | "laugh"

/** A line: what it reads as (for tests and the lab), its phonemes word by word, and its tune. */
export interface Line {
  readonly text: string
  /** Each word's tokens (`phonemes.ts`: "ˈa" a stressed vowel, "tː" a geminate); an empty word is a phrase break (a short pause). */
  readonly words: ReadonlyArray<ReadonlyArray<string>>
  readonly tune: Tune
}

/**
 * What a line is said for: chatting (greeting, talking, answering, laughing, leaving), crying out in a `Feeling` (`pity`: shock at
 * a killed animal), asking after a stranger struck down (a man, a woman, a child), grieving by one's own (`mum`, `dad`, `nonna`,
 * `nonno`: a child's call to a parent or grandparent), or a robbed driver.
 */
export type Situation =
  | "greet" | "chat" | "reply" | "laugh" | "farewell" | "fright" | "shock" | "pity" | "anger" | "surprise" | "helpMan" | "helpWoman" | "helpKid"
  | "grieve" | "mum" | "dad" | "nonna" | "nonno" | "thief"

/** A line in a speaker's voice: the params of the `talk` and `yell` one-shots. */
export interface Speech {
  readonly speaker: Speaker
  readonly line: Line
}
