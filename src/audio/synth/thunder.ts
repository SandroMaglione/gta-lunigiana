/**
 * Thunder, rendered in pure TypeScript from Few's "string of pearls" (1969): the lightning channel
 * is a tortuous chain of straight segments (Hill 1968: 5–70 m long, turning about 16° at each), and
 * every couple of metres of it sends one N-wave (its shock, relaxed), heard after its own travel
 * time, 1/r fainter. Segments across the line of sight add up into claps, the rest smears into
 * rumble, and the far end of the channel arrives seconds after the near one: a bolt nearby cracks
 * (its foot, a run of short N-waves) and booms, one far away only rumbles, low and slow to swell; an
 * in-cloud flash has no foot to crack. The air is one lowpass that closes as the render goes on,
 * since what arrives t s after the first sound travelled `c·t` m further.
 *
 * Its loudest clap peaks at the nominal 0.5 before the air, which then takes from a far one what it
 * takes (`thunderQuiet`); the distance and the ears' height over the flash's ground move its shape
 * (onset, length, spectrum: a ridge hears a valley bolt's trunk before its foot), the director its
 * level (`LEVELS.thunder`, the cap `MOST_DB.thunder`). Rendered once per params object
 * (`thunderRender`), in pure TypeScript on the main thread: the director renders it on a frame after
 * the flash's, seconds before the sound arrives, so the frame that plays it only copies a buffer. At
 * 16 kHz for a bolt within 1 km (past 100 m the air leaves nothing above 4 kHz; 4–8 ms) and 8 kHz
 * past it and for an in-cloud flash, whose channel starts 3 km up (nothing above 700 Hz, 900 from a
 * summit 1.8 km over its ground; half that); the flash's seed draws the channel, so one flash
 * always thunders alike.
 * ponytail: main-thread render, like the crash's; move it to a Worker if phones show long tasks.
 *
 * @module audio/synth/thunder
 */
import { airCutoff, SPEED_OF_SOUND } from "../acoustics.ts"
import { bufferOf } from "../buffers.ts"
import type { OneShot, Shot } from "../types.ts"
import { between, seeded } from "./crash/dsp.ts"
import { playBuffer } from "./graph.ts"

type Thunder = Extract<OneShot, { readonly kind: "thunder" }>

/** The rate a thunder renders at, Hz (Web Audio resamples it to the device's): `THUNDER_RATE` for a bolt within `NEAR` m, half past it and in the cloud. */
export const THUNDER_RATE = 16000
const NEAR = 1000
/** The longest render, s: arrivals later than this are left out and the last 0.5 s fades. */
export const LONGEST = 20
/**
 * The channel, m: a bolt climbs to `top` before it branches in the cloud, its branches `bolt` long; an in-cloud flash spreads at
 * `cloud`, its branches `spread` long.
 */
const CHANNEL = {
  top: [1500, 3000],
  bolt: [800, 3000],
  cloud: [3000, 5000],
  spread: [1000, 4000],
} as const
/** One pearl (an N-wave source) every this many metres of channel. */
const PEARL = 2
/** The channel's energy per metre falls with height over this many metres (its current fades up the channel). */
const FADE_UP = 4000
/** Seconds the end fades over when the render is cut at `LONGEST`; a natural end fades over `END`. */
const CUT_FADE = 0.5,
  END = 0.02

/** A point of the channel, m (the strike point, or the point under an in-cloud flash, at the origin), and its weight. */
interface Pearl {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly w: number
}

/** A standard normal draw (Box–Muller). */
const gauss = (random: () => number): number =>
  Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random())

type Vec = readonly [number, number, number]
const unitOf = ([x, y, z]: Vec): Vec => {
  const n = Math.hypot(x, y, z) || 1
  return [x / n, y / n, z / n]
}

/**
 * A tortuous channel from `from` heading `aim` (a unit vector it keeps returning to) until it has run `length` m or
 * reached `below` m up (when set): each segment 5–70 m, each turn about 16° (Hill 1968). Adds its pearls, `weight` each.
 */
