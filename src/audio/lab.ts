/**
 * The audition page (lab.html; the dev server serves it, the production build leaves it out):
 * every synth on a button with its params on controls, played through the real emitter and
 * mixer from a distance and a side of the screen you pick, beside the level, gain, pan, lowpass
 * and reverb send the director gives it there: its calibration (director/levels.ts) through its
 * acoustic chain (director/hearing.ts), over open, flat ground with nothing in the way. "Render
 * all" renders every voice and shot offline at a few representative params (the crashes over a
 * matrix of bodies, targets and speeds, the scrape along every material, each engine at its redline
 * under full load, where its trim is calibrated, and worn by damage, one misfiring) and tabulates
 * peak, RMS, spectral centroid and NaNs; `window.lab.renderAll()` returns the same rows, for CDP
 * checks.
 *
 * @module audio/lab
 */
import { screenAxes } from "../sim/view.ts"
import { VEHICLE_MODELS, VEHICLES, type VehicleModel } from "../sim/vehicles.ts"
import { AMBIENT_DB, CABIN, type Cabin, dbToGain, EAR_HEIGHT, gainToDb } from "./acoustics.ts"
import { makeKit } from "./buffers.ts"
import { hear, type Hearing } from "./director/hearing.ts"
import { BEDS, ENGINE, type Level, LEVELS, OWN_ENGINE_DB, WATER_R_MIN, windDb } from "./director/levels.ts"
import { type Emitter, makeEmitter } from "./emitter.ts"
import { measure } from "./measure.ts"
import { makeMixer, type Mixer } from "./mixer.ts"
import { crashQuiet } from "./synth/crash/index.ts"
import { engineQuiet } from "./synth/engine.ts"
import { clunkQuiet } from "./synth/impacts.ts"
import { VEHICLE_SHOTS, VEHICLE_VOICES } from "./synth/vehicles.ts"
import { WORLD_SHOTS, WORLD_VOICES } from "./synth/world.ts"
import type { Continuous, Kit, Material, OneShot, Shot, Shots, Surface, Voice, VoiceFactory, Voices, Zone } from "./types.ts"

const VOICES = { ...VEHICLE_VOICES, ...WORLD_VOICES } satisfies Voices
const SHOTS = { ...VEHICLE_SHOTS, ...WORLD_SHOTS } satisfies Shots

type Sound = Continuous | OneShot
type Crash = Extract<OneShot, { readonly kind: "crash" }>
type WaterBody = Extract<Continuous, { readonly kind: "water" }>["body"]

/** The screen axes on the ground, with the view in its home seat. */
const { right: SCREEN_RIGHT, up: SCREEN_UP } = screenAxes(0)

// ponytail: water as a point source: the river (the Lucido) and the stream (a 4 m one) at their 2 m bank level + 6 dB, the fountain at
// its 1 m level; the director takes each body's line-source level at the listener from places.
const WATER_DB = { fountain: 65, stream: 61, river: 76 } as const satisfies Record<WaterBody, number>

/**
 * A source's calibration; `wet` marks one heard at the ears, with the director's reverb send for it (none); `under`, a bed
 * whose voice plays that many dB under its nominal by itself, which its gain gives back (world.ts); `quiet`, an engine, crash
 * or clunk that plays that many dB under its nominal, which masking counts (vehicles.ts).
 */
type Calibration = Level & { readonly wet?: number; readonly under?: number; readonly quiet?: number }

