/**
 * The audition page (lab.html; the dev server serves it, the production build leaves it out):
 * every synth on a button with its params on controls, played through the real emitter and
 * mixer from a distance and a side of the screen you pick, beside the level, gain, pan, lowpass
 * and reverb send the director gives it there: its calibration (director/levels.ts) through its
 * acoustic chain (director/hearing.ts), over open, flat ground with nothing in the way. "Render
 * all" renders every voice and shot offline at a few representative params (lab-rows.ts: the
 * crashes over a matrix of bodies, targets and speeds, the scrape along every material, each engine
 * at its redline under full load, where its trim is calibrated, and worn by damage, one misfiring,
 * speech in every register, each animal's calls) and tabulates peak, RMS, spectral centroid and
 * NaNs; `window.lab.renderAll()` returns the same rows, for CDP checks. Thunder is heard from its
 * own `distance` and `ears` height (its render holds the air), aloft (over no ground, as the
 * director hears it), from its first sound, under its cap.
 *
 * @module audio/lab
 */
import { AGES } from "../sim/schema.ts"
import { VEHICLE_MODELS, type VehicleModel } from "../sim/vehicles.ts"
import { screenAxes } from "../sim/view.ts"
import { AMBIENT_DB, CABIN, type Cabin, dbToGain, EAR_HEIGHT, gainToDb } from "./acoustics.ts"
import { makeKit } from "./buffers.ts"
import { hear, type Hearing } from "./director/hearing.ts"
import {
  BEDS,
  ENGINE,
  type Level,
  LEVELS,
  MOST_DB,
  OWN_ENGINE_DB,
  rainDb,
  roofDb,
  speechLevel,
  WATER_R_MIN,
  windDb,
} from "./director/levels.ts"
import { type Emitter, makeEmitter } from "./emitter.ts"
import { type Row, SHOTS, type Sound, VOICES } from "./lab-render.ts"
import {
  CRASH,
  type CrashForm,
  crashOf,
  MATERIALS,
  renderRows,
  type Speaking,
  type SpeechForm,
  speechOf,
} from "./lab-rows.ts"
import { makeMixer, type Mixer } from "./mixer.ts"
import type { Situation } from "./speech/types.ts"
import { animalQuiet } from "./synth/animals.ts"
import { crashQuiet } from "./synth/crash/index.ts"
import { engineQuiet } from "./synth/engine.ts"
import { clunkQuiet } from "./synth/impacts.ts"
import { VALLEY_GUSTS } from "./synth/nature.ts"
import { rainQuiet } from "./synth/rain.ts"
import { IN_CLOUD, thunderQuiet } from "./synth/thunder.ts"
import type { Continuous, Kit, OneShot, Shot, Surface, Voice, VoiceFactory, Zone } from "./types.ts"

type Crash = Extract<OneShot, { readonly kind: "crash" }>
type WaterBody = Extract<Continuous, { readonly kind: "water" }>["body"]

/** The screen axes on the ground, with the view in its home seat. */
const { right: SCREEN_RIGHT, up: SCREEN_UP } = screenAxes(0)

// ponytail: water as a point source: the river (the Lucido) and the stream (a 4 m one) at their 2 m bank level + 6 dB, the fountain at
// its 1 m level; the director takes each body's line-source level at the listener from places.
const WATER_DB = { fountain: 65, stream: 61, river: 76 } as const satisfies Record<
  WaterBody,
  number
>

/**
 * A source's calibration; `wet` marks one heard at the ears, with the director's reverb send for it (none); `under`, a bed
 * whose voice plays that many dB under its nominal by itself, which its gain gives back (world.ts); `quiet`, an engine, crash
 * or clunk that plays that many dB under its nominal, which masking counts (vehicles.ts).
 */
type Calibration = Level & {
  readonly wet?: number
  readonly under?: number
  readonly quiet?: number
}

/** How far a thunder is heard from, m: its strike point, or an in-cloud flash's start, by ears `ears` m over the ground under it. */
const rangeOf = (sound: Extract<OneShot, { readonly kind: "thunder" }>): number =>
  Math.hypot(sound.distance, (sound.bolt ? 0 : IN_CLOUD) - sound.ears)

