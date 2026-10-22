/**
 * The audition page's "Render all" (lab.ts): every voice and shot rendered offline at 48 kHz at a
 * few representative params (the crashes over a matrix of bodies, targets and speeds, the scrape
 * along every material, each engine at its redline under full load, where its trim is calibrated,
 * speech in every register, each animal's calls) and measured: peak, RMS, spectral centroid, NaNs,
 * length, and any sound left after a voice's stop or a shot's end. Also the flat forms the page's
 * controls edit for the crash and for speech, and the synth tables the page plays.
 *
 * @module audio/lab-renders
 */
import type { Age } from "../sim/schema.ts"
import { VEHICLE_MODELS, VEHICLES, type VehicleModel } from "../sim/vehicles.ts"
import { makeKit } from "./buffers.ts"
import { measure } from "./measure.ts"
import { lineFor } from "./speech/index.ts"
import type { Situation } from "./speech/types.ts"
import { VEHICLE_SHOTS, VEHICLE_VOICES } from "./synth/vehicles.ts"
import { WORLD_SHOTS, WORLD_VOICES } from "./synth/world.ts"
import type { Continuous, Kit, Material, OneShot, Shot, Shots, Surface, VoiceFactory, Voices, Zone } from "./types.ts"

/** Every continuous synth, by kind. */
export const VOICES = { ...VEHICLE_VOICES, ...WORLD_VOICES } satisfies Voices
/** Every one-shot synth, by kind. */
export const SHOTS = { ...VEHICLE_SHOTS, ...WORLD_SHOTS } satisfies Shots

/** Any sound the page plays. */
export type Sound = Continuous | OneShot
type Crash = Extract<OneShot, { readonly kind: "crash" }>
/** A line said or yelled. */
export type Speaking = Extract<OneShot, { readonly kind: "talk" | "yell" }>

/** Every wall and ground material. */
// Every key of a `satisfies Record<Material, 0>` is a Material.
export const MATERIALS = Object.keys({ masonry: 0, stone: 0, sheet: 0, glass: 0, rail: 0, rock: 0, earth: 0, tree: 0, road: 0 } satisfies Record<Material, 0>) as ReadonlyArray<Material>

/** `model`'s mass, t, as the sim reports it. */
export const tonnes = (model: VehicleModel): number => VEHICLES[model].mass / 1000
/** The reduced mass of two models, t. */
const paired = (a: VehicleModel, b: VehicleModel): number => 1 / (1 / tonnes(a) + 1 / tonnes(b))

/** The crash's params flat, one control each: `against` is a wall's material or the model of the car hit, on its `struck` zone. */
export interface CrashForm {
  readonly kind: "crash"
  readonly speed: number
  readonly mass: number
  readonly model: VehicleModel
  readonly zone: Zone
  readonly against: Material | VehicleModel
  readonly struck: Zone
  readonly surface: Surface
}
/** A Panda's nose into a rendered house wall, on asphalt. */
export const CRASH: CrashForm = { kind: "crash", speed: 8, mass: tonnes("panda"), model: "panda", zone: "front", against: "masonry", struck: "front", surface: "asphalt" }
const isModel = (name: string): name is VehicleModel => (VEHICLE_MODELS as ReadonlyArray<string>).includes(name)
/** The crash `form` describes. */
export const crashOf = ({ model, zone, against, struck, ...rest }: CrashForm): Crash => ({
  ...rest, body: { model, zone }, against: isModel(against) ? { kind: "car", body: { model: against, zone: struck } } : { kind: "wall", material: against }
})

/** Speech's params flat: a fresh line for `situation` in the voice of `voice`, `age` and `female`, said (`talk`) or yelled (`yell`). */
export interface SpeechForm<K extends Speaking["kind"] = Speaking["kind"]> {
  readonly kind: K
  readonly situation: Situation
  readonly voice: number
  readonly age: Age
  readonly female: boolean
}
/** The speech `form` describes, with a line drawn for its situation. */
export const speechOf = <K extends Speaking["kind"]>({ kind, situation, ...speaker }: SpeechForm<K>): Extract<Speaking, { readonly kind: K }> =>
  ({ kind, speaker, line: lineFor(situation, Math.random) }) as Extract<Speaking, { readonly kind: K }>