const walk = (
  pearls: Array<Pearl>,
  random: () => number,
  from: Vec,
  aim: Vec,
  length: number,
  weight: number,
  below = Infinity,
): Vec => {
  let [x, y, z] = from,
    dir = unitOf([
      aim[0] + 0.3 * gauss(random),
      aim[1] + 0.3 * gauss(random),
      aim[2] + 0.3 * gauss(random),
    ]),
    run = 0
  while (run < length && z < below) {
    const segment = between(random, 5, 70),
      w = weight * Math.exp(0.35 * gauss(random))
    // Pearls jittered within their 2 m cell: evenly spaced ones would buzz at c / 2 m along a channel pointing at the listener.
    for (let s = PEARL * random(); s < segment; s += PEARL) {
      const at = s + PEARL * (random() - 0.5)
      pearls.push({
        x: x + dir[0] * at,
        y: y + dir[1] * at,
        z: Math.max(0, z + dir[2] * at),
        w: w * Math.exp(-z / FADE_UP),
      })
    }
    x += dir[0] * segment
    y += dir[1] * segment
    z = Math.max(0, z + dir[2] * segment)
    run += segment
    // A turn of about 16° on average, pulled back towards the heading so the channel keeps its course.
    dir = unitOf([
      dir[0] + 0.22 * gauss(random) + 0.15 * (aim[0] - dir[0]),
      dir[1] + 0.22 * gauss(random) + 0.15 * (aim[1] - dir[1]),
      dir[2] + 0.22 * gauss(random) + 0.15 * (aim[2] - dir[2]),
    ])
  }
  return [x, y, z]
}

/** A heading `elevation` rad above the horizontal, at a random azimuth. */
const heading = (random: () => number, elevation: number): Vec => {
  const azimuth = 2 * Math.PI * random()
  return [
    Math.cos(elevation) * Math.cos(azimuth),
    Math.cos(elevation) * Math.sin(azimuth),
    Math.sin(elevation),
  ]
}

/** 2–4 branches spreading in the cloud from points of `starts`, near level, `length` m long, at half weight. */
const branches = (
  pearls: Array<Pearl>,
  random: () => number,
  starts: ReadonlyArray<Vec>,
  length: readonly [number, number],
): void => {
  for (let i = 0, n = 2 + Math.floor(random() * 3); i < n; i++) {
    walk(
      pearls,
      random,
      starts[Math.floor(random() * starts.length)]!,
      heading(random, 0.15 * gauss(random)),
      between(random, ...length),
      0.5,
    )
  }
}

/**
 * The channel of `sound`, where it starts and how many of its first pearls are the trunk the later strokes light again: a bolt
 * climbs from its strike point at the origin into the cloud, then branches; an in-cloud flash only branches, from a point above it.
 */
const channelOf = (
  sound: Thunder,
  random: () => number,
): { readonly pearls: ReadonlyArray<Pearl>; readonly trunk: number; readonly origin: Vec } => {
  const pearls: Array<Pearl> = []
  if (!sound.bolt) {
    const origin: Vec = [0, 0, between(random, ...CHANNEL.cloud)]
    branches(pearls, random, [origin], CHANNEL.spread)
    return { pearls, trunk: 0, origin }
  }
  const height = between(random, ...CHANNEL.top),
    top = walk(pearls, random, [0, 0, 0], [0, 0, 1], 3 * height, 1, height)
  const trunk = pearls.length
  // Branches in the cloud from the top 40 % of the channel; 1–3 forks reaching down and out from its middle, at a third of its weight.
  const upper = pearls.slice(Math.floor(0.6 * trunk)).map((p): Vec => [p.x, p.y, p.z])
  branches(pearls, random, upper.length > 0 ? upper : [top], CHANNEL.bolt)
  for (let i = 0, n = 1 + Math.floor(random() * 3); i < n; i++) {
    const p = pearls[Math.floor(between(random, 0.2, 0.7) * trunk)]
    if (p !== undefined)
      walk(
        pearls,
        random,
        [p.x, p.y, p.z],
        heading(random, -between(random, 0.5, 1.1)),
        between(random, 50, 400),
        0.3,
      )
  }
  return { pearls, trunk, origin: [0, 0, 0] }
}

/** A bolt's return strokes after the first: 1–3, each 30–120 ms after the one before, down the trunk only, at 40–80 % (none in the cloud). */
const strokesOf = (
  sound: Thunder,
  random: () => number,
): ReadonlyArray<{ readonly at: number; readonly gain: number }> => {
  const strokes = [{ at: 0, gain: 1 }]
  for (let i = 0, n = sound.bolt ? 1 + Math.floor(random() * 3) : 0; i < n; i++)
    strokes.push({
      at: strokes[i]!.at + between(random, 0.03, 0.12),
      gain: between(random, 0.4, 0.8),
    })
  return strokes
}

