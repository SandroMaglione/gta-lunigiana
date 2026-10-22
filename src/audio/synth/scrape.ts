/**
 * A car grinding along a wall, by what the wall is made of (synthesis.md §6.7, critique §5.4).
 *
 * - The surface: a pure-TS loop of the wall as the body rides along it at `V_REF` (micro-impacts
 *   with power-law heights over a rough bed, the level dipping at joints, damped knocks at posts,
 *   splices, glazing bars and chips), played at v / `V_REF` like a phonograph: every bump, joint
 *   and post passes at the car's speed (stones at v / 0.3 m, guard-rail posts at v / 2 m).
 * - The car's panels: 8–12 narrow bandpasses (Q 60–120) at plate frequencies drawn fresh per
 *   scrape over 150–3000 Hz, rung by the surface; a soft earth bank rings none.
 * - The wall's own layer: the guard rail's 12 high-Q bands (Q 300–500, half near its 176 / 428 /
 *   771 Hz bands) and a stick-slip squeal below about 3 m/s; a sheet's wobbling ring; a trunk's
 *   short wood bank; a greenhouse's rare shard screech; plain grit and chips on masonry, stone and rock.
 *
 * The squeal and the screech open with the stick-slip judder (the gust signal sped up 40×), which
 * also shakes the whole grind. Loudness follows roughness noise, +4.5 dB per doubling of speed
 * (v^0.75, Yokoi & Nakai), full from 12 m/s, where every material peaks near 0.5.
 *
 * @module audio/synth/scrape
 */
import { bufferOf, loop, noiseSamples, smoothstep } from "../buffers.ts"
import type { Continuous, Material, VoiceFactory } from "../types.ts"
import { fadeOut, glide } from "./graph.ts"

type ScrapeSound = Extract<Continuous, { readonly kind: "scrape" }>

/** A surface loop is `LENGTH` m of wall ridden at `V_REF` m/s (3.2 s): a whole number of 2 m post spans and 4 m rail splices. */
const V_REF = 10, LENGTH = 32
/** Each loop's RMS. */
export const LOOP_RMS = 0.25

/** Damped modes struck along the wall. */
interface Knocks {
  /** Mean spacing, m: `regular` ones stand exactly that far apart (posts), the rest fall at random (chips). */
  readonly every: number
  readonly regular: boolean
  /** Each knock rings `modes` modes drawn over `hz`, loss factor `eta`, struck at up to `level` × the bed's RMS. */
  readonly hz: readonly [number, number]
  readonly modes: number
  readonly eta: number
  readonly level: number
}

/** A wall's surface as the car's body rides along it at `V_REF`: a rough pink bed (equal energy per octave, as measured), grit, joints and knocks. */
export interface Texture {
  /** Grit: micro-impacts per metre, their heights' power law (count over h ∝ h^−gamma, 10:1), their widths s, the tallest's peak re the bed's RMS. */
  readonly bumps: number
  readonly gamma: number
  readonly width: readonly [number, number]
  readonly grit: number
  /** Where the level dips (stone passes, sheet ribs): spacing m, ± share of it, depth 0…1 (0.68: 10 dB from face to joint). */
  readonly joints?: { readonly every: number; readonly jitter: number; readonly depth: number }
  readonly knocks: ReadonlyArray<Knocks>
}

/** Adds a mode at `hz` struck with `amp` at sample `i0` into the loop `out`, ringing to −60 dB and wrapping past its end. */
const ring = (out: Float32Array, i0: number, hz: number, eta: number, amp: number, sampleRate: number): void => {
  const n = out.length, w = (2 * Math.PI * hz) / sampleRate, decay = Math.exp((-Math.PI * hz * eta) / sampleRate)
  const len = Math.min(n, Math.ceil((2.2 / (hz * eta)) * sampleRate))
  // A damped sine by its two-term recurrence: no sin() per sample.
  const c = 2 * decay * Math.cos(w), k2 = decay * decay
  let prev = 0, cur = amp * Math.sin(w)
  for (let j = 0, i = i0 % n; j < len; j++, i = i + 1 === n ? 0 : i + 1) {
    out[i]! += cur
    const next = c * cur - k2 * prev
    prev = cur
    cur = next
  }
}