/** Some sounds of every kind of `S`: a new kind fails to compile until "render all" plays it. */
type Each<S extends Sound> = { readonly [K in S["kind"]]: ReadonlyArray<Extract<S, { readonly kind: K }>> }

/** "Render all": representative params per voice (rendered 2 s) and per shot. */
const VOICE_RENDERS = {
  // Each model at the redline under full load (its trim's calibration: flagged off nominal outside 0.42–0.6) and idling; the Giulia from its seat.
  engine: [
    ...VEHICLE_MODELS.flatMap((model) => {
      const { idle, redline } = VEHICLES[model].engine
      return [{ kind: "engine", model, rpm: redline, load: 1, inside: false, variant: 0.5 }, { kind: "engine", model, rpm: idle, load: 0, inside: false, variant: 0.5 }] as const
    }),
    { kind: "engine", model: "carabinieri", rpm: 3500, load: 0.5, inside: true, variant: 0.5 }
  ],
  tyres: [
    // The loudest intended case, a full slide at the Giulia's top speed: peaks near 0.5.
    { kind: "tyres", speed: 40, skid: 1, slip: 12, surface: "asphalt", heavy: false },
    { kind: "tyres", speed: 14, skid: 0, slip: 0, surface: "asphalt", heavy: false },
    { kind: "tyres", speed: 20, skid: 0.6, slip: 6, surface: "asphalt", heavy: false },
    { kind: "tyres", speed: 10, skid: 0, slip: 0, surface: "stone", heavy: false },
    { kind: "tyres", speed: 15, skid: 0.5, slip: 3, surface: "gravel", heavy: true },
    // A standing burnout, a locked wheel, ABS braking at the limit.
    { kind: "tyres", speed: 0, skid: 1, slip: 8, surface: "asphalt", heavy: false },
    { kind: "tyres", speed: 15, skid: 1, slip: 15, surface: "asphalt", heavy: false },
    { kind: "tyres", speed: 20, skid: 0.25, slip: 3, surface: "asphalt", heavy: false }
  ],
  // Full grinding from 12 m/s, where every material peaks near 0.5; masonry slower, and the guard rail's squeal at 2.5 m/s.
  scrape: [
    ...MATERIALS.map((material) => ({ kind: "scrape", speed: 12, material }) as const),
    { kind: "scrape", speed: 4, material: "masonry" },
    { kind: "scrape", speed: 2.5, material: "rail" }
  ],
  horn: VEHICLE_MODELS.map((model) => ({ kind: "horn", model }) as const),
  siren: [{ kind: "siren" }],
  beeper: [{ kind: "beeper" }],
  water: [{ kind: "water", body: "fountain", flow: 0.5 }, { kind: "water", body: "stream", flow: 0.6 }, { kind: "water", body: "river", flow: 1 }],
  wind: [{ kind: "wind", strength: 0.3, forest: 0 }, { kind: "wind", strength: 1, forest: 1 }],
  crickets: [{ kind: "crickets", density: 0.3 }, { kind: "crickets", density: 1 }]
} satisfies Each<Continuous>
const SHOT_RENDERS = {
  // A Panda into a house wall (a bump to a heavy hit), car–car pairs, each other target, a side hit, a wreck, the laden truck nudging
  // and hitting a house, a hard landing on the road and a roll onto it: each at the sim's mass (the car's, the reduced mass of two).
  crash: ([
    { speed: 2 }, { speed: 5 }, { speed: 14 }, { speed: 20 },
    { speed: 10, against: "panda" },
    { speed: 12, against: "truck" },
    { speed: 8, model: "ape", against: "stone" },
    { speed: 12, model: "carabinieri", against: "rail" },
    { speed: 10, against: "tree" },
    { speed: 8, against: "earth" },
    { speed: 12, zone: "side" },
    { speed: 40, model: "carabinieri" },
    { speed: 2, model: "truck" },
    { speed: 12, model: "truck" },
    { speed: 8, zone: "under", against: "road" },
    { speed: 8, zone: "side", against: "road" }
  ] satisfies ReadonlyArray<Partial<CrashForm>>).map((row) => {
    const form = { ...CRASH, ...row }
    return crashOf({ ...form, mass: isModel(form.against) ? paired(form.model, form.against) : tonnes(form.model) })
  }),
  thud: [{ kind: "thud", speed: 5 }, { kind: "thud", speed: 12 }],
  clunk: [{ kind: "clunk", speed: 5, heavy: false }, { kind: "clunk", speed: 2, heavy: true }],
  door: [{ kind: "door", model: "panda", open: true }, { kind: "door", model: "panda", open: false }, { kind: "door", model: "truck", open: false }],
  ignition: VEHICLE_MODELS.map((model) => ({ kind: "ignition", model }) as const),
  honk: [{ kind: "honk", model: "panda" }, { kind: "honk", model: "truck" }],
  step: [
    { kind: "step", surface: "stone", run: true },
    { kind: "step", surface: "asphalt", run: false },
    { kind: "step", surface: "gravel", run: true },
    { kind: "step", surface: "grass", run: false }
  ],
  // Each register: a man, a woman, an elder and a child, chatting quietly and crying out; a line drawn per page load.
  talk: ([
    { situation: "chat", voice: 0.3, age: "adult", female: false },
    { situation: "reply", voice: 0.7, age: "adult", female: true },
    { situation: "greet", voice: 0.5, age: "elder", female: false },
    { situation: "laugh", voice: 0.5, age: "kid", female: true }
  ] as const).map((form) => speechOf({ kind: "talk", ...form })),
  yell: ([
    { situation: "fright", voice: 0.3, age: "adult", female: false },
    { situation: "anger", voice: 0.7, age: "adult", female: true },
    { situation: "shock", voice: 0.5, age: "elder", female: true },
    { situation: "surprise", voice: 0.5, age: "kid", female: false }
  ] as const).map((form) => speechOf({ kind: "yell", ...form })),
  scream: [{ kind: "scream", voice: 0.2 }, { kind: "scream", voice: 0.8 }],
  groan: [{ kind: "groan", voice: 0.2 }, { kind: "groan", voice: 0.8 }],
  bell: [{ kind: "bell", pitch: 400 }, { kind: "bell", pitch: 800 }],
  bird: (["robin", "tit", "blackbird", "chaffinch"] as const).map((species) => ({ kind: "bird", species }) as const),
  bark: [{ kind: "bark", big: true }, { kind: "bark", big: false }],
  moo: [{ kind: "moo", size: 0.85 }, { kind: "moo", size: 1.15 }],
  grunt: [{ kind: "grunt", size: 1 }],
  squeal: [{ kind: "squeal", size: 1 }],
  yelp: [{ kind: "yelp", size: 1 }],
  meow: [{ kind: "meow", size: 1, yowl: false }, { kind: "meow", size: 1, yowl: true }],
  hiss: [{ kind: "hiss", size: 1 }]
} satisfies Each<OneShot>

