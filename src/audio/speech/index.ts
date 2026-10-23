/**
 * Speech: The Sims-style Italian talking. `lineFor` picks what a person says (gibberish that
 * sounds Italian, real fillers, cries in real Italian), `lineSeconds` how long it lasts, and
 * `speechShot` plays it, rendered in pure TypeScript by a Klatt-style formant synth (render.ts) at
 * the context's rate up to 48 kHz on the main thread: ≈ 3 ms per second of speech at 48 kHz on a
 * desktop (a chat line ≈ 6 ms, a yell ≈ 2.5 ms), several times that on a phone, so the director
 * starts only a few lines a frame.
 *
 * @module audio/speech
 */
import { bufferOf } from "../buffers.ts"
import { playBuffer } from "../synth/graph.ts"
import type { Shot } from "../types.ts"
import { renderSpeech } from "./render.ts"
import type { Speech } from "./types.ts"

export { lineFor } from "./lines.ts"
export { lineSeconds } from "./plan.ts"
export { renderSpeech } from "./render.ts"

/**
 * The rate a line renders at on `ctx`, Hz: the device's, capped at 48 kHz like the crash (Web Audio resamples above it). Not
 * lower: at 24 kHz a line renders in half the time, but the formant resonators near Nyquist brighten the 2.8–5.6 kHz octave by
 * 2–3 dB.
 */
const rateOf = (ctx: BaseAudioContext): number => Math.min(ctx.sampleRate, 48000)

/** A line of speech, said (`talk`) or yelled (`loud`, `yell`), rendered at play. */
export const speechShot = (loud: boolean): Shot<Speech> => {
  // Renders kept per speech object, so the director's echo of a line replays it instead of rendering anew.
  const renders = new WeakMap<Speech, AudioBuffer>()
  return {
    play: (io, speech, when) => {
      let buffer = renders.get(speech)
      if (buffer === undefined)
        renders.set(
          speech,
          (buffer = bufferOf(
            io.ctx,
            renderSpeech(speech, loud, rateOf(io.ctx), Math.random),
            rateOf(io.ctx),
          )),
        )
      return playBuffer(io, buffer, when)
    },
  }
}