/** `samples` scaled in place to RMS `to` (left silent if silent). */
const toRms = (samples: Float32Array, to: number): Float32Array => {
  let energy = 0
  for (const v of samples) energy += v * v
  const gain = energy > 0 ? to / Math.sqrt(energy / samples.length) : 0
  for (let i = 0; i < samples.length; i++) samples[i]! *= gain
  return samples
}

/** `texture`'s loop at `sampleRate`, RMS `LOOP_RMS`; everything ringing past the end carries on at the start, so it loops seamlessly. */
export const surfaceLoop = (texture: Texture, sampleRate: number, random: () => number = Math.random): Float32Array<ArrayBuffer> => {
  const n = Math.round((LENGTH / V_REF) * sampleRate), out = new Float32Array(n), metre = n / LENGTH
  const floor = 0.1 ** texture.gamma
  // Each bump rides up and down: one sine period (no DC), its height drawn from the power law.
  for (let x = -Math.log(1 - random()) / texture.bumps; x < LENGTH; x += -Math.log(1 - random()) / texture.bumps) {
    const h = 0.1 * (1 - random() * (1 - floor)) ** (-1 / texture.gamma), sign = random() < 0.5 ? -1 : 1
    const [w0, w1] = texture.width, len = Math.max(2, Math.round((w0 + (w1 - w0) * random()) * sampleRate)), i0 = Math.floor(x * metre)
    for (let j = 0; j < len; j++) out[(i0 + j) % n]! += sign * h * Math.sin((2 * Math.PI * j) / len)
  }
  const bed = toRms(noiseSamples("pink", n, sampleRate, random), 1)
  for (let i = 0; i < n; i++) out[i]! = texture.grit * out[i]! + bed[i]!
  for (const k of texture.knocks) {
    const count = Math.round(LENGTH / k.every)
    for (let c = 0; c < count; c++) {
      const x = k.regular ? (c + 0.5) * k.every : random() * LENGTH, amp = k.level * (0.5 + 0.5 * random())
      for (let m = 0; m < k.modes; m++) ring(out, Math.floor(x * metre), k.hz[0] + (k.hz[1] - k.hz[0]) * random(), k.eta, amp / k.modes, sampleRate)
    }
  }
  if (texture.joints !== undefined) {
    // Whole joints over the loop, jittered then scaled to fit it exactly; the level dips at each (a raised cosine).
    const { every, jitter, depth } = texture.joints
    const spans = Array.from({ length: Math.round(LENGTH / every) }, () => 1 + jitter * (2 * random() - 1))
    const scale = n / spans.reduce((sum, s) => sum + s, 0)
    let at = 0
    for (const span of spans) {
      const start = at, len = span * scale
      at += len
      for (let i = Math.round(start); i < Math.min(n, Math.round(at)); i++) out[i]! *= 1 - depth * 0.5 * (1 + Math.cos((2 * Math.PI * (i - start)) / len))
    }
  }
  toRms(out, LOOP_RMS)
  return out
}

/** A range of `hz` ± `spread`. */
const near = (hz: number, spread: number): readonly [number, number] => [hz * (1 - spread), hz * (1 + spread)]
/** `count` copies of a range. */
const times = (count: number, range: readonly [number, number]): ReadonlyArray<readonly [number, number]> => Array.from({ length: count }, () => range)

