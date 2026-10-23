/**
 * Noise, grain and control signals for every synth: the samples are plain functions of a random
 * source (tested in Node), wrapped into AudioBuffers once per context by `makeKit`. Loops are
 * seamless: noise cross-fades its tail into its head, grains and gusts wrap around.
 *
 * @module audio/buffers
 */
import type { Kit } from "./types.ts"

type Colour = "white" | "pink" | "brown"

/** `n` samples of `colour` noise, about ±1 peak, looping without a click. */
export const noiseSamples = (
  colour: Colour,
  n: number,
  sampleRate: number,
  random: () => number = Math.random,
): Float32Array<ArrayBuffer> => {
  const fade = Math.min(Math.floor(sampleRate * 0.05), Math.floor(n / 4))
  const raw = new Float32Array(n + fade)
  // Pink: Paul Kellet's filter; brown: a leaky integrator.
  let b0 = 0,
    b1 = 0,
    b2 = 0,
    b3 = 0,
    b4 = 0,
    b5 = 0,
    b6 = 0,
    last = 0
  for (let i = 0; i < raw.length; i++) {
    const w = random() * 2 - 1
    if (colour === "white") raw[i] = w * 0.5
    else if (colour === "pink") {
      b0 = 0.99886 * b0 + w * 0.0555179
      b1 = 0.99332 * b1 + w * 0.0750759
      b2 = 0.969 * b2 + w * 0.153852
      b3 = 0.8665 * b3 + w * 0.3104856
      b4 = 0.55 * b4 + w * 0.5329522
      b5 = -0.7616 * b5 - w * 0.016898
      raw[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11
      b6 = w * 0.115926
    } else {
      last = (last + 0.02 * w) / 1.02
      raw[i] = last * 3.5
    }
  }
  const out = raw.slice(0, n)
  // Equal-power cross-fade of the overshoot into the head: the last sample flows into the first.
  for (let i = 0; i < fade; i++) {
    const t = (i / fade) * (Math.PI / 2)
    out[i] = raw[n + i]! * Math.cos(t) + raw[i]! * Math.sin(t)
  }
  return out
}

/** `n` samples of sparse noise grains (1–5 ms, Poisson at `grainsPerSecond`): gravel, leaves, crackle. */
export const crackleSamples = (
  n: number,
  sampleRate: number,
  grainsPerSecond = 400,
  random: () => number = Math.random,
): Float32Array<ArrayBuffer> => {
  const out = new Float32Array(n)
  const seconds = n / sampleRate
  for (
    let t = -Math.log(1 - random()) / grainsPerSecond;
    t < seconds;
    t += -Math.log(1 - random()) / grainsPerSecond
  ) {
    const i0 = Math.floor(t * sampleRate),
      len = Math.floor(sampleRate * (0.001 + random() * 0.004)),
      a = random() ** 2
    for (let j = 0; j < len; j++) out[(i0 + j) % n]! += a * (random() * 2 - 1) * (1 - j / len)
  }
  return out
}

/** `n` samples of a slow control signal in −1…1: a few sines with whole cycles over the loop (gusts, surges). */
export const gustSamples = (
  n: number,
  random: () => number = Math.random,
): Float32Array<ArrayBuffer> => {
  const out = new Float32Array(n)
  // Each sine as a point (c, s) = (cos, sin)(w·i + phase) turned through w per sample: no Math.sin per
  // sample (half a million samples, five sines, on the first key press). The rounding drift over a
  // loop stays near 1e-10, far below the Float32 output, so it needs no renormalising.
  const parts = [2, 5, 9, 17, 31].map((k) => {
    const w = (2 * Math.PI * k) / n,
      phase = random() * 2 * Math.PI
    return {
      a: 1 / Math.sqrt(k),
      cw: Math.cos(w),
      sw: Math.sin(w),
      c: Math.cos(phase),
      s: Math.sin(phase),
    }
  })
  let max = 0
  for (let i = 0; i < n; i++) {
    let v = 0
    for (const p of parts) {
      v += p.a * p.s
      const c = p.c
      p.c = c * p.cw - p.s * p.sw
      p.s = p.s * p.cw + c * p.sw
    }
    out[i] = v
    // Of the stored (Float32) values, so the peak divides to exactly ±1, never an ulp beyond.
    max = Math.max(max, Math.abs(out[i]!))
  }
  for (let i = 0; i < n; i++) out[i]! /= max
  return out
}

/** A stereo reverb impulse response: decorrelated noise, darkening, decaying 60 dB in `rt60` s after `preDelay` s. */
export const impulseResponse = (
  ctx: BaseAudioContext,
  seconds: number,
  rt60: number,
  preDelay: number,
): AudioBuffer => {
  const rate = ctx.sampleRate,
    n = Math.floor(rate * seconds),
    ir = ctx.createBuffer(2, n, rate)
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c)
    let lp = 0
    for (let i = Math.floor(preDelay * rate); i < n; i++) {
      const t = i / rate
      lp += (Math.random() * 2 - 1 - lp) * Math.max(0.08, 1 - t / seconds)
      d[i] = lp * Math.exp((-6.91 * t) / rt60)
    }
  }
  return ir
}

/** A mono AudioBuffer holding `samples` at `sampleRate`. */
export const bufferOf = (
  ctx: BaseAudioContext,
  samples: Float32Array<ArrayBuffer>,
  sampleRate = ctx.sampleRate,
): AudioBuffer => {
  const buffer = ctx.createBuffer(1, samples.length, sampleRate)
  buffer.copyToChannel(samples, 0)
  return buffer
}

/** Every shared buffer for `ctx`: 4 s of each noise colour, 3 s of grains, a 64 s gust signal at 8 kHz. */
export const makeKit = (ctx: BaseAudioContext): Kit => {
  const rate = ctx.sampleRate
  return {
    white: bufferOf(ctx, noiseSamples("white", rate * 4, rate)),
    pink: bufferOf(ctx, noiseSamples("pink", rate * 4, rate)),
    brown: bufferOf(ctx, noiseSamples("brown", rate * 4, rate)),
    crackle: bufferOf(ctx, crackleSamples(rate * 3, rate)),
    // 8 kHz is the lowest buffer rate every browser must accept.
    gust: bufferOf(ctx, gustSamples(8000 * 64), 8000),
  }
}

/** Starts `buffer` looping at a random offset (so voices sharing it never line up), at `rate`. */
export const loop = (
  ctx: BaseAudioContext,
  buffer: AudioBuffer,
  rate = 1,
): AudioBufferSourceNode => {
  const source = new AudioBufferSourceNode(ctx, { buffer, loop: true, playbackRate: rate })
  source.start(0, Math.random() * buffer.duration)
  return source
}

/** A soft-clipping tanh curve for WaveShaperNode, normalised to ±1. */
export const tanhCurve = (drive = 2.5, n = 1024): Float32Array<ArrayBuffer> => {
  const curve = new Float32Array(n)
  for (let i = 0; i < n; i++)
    curve[i] = Math.tanh(drive * ((i / (n - 1)) * 2 - 1)) / Math.tanh(drive)
  return curve
}

/** 0 below `a`, 1 above `b`, a smooth S between. */
export const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
