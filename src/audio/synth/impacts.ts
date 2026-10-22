/**
 * Vehicle impacts and handling sounds (synthesis.md §4, §6); the crash has its own renderer
 * (`synth/crash/`) and the scrape its own voice (`synth/scrape.ts`). These are rendered once per
 * context with an OfflineAudioContext and normalised; playing one costs a buffer source and a gain.
 *
 * - `thud`: a vehicle hitting a person, kept tasteful: a low thump and a cloth swish, no crunch.
 * - `clunk`: the suspension bottoming out over a hump or on a light landing: the bump stops' thump,
 *   a steel clunk, loose trim ticking.
 * - `door`: per model open (two latch clicks, the seal) and close (thump, latch, panel ring).
 * - `ignition`: the starter whirring with a dip at every compression, then the engine catching:
 *   the real engine synth flaring and settling, fading as the running engine voice takes over.
 *
 * @module audio/synth/impacts
 */
import { VEHICLE_MODELS, VEHICLES, type VehicleModel } from "../../sim/vehicles.ts"
import { bufferOf, loop } from "../buffers.ts"
import type { Kit, OneShot, Shot } from "../types.ts"
import { engine, timbre } from "./engine.ts"
import { bake, jitter, normalise, perContext, pick, playBuffer, strike } from "./graph.ts"

const VARIANTS = 3

/** A baked sound for `ctx`, scaled to peak at `peak`. */
const peaking = (ctx: BaseAudioContext, peak: number) => (samples: Float32Array<ArrayBuffer>): AudioBuffer => {
  normalise([samples], peak)
  return bufferOf(ctx, samples)
}

/** A noise source (fresh offset per render) through a filter, ready to strike. */
const filtered = (ctx: BaseAudioContext, buffer: AudioBuffer, options: BiquadFilterOptions): AudioNode => loop(ctx, buffer).connect(new BiquadFilterNode(ctx, options))

/** A sine sweeping from `from` to `to` Hz over `seconds`. */
const sweep = (ctx: BaseAudioContext, from: number, to: number, seconds: number): OscillatorNode => {
  const osc = new OscillatorNode(ctx, { frequency: from })
  osc.frequency.setValueAtTime(from, 0)
  osc.frequency.exponentialRampToValueAtTime(to, seconds)
  osc.start()
  return osc
}

const renderThud = (rate: number, kit: Kit) => bake(rate, 0.4, (ctx) => {
  const out = ctx.destination
  strike(ctx, sweep(ctx, 120, 60, 0.08), out, 0, 0.9, 0.04)
  strike(ctx, filtered(ctx, kit.brown, { type: "lowpass", frequency: 400 }), out, 0, 0.7, 0.025)
  strike(ctx, filtered(ctx, kit.white, { type: "bandpass", frequency: 2000, Q: 1.5 }), out, 0.004, 0.15, 0.008)
})

const thuds = perContext((ctx, kit) => Promise.all(Array.from({ length: VARIANTS }, () => renderThud(ctx.sampleRate, kit).then(peaking(ctx, 0.5)))))

/** A body hit by a vehicle: full level from 12 m/s. */
export const thud: Shot<Extract<OneShot, { readonly kind: "thud" }>> = {
  prepare: thuds.prepare,
  play: (io, sound, when) => {
    const variants = thuds.get(io.ctx)
    return variants ? playBuffer(io, pick(variants), when, jitter(0.1), Math.max(0.15, Math.min(1, sound.speed / 12))) : when
  }
}

/** An underbody hit slower than this (m/s) is the suspension bottoming out, taken by the bump stops: a clunk, not a crash. */
export const BOTTOMED = 5

/** The clunk's level re its nominal peak at `BOTTOMED`: 6 dB per doubling of speed (its amplitude ∝ v), at least 0.2. */
const clunkGain = (speed: number): number => Math.max(0.2, Math.min(1, speed / BOTTOMED))

/** How far (dB) a clunk at `speed` plays under its nominal peak, so masking counts the level played. */
export const clunkQuiet = (speed: number): number => -20 * Math.log10(clunkGain(speed))