/** How one material grinds. */
interface Layer {
  readonly texture: Texture
  /** The contact noise heard directly: its band, Hz, and gain. */
  readonly band: readonly [number, number]
  readonly direct: number
  /** How hard the surface drives the car's panels. */
  readonly panels: number
  /** The wall's own modes, one drawn per range per scrape, at Q drawn in `q`; `wobble` cents of slow detune (a sheet flexing). */
  readonly ring?: { readonly hz: ReadonlyArray<readonly [number, number]>; readonly q: readonly [number, number]; readonly gain: number; readonly wobble: number }
  /**
   * Stick-slip: a pulse train at a rate drawn over `hz`, heard through two of its harmonics in `bands` (the panel modes it locks
   * into), open while the judder is over `over` (−1 always … 1 never), fading out above `below` m/s (absent: at any speed).
   */
  readonly squeal?: { readonly hz: readonly [number, number]; readonly bands: readonly [number, number]; readonly over: number; readonly gain: number; readonly below?: number }
  /** The layer's gain: TUNED by browser renders so it peaks near 0.5 at full speed. */
  readonly gain: number
}

/** Chips knocked off masonry and stone, pebbles off rock (synthesis.md §2.8: 3 modes at 500–2500 Hz, η 0.03). */
const chips = (every: number, hz: readonly [number, number] = [500, 2500]): Knocks => ({ every, regular: false, hz, modes: 3, eta: 0.03, level: 2 })

/** Rendered plaster: fine dense grit, a few chips. */
const PLASTER = {
  texture: { bumps: 120, gamma: 1.7, width: [0.0001, 0.0005], grit: 3, knocks: [chips(4)] },
  band: [100, 2500], direct: 1, panels: 0.5, gain: 0.33
} as const satisfies Layer

/** Every material's grind. TUNED in Chrome against the scrape references (centroid, band flatness, octaves) and to peak near 0.5 at 12 m/s. */
export const LAYERS = {
  masonry: PLASTER,
  // A body sliding on the road or paving grinds like a rendered wall.
  road: PLASTER,
  // Rubble stone: the level swings 10 dB at every 0.3 m stone (a 33 Hz buzz at 10 m/s), chips.
  stone: {
    texture: { bumps: 50, gamma: 1.5, width: [0.0001, 0.001], grit: 4, joints: { every: 0.3, jitter: 0.2, depth: 0.68 }, knocks: [chips(1.5)] },
    band: [100, 2200], direct: 1, panels: 0.5, gain: 0.23
  },
  // A cliff: harsh, heavy-tailed grit, irregular faces, pebbles.
  rock: {
    texture: { bumps: 60, gamma: 1.2, width: [0.0001, 0.001], grit: 5, joints: { every: 0.4, jitter: 0.5, depth: 0.5 }, knocks: [chips(1.5, [800, 3000])] },
    band: [100, 3000], direct: 1, panels: 0.5, gain: 0.17
  },
  // Soft dirt: a pink hiss band, no ring.
  earth: {
    texture: { bumps: 300, gamma: 2, width: [0.001, 0.003], grit: 1.5, knocks: [] },
    band: [800, 3000], direct: 1, panels: 0, gain: 0.61
  },
  // Bark plates every 10 cm or so, a short wood bank (Farnell's 62.5…790 Hz, η 0.04–0.06).
  tree: {
    texture: { bumps: 40, gamma: 1.5, width: [0.0005, 0.002], grit: 2, joints: { every: 0.1, jitter: 0.5, depth: 0.4 }, knocks: [] },
    band: [100, 1800], direct: 1, panels: 0.3,
    ring: { hz: [62.5, 125, 250, 395, 560, 790].map((hz) => near(hz, 0.1)), q: [17, 25], gain: 1, wobble: 0 },
    gain: 0.34
  },
  // A W-beam: smooth, a post thump every 2 m and a splice click every 4 m, the rail's own long ring, and a squeal when slow.
  rail: {
    texture: {
      bumps: 8, gamma: 1.5, width: [0.0002, 0.001], grit: 2,
      knocks: [{ every: 2, regular: true, hz: [120, 700], modes: 3, eta: 0.03, level: 6 }, { every: 4, regular: true, hz: [2000, 4000], modes: 2, eta: 0.01, level: 2 }]
    },
    band: [150, 3000], direct: 0.5, panels: 1,
    ring: { hz: [...times(2, near(176, 0.06)), ...times(2, near(428, 0.06)), ...times(2, near(771, 0.06)), ...times(6, [80, 1500])], q: [300, 500], gain: 4, wobble: 0 },
    squeal: { hz: [200, 900], bands: [1000, 3000], over: 0, gain: 3, below: 3 },
    gain: 0.27
  },
  // Profiled cladding: a rib every 20 cm, the thin sheet's big wobbling ring.
  sheet: {
    texture: { bumps: 15, gamma: 1.5, width: [0.0002, 0.001], grit: 2, joints: { every: 0.2, jitter: 0, depth: 0.5 }, knocks: [] },
    band: [150, 3000], direct: 0.7, panels: 0.5,
    ring: { hz: times(10, [150, 2000]), q: [150, 300], gain: 3, wobble: 25 },
    gain: 0.45
  },
  // Greenhouse panes: smooth glass, a glazing bar every 0.8 m, now and then a shard's screech.
  glass: {
    texture: { bumps: 10, gamma: 1.5, width: [0.0001, 0.0004], grit: 2, knocks: [{ every: 0.8, regular: true, hz: [2000, 5000], modes: 2, eta: 0.01, level: 1.5 }] },
    band: [800, 6000], direct: 1, panels: 0.5,
    squeal: { hz: [300, 700], bands: [3000, 6000], over: 0.6, gain: 2 },
    gain: 0.36
  }
} as const satisfies Record<Material, Layer>