/** `sound`'s calibration: the beds and the own engine (from the driver's seat, through no cabin) sound at the ears. */
const sourceOf = (sound: Sound): Calibration =>
  sound.kind === "engine" ? (sound.inside ? { db: OWN_ENGINE_DB, rMin: 1, wet: 0 } : { ...ENGINE[sound.model], quiet: engineQuiet(sound.model, sound.rpm, sound.load, sound.damage) })
  : sound.kind === "crash" ? { ...LEVELS.crash, quiet: crashQuiet(sound) }
  : sound.kind === "clunk" ? { ...LEVELS.clunk, quiet: clunkQuiet(sound.speed) }
  : sound.kind === "water" ? { db: WATER_DB[sound.body], rMin: WATER_R_MIN }
  : sound.kind === "wind" ? { db: windDb(sound.strength), rMin: 1, wet: 0, under: BEDS.wind - windDb(sound.strength) }
  : sound.kind === "crickets" ? { db: BEDS.crickets, rMin: 1, wet: 0 }
  : LEVELS[sound.kind]

/** The listener's side of the page's controls: the source `r` m away towards `side` (−1 screen-left … 1 screen-right), their cabin and street. */
interface Where { readonly r: number; readonly side: number; readonly cabin: Cabin | undefined; readonly street: number }

/** Still ears over open, flat ground; sources stand at the same height, so `r` is the distance. */
const EARS = { x: 0, y: 0, z: EAR_HEIGHT, vx: 0, vy: 0, right: SCREEN_RIGHT } as const

/** How `sound` reaches the listener at `where`, and its calibration. */
const heard = (sound: Sound, where: Where): { readonly hearing: Hearing; readonly source: Calibration } => {
  const source = sourceOf(sound), r = source.wet === undefined ? where.r : 0, ahead = Math.sqrt(1 - where.side * where.side)
  const at = { x: r * (where.side * SCREEN_RIGHT.x + ahead * SCREEN_UP.x), y: r * (where.side * SCREEN_RIGHT.y + ahead * SCREEN_UP.y), z: EAR_HEIGHT }
  // The game plays the listener's own engine through no cabin (the synth makes its own).
  const own = sound.kind === "engine" && sound.inside
  const hearing = hear({
    ears: EARS, source: at, db: source.db, rMin: source.rMin, height: EAR_HEIGHT, quiet: source.quiet, delta: 0, forest: 0, ambient: AMBIENT_DB,
    street: where.street, cabin: own ? undefined : where.cabin
  })
  const placement = { ...hearing.placement, gain: hearing.placement.gain * dbToGain(source.under ?? 0), wet: source.wet ?? hearing.placement.wet }
  return { hearing: { ...hearing, placement }, source }
}

const SURFACES = Object.keys({ asphalt: 0, stone: 0, gravel: 0, dirt: 0, grass: 0, leaves: 0 } satisfies Record<Surface, 0>)
// Every key of a `satisfies Record<Material, 0>` is a Material.
const MATERIALS = Object.keys({ masonry: 0, stone: 0, sheet: 0, glass: 0, rail: 0, rock: 0, earth: 0, tree: 0, road: 0 } satisfies Record<Material, 0>) as ReadonlyArray<Material>
const ZONES = Object.keys({ front: 0, side: 0, rear: 0, under: 0 } satisfies Record<Zone, 0>)
/** Menus for the string params. */
const OPTIONS: Readonly<Record<string, ReadonlyArray<string>>> = {
  model: VEHICLE_MODELS,
  surface: SURFACES,
  material: MATERIALS,
  zone: ZONES,
  struck: ZONES,
  against: [...MATERIALS, ...VEHICLE_MODELS],
  body: Object.keys({ fountain: 0, stream: 0, river: 0 } satisfies Record<WaterBody, 0>),
  species: Object.keys({ robin: 0, tit: 0, blackbird: 0, chaffinch: 0 } satisfies Record<Extract<OneShot, { readonly kind: "bird" }>["species"], 0>)
}
/** Slider [min, max, step] per numeric param, or per `kind.param` where kinds differ. */
const RANGES: Readonly<Record<string, readonly [number, number, number] | undefined>> = {
  "tyres.speed": [0, 45, 0.5], "scrape.speed": [0, 20, 0.5], "crash.speed": [0, 60, 0.5], "thud.speed": [0, 20, 0.5], "clunk.speed": [0, 6, 0.1],
  rpm: [0, 7000, 10], slip: [0, 20, 0.1], mass: [0.1, 30, 0.05], pitch: [350, 900, 1]
}
const UNIT_RANGE = [0, 1, 0.01] as const

