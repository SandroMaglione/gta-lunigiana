/**
 * Thunder: every lightning flash's thunder waits in the director until its sound reaches the
 * listener, wherever they have moved meanwhile (in a car by then, they hear it through the cabin).
 * It is rendered as heard from the ears' height over the ground under the flash, on a frame after
 * the flash's (where the bolt is drawn), one render a frame, seconds before it is due but for a
 * strike within a few metres. It comes from its strike point, or
 * an in-cloud flash's start, along a clear path: its channel stands kilometres above every ridge and
 * roof, so no obstacle is walked and the ground takes nothing; the masking floor is the one when it
 * arrives (rain masks far thunder). The channel fills the sky, so it pans narrower than a point; the
 * flash's `power` makes it quieter; its direct sound plays under its cap, and at most two thunders
 * roll at once (a louder third fades out the quieter of them), so the master limiter never pumps
 * the rain under them. The rock faces in sight answer it, as they answer a crash, 10 dB and more
 * under it; the render's own roll holds the rest of the valley's returns.
 *
 * @module audio/director/thunder
 */
import { CABIN, dbToGain, SPEED_OF_SOUND } from "../acoustics.ts"
import { IN_CLOUD, thunderQuiet, thunderRender, type ThunderRender } from "../synth/thunder.ts"
import type { OneShot } from "../types.ts"
import { type Frame, groundAt } from "./frame.ts"
import { DELAY_FROM, type Level, LEVELS, MOST_DB } from "./levels.ts"

type Thunder = Extract<OneShot, { readonly kind: "thunder" }>

/** A thunder is placed this long (s) before its first sound arrives, as a bell's stroke is. */
const AHEAD = 0.1
/** The channel fills the sky: a thunder pans this share of a point source's. */
const WIDTH = 0.6
/** At most this many thunders roll at once; another one sounding plays this much (linear) under its own level, so two at the cap stay under the limiter. */
const AT_ONCE = 2,
  OVERLAP = Math.SQRT1_2
/** A flash of `power` 1 thunders at `LEVELS.thunder`; a weaker one this many dB under per decade of power, down to its 0.3. */
const POWER_DB = 20,
  WEAKEST = 0.3

/** A flash's thunder on its way: the sound, the ground under the flash (m a.s.l.), the speaker time of the flash, its level, and its render once made. */
interface Rolling {
  readonly sound: Thunder
  readonly x: number
  readonly y: number
  readonly ground: number
  readonly at: number
  readonly level: Level
  readonly render?: ThunderRender
}

/** The thunder part of the director, with the thunders on their way and those still sounding (speaker time they end, level at the ears). */
export const makeThunder = () => {
  const coming: Array<Rolling> = []
  let sounding: Array<{ readonly sound: Thunder; readonly end: number; readonly level: number }> =
    []

  /**
   * How `thunder` reaches the ears now: from where its render starts (before the render, where it starts on average), clear, its
   * air already in its render (only a cabin closes it), narrower than a point, dry.
   */
  const heard = (frame: Frame, thunder: Rolling) => {
    const z = thunder.ground + (thunder.render?.height ?? (thunder.sound.bolt ? 0 : IN_CLOUD))
    const range = Math.hypot(thunder.x - frame.ears.x, thunder.y - frame.ears.y, z - frame.ears.z)
    const at = frame.path(undefined, { x: thunder.x, y: thunder.y, z }, thunder.level, {
      quiet: thunderQuiet(range),
    })
    const cutoff = frame.inside === undefined ? 20000 : CABIN[frame.inside].cutoff
    return {
      range,
      at: { ...at, placement: { ...at.placement, pan: WIDTH * at.placement.pan, cutoff, wet: 0 } },
    }
  }

  return {
    hear: (frame: Frame): void => {
      const { ears, now } = frame
      for (const h of frame.heard.happenings) {
        if (h.kind !== "lightning" || !frame.live) continue
        // Rendered as heard from where the ears stand now, over the ground under the flash: the geometry its timing below uses.
        const ground = groundAt(h.x, h.y)
        const sound: Thunder = {
          kind: "thunder",
          distance: Math.hypot(h.x - ears.x, h.y - ears.y),
          ears: ears.z - ground,
          bolt: h.bolt,
          seed: h.seed,
        }
        const level = {
          ...LEVELS.thunder,
          db: LEVELS.thunder.db + POWER_DB * Math.log10(Math.min(1, Math.max(WEAKEST, h.power))),
        }
        const thunder = { sound, x: h.x, y: h.y, ground, at: now, level }
        // Not even heard now (masked, or the listener too far): it is not waited for, nor rendered.
        if (heard(frame, thunder).at.audible) coming.push(thunder)
      }
      // The oldest flash still to render, from the frame after its own: the frame that plays it then only copies a buffer.
      const next = coming.findIndex((thunder) => thunder.render === undefined && thunder.at < now)
      if (next >= 0) coming[next] = { ...coming[next]!, render: thunderRender(coming[next]!.sound) }
      sounding = sounding.filter((s) => s.end > now)
      for (let k = coming.length - 1; k >= 0; k--) {
        const thunder = coming[k]!,
          render = thunder.render
        if (render === undefined) continue
        const { range, at } = heard(frame, thunder)
        // Its first sound leaves `lead` s before its reference point's; within `DELAY_FROM` m it plays at once, like any one-shot.
        const first =
          range > DELAY_FROM ? thunder.at + range / SPEED_OF_SOUND - render.lead : thunder.at
        if (first > now + AHEAD) continue
        coming.splice(k, 1)
        if (!at.audible) continue
        // A third one plays only over the quieter of the two rolling, whose tail it masks: that one fades out and it takes its place.
        if (sounding.length >= AT_ONCE) {
          const quietest = sounding.reduce((a, b) => (b.level < a.level ? b : a))
          if (at.level <= quietest.level) continue
          frame.stop(quietest.sound)
          sounding = sounding.filter((s) => s !== quietest)
        }
        const gain =
          Math.min(at.placement.gain, dbToGain(MOST_DB.thunder)) *
          (sounding.length > 0 ? OVERLAP : 1)
        const delay = Math.max(0, first - now)
        frame.play(thunder.sound, { ...at, placement: { ...at.placement, gain }, delay: 0 }, delay)
        sounding.push({ sound: thunder.sound, end: now + delay + render.seconds, level: at.level })
      }
    },
  }
}