/** Full grinding from this speed, m/s; the loop's rate bounds. */
const FULL = 12, RATE: readonly [number, number] = [0.2, 2.5]
/** The car's panels: how many, over what band (Hz), at what Q. */
const PANELS = { count: [8, 12], hz: [150, 3000], q: [60, 120] } as const

/** Roughness noise: +4.5 dB per doubling of speed (v^0.75), 1 from `FULL` m/s; 0 for NaN. */
export const scrapeGain = (speed: number): number => Math.min(1, Math.max(0, speed) / FULL) ** 0.75 || 0

const surfaces = new WeakMap<BaseAudioContext, Map<Material, AudioBuffer>>()

/** `material`'s surface loop for `ctx`, made on first use. */
const surfaceOf = (ctx: BaseAudioContext, material: Material): AudioBuffer => {
  // ponytail: computed on the main thread the first time a material is scraped (a few ms, once per material and context); bake ahead if it ever hitches.
  const made = surfaces.get(ctx) ?? new Map<Material, AudioBuffer>()
  surfaces.set(ctx, made)
  let buffer = made.get(material)
  if (buffer === undefined) {
    buffer = bufferOf(ctx, surfaceLoop(LAYERS[material].texture, ctx.sampleRate))
    made.set(material, buffer)
  }
  return buffer
}

/** A value drawn over `range`. */
const draw = ([lo, hi]: readonly [number, number]): number => lo + (hi - lo) * Math.random()
/** A value drawn over `range` evenly per octave. */
const drawLog = ([lo, hi]: readonly [number, number]): number => lo * (hi / lo) ** Math.random()