/** The bump stops' rubber thump (a heavy truck's lower), the suspension's steel clunking once, and the body's loose trim ticking. */
const renderClunk = (rate: number, kit: Kit, heavy: boolean) => bake(rate, 0.35, (ctx) => {
  const out = ctx.destination, low = heavy ? 0.65 : 1
  strike(ctx, sweep(ctx, 110 * low * jitter(0.1), 55 * low, 0.07), out, 0, 0.9, 0.035)
  strike(ctx, filtered(ctx, kit.brown, { type: "lowpass", frequency: 300 * low }), out, 0, 0.5, 0.02)
  for (const hz of [330, 760]) {
    const ring = new OscillatorNode(ctx, { frequency: hz * low * jitter(0.15) })
    ring.start()
    strike(ctx, ring, out, 0.006, 0.18, 0.02)
  }
  strike(ctx, filtered(ctx, kit.white, { type: "bandpass", frequency: 1800, Q: 3 }), out, 0.01 + 0.02 * Math.random(), 0.12, 0.005)
})

const clunks = perContext(async (ctx, kit) => {
  const variants = (heavy: boolean) => Promise.all(Array.from({ length: VARIANTS }, () => renderClunk(ctx.sampleRate, kit, heavy).then(peaking(ctx, 0.5))))
  return { light: await variants(false), heavy: await variants(true) }
})

/** The suspension bottoming out: full level from `BOTTOMED`. */
export const clunk: Shot<Extract<OneShot, { readonly kind: "clunk" }>> = {
  prepare: clunks.prepare,
  play: (io, sound, when) => {
    const set = clunks.get(io.ctx)
    return set ? playBuffer(io, pick(sound.heavy ? set.heavy : set.light), when, jitter(0.06), clunkGain(sound.speed)) : when
  }
}

/** One model's door: thump pitch (Hz), panel rings (Hz, decay τ s), and loose-trim rattle level. */
interface DoorSpec {
  readonly thump: number
  readonly rings: ReadonlyArray<readonly [hz: number, tau: number]>
  readonly rattle: number
}

const DOORS = {
  // Light and tinny: a ringing panel.
  panda: { thump: 120, rings: [[600, 0.03]], rattle: 0 },
  // A thin cab door that rattles.
  ape: { thump: 150, rings: [], rattle: 0.5 },
  // Steel cab: two metal rings.
  truck: { thump: 85, rings: [[400, 0.06], [1100, 0.04]], rattle: 0 },
  // Heavy and damped.
  carabinieri: { thump: 70, rings: [], rattle: 0 }
} as const satisfies Record<VehicleModel, DoorSpec>

const renderDoor = (rate: number, kit: Kit, spec: DoorSpec, open: boolean) => bake(rate, open ? 0.25 : 0.45, (ctx) => {
  const out = ctx.destination
  const click = (t: number, frequency: number, peak: number) => strike(ctx, filtered(ctx, kit.white, { type: "bandpass", frequency, Q: 2 }), out, t, peak, 0.0015)
  if (open) {
    click(0, 2500, 0.5)
    click(0.025 + 0.015 * Math.random(), 4000, 0.4)
    strike(ctx, filtered(ctx, kit.brown, { type: "lowpass", frequency: 400 }), out, 0.01, 0.6, 0.008)
    return
  }
  const thump = new OscillatorNode(ctx, { frequency: spec.thump })
  thump.frequency.setTargetAtTime(spec.thump * 0.6, 0, 0.04)
  thump.start()
  strike(ctx, thump, out, 0, 0.9, 0.05)
  strike(ctx, filtered(ctx, kit.brown, { type: "lowpass", frequency: 300 }), out, 0, 0.6, 0.015)
  click(0.012, 3500, 0.3)
  for (const [frequency, tau] of spec.rings) {
    const ring = new OscillatorNode(ctx, { frequency })
    ring.start()
    strike(ctx, ring, out, 0.004, 0.2, tau)
  }
  if (spec.rattle > 0) strike(ctx, filtered(ctx, kit.white, { type: "bandpass", frequency: 1500, Q: 5 }), out, 0.005, spec.rattle, 0.02)
})

const doors = perContext(async (ctx, kit) => {
  const variants = (model: VehicleModel, open: boolean) => Promise.all([0, 1].map(() => renderDoor(ctx.sampleRate, kit, DOORS[model], open).then(peaking(ctx, open ? 0.3 : 0.5))))
  const sets = await Promise.all(VEHICLE_MODELS.map(async (model) => [model, { open: await variants(model, true), close: await variants(model, false) }] as const))
  return new Map(sets)
})

