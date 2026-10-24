/**
 * How the view turns, one frame at a time: on foot the turn keys swing it a quarter at a time
 * (`turnToward`); driving it follows the car on a spring, so the road ahead stays up the screen
 * (`followToward`); got out, the same spring settles it on the quarter seat the sim picked
 * (`settleOn`). The yaw is radians to the left of the home seat (see `PixelView.yaw`).
 *
 * @module render/swing
 */
import { wrapAngle } from "../sim/body.ts"
import { followYaw, QUARTER } from "../sim/view.ts"

/**
 * The view's yaw one frame of `dt` seconds on from `yaw`, swinging toward `target`: it eases out,
 * covering 1 − e^(−12·dt) of the way, but never slower than 1 rad/s, so a quarter turn lands in
 * about a third of a second and stops dead instead of creeping (any sub-texel creep shimmers).
 */
export const turnToward = (yaw: number, target: number, dt: number): number => {
  const rest = Math.abs(target - yaw),
    step = Math.max(rest * (1 - Math.exp(-12 * dt)), dt)
  return step >= rest ? target : yaw + Math.sign(target - yaw) * step
}

/** The spring's natural frequency, rad/s: from rest it covers 95% of a half turn in 1.2 s, and lags a car turning steadily by 2/4 = 0.5 s of its turn. */
const FOLLOW = 4
/** At rest, the car's heading moves the view only once it is this far off, rad: the spring does not creep after every wobble. */
const HOLD = 0.02
/** Closer than this, rad, and slower than `SETTLE_RATE`, rad/s, the spring stops on its target: a jump of at most a texel at the view's corners. */
const SETTLE = 0.003
const SETTLE_RATE = 0.05
/** Settling on a seat closes at least this fast, rad/s: the spring's tail would creep. */
const LAND = 0.1

/** A yaw and how fast it turns, rad/s. */
export interface Spin {
  readonly yaw: number
  readonly rate: number
}

/** One exact step of a critically damped spring pulling `spin` toward `target` (held still over the frame): stable at any `dt`. */
const spring = (spin: Spin, target: number, dt: number): Spin => {
  const error = spin.yaw - target,
    lead = spin.rate + FOLLOW * error,
    decay = Math.exp(-FOLLOW * dt)
  const off = (error + lead * dt) * decay,
    rate = (spin.rate - FOLLOW * lead * dt) * decay
  return Math.abs(off) < SETTLE && Math.abs(rate) < SETTLE_RATE
    ? { yaw: target, rate: 0 }
    : { yaw: target + off, rate }
}

/**
 * `spin` one frame of `dt` s on, following `target` (the car's heading as a yaw) on a spring: from
 * rest it eases in and out, never overshooting, and stops on the target. At rest it holds still until
 * the target is `HOLD` away.
 */
export const followToward = (spin: Spin, target: number, dt: number): Spin =>
  spin.rate === 0 && Math.abs(target - spin.yaw) <= HOLD ? spin : spring(spin, target, dt)

/** `spin` one frame of `dt` s on, settling on the yaw `seat` on the spring, closing at least `LAND` rad/s at the end so it lands. */
export const settleOn = (spin: Spin, seat: number, dt: number): Spin => {
  const was = Math.abs(spin.yaw - seat),
    next = spring(spin, seat, dt)
  const left = was - LAND * dt
  // Turning away (the car turned so) or closing fast enough, the spring has it.
  if (Math.abs(next.yaw - seat) <= left || Math.abs(next.yaw - seat) >= was) return next
  return left <= 0
    ? { yaw: seat, rate: 0 }
    : { yaw: seat + Math.sign(spin.yaw - seat) * left, rate: next.rate }
}

/** The view's swing: its yaw and rate, and what turns it: the car, the spring settling it on the seat `seat` (`View` turns), or the turn keys. */
export interface Swing extends Spin {
  readonly by: "car" | "seat" | "keys"
  readonly seat: number
}

/**
 * The view one frame of `dt` s on, for the sim's seat `turns` (`View`). Driving (`heading`, rad
 * counter-clockwise from east), it follows the car the short way round; got out, it settles on
 * `turns` the short way round (a whole turn more or less looks the same) until a turn key moves the
 * seat, which `turnToward` then swings to. `instant` (reduced motion, the first frame) skips the easing,
 * except while following the car, which it only lands on at once.
 */
export const swingView = (
  swing: Swing,
  turns: number,
  heading: number | undefined,
  dt: number,
  instant: boolean,
): Swing => {
  const seat = turns * QUARTER
  if (heading !== undefined) {
    const target = swing.yaw + wrapAngle(followYaw(heading) - swing.yaw)
    // `instant` jumps onto the car once: locked to it after, the view would turn with every wobble of
    // the wheel, more motion than the spring's.
    const spin =
      instant && swing.by !== "car" ? { yaw: target, rate: 0 } : followToward(swing, target, dt)
    return { ...spin, by: "car", seat: turns }
  }
  if (swing.by === "car" || (swing.by === "seat" && swing.seat === turns)) {
    const from = { yaw: seat - wrapAngle(seat - swing.yaw), rate: swing.rate }
    const spin = instant ? { yaw: seat, rate: 0 } : settleOn(from, seat, dt)
    return { ...spin, by: "seat", seat: turns }
  }
  return { yaw: instant ? seat : turnToward(swing.yaw, seat, dt), rate: 0, by: "keys", seat: turns }
}
