/**
 * The sky frame: what the sky is doing this frame, one plain object the sky host computes once per
 * animation frame and every sky effect (precipitation, lightning, lamps, glow) reads. Effects
 * animate on `now` (sim seconds, frozen in the pause), never on game time.
 *
 * @module render/sky/frame
 */

/** What the sky is doing this frame, computed once by the sky host (render-sky) and read by every effect. */
export interface SkyFrame {
  /** Sim seconds, (Time.step + alpha) · STEP.dt: what effects animate on (it stands still in the pause). */
  readonly now: number
  /** 0 full day … 1 full night, from the sun's elevation (civil twilight) and dark weather. */
  readonly night: number
  /** Lamps and headlights on, 0..1, eased (on at dusk, in dark storms and thick fog). */
  readonly lamps: number
  /** Linear multiplier for unlit things (particles, the bolt by day): the light an upward face gets now, ≈1 at a clear noon, flash included. */
  readonly ambient: number
  /** Scene-wide lightning flash now, 0..1 (one smooth pulse per flash). */
  readonly flash: number
  /** Wind at the focus, m/s, sim frame (x east, y north): the velocity the air moves with. */
  readonly wind: { readonly x: number; readonly y: number }
  /** Rain and snow falling at the focus, mm/h liquid-equivalent each. */
  readonly rain: number
  readonly snow: number
}