/** Grinding along a wall at `speed` m/s, on `material`; a new material fades its layer in over the old one. */
export const scrape: VoiceFactory<ScrapeSound> = ({ ctx, out, cents, kit }) => {
  const output = new GainNode(ctx, { gain: 0 }), grind = new GainNode(ctx, { gain: 1 })
  grind.connect(output).connect(out)
  // Stick-slip: the gust signal, sped up 40×, shakes the grind at 1–20 Hz.
  const judder = loop(ctx, kit.gust, 40)
  judder.connect(new GainNode(ctx, { gain: 0.5 })).connect(grind.gain)
  /** A bandpass at `hz`, Q `q`, following the Doppler shift (white noise has no pitch: Doppler moves the bands it rings through). */
  const band = (hz: number, q: number, type: BiquadFilterType = "bandpass"): BiquadFilterNode => {
    const filter = new BiquadFilterNode(ctx, { type, frequency: hz, Q: q })
    cents.connect(filter.detune)
    return filter
  }
  // The car's panels, drawn fresh for this scrape; narrow bands pass little, so the bank is made up by 6 (TUNED).
  const panels = new GainNode(ctx), panelOut = new GainNode(ctx, { gain: 6 })
  panelOut.connect(grind)
  for (let i = Math.round(draw(PANELS.count)); i > 0; i--) panels.connect(band(drawLog(PANELS.hz), draw(PANELS.q))).connect(panelOut)

  /** One material's nodes: its surface (and squeal) at the layer's level, heard directly, through the car's panels and the wall's own ring. */
  const layerOf = (material: Material, now: number) => {
    const spec: Layer = LAYERS[material], level = new GainNode(ctx, { gain: 0 })
    level.gain.setTargetAtTime(spec.gain, now, 0.05)
    const surface = loop(ctx, surfaceOf(ctx, material))
    cents.connect(surface.detune)
    surface.connect(level)
    level.connect(band(spec.band[0], 0.7, "highpass")).connect(band(spec.band[1], 0.7, "lowpass")).connect(new GainNode(ctx, { gain: spec.direct })).connect(grind)
    if (spec.panels > 0) level.connect(new GainNode(ctx, { gain: spec.panels })).connect(panels)
    const sources: Array<AudioScheduledSourceNode> = [surface]
    const own = spec.ring
    if (own !== undefined) {
      const rung = new GainNode(ctx, { gain: own.gain })
      rung.connect(grind)
      const modes = own.hz.map((range) => band(draw(range), draw(own.q)))
      for (const mode of modes) level.connect(mode).connect(rung)
      if (own.wobble > 0) {
        // The sheet flexes: its modes drift together by ± `wobble` cents at 3–6 Hz.
        const wobble = new OscillatorNode(ctx, { frequency: 3 + 3 * Math.random() }), depth = new GainNode(ctx, { gain: own.wobble })
        wobble.connect(depth)
        for (const mode of modes) depth.connect(mode.detune)
        wobble.start()
        sources.push(wobble)
      }
    }
    let squeal: { readonly open: GainNode; readonly below: number | undefined; readonly gain: number } | undefined
    if (spec.squeal !== undefined) {
      const { hz, bands, over, gain, below } = spec.squeal
      // The pulse train through narrow bands on two of its harmonics, into the layer like the surface; the judder over `over` opens it.
      const rate = draw(hz), pulses = new OscillatorNode(ctx, { type: "sawtooth", frequency: rate }), gate = new GainNode(ctx, { gain: 0 })
      cents.connect(pulses.detune)
      for (let i = 0; i < 2; i++) pulses.connect(band(rate * Math.max(1, Math.round(draw(bands) / rate)), 40)).connect(gate)
      gate.connect(level)
      const curve = new Float32Array(256).map((_, i) => Math.max(0, ((i / 255) * 2 - 1 - over) / (1 - over)))
      const open = new GainNode(ctx, { gain: 0 })
      judder.connect(new WaveShaperNode(ctx, { curve })).connect(open).connect(gate.gain)
      pulses.start()
      sources.push(pulses)
      squeal = { open, below, gain }
    }
    return {
      sources,
      update: (speed: number, now: number, jump: boolean) => {
        glide(surface.playbackRate, Math.min(RATE[1], Math.max(RATE[0], speed / V_REF)), now, jump)
        if (squeal !== undefined) glide(squeal.open.gain, squeal.gain * (squeal.below === undefined ? 1 : 1 - smoothstep(squeal.below - 1, squeal.below + 1, speed)), now, jump)
      },
      stop: (now: number) => fadeOut(level, sources, now)
    }
  }

  let held: { readonly material: Material; readonly layer: ReturnType<typeof layerOf> } | undefined
  return {
    update: (sound, now) => {
      const speed = Math.max(0, sound.speed) || 0, fresh = held?.material !== sound.material
      if (held === undefined || fresh) {
        held?.layer.stop(now)
        held = { material: sound.material, layer: layerOf(sound.material, now) }
      }
      glide(output.gain, scrapeGain(speed), now, false)
      held.layer.update(speed, now, fresh)
    },
    stop: (now) => fadeOut(output, [judder, ...(held?.layer.sources ?? [])], now)
  }
}