const RATE = 48000
/** Voices settle (fade in) for `settle` s, are measured for `seconds`, then stopped: they must be silent `fade` s later, when the speaker frees their emitter. */
const VOICE_RENDER = { settle: 0.5, seconds: 2, fade: 0.5 } as const
/** Room for the longest shot: a bell rings 10 s. */
const SHOT_SECONDS = 12
/** Below this peak a render counts as silent (−80 dBFS); above `CLIP`, as clipping. */
const SILENT = 1e-4, CLIP = 0.95
/** An engine at the redline under full load, heard outside, peaks at the nominal 0.5 within this (its `TRIM` is off otherwise). */
const NOMINAL = [0.42, 0.6] as const

/** Whether `sound` is a calibration render that peaks off nominal. */
const offNominal = (sound: Sound, peak: number): boolean =>
  sound.kind === "engine" && !sound.inside && sound.load === 1 && sound.rpm === VEHICLES[sound.model].engine.redline && (peak < NOMINAL[0] || peak > NOMINAL[1])

/** One line of the render table. */
export interface Row {
  readonly name: string
  readonly params: string
  readonly peak: number
  /** dBFS. */
  readonly rms: number
  /** Spectral centroid, Hz. */
  readonly centroid: number
  readonly nan: boolean
  /** How long it sounds: the voice's measured span, the shot's own end time. */
  readonly seconds: number
  /** Anything to look at: silent, clipping, an engine off its nominal peak, NaN, sound after its stop or end. */
  readonly flags: string
}

