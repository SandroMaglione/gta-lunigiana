/**
 * Non-verbal human cues by formant synthesis, kept short and tasteful (words are speech's, in
 * `src/audio/speech`): a sawtooth glottis following an F0
 * contour, plus breath noise, through three vowel formants, roughened by fast amplitude
 * modulation (30–150 Hz is what makes a scream a scream; speech moves at 4–5 Hz, Arnal et al.
 * 2015). Live graphs, since every person keeps their own pitch. Dogs bark through the same tract.
 *
 * @module audio/synth/voices
 */
import type { OneShot, Shot, ShotIo } from "../types.ts"
import { jitter, unit } from "./graph.ts"

type Formants = readonly [number, number, number]

/** Vowel formants F1–F3, Hz (Peterson & Barney 1952 averages). */
const VOWELS = {
  aMale: [730, 1090, 2440], aFemale: [850, 1220, 2810],
  oMale: [570, 840, 2410], oFemale: [590, 920, 2710]
} as const satisfies Record<string, Formants>

/** Formant bandwidths (Hz) and levels, F1–F3. */
const BANDWIDTHS = [90, 120, 170] as const
const LEVELS = [1, 0.5, 0.3] as const

/** One vocalisation. */
export interface Vocal {
  /** F0 contour, Hz: at the start, at 30 % of the way, at the end. */
  readonly f0: readonly [number, number, number]
  readonly vowel: Formants
  readonly seconds: number
  /** Roughness 0…1: depth of the amplitude modulation at `roughHz`. */
  readonly rough: number
  readonly roughHz: number
  /** Breath noise through the same formants, relative to the glottis. */
  readonly breath: number
  /** Envelope peak: calibrated so the cue peaks near 0.5 (−6 dBFS). */
  readonly peak: number
}

/** Schedules `vocal` into `io.out` at `t`; returns the time it ends. */
export const vocalise = (io: ShotIo, vocal: Vocal, t: number): number => {
  const { ctx, kit } = io, { f0, seconds, rough } = vocal, end = t + seconds
  const glottis = new OscillatorNode(ctx, { type: "sawtooth", frequency: f0[0] })
  glottis.frequency.setValueAtTime(f0[0], t)
  glottis.frequency.linearRampToValueAtTime(f0[1], t + seconds * 0.3)
  glottis.frequency.linearRampToValueAtTime(f0[2], end)
  const breath = new AudioBufferSourceNode(ctx, { buffer: kit.pink }), source = new GainNode(ctx)
  glottis.connect(source)
  breath.connect(new GainNode(ctx, { gain: vocal.breath })).connect(source)
  // Gain swings over [1 − rough, 1] at roughHz.
  const rasp = new GainNode(ctx, { gain: 1 - rough / 2 }), wobble = new OscillatorNode(ctx, { frequency: vocal.roughHz })
  wobble.connect(new GainNode(ctx, { gain: rough / 2 })).connect(rasp.gain)
  vocal.vowel.forEach((hz, i) => {
    source.connect(new BiquadFilterNode(ctx, { type: "bandpass", frequency: hz, Q: hz / BANDWIDTHS[i]! })).connect(new GainNode(ctx, { gain: LEVELS[i] })).connect(rasp)
  })
  const envelope = new GainNode(ctx, { gain: 0 }), attack = Math.min(0.04, seconds * 0.25), release = Math.min(0.12, seconds * 0.4)
  rasp.connect(envelope).connect(io.out)
  envelope.gain.setValueAtTime(0, t)
  envelope.gain.linearRampToValueAtTime(vocal.peak, t + attack)
  envelope.gain.setValueAtTime(vocal.peak, end - release)
  envelope.gain.linearRampToValueAtTime(0, end)
  glottis.onended = () => envelope.disconnect()
  for (const node of [glottis, wobble]) {
    node.start(t)
    node.stop(end + 0.02)
  }
  breath.start(t, Math.random() * (kit.pink.duration - seconds - 0.1))
  breath.stop(end + 0.02)
  return end + 0.02
}

type Cue = "scream" | "groan"
type Sex = "male" | "female"

/** Each cue per sex (synthesis.md §8; male screams and female groans TUNED from the others; `peak` TUNED by rendering). */
const CUES = {
  scream: {
    male: { f0: [420, 560, 360], vowel: VOWELS.aMale, seconds: 0.8, rough: 0.7, roughHz: 70, breath: 1.2, peak: 1.5 },
    female: { f0: [700, 950, 600], vowel: VOWELS.aFemale, seconds: 0.9, rough: 0.7, roughHz: 80, breath: 1.2, peak: 0.8 }
  },
  groan: {
    male: { f0: [130, 110, 85], vowel: VOWELS.oMale, seconds: 0.8, rough: 0.35, roughHz: 40, breath: 1.4, peak: 1.2 },
    female: { f0: [220, 190, 150], vowel: VOWELS.oFemale, seconds: 0.8, rough: 0.35, roughHz: 45, breath: 1.4, peak: 1.15 }
  }
} as const satisfies Record<Cue, Record<Sex, Vocal>>

/** Who `voice` 0…1 is: the lower half male, the upper female; within each, a pitch ±12 % and a vocal tract ±5 %. */
const speakerOf = (voice: number): { readonly sex: Sex; readonly pitch: number; readonly tract: number } => {
  const v = unit(voice), within = v < 0.5 ? v * 2 : (v - 0.5) * 2
  return { sex: v < 0.5 ? "male" : "female", pitch: 0.88 + 0.24 * within, tract: 0.95 + 0.1 * within }
}

/** `cue` in the voice of `voice`, a little different every time. */
const utter = (cue: Cue): Shot<Extract<OneShot, { readonly kind: Cue }>> => ({
  play: (io, { voice }, when) => {
    const { sex, pitch, tract } = speakerOf(voice), base: Vocal = CUES[cue][sex], f0 = pitch * jitter(0.04)
    const scale = ([f1, f2, f3]: Formants): Formants => [f1 * tract, f2 * tract, f3 * tract]
    return vocalise(io, {
      ...base,
      f0: [base.f0[0] * f0, base.f0[1] * f0, base.f0[2] * f0],
      vowel: scale(base.vowel),
      seconds: base.seconds * jitter(0.1)
    }, when)
  }
})

/** A terrified scream (a pedestrian in danger). */
export const scream = utter("scream")
/** A pained groan from someone on the ground. */
export const groan = utter("groan")