/** `model`'s mass, t, as the sim reports it; the reduced mass of two models. */
const tonnes = (model: VehicleModel): number => VEHICLES[model].mass / 1000
const paired = (a: VehicleModel, b: VehicleModel): number => 1 / (1 / tonnes(a) + 1 / tonnes(b))

/** Each kind's params as first shown; the controls are made from these (numbers: sliders, strings: menus, flags: checkboxes). */
const HELD = {
  engine: { kind: "engine", model: "panda", rpm: 3000, load: 0.5, inside: false, variant: 0.5, damage: 0, misfire: false },
  tyres: { kind: "tyres", speed: 12, skid: 0, slip: 0, surface: "asphalt", heavy: false },
  scrape: { kind: "scrape", speed: 8, material: "masonry" },
  horn: { kind: "horn", model: "panda" },
  siren: { kind: "siren" },
  beeper: { kind: "beeper" },
  fire: { kind: "fire" },
  water: { kind: "water", body: "stream", flow: 0.6 },
  wind: { kind: "wind", strength: 0.6, forest: 0.3 },
  crickets: { kind: "crickets", density: 0.7 }
} as const satisfies { readonly [K in Continuous["kind"]]: Extract<Continuous, { readonly kind: K }> }

/** The crash's params flat, one control each: `against` is a wall's material or the model of the car hit, on its `struck` zone. */
interface CrashForm {
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
const CRASH: CrashForm = { kind: "crash", speed: 8, mass: tonnes("panda"), model: "panda", zone: "front", against: "masonry", struck: "front", surface: "asphalt" }
const isModel = (name: string): name is VehicleModel => (VEHICLE_MODELS as ReadonlyArray<string>).includes(name)
/** The crash `form` describes. */
const crashOf = ({ model, zone, against, struck, ...rest }: CrashForm): Crash => ({
  ...rest, body: { model, zone }, against: isModel(against) ? { kind: "car", body: { model: against, zone: struck } } : { kind: "wall", material: against }
})

/** A one-shot panel's controls: its sound's params, the crash's flattened. */
type Form = Exclude<OneShot, Crash> | CrashForm
const soundOf = (form: Form): OneShot => (form.kind === "crash" ? crashOf(form) : form)

const PLAYED = {
  crash: CRASH,
  explosion: { kind: "explosion", surface: "asphalt" },
  thud: { kind: "thud", speed: 8 },
  clunk: { kind: "clunk", speed: 3, heavy: false },
  door: { kind: "door", model: "panda", open: false },
  ignition: { kind: "ignition", model: "panda" },
  honk: { kind: "honk", model: "panda" },
  step: { kind: "step", surface: "stone", run: false },
  scream: { kind: "scream", voice: 0.3 },
  shout: { kind: "shout", voice: 0.3 },
  groan: { kind: "groan", voice: 0.3 },
  bell: { kind: "bell", pitch: 600 },
  bird: { kind: "bird", species: "robin" },
  bark: { kind: "bark", big: true }
} as const satisfies { readonly [K in OneShot["kind"]]: Extract<Form, { readonly kind: K }> }

/** Some sounds of every kind of `S`: a new kind fails to compile until "render all" plays it. */
type Each<S extends Sound> = { readonly [K in S["kind"]]: ReadonlyArray<Extract<S, { readonly kind: K }>> }

type Engine = Extract<Continuous, { readonly kind: "engine" }>
/** `model`'s engine as new, outside, the nominal variant, at its redline under full load unless `more` says otherwise. */
const engineAt = (model: VehicleModel, more: Partial<Engine> = {}): Engine =>
  ({ kind: "engine", model, rpm: VEHICLES[model].engine.redline, load: 1, inside: false, variant: 0.5, damage: 0, misfire: false, ...more })
/** A worn Panda misfiring in every other 0.25 s window (the sim's), as the director would hold it frame by frame. */
const SPUTTERING = engineAt("panda", { rpm: 3000, load: 0.5, damage: 0.9 })
const sputtering = (t: number): Engine => ({ ...SPUTTERING, misfire: Math.floor(t / 0.25) % 2 === 1 })

/** "Render all": representative params per voice (rendered 2 s) and per shot. */
const VOICE_RENDERS = {
  // Each model at the redline under full load (its trim's calibration: flagged off nominal outside 0.42–0.6), idling, and worn at the redline
  // (flagged over nominal past 0.6, as every engine row is); the Giulia from its seat; a Panda and the truck idling worn; the truck's
  // loudest knock.
  engine: [
    ...VEHICLE_MODELS.flatMap((model) => [engineAt(model), engineAt(model, { rpm: VEHICLES[model].engine.idle, load: 0 }), engineAt(model, { damage: 0.9 })]),
    engineAt("carabinieri", { rpm: 3500, load: 0.5, inside: true }),
    engineAt("panda", { rpm: VEHICLES.panda.engine.idle, load: 0, damage: 0.5 }),
    engineAt("truck", { rpm: VEHICLES.truck.engine.idle, load: 0, damage: 0.8 }),
    // The loudest knock: the truck's, at the redline off the throttle, at full damage short of destroyed.
    engineAt("truck", { load: 0, damage: 0.99 })
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
  fire: [{ kind: "fire" }],
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
  // Its debris on the road, on setts (bouncier) and on grass (muffled); each run draws a new blast.
  explosion: (["asphalt", "stone", "grass"] as const).map((surface) => ({ kind: "explosion", surface }) as const),
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
  scream: [{ kind: "scream", voice: 0.2 }, { kind: "scream", voice: 0.8 }],
  shout: [{ kind: "shout", voice: 0.2 }, { kind: "shout", voice: 0.8 }],
  groan: [{ kind: "groan", voice: 0.2 }, { kind: "groan", voice: 0.8 }],
  bell: [{ kind: "bell", pitch: 400 }, { kind: "bell", pitch: 800 }],
  bird: (["robin", "tit", "blackbird", "chaffinch"] as const).map((species) => ({ kind: "bird", species }) as const),
  bark: [{ kind: "bark", big: true }, { kind: "bark", big: false }]
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

/** Whether `sound` is a calibration render (an engine as new) that peaks off nominal. */
const offNominal = (sound: Sound, peak: number): boolean =>
  sound.kind === "engine" && !sound.inside && sound.load === 1 && sound.damage === 0 && sound.rpm === VEHICLES[sound.model].engine.redline
  && (peak < NOMINAL[0] || peak > NOMINAL[1])
/** Whether `sound` is an engine peaking over its nominal: worn or misfiring, it must not. */
const overNominal = (sound: Sound, peak: number): boolean => sound.kind === "engine" && peak > NOMINAL[1]

/** One line of the render table. */
interface Row {
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
  /** Anything to look at: silent, clipping, an engine off or over its nominal peak, NaN, sound after its stop or end. */
  readonly flags: string
}

/** A param's value; a nested one's values joined by "/" (body=panda/front). */
const shown = (value: unknown): string => (typeof value === "object" && value !== null ? Object.values(value).map(shown).join("/") : String(value))
const paramsOf = (sound: Sound): string => Object.entries(sound).filter(([name]) => name !== "kind").map(([name, value]) => `${name}=${shown(value)}`).join(" ")

/** The row for `sound` (shown as `params`) measured over [from, to] s of `audio`, which must be silent from `quiet` s on. */
const rowOf = (sound: Sound, audio: AudioBuffer, from: number, to: number, quiet: number, params = paramsOf(sound)): Row => {
  const span = (a: number, b: number) => Array.from({ length: audio.numberOfChannels }, (_, c) => audio.getChannelData(c).subarray(Math.floor(a * RATE), Math.floor(b * RATE)))
  const m = measure(span(from, to), RATE), after = measure(span(quiet, audio.duration), RATE)
  const flags = [
    m.peak < SILENT && "silent", m.peak > CLIP && "clips", offNominal(sound, m.peak) ? "off nominal" : overNominal(sound, m.peak) && "over nominal",
    (m.nan || after.nan) && "NaN",
    after.peak > SILENT && `${after.peak.toFixed(4)} after its end`
  ]
  return {
    name: sound.kind, params, peak: Number(m.peak.toFixed(3)), rms: Number(m.rms.toFixed(1)), centroid: Math.round(m.centroid),
    nan: m.nan || after.nan, seconds: Number((to - from).toFixed(2)), flags: flags.filter((flag) => flag !== false).join(", ")
  }
}

/** `sound` held for 2.5 s as the director holds it, at 60 frames a second (its params at `t` s from `at`), then stopped. */
const renderVoice = async (kit: Kit, sound: Continuous, at: (t: number) => Continuous = () => sound, params?: string): Promise<Row> => {
  const { settle, seconds, fade } = VOICE_RENDER, end = settle + seconds
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: Math.ceil((end + fade + 0.05) * RATE), sampleRate: RATE })
  const cents = new ConstantSourceNode(ctx, { offset: 0 })
  cents.start()
  const voice = (VOICES[sound.kind] as VoiceFactory<Continuous>)({ ctx, out: ctx.destination, cents, kit })
  // Frames at 60 Hz, as the director would hold it.
  for (let t = 0; t < end; t += 1 / 60) voice.update(at(t), t)
  voice.stop(end)
  return rowOf(sound, await ctx.startRendering(), settle, end, end + fade, params)
}

const renderShot = async (kit: Kit, sound: OneShot): Promise<Row> => {
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: SHOT_SECONDS * RATE, sampleRate: RATE })
  const shot = SHOTS[sound.kind] as Shot<OneShot>
  await shot.prepare?.(ctx, kit)
  // A fresh params object: the crash and the explosion keep one render per object, and every run should draw anew.
  const end = Math.min(SHOT_SECONDS, shot.play({ ctx, out: ctx.destination, kit }, { ...sound }, 0))
  // The speaker frees a shot's emitter 0.1 s after its end.
  return rowOf(sound, await ctx.startRendering(), 0, end, Math.min(SHOT_SECONDS, end + 0.1))
}

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, parent: HTMLElement, text?: string): HTMLElementTagNameMap[K] => {
  const node = parent.appendChild(document.createElement(tag))
  if (text !== undefined) node.textContent = text
  return node
}
/** An element of lab.html. */
const byId = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T

