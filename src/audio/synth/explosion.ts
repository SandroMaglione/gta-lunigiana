/**
 * A burning wreck blowing up, rendered on demand in pure TypeScript with the crash's band-noise engine
 * and struck modes (crash/dsp.ts), once per params object, so the director's echoes replay the same
 * render. In time: the blast wave's crack (a Friedlander pulse and a few ms of bright noise); the boom
 * of the fuel going up, broadband noise loudest at 125 Hz, and its thump, a sine falling from 60–75 to
 * 28–34 Hz, saturated so its harmonics carry it on small speakers, over a burst of lowpassed brown
 * noise; the fireball's roar, swelling and billowing over about 1.5 s while its whoosh sweeps up and
 * back down; and debris raining down 0.3–2.5 s later, metal clinks and dull thuds landing on
 * `surface`, thinning. Every render peaks at the nominal 0.5; how loud an explosion is is the
 * director's (`LEVELS.explosion`).
 *
 * @module audio/synth/explosion
 */
import type { OneShot, Shot } from "../types.ts"
import {
  bandLoops,
  BANDS,
  between,
  finish,
  type Mix,
  noiseFor,
  playNoise,
  power,
  powerLaw,
  puff,
  type Spectrum,
} from "./crash/dsp.ts"
import { land } from "./crash/textures.ts"
import { rendered, renderRate } from "./graph.ts"

/** An explosion's params. */
type Explosion = Extract<OneShot, { readonly kind: "explosion" }>

/** `db` per octave band as power shares summing to 1, so a layer's top is its total power. */
const shares = (db: Spectrum): Spectrum => {
  const p = power(db),
    sum = p.reduce((a, b) => a + b, 0)
  return p.map((v) => v / sum)
}
// Spectra, dB per octave band 31.5 Hz … 16 kHz.
/** The blast wave's crack: brightest at 2–8 kHz. */
const CRACK = shares([-40, -30, -22, -14, -8, -4, -1, 0, 0, -4])
/** The fuel going up: broadband, loudest at 125 Hz, 14 dB down by 2 kHz. */
const BOOM = shares([-6, -1, 0, -2, -5, -9, -14, -21, -29, -40])
/** The fuel going up: brown noise lowpassed over 125 Hz. */
const RUMBLE = shares([0, -1, -5, -12, -21, -31, -41, -51, -99, -99])
/** A metal piece's click under its ring. */
const CLINK = power([-99, -99, -99, -26, -14, -5, 0, -4, -14, -28])
/** A heavy piece (a wheel, a door) landing: a dull thud at 125–250 Hz. */
const THUD = power([-20, -6, 0, -2, -8, -16, -26, -36, -46, -60])

/** The longest render, s: the roar's tail and the last bounces of the debris end inside it. */
const LENGTH = 3.6
/** Every render's peak: the nominal. */
const NOMINAL = 0.5
/**
 * TUNED: each layer's top in the render's own units, before it is scaled to NOMINAL: the crack's pulse (amplitude) and noise
 * (power), the boom (power), the thump's sine (amplitude) and rumble (power), the roar at its swell (power), the loudest piece of
 * debris (power).
 */
const TOP = {
  pulse: 0.6,
  crack: 0.15,
  boom: 0.3,
  thump: 0.7,
  rumble: 0.2,
  roar: 0.18,
  debris: 0.04,
} as const
/**
 * TUNED: the whole blast is driven into a soft clip, tanh(SATURATE·x / its peak), which presses its loudest few dB together (no
 * release, so nothing pumps), so it plays dense at the nominal peak and leaves the master limiter little to take.
 */
const SATURATE = 2
/** The thump's saturation: tanh(DRIVE·x), so its 3rd and 5th harmonics (90–375 Hz) carry the boom where a small speaker has no 30–70 Hz. */
const DRIVE = 1.8
/**
 * The roar: the order of its swell (its amplitude x^k·e^(k(1 − x)), x = t over the peak's time), its spread around its sweeping
 * centre (octaves, one sigma), and how far its billowing swings it (one sigma, nepers of amplitude) and how fast (Hz).
 */
const ROAR = { order: 0.6, spread: 1.1, billow: 0.2, rate: 8 } as const

/** A standard normal draw (Box–Muller). */
const gauss = (random: () => number): number =>
  Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random())

/** The blast wave: a Friedlander pulse (1 − t/T)·e^(−t/T), T its 3–6 ms positive phase (a jump, then the suction, no net push), and a few ms of bright noise. */
const crack = (mix: Mix): void => {
  const { out, sampleRate, random } = mix,
    positive = between(random, 0.003, 0.006)
  for (let i = 0; i < Math.min(out.length, 16 * positive * sampleRate); i++) {
    const x = i / sampleRate / positive
    out[i]! += TOP.pulse * (1 - x) * Math.exp(-x)
  }
  puff(mix, 0, 0.0002, between(random, 0.0015, 0.003), TOP.crack, CRACK)
}

/**
 * The fuel going up: the boom, up in 3–6 ms and its power falling with a time constant of 80–140 ms; the thump, a sine falling from
 * 60–75 to 28–34 Hz (its glide's time constant 60–120 ms), up in 3–6 ms, decaying with a time constant of 120–200 ms, saturated;
 * and a burst of rumble.
 */