/** `sound`'s calibration: the beds and the own engine and the roof's drumming (from the driver's seat, through no cabin) sound at the ears. */
const sourceOf = (sound: Sound): Calibration =>
  sound.kind === "engine"
    ? sound.inside
      ? { db: OWN_ENGINE_DB, rMin: 1, wet: 0 }
      : {
          ...ENGINE[sound.model],
          quiet: engineQuiet(sound.model, sound.rpm, sound.load, sound.damage),
        }
    : sound.kind === "crash"
      ? { ...LEVELS.crash, quiet: crashQuiet(sound) }
      : sound.kind === "clunk"
        ? { ...LEVELS.clunk, quiet: clunkQuiet(sound.speed) }
        : sound.kind === "talk" || sound.kind === "yell"
          ? speechLevel(sound.kind, sound.speaker)
          : sound.kind === "meow"
            ? { ...LEVELS.meow, quiet: animalQuiet(sound) }
            : sound.kind === "water"
              ? { db: WATER_DB[sound.body], rMin: WATER_R_MIN }
              : sound.kind === "wind"
                ? {
                    db: windDb(sound.strength),
                    rMin: 1,
                    wet: 0,
                    under: BEDS.wind - windDb(sound.strength),
                  }
                : sound.kind === "crickets"
                  ? { db: BEDS.crickets, rMin: 1, wet: 0 }
                  : sound.kind === "rain"
                    ? { db: rainDb(sound.rate), rMin: 1, wet: 0, under: rainQuiet(sound.rate) }
                    : sound.kind === "roof"
                      ? { db: roofDb(sound.rate), rMin: 1, wet: 0, under: rainQuiet(sound.rate) }
                      : sound.kind === "thunder"
                        ? { ...LEVELS.thunder, quiet: thunderQuiet(rangeOf(sound)) }
                        : LEVELS[sound.kind]

/** The listener's side of the page's controls: the source `r` m away towards `side` (−1 screen-left … 1 screen-right), their cabin and street. */
interface Where {
  readonly r: number
  readonly side: number
  readonly cabin: Cabin | undefined
  readonly street: number
}

/** Still ears over open, flat ground; sources stand at the same height, so `r` is the distance. */
const EARS = { x: 0, y: 0, z: EAR_HEIGHT, vx: 0, vy: 0, right: SCREEN_RIGHT } as const

/** How `sound` reaches the listener at `where`, and its calibration. */
const heard = (
  sound: Sound,
  where: Where,
): { readonly hearing: Hearing; readonly source: Calibration } => {
  const source = sourceOf(sound),
    thunder = sound.kind === "thunder" ? rangeOf(sound) : undefined
  const r = thunder ?? (source.wet === undefined ? where.r : 0),
    ahead = Math.sqrt(1 - where.side * where.side)
  const at = {
    x: r * (where.side * SCREEN_RIGHT.x + ahead * SCREEN_UP.x),
    y: r * (where.side * SCREEN_RIGHT.y + ahead * SCREEN_UP.y),
    z: EAR_HEIGHT,
  }
  // The game plays the listener's own engine and the roof's drumming through no cabin (the synths make their own).
  const own = (sound.kind === "engine" && sound.inside) || sound.kind === "roof"
  const hearing = hear({
    ears: EARS,
    source: at,
    db: source.db,
    rMin: source.rMin,
    height: EAR_HEIGHT,
    aloft: source.aloft,
    quiet: source.quiet,
    delta: 0,
    forest: 0,
    ambient: AMBIENT_DB,
    street: where.street,
    cabin: own ? undefined : where.cabin,
  })
  // A one-shot's direct sound under its cap, as the director plays it; thunder's air is in its render, so only the cabin closes it.
  const most = isShot(sound) ? MOST[sound.kind] : undefined
  const gain = Math.min(
    hearing.placement.gain * dbToGain(source.under ?? 0),
    dbToGain(most ?? Infinity),
  )
  const placement = {
    ...hearing.placement,
    gain,
    cutoff: thunder === undefined ? hearing.placement.cutoff : (where.cabin?.cutoff ?? 20000),
    wet: source.wet ?? hearing.placement.wet,
  }
  return {
    hearing: { ...hearing, placement, delay: thunder === undefined ? hearing.delay : 0 },
    source,
  }
}