/** How far an in-cloud flash's channel runs above the point under it, m, on average: the director hears one from there. */
export const IN_CLOUD = (CHANNEL.cloud[0] + CHANNEL.cloud[1]) / 2
/** Within this many metres a thunder's crack is as loud (A-weighted) as from here. */
const QUIET_FROM = 300

/**
 * How far (dB(A)) a thunder heard from `range` m (to the strike point, or to an in-cloud flash's start) plays under its nominal
 * by itself: the air takes its highs and its N-waves stretch lower, 3.5 dB a doubling of range past 300 m, bolts and in-cloud
 * flashes alike (measured: the loudest 128 ms, A-weighted, the median of 96 renders each, within 0.7 dB from 1 to 12 km;
 * one draw lies within ±5 dB of it near, ±2 dB far).
 */
export const thunderQuiet = (range: number): number =>
  11.5 * Math.log10(Math.max(QUIET_FROM, range) / QUIET_FROM)

/** Air absorption's 3 dB point after `r` m, Hz: the game's (`airCutoff`) to 2 km, then on down as ISO 9613-1 at 125–250 Hz (about 105 Hz at 8 km). */
const thunderCutoff = (r: number): number =>
  r <= 2000 ? airCutoff(r) : airCutoff(2000) * (2000 / r) ** 0.8

/** The air on `x` in place, the range growing from `near` m by c m a second: one pole at its 3 dB point and one three times higher (absorption in dB grows about as f^1.5, gentler than a Butterworth); coefficients every 16 samples. */
const air = (x: Float32Array, rate: number, near: number): void => {
  let lo = 0,
    hi = 0,
    a1 = 1,
    a2 = 1
  for (let i = 0; i < x.length; i++) {
    if ((i & 15) === 0) {
      const fc = thunderCutoff(near + (SPEED_OF_SOUND * i) / rate)
      a1 = 1 - Math.exp((-2 * Math.PI * fc) / rate)
      a2 = 1 - Math.exp((-2 * Math.PI * 3 * fc) / rate)
    }
    hi += a2 * (x[i]! - hi)
    lo += a1 * (hi - lo)
    x[i] = lo
  }
}

/** The valley's roll: the ground and the hillsides send the thunder back for seconds. A Schroeder reverb (four combs ringing `t60` s, two allpasses) on the thunder, mixed `gain` under it. */
const ROLL = {
  combs: [0.143, 0.181, 0.223, 0.271],
  allpasses: [0.031, 0.011],
  t60: 2.5,
  gain: 0.25,
} as const
/** How long the roll rings on past the last arrival, s (30 dB down). */
const TAIL = (ROLL.t60 * 30) / 60

/** Adds the valley's roll of `x` into it. Each delay line keeps only its last `delay` samples (a ring), not a copy of the render. */
const roll = (x: Float32Array, rate: number): void => {
  const wet = new Float32Array(x.length)
  for (const seconds of ROLL.combs) {
    const delay = Math.round(seconds * rate),
      g = 10 ** ((-3 * seconds) / ROLL.t60),
      ring = new Float32Array(delay)
    for (let i = 0, j = 0; i < x.length; i++, j = j + 1 === delay ? 0 : j + 1) {
      ring[j] = x[i]! + (i >= delay ? g * ring[j]! : 0)
      wet[i]! += ring[j]! / ROLL.combs.length
    }
  }
  for (const seconds of ROLL.allpasses) {
    const delay = Math.round(seconds * rate),
      g = 0.6,
      ring = new Float32Array(delay)
    for (let i = 0, j = 0; i < x.length; i++, j = j + 1 === delay ? 0 : j + 1) {
      const input = wet[i]!
      wet[i] = -g * input + (i >= delay ? ring[j]! + g * wet[i - delay]! : 0)
      ring[j] = input
    }
  }
  for (let i = 0; i < x.length; i++) x[i]! += ROLL.gain * wet[i]!
}

/**
 * A thunder's samples; how long its first sound comes before the sound of its reference point, s: the strike point, or the start
 * of an in-cloud flash, `height` m above the point under it (0 for a bolt).
 */
interface Render {
  readonly samples: Float32Array<ArrayBuffer>
  readonly lead: number
  readonly height: number
}

/**
 * Thunder `distance` m away horizontally, heard `ears` m above the ground under it (each 0 when not finite), mono samples at `rate`
 * Hz whose loudest clap peaks at 0.5 before the air, at most `LONGEST` s, starting with the first sound to arrive; the flash's
 * `seed` draws its channel.
 */