const thump = (mix: Mix): void => {
  const { out, sampleRate, random } = mix
  puff(mix, 0, between(random, 0.003, 0.006), between(random, 0.08, 0.14), TOP.boom, BOOM)
  const from = between(random, 60, 75),
    to = between(random, 28, 34),
    glide = Math.exp(-1 / (between(random, 0.06, 0.12) * sampleRate))
  const rise = Math.round(between(random, 0.003, 0.006) * sampleRate),
    decay = between(random, 0.12, 0.2),
    fall = Math.exp(-1 / (decay * sampleRate))
  let phase = 0,
    above = from - to,
    level = TOP.thump / Math.tanh(DRIVE)
  for (let i = 0; i < Math.min(out.length, rise + 7 * decay * sampleRate); i++) {
    out[i]! +=
      (i < rise ? Math.sin((Math.PI / 2) * (i / rise)) ** 2 : 1) *
      level *
      Math.tanh(DRIVE * Math.sin(phase))
    phase += (2 * Math.PI * (to + above)) / sampleRate
    above *= glide
    if (i >= rise) level *= fall
  }
  puff(mix, 0, between(random, 0.005, 0.01), between(random, 0.1, 0.16), TOP.rumble, RUMBLE)
}

/**
 * The fireball: band noise swelling to its peak at 0.18–0.28 s and dying away (about 16 dB down by 1.5 s, 35 by 2.5 s), billowing
 * (lowpassed Gaussian noise swinging its level), its centre whooshing from 110–150 Hz up to 450–700 Hz at 0.12–0.2 s and back down.
 */
const roar = (mix: Mix): void => {
  const {
    noise: { power: bands, rate },
    random,
  } = mix
  const swell = between(random, 0.18, 0.28),
    whoosh = between(random, 0.12, 0.2),
    low = Math.log2(between(random, 110, 150)),
    high = Math.log2(between(random, 450, 700))
  const keep = Math.exp((-2 * Math.PI * ROAR.rate) / rate),
    fresh = Math.sqrt(1 - keep * keep),
    weights = new Float64Array(BANDS.length)
  for (let c = 0, billow = 0; c < bands[0]!.length; c++) {
    const t = c / rate,
      x = t / swell,
      w = t / whoosh,
      centre = low + (high - low) * w * Math.exp(1 - w)
    billow = keep * billow + fresh * gauss(random)
    const top =
      TOP.roar * (x * Math.exp(1 - x)) ** (2 * ROAR.order) * Math.exp(2 * ROAR.billow * billow)
    let sum = 0
    for (let b = 0; b < BANDS.length; b++)
      sum += weights[b] = Math.exp(-0.5 * ((Math.log2(BANDS[b]!) - centre) / ROAR.spread) ** 2)
    for (let b = 0; b < BANDS.length; b++) bands[b]![c]! += (top * weights[b]!) / sum
  }
}

/** 24–40 pieces landing on `surface` from 0.3 to 2.5 s, most early, the later ones smaller: 60 % metal clinking at 1–5 kHz (ringing 30–120 ms), the rest dull thuds. */
const debris = (mix: Mix, surface: Explosion["surface"]): void => {
  const { random } = mix
  for (let i = Math.round(between(random, 24, 40)); i > 0; i--) {
    const late = random() ** 1.7,
      t = 0.3 + 2.2 * late,
      level = TOP.debris * (1 - 0.6 * late) * powerLaw(random(), 1.5, 0.01, 1)
    if (random() < 0.6) {
      const hz = between(random, 1000, 5000),
        eta = 2.2 / (hz * between(random, 0.03, 0.12))
      land(
        mix,
        t,
        surface,
        level,
        CLINK,
        [
          [hz, eta],
          [hz * between(random, 1.3, 2.4), eta],
        ],
        0.5,
      )
    } else
      land(
        mix,
        t,
        surface,
        3 * level,
        THUD,
        [[between(random, 80, 200), between(random, 0.05, 0.1)]],
        0.4,
      )
  }
}

/** `sound` rendered at `sampleRate`, every choice drawn from `random` (deterministic for a seeded one), peaking at NOMINAL. */
export const renderExplosion = (
  sound: Explosion,
  sampleRate: number,
  random: () => number,
): Float32Array<ArrayBuffer> => {
  const n = Math.ceil(LENGTH * sampleRate),
    out = new Float32Array(n),
    mix: Mix = { out, noise: noiseFor(n, sampleRate), sampleRate, random, floor: 1e-6 }
  crack(mix)
  thump(mix)
  roar(mix)
  debris(mix, sound.surface)
  playNoise(out, mix.noise, random, mix.floor)
  let peak = 0
  for (const v of out) peak = Math.max(peak, Math.abs(v))
  for (let i = 0; i < n; i++) out[i] = Math.tanh((SATURATE * out[i]!) / peak)
  return finish(out, NOMINAL / Math.tanh(SATURATE), sampleRate)
}

/** A burning wreck blowing up. */
export const explosion: Shot<Explosion> = {
  // The noise loops, made once per sample rate (the crash's too), so the first blast renders at its usual cost.
  prepare: (ctx) => Promise.resolve(void bandLoops(renderRate(ctx))),
  play: rendered(renderExplosion),
}