const SURFACES = Object.keys({
  asphalt: 0,
  stone: 0,
  gravel: 0,
  dirt: 0,
  grass: 0,
  leaves: 0,
} satisfies Record<Surface, 0>)
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
  situation: Object.keys({
    greet: 0,
    chat: 0,
    reply: 0,
    laugh: 0,
    farewell: 0,
    fright: 0,
    shock: 0,
    pity: 0,
    anger: 0,
    surprise: 0,
    helpMan: 0,
    helpWoman: 0,
    helpKid: 0,
    grieve: 0,
    mum: 0,
    dad: 0,
    nonna: 0,
    nonno: 0,
    thief: 0,
  } satisfies Record<Situation, 0>),
  age: AGES,
  species: Object.keys({ robin: 0, tit: 0, blackbird: 0, chaffinch: 0, owl: 0 } satisfies Record<
    Extract<OneShot, { readonly kind: "bird" }>["species"],
    0
  >),
}
/** Slider [min, max, step] per numeric param, or per `kind.param` where kinds differ. */
const RANGES: Readonly<Record<string, readonly [number, number, number] | undefined>> = {
  "tyres.speed": [0, 45, 0.5],
  "scrape.speed": [0, 20, 0.5],
  "crash.speed": [0, 60, 0.5],
  "thud.speed": [0, 20, 0.5],
  "clunk.speed": [0, 6, 0.1],
  rpm: [0, 7000, 10],
  slip: [0, 20, 0.1],
  mass: [0.1, 30, 0.05],
  pitch: [350, 900, 1],
  size: [0.85, 1.15, 0.01],
  rate: [0, 60, 0.5],
  celsius: [-5, 30, 0.5],
  "thunder.distance": [30, 15000, 10],
  "thunder.ears": [-400, 1000, 0.1],
  "thunder.seed": [1, 1000, 1],
}
const UNIT_RANGE = [0, 1, 0.01] as const

/** Each kind's params as first shown; the controls are made from these (numbers: sliders, strings: menus, flags: checkboxes). */
const HELD = {
  engine: {
    kind: "engine",
    model: "panda",
    rpm: 3000,
    load: 0.5,
    inside: false,
    variant: 0.5,
    damage: 0,
    misfire: false,
  },
  tyres: { kind: "tyres", speed: 12, skid: 0, slip: 0, surface: "asphalt", heavy: false },
  scrape: { kind: "scrape", speed: 8, material: "masonry" },
  horn: { kind: "horn", model: "panda" },
  siren: { kind: "siren" },
  beeper: { kind: "beeper" },
  fire: { kind: "fire" },
  water: { kind: "water", body: "stream", flow: 0.6 },
  wind: { kind: "wind", strength: 0.6, forest: 0.3, gusts: VALLEY_GUSTS },
  crickets: { kind: "crickets", density: 0.7, celsius: 15 },
  rain: { kind: "rain", rate: 4, forest: 0.3, built: 0.2, water: 0 },
  roof: { kind: "roof", rate: 4 },
} as const satisfies {
  readonly [K in Continuous["kind"]]: Extract<Continuous, { readonly kind: K }>
}

/** A one-shot panel's controls: its sound's params, the crash's and speech's flattened. */
type Form = Exclude<OneShot, Crash | Speaking> | CrashForm | SpeechForm<"talk"> | SpeechForm<"yell">
const soundOf = (form: Form): OneShot =>
  form.kind === "crash"
    ? crashOf(form)
    : form.kind === "talk" || form.kind === "yell"
      ? speechOf(form)
      : form

const PLAYED = {
  crash: CRASH,
  explosion: { kind: "explosion", surface: "asphalt" },
  thud: { kind: "thud", speed: 8 },
  clunk: { kind: "clunk", speed: 3, heavy: false },
  door: { kind: "door", model: "panda", open: false },
  ignition: { kind: "ignition", model: "panda" },
  honk: { kind: "honk", model: "panda" },
  step: { kind: "step", surface: "stone", run: false, snow: false },
  talk: { kind: "talk", situation: "chat", voice: 0.5, age: "adult", female: false },
  yell: { kind: "yell", situation: "fright", voice: 0.5, age: "adult", female: true },
  scream: { kind: "scream", voice: 0.3 },
  groan: { kind: "groan", voice: 0.3 },
  bell: { kind: "bell", pitch: 600 },
  bird: { kind: "bird", species: "robin" },
  bark: { kind: "bark", big: true },
  moo: { kind: "moo", size: 1 },
  grunt: { kind: "grunt", size: 1 },
  squeal: { kind: "squeal", size: 1 },
  yelp: { kind: "yelp", size: 1 },
  meow: { kind: "meow", size: 1, yowl: false },
  hiss: { kind: "hiss", size: 1 },
  thunder: { kind: "thunder", distance: 1500, ears: EAR_HEIGHT, bolt: true, seed: 1 },
} as const satisfies { readonly [K in OneShot["kind"]]: Extract<Form, { readonly kind: K }> }