export const renderThunder = (sound: Thunder, rate: number): Render => {
  const random = seeded(sound.seed),
    d = Number.isFinite(sound.distance) ? Math.max(0, sound.distance) : 0,
    ears = Number.isFinite(sound.ears) ? sound.ears : 0
  const { pearls, trunk, origin } = channelOf(sound, random),
    strokes = strokesOf(sound, random)
  const rangeOf = (p: Vec): number => Math.hypot(p[0] - d, p[1], p[2] - ears)
  const reach = pearls.map((p) => rangeOf([p.x, p.y, p.z]))
  let near = Infinity,
    last = 0
  for (const r of reach) {
    near = Math.min(near, r)
    last = Math.max(last, r)
  }
  // The last stroke's last N-wave, the air's settling and the valley's roll, past the last arrival.
  const seconds = (last - near) / SPEED_OF_SOUND + strokes.at(-1)!.at + 0.05 + TAIL,
    cut = seconds > LONGEST
  const n = Math.ceil(Math.min(LONGEST, seconds) * rate),
    out = new Float32Array(n)
  for (let i = 0; i < pearls.length; i++) {
    const r = reach[i]!,
      arrives = (r - near) / SPEED_OF_SOUND
    // An N-wave: the shock's jump up, a straight fall to as far under, the jump back. Weak-shock stretching lengthens it with distance:
    // 3 ms at 100 m, 5 at 1 km, 9 at 8 km, so its spectrum peaks near 250, 150 and 90 Hz (Few's 40–200 Hz, before the air).
    const tau =
      Math.min(0.015, Math.max(0.001, 0.0008 * (r / 0.5) ** 0.25)) * (0.8 + 0.4 * random())
    const length = Math.max(2, Math.round(tau * rate)),
      a = pearls[i]!.w / Math.max(10, r)
    // The trunk rings with every stroke, the rest with the first.
    for (let s = 0, m = i < trunk ? strokes.length : 1; s < m; s++) {
      const stroke = strokes[s]!,
        start = Math.round((arrives + stroke.at) * rate),
        end = Math.min(n, start + length)
      for (let k = start; k < end; k++)
        out[k]! += stroke.gain * a * (1 - (2 * (k - start)) / length)
    }
  }
  // The loudest clap at the nominal 0.5 before the air: the air then takes from it what it takes from the thunder (`thunderQuiet`).
  let loudest = 0
  for (let i = 0; i < n; i++) loudest = Math.max(loudest, Math.abs(out[i]!))
  for (let i = 0; i < n; i++) out[i]! *= loudest > 0 ? 0.5 / loudest : 0
  air(out, rate, near)
  roll(out, rate)
  const fade = Math.round((cut ? CUT_FADE : END) * rate)
  for (let i = Math.max(0, n - fade); i < n; i++) out[i]! *= (n - i) / fade
  // The roll and the air's ringing lift a near crack a little past the nominal: held to it, so the cap keeps the limiter out.
  let peak = 0
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]!))
  if (peak > 0.5) for (let i = 0; i < n; i++) out[i]! *= 0.5 / peak
  return {
    samples: out,
    lead: Math.max(0, rangeOf(origin) - near) / SPEED_OF_SOUND,
    height: origin[2],
  }
}

/** A thunder's render at its rate, Hz, and its length, s. */
export interface ThunderRender extends Render {
  readonly rate: number
  readonly seconds: number
}

const renders = new WeakMap<Thunder, ThunderRender>()

/**
 * `sound`'s render, made on the first call and kept per params object: at `THUNDER_RATE` for a bolt within 1 km, at half of it
 * past and for an in-cloud flash, whose channel starts 3 km up (`CHANNEL.cloud`): even overhead its nearest point is 2.4 km off
 * (the air's 3 dB point 270 Hz), or 800 m from a summit 1.8 km over its ground (870 Hz).
 */
export const thunderRender = (sound: Thunder): ThunderRender => {
  let render = renders.get(sound)
  if (render === undefined) {
    const rate = !sound.bolt || sound.distance > NEAR ? THUNDER_RATE / 2 : THUNDER_RATE,
      made = renderThunder(sound, rate)
    renders.set(sound, (render = { ...made, rate, seconds: made.samples.length / rate }))
  }
  return render
}

/** A lightning flash's thunder from its first sound at `when` (`lead` s before its strike point's, or its in-cloud start's), as any shot plays. */
export const thunder: Shot<Thunder> = {
  play: (io, sound, when) => {
    const { samples, rate } = thunderRender(sound)
    return playBuffer(io, bufferOf(io.ctx, samples, rate), when)
  },
}
