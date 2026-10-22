/**
 * The crash one-shot: rendered on demand at play from its exact params (render.ts), in pure
 * TypeScript on the main thread, at the device's rate up to 48 kHz (Web Audio resamples above it: a
 * mode costs a step a sample, so 96 kHz would double the cost for nothing audible). A render is kept
 * per params object, so the director's echoes of one crash (the same object, played again later and
 * fainter) replay it instead of rendering anew.
 * ponytail: main-thread render (a few ms; the heaviest, a 40 m/s wreck or two trucks, 15–20 ms); move
 * it to a Worker if the browser shows long tasks.
 *
 * @module audio/synth/crash
 */
import { bufferOf } from "../../buffers.ts"
import type { Shot } from "../../types.ts"
import { playBuffer } from "../graph.ts"
import { bandLoops } from "./dsp.ts"
import { type Crash, levelOf } from "./hit.ts"
import { renderCrash, SHELL_ADDS } from "./render.ts"
import { TARGETS } from "./targets.ts"

/** How far (dB) a crash plays under its nominal peak (the reference crash, a Panda into a house at 15 m/s), so masking counts the level played: the law, less what a ringing wall or two clanking shells add to it; negative past the reference, to about −8 dB. */
export const crashQuiet = (sound: Crash): number =>
  -levelOf(sound) - (sound.against.kind === "wall" ? TARGETS[sound.against.material].adds : SHELL_ADDS) * Math.min(1, sound.speed / 8)

/** The rate a crash renders at on `ctx`, Hz. */
const rateOf = (ctx: BaseAudioContext): number => Math.min(ctx.sampleRate, 48000)

const renders = new WeakMap<Crash, AudioBuffer>()

/** A vehicle hitting a wall, another vehicle or a parked car. */
export const crash: Shot<Crash> = {
  // The noise loops, made once per sample rate, so the first crash renders at its usual cost.
  prepare: (ctx) => Promise.resolve(void bandLoops(rateOf(ctx))),
  play: (io, sound, when) => {
    let buffer = renders.get(sound)
    if (buffer === undefined) renders.set(sound, (buffer = bufferOf(io.ctx, renderCrash(sound, rateOf(io.ctx), Math.random), rateOf(io.ctx))))
    return playBuffer(io, buffer, when)
  }
}