/** Whether `sound` is a one-shot (`PLAYED` has a panel for every one-shot kind). */
const isShot = (sound: Sound): sound is OneShot => sound.kind in PLAYED
/** Each one-shot kind's cap, if it has one. */
const MOST: Partial<Record<OneShot["kind"], number>> = MOST_DB

const element = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  parent: HTMLElement,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const node = parent.appendChild(document.createElement(tag))
  if (text !== undefined) node.textContent = text
  return node
}
/** An element of lab.html. */
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- the caller knows the element's type from lab.html
const byId = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T

/** Renders every voice and shot offline, prints the table on the page and returns its rows. */
const renderAll = async (): Promise<ReadonlyArray<Row>> => {
  const rows = await renderRows()
  const table = byId("renders")
  table.replaceChildren()
  const head = element("tr", element("thead", table))
  for (const name of ["sound", "params", "peak", "RMS dBFS", "centroid Hz", "NaN", "s", "flags"])
    element("th", head, name)
  const body = element("tbody", table)
  for (const row of rows) {
    const line = element("tr", body)
    for (const cell of [
      row.name,
      row.params,
      row.peak,
      row.rms,
      row.centroid,
      row.nan ? "NaN" : "",
      row.seconds,
      row.flags,
    ])
      element("td", line, String(cell))
    if (row.flags !== "") line.className = "flagged"
  }
  return rows
}

interface Live {
  readonly ctx: AudioContext
  readonly kit: Kit
  readonly mixer: Mixer
  readonly ready: Promise<unknown>
}
let live: Live | undefined

/** The live context, made on the first button press (autoplay policy), with every shot preparing. */
const wake = (): Live => {
  if (live !== undefined) return live
  const ctx = new AudioContext(),
    kit = makeKit(ctx)
  const ready = Promise.all(
    Object.entries(SHOTS).flatMap(([kind, shot]) =>
      shot.prepare === undefined
        ? []
        : [
            shot
              .prepare(ctx, kit)
              .catch((error: unknown) => console.error(`lab: preparing ${kind} failed`, error)),
          ],
    ),
  )
  return (live = { ctx, kit, mixer: makeMixer(ctx), ready })
}

/** A control per param of `defaults` in `box`; returns a reader of the current params. */
const controls = <F extends { readonly kind: string }>(
  box: HTMLElement,
  defaults: F,
): (() => F) => {
  const readers: Array<readonly [string, () => unknown]> = []
  for (const [name, value] of Object.entries(defaults)) {
    if (name === "kind") continue
    const label = element("label", box, `${name} `)
    if (typeof value === "boolean") {
      const input = Object.assign(element("input", label), { type: "checkbox", checked: value })
      readers.push([name, () => input.checked])
    } else if (typeof value === "string") {
      const select = element("select", label)
      for (const option of OPTIONS[name] ?? [])
        select.add(new Option(option, option, false, option === value))
      readers.push([name, () => select.value])
    } else {
      const [min, max, step] = RANGES[`${defaults.kind}.${name}`] ?? RANGES[name] ?? UNIT_RANGE
      const input = Object.assign(element("input", label), {
        type: "range",
        min: String(min),
        max: String(max),
        step: String(step),
        value: String(value),
      })
      const output = element("output", label, String(value))
      input.addEventListener("input", () => (output.textContent = input.value))
      readers.push([name, () => Number(input.value)])
    }
  }
  return () => ({
    ...defaults,
    ...Object.fromEntries(readers.map(([name, read]) => [name, read()])),
  })
}