/** Renders every voice and shot offline, prints the table on the page and returns its rows. */
const renderAll = async (): Promise<ReadonlyArray<Row>> => {
  const kit = makeKit(new OfflineAudioContext({ length: 1, sampleRate: RATE }))
  const rows: Array<Row> = []
  // One at a time: a dozen 12 s stereo renders at once would hold hundreds of MB.
  for (const sound of Object.values(VOICE_RENDERS).flat()) rows.push(await renderVoice(kit, sound))
  rows.push(await renderVoice(kit, SPUTTERING, sputtering, paramsOf(SPUTTERING).replace("misfire=false", "misfire=every other 0.25 s")))
  for (const sound of Object.values(SHOT_RENDERS).flat()) rows.push(await renderShot(kit, sound))
  const table = byId("renders")
  table.replaceChildren()
  const head = element("tr", element("thead", table))
  for (const name of ["sound", "params", "peak", "RMS dBFS", "centroid Hz", "NaN", "s", "flags"]) element("th", head, name)
  const body = element("tbody", table)
  for (const row of rows) {
    const line = element("tr", body)
    for (const cell of [row.name, row.params, row.peak, row.rms, row.centroid, row.nan ? "NaN" : "", row.seconds, row.flags]) element("td", line, String(cell))
    if (row.flags !== "") line.className = "flagged"
  }
  return rows
}

