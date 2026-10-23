/**
 * A destroyed vehicle's fire: the flames' roar, brown noise under 500 Hz flickering with the gust
 * signal sped up, and their crackle, noise bursts drawn at random and scheduled a little ahead (as
 * the crickets' echemes are): sharp pops at 2–6 kHz, and now and then a deeper snap. A loop of the
 * kit's grains would repeat its 3 s pattern within the 5–10 s a wreck burns before it blows up;
 * bursts drawn afresh never repeat. It peaks at 0.33–0.38, under the nominal 0.5 (docs/audio.md,
 * Calibration); how loud a fire is is the director's (`LEVELS.fire`).
 *
 * @module audio/synth/fire
 */
import { loop } from "../buffers.ts"
import type { Continuous, VoiceFactory } from "../types.ts"
import { burst, draw, drawLog, fadeOut, outlet } from "./graph.ts"

/** The roar's level, how far the flicker swings it (less than the level: never negative), and how much faster than the wind the gust signal plays (0.75–12 Hz). */
const ROAR = { gain: 0.35, flicker: 0.2, rate: 24 } as const

/** One kind of crackle: bursts a second (Poisson), their band (Hz) and Q, decay time constant (s), and loudest peak. */
interface Crackle {
  readonly rate: number
  readonly hz: readonly [number, number]
  readonly q: number
  readonly tau: readonly [number, number]
  readonly peak: number
}
/** The sharp pops of burning trim and paint, and the rarer, deeper snaps of the bodywork. */
const CRACKLE: ReadonlyArray<Crackle> = [
  { rate: 10, hz: [2000, 6000], q: 1.5, tau: [0.002, 0.006], peak: 1.5 },
  { rate: 1, hz: [600, 800], q: 2, tau: [0.012, 0.018], peak: 2.5 },
]
/** How far ahead the crackle is scheduled, s. */
const LOOKAHEAD = 0.3

/** A burning wreck: Doppler from `io.cents` on the roar. */
export const fire: VoiceFactory<Extract<Continuous, { readonly kind: "fire" }>> = ({
  ctx,
  out,
  cents,
  kit,
}) => {
  const level = outlet(ctx, out)
  const brown = loop(ctx, kit.brown),
    gust = loop(ctx, kit.gust, ROAR.rate),
    roar = new GainNode(ctx, { gain: ROAR.gain })
  cents.connect(brown.detune)
  brown
    .connect(new BiquadFilterNode(ctx, { type: "lowpass", frequency: 500 }))
    .connect(roar)
    .connect(level)
  gust.connect(new GainNode(ctx, { gain: ROAR.flicker })).connect(roar.gain)
  // When each kind of crackle bursts next.
  const next = CRACKLE.map(() => 0)
  let burning = true
  return {
    update: (_, now) => {
      if (!burning) return
      for (const [i, crackle] of CRACKLE.entries()) {
        // A crackle that fell behind (a paused frame) carries on from now, not with a pile of bursts in the past.
        let t = Math.max(next[i]!, now)
        for (; t < now + LOOKAHEAD; t += -Math.log(1 - Math.random()) / crackle.rate) {
          // Mostly faint, a few loud: the peak's square of a uniform draw.
          burst(
            ctx,
            kit.white,
            level,
            t,
            0.0005,
            draw(crackle.tau),
            drawLog(crackle.hz),
            crackle.q,
            crackle.peak * Math.random() ** 2,
          )
        }
        next[i] = t
      }
    },
    stop: (now) => {
      burning = false
      fadeOut(level, [brown, gust], now)
    },
  }
}