/** One panel per sound kind: its controls, a hold or play button, and the readout of how it is heard. */
const panels: Array<{ readonly read: () => Sound; readonly readout: HTMLElement }> = []
/** A held kind: its emitter, and its voice with the model it was built for (engines and horns fix their graph by model). */
interface Held {
  readonly read: () => Continuous
  readonly emitter: Emitter
  voice: Voice<Continuous>
  model: VehicleModel | undefined
}
const holding = new Map<Continuous["kind"], Held>()

const modelOf = (sound: Continuous): VehicleModel | undefined =>
  "model" in sound ? sound.model : undefined
/** A new voice for `sound` into `emitter`. */
const voiceIn = ({ ctx, kit }: Live, emitter: Emitter, sound: Continuous): Voice<Continuous> =>
  (VOICES[sound.kind] as VoiceFactory<Continuous>)({
    ctx,
    out: emitter.input,
    cents: emitter.cents,
    kit,
  })

/** A panel for the sound `soundOf` makes of the params on its controls (from `defaults`). */
const panel = <F extends { readonly kind: string }, S extends Sound>(
  parent: HTMLElement,
  defaults: F,
  soundOf: (form: F) => S,
  label: string,
  press: (read: () => S, button: HTMLButtonElement) => void,
): void => {
  const box = element("fieldset", parent)
  element("legend", box, defaults.kind)
  const form = controls(box, defaults),
    read = () => soundOf(form())
  const button = element("button", box, label)
  button.addEventListener("click", () => press(read, button))
  panels.push({ read, readout: element("output", box) })
}

const where = (): Where => {
  const value = (id: string) => Number(byId<HTMLInputElement>(id).value)
  const cabin = byId<HTMLSelectElement>("cabin").value
  // The slider is logarithmic: 0.5 m … 2 km.
  return {
    r: 0.5 * 4000 ** (value("distance") / 1000),
    side: value("side"),
    cabin: cabin in CABIN ? CABIN[cabin as VehicleModel] : undefined,
    street: value("street"),
  }
}

const describe = (sound: Sound, at: Where): string => {
  const {
    hearing: { placement, level, delay },
    source,
  } = heard(sound, at)
  const gain = placement.gain > 0 ? `gain ${gainToDb(placement.gain).toFixed(1)} dB` : "inaudible"
  return `${Math.round(source.db)} dB(A)${source.wet === undefined ? " @1 m" : " here"} → ${level.toFixed(0)} dB(A) · ${gain} · pan ${placement.pan.toFixed(2)} · lowpass ${Math.round(placement.cutoff)} Hz · send ${placement.wet.toFixed(2)}${delay > 0 ? ` · delay ${Math.round(delay * 1000)} ms` : ""}`
}

const build = (): void => {
  const cabin = byId<HTMLSelectElement>("cabin")
  for (const model of VEHICLE_MODELS) cabin.add(new Option(model, model))
  for (const defaults of Object.values(HELD)) {
    panel(
      byId("held"),
      defaults as Continuous,
      (sound) => sound,
      "Hold",
      (read, button) => {
        const audio = wake(),
          now = audio.ctx.currentTime,
          held = holding.get(defaults.kind)
        if (held !== undefined) {
          held.voice.stop(now)
          held.emitter.release(now)
          holding.delete(defaults.kind)
          button.textContent = "Hold"
          return
        }
        // Silent at first: the next frame's placement fades it in.
        const sound = read(),
          emitter = makeEmitter(audio.ctx, audio.mixer, {
            ...heard(sound, where()).hearing.placement,
            gain: 0,
          })
        holding.set(defaults.kind, {
          read,
          emitter,
          voice: voiceIn(audio, emitter, sound),
          model: modelOf(sound),
        })
        button.textContent = "Release"
      },
    )
  }
  for (const defaults of Object.values(PLAYED)) {
    panel(byId("played"), defaults as Form, soundOf, "Play", (read) => {
      const audio = wake()
      // The first press waits for the shots' renders.
      void audio.ready.then(() => {
        const { ctx, kit, mixer } = audio,
          sound = read(),
          { hearing } = heard(sound, where())
        const emitter = makeEmitter(ctx, mixer, hearing.placement)
        emitter.free(
          (SHOTS[sound.kind] as Shot<OneShot>).play(
            { ctx, out: emitter.input, kit },
            sound,
            ctx.currentTime + hearing.delay,
          ) + 0.1,
        )
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