interface Live { readonly ctx: AudioContext; readonly kit: Kit; readonly mixer: Mixer; readonly ready: Promise<unknown> }
let live: Live | undefined

/** The live context, made on the first button press (autoplay policy), with every shot preparing. */
const wake = (): Live => {
  if (live !== undefined) return live
  const ctx = new AudioContext(), kit = makeKit(ctx)
  const ready = Promise.all(Object.entries(SHOTS).map(([kind, shot]) => shot.prepare?.(ctx, kit).catch((error: unknown) => console.error(`lab: preparing ${kind} failed`, error))))
  return (live = { ctx, kit, mixer: makeMixer(ctx), ready })
}

/** A control per param of `defaults` in `box`; returns a reader of the current params. */
const controls = <F extends { readonly kind: string }>(box: HTMLElement, defaults: F): (() => F) => {
  const readers: Array<readonly [string, () => unknown]> = []
  for (const [name, value] of Object.entries(defaults)) {
    if (name === "kind") continue
    const label = element("label", box, `${name} `)
    if (typeof value === "boolean") {
      const input = Object.assign(element("input", label), { type: "checkbox", checked: value })
      readers.push([name, () => input.checked])
    } else if (typeof value === "string") {
      const select = element("select", label)
      for (const option of OPTIONS[name] ?? []) select.add(new Option(option, option, false, option === value))
      readers.push([name, () => select.value])
    } else {
      const [min, max, step] = RANGES[`${defaults.kind}.${name}`] ?? RANGES[name] ?? UNIT_RANGE
      const input = Object.assign(element("input", label), { type: "range", min: String(min), max: String(max), step: String(step), value: String(value) })
      const output = element("output", label, String(value))
      input.addEventListener("input", () => (output.textContent = input.value))
      readers.push([name, () => Number(input.value)])
    }
  }
  return () => ({ ...defaults, ...Object.fromEntries(readers.map(([name, read]) => [name, read()])) })
}