/** A param's value; a nested one's values joined by "/" (body=panda/front). */
const shown = (value: unknown): string => (typeof value === "object" && value !== null ? Object.values(value).map(shown).join("/") : String(value))
const paramsOf = (sound: Sound): string => Object.entries(sound).filter(([name]) => name !== "kind").map(([name, value]) => `${name}=${shown(value)}`).join(" ")

/** The row for `sound` measured over [from, to] s of `audio`, which must be silent from `quiet` s on. */
const rowOf = (sound: Sound, audio: AudioBuffer, from: number, to: number, quiet: number): Row => {
  const span = (a: number, b: number) => Array.from({ length: audio.numberOfChannels }, (_, c) => audio.getChannelData(c).subarray(Math.floor(a * RATE), Math.floor(b * RATE)))
  const m = measure(span(from, to), RATE), after = measure(span(quiet, audio.duration), RATE)
  const flags = [
    m.peak < SILENT && "silent", m.peak > CLIP && "clips", offNominal(sound, m.peak) && "off nominal", (m.nan || after.nan) && "NaN",
    after.peak > SILENT && `${after.peak.toFixed(4)} after its end`
  ]
  return {
    name: sound.kind, params: paramsOf(sound), peak: Number(m.peak.toFixed(3)), rms: Number(m.rms.toFixed(1)), centroid: Math.round(m.centroid),
    nan: m.nan || after.nan, seconds: Number((to - from).toFixed(2)), flags: flags.filter((flag) => flag !== false).join(", ")
  }
}

const renderVoice = async (kit: Kit, sound: Continuous): Promise<Row> => {
  const { settle, seconds, fade } = VOICE_RENDER, end = settle + seconds
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: Math.ceil((end + fade + 0.05) * RATE), sampleRate: RATE })
  const cents = new ConstantSourceNode(ctx, { offset: 0 })
  cents.start()
  const voice = (VOICES[sound.kind] as VoiceFactory<Continuous>)({ ctx, out: ctx.destination, cents, kit })
  // Frames at 60 Hz, as the director would hold it.
  for (let t = 0; t < end; t += 1 / 60) voice.update(sound, t)
  voice.stop(end)
  return rowOf(sound, await ctx.startRendering(), settle, end, end + fade)
}

const renderShot = async (kit: Kit, sound: OneShot): Promise<Row> => {
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: SHOT_SECONDS * RATE, sampleRate: RATE })
  const shot = SHOTS[sound.kind] as Shot<OneShot>
  await shot.prepare?.(ctx, kit)
  // A fresh params object: the crash keeps one render per object, and every run should draw anew.
  const end = Math.min(SHOT_SECONDS, shot.play({ ctx, out: ctx.destination, kit }, { ...sound }, 0))
  // The speaker frees a shot's emitter 0.1 s after its end.
  return rowOf(sound, await ctx.startRendering(), 0, end, Math.min(SHOT_SECONDS, end + 0.1))
}


/** Renders every voice and shot offline, one at a time (a dozen 12 s stereo renders at once would hold hundreds of MB). */
export const renderRows = async (): Promise<ReadonlyArray<Row>> => {
  const kit = makeKit(new OfflineAudioContext({ length: 1, sampleRate: RATE }))
  const rows: Array<Row> = []
  for (const sound of Object.values(VOICE_RENDERS).flat()) rows.push(await renderVoice(kit, sound))
  for (const sound of Object.values(SHOT_RENDERS).flat()) rows.push(await renderShot(kit, sound))
  return rows
}