/** A car door opening or closing. */
export const door: Shot<Extract<OneShot, { readonly kind: "door" }>> = {
  prepare: doors.prepare,
  play: (io, sound, when) => {
    const set = doors.get(io.ctx)?.get(sound.model)
    return set ? playBuffer(io, pick(sound.open ? set.open : set.close), when, jitter(0.04)) : when
  }
}

/**
 * Starter cranking per model: seconds until the engine catches, and the crank speed (rpm). The
 * director starts holding the engine voice about `seconds` after playing `ignition`.
 */
export const CRANK = {
  panda: { seconds: 0.8, rpm: 220 },
  ape: { seconds: 0.4, rpm: 300 },
  truck: { seconds: 1.5, rpm: 180 },
  carabinieri: { seconds: 0.6, rpm: 260 }
} as const satisfies Record<VehicleModel, { readonly seconds: number; readonly rpm: number }>

/** The starter's level against the catch (the model's engine voice at its own nominal level). */
const STARTER = 0.15
/** How long the catch is heard before the running engine voice carries on, s. */
const CATCH = 0.9

const renderIgnition = (rate: number, kit: Kit, model: VehicleModel) => bake(rate, CRANK[model].seconds + CATCH, (ctx) => {
  const out = ctx.destination, crank = CRANK[model], spec = timbre(model), { gearbox } = VEHICLES[model]
  const starter = new GainNode(ctx, { gain: 0 })
  starter.gain.setValueAtTime(0, 0)
  starter.gain.linearRampToValueAtTime(STARTER, 0.02)
  starter.gain.setValueAtTime(STARTER, crank.seconds)
  starter.gain.setTargetAtTime(0, crank.seconds, 0.02)
  starter.connect(out)
  // The motor's geared whine dips, and the engine lumps, at every compression stroke.
  const motor = new OscillatorNode(ctx, { type: "square", frequency: 140 }), lump = new OscillatorNode(ctx, { frequency: 50 })
  const compression = new OscillatorNode(ctx, { frequency: (crank.rpm / 60) * spec.pulses })
  // Both envelopes stay ≥ 0, so they pulse once per compression (one centred on 0 would ring-modulate at twice the rate).
  const whine = new GainNode(ctx, { gain: 0.6 }), lumps = new GainNode(ctx, { gain: 0.3 })
  motor.frequency.setTargetAtTime(170, 0, 0.15)
  compression.connect(new GainNode(ctx, { gain: 0.4 })).connect(whine.gain)
  compression.connect(new GainNode(ctx, { gain: 0.3 })).connect(lumps.gain)
  motor.connect(new BiquadFilterNode(ctx, { type: "bandpass", frequency: 900, Q: 1 })).connect(whine).connect(starter)
  lump.connect(lumps).connect(starter)
  for (const source of [motor, lump, compression]) source.start()
  // The catch: the engine flares on a blip of throttle (70 % of the way to its launch revs, at 70 % load) and settles toward idle.
  const cents = new ConstantSourceNode(ctx, { offset: 0 }), caught = new GainNode(ctx)
  caught.gain.setTargetAtTime(0, crank.seconds + CATCH * 0.55, 0.12)
  caught.connect(out)
  cents.start()
  const running = engine({ ctx, out: caught, cents, kit })
  for (let t = crank.seconds; t < crank.seconds + CATCH; t += 1 / 60) {
    const since = t - crank.seconds, blip = since < 0.12 ? 0.7 : 0.7 * Math.exp(-(since - 0.12) / 0.25)
    running.update({ kind: "engine", model, rpm: spec.idle + blip * (gearbox.launch - spec.idle), load: blip, inside: false, variant: 0.5, damage: 0, misfire: false }, t)
  }
})

const ignitions = perContext(async (ctx, kit) => new Map(await Promise.all(
  VEHICLE_MODELS.map(async (model) => [model, peaking(ctx, 0.4)(await renderIgnition(ctx.sampleRate, kit, model))] as const)
)))

/** The starter until the engine catches (`CRANK` seconds), then the catch fading under the running engine. */
export const ignition: Shot<Extract<OneShot, { readonly kind: "ignition" }>> = {
  prepare: ignitions.prepare,
  play: (io, sound, when) => {
    const buffer = ignitions.get(io.ctx)?.get(sound.model)
    return buffer ? playBuffer(io, buffer, when) : when
  }
}