/** One panel per sound kind: its controls, a hold or play button, and the readout of how it is heard. */
const panels: Array<{ readonly read: () => Sound; readonly readout: HTMLElement }> = []
/** A held kind: its emitter, and its voice with the model it was built for (engines and horns fix their graph by model). */
interface Held { readonly read: () => Continuous; readonly emitter: Emitter; voice: Voice<Continuous>; model: VehicleModel | undefined }
const holding = new Map<Continuous["kind"], Held>()

const modelOf = (sound: Continuous): VehicleModel | undefined => ("model" in sound ? sound.model : undefined)
/** A new voice for `sound` into `emitter`. */
const voiceIn = ({ ctx, kit }: Live, emitter: Emitter, sound: Continuous): Voice<Continuous> =>
  (VOICES[sound.kind] as VoiceFactory<Continuous>)({ ctx, out: emitter.input, cents: emitter.cents, kit })

/** A panel for the sound `soundOf` makes of the params on its controls (from `defaults`). */
const panel = <F extends { readonly kind: string }, S extends Sound>(
  parent: HTMLElement, defaults: F, soundOf: (form: F) => S, label: string, press: (read: () => S, button: HTMLButtonElement) => void
): void => {
  const box = element("fieldset", parent)
  element("legend", box, defaults.kind)
  const form = controls(box, defaults), read = () => soundOf(form())
  const button = element("button", box, label)
  button.addEventListener("click", () => press(read, button))
  panels.push({ read, readout: element("output", box) })
}

const where = (): Where => {
  const value = (id: string) => Number(byId<HTMLInputElement>(id).value)
  const cabin = byId<HTMLSelectElement>("cabin").value
  // The slider is logarithmic: 0.5 m … 2 km.
  return { r: 0.5 * 4000 ** (value("distance") / 1000), side: value("side"), cabin: cabin in CABIN ? CABIN[cabin as VehicleModel] : undefined, street: value("street") }
}

const describe = (sound: Sound, at: Where): string => {
  const { hearing: { placement, level, delay }, source } = heard(sound, at)
  const gain = placement.gain > 0 ? `gain ${gainToDb(placement.gain).toFixed(1)} dB` : "inaudible"
  return `${Math.round(source.db)} dB(A)${source.wet === undefined ? " @1 m" : " here"} → ${level.toFixed(0)} dB(A) · ${gain} · pan ${placement.pan.toFixed(2)} · lowpass ${Math.round(placement.cutoff)} Hz · send ${placement.wet.toFixed(2)}${delay > 0 ? ` · delay ${Math.round(delay * 1000)} ms` : ""}`
}

const build = (): void => {
  const cabin = byId<HTMLSelectElement>("cabin")
  for (const model of VEHICLE_MODELS) cabin.add(new Option(model, model))
  for (const defaults of Object.values(HELD)) {
    panel(byId("held"), defaults as Continuous, (sound) => sound, "Hold", (read, button) => {
      const audio = wake(), now = audio.ctx.currentTime, held = holding.get(defaults.kind)
      if (held !== undefined) {
        held.voice.stop(now)
        held.emitter.release(now)
        holding.delete(defaults.kind)
        button.textContent = "Hold"
        return
      }
      // Silent at first: the next frame's placement fades it in.
      const sound = read(), emitter = makeEmitter(audio.ctx, audio.mixer, { ...heard(sound, where()).hearing.placement, gain: 0 })
      holding.set(defaults.kind, { read, emitter, voice: voiceIn(audio, emitter, sound), model: modelOf(sound) })
      button.textContent = "Release"
    })
  }
  for (const defaults of Object.values(PLAYED)) {
    panel(byId("played"), defaults as Form, soundOf, "Play", (read) => {
      const audio = wake()
      // The first press waits for the shots' renders.
      void audio.ready.then(() => {
        const { ctx, kit, mixer } = audio, sound = read(), { hearing } = heard(sound, where())
        const emitter = makeEmitter(ctx, mixer, hearing.placement)
        emitter.free((SHOTS[sound.kind] as Shot<OneShot>).play({ ctx, out: emitter.input, kit }, sound, ctx.currentTime + hearing.delay) + 0.1)
      })
    })
  }
  const render = byId<HTMLButtonElement>("render")
  render.addEventListener("click", () => {
    render.disabled = true
    void renderAll().finally(() => (render.disabled = false))
  })
}

/** Every frame: the readouts, the held voices' params and placements, the meter. */
const frame = (): void => {
  // First, so a synth that throws costs one frame, not the loop.
  requestAnimationFrame(frame)
  const at = where()
  byId("distance-shown").textContent = `${at.r < 10 ? at.r.toFixed(1) : Math.round(at.r)} m`
  for (const { read, readout } of panels) readout.textContent = describe(read(), at)
  if (live !== undefined) {
    const now = live.ctx.currentTime
    for (const held of holding.values()) {
      const sound = held.read()
      if (modelOf(sound) !== held.model) {
        held.voice.stop(now)
        held.voice = voiceIn(live, held.emitter, sound)
        held.model = modelOf(sound)
      }
      held.emitter.place(heard(sound, at).hearing.placement, now)
      held.voice.update(sound, now)
    }
    const level = live.mixer.level()
    byId<HTMLMeterElement>("meter").value = level
    byId("meter-shown").textContent = `${level.toFixed(1)} dBFS`
  }
}

build()
frame()
Object.assign(window, { lab: { renderAll } })
