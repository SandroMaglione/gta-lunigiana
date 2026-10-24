import { Ops, type Vec2 } from "@typeonce/ritmo-math"

/** A quarter turn to the left (counter-clockwise), exact so the axes never drift. */
const left = (v: Vec2.Vec2): Vec2.Vec2 => ({ x: -v.y, y: v.x })

/**
 * Ground directions of the screen axes, by quarter turns of the view (index 0..3). At 0, the home
 * seat, the camera sits north-west of the focus and looks south-east (the mountains rise to the
 * south and east, so this side sees every street): up = south-east, right = south-west. Each turn
 * swings both a quarter to the left.
 */
const AXES = [
  { up: { x: Math.SQRT1_2, y: -Math.SQRT1_2 }, right: { x: -Math.SQRT1_2, y: -Math.SQRT1_2 } },
]
for (let k = 1; k < 4; k++)
  AXES.push({ up: left(AXES[k - 1]!.up), right: left(AXES[k - 1]!.right) })

/**
 * Screen-up and screen-right on the ground after `turns` quarter turns of the view to the left
 * (any integer; see the `View` resource). Render builds the camera from these; the sim maps
 * on-foot input through them.
 */
export const screenAxes = (turns: number): { readonly up: Vec2.Vec2; readonly right: Vec2.Vec2 } =>
  AXES[((turns % 4) + 4) % 4]!

/** Radians of view yaw per quarter turn of the `View`; a turn to the left is counter-clockwise. */
export const QUARTER = Math.PI / 2

/** Heading of screen-up in the home seat, rad counter-clockwise from east: south-east (`AXES[0].up`). */
const HOME_HEADING = -Math.PI / 4

/**
 * The yaw (rad to the left of the home seat) of the view whose screen-up points along `heading` (rad
 * counter-clockwise from east): the driving view, which keeps the road ahead up the screen.
 */
export const followYaw = (heading: number): number => heading - HOME_HEADING

/**
 * Screen-up and screen-right on the ground for a view turned `yaw` rad to the left of its home seat,
 * any yaw: the home seat's axes turned by it (`screenAxes` holds the quarter turns exactly).
 */
export const axesAt = (yaw: number): { readonly up: Vec2.Vec2; readonly right: Vec2.Vec2 } => {
  const c = Ops.cos(yaw),
    s = Ops.sin(yaw)
  const turn = ({ x, y }: Vec2.Vec2) => ({ x: x * c - y * s, y: x * s + y * c })
  return { up: turn(AXES[0]!.up), right: turn(AXES[0]!.right) }
}

/**
 * The screen axes on the ground of the view at rest: the quarter seat `turns`' on foot, the driving
 * view's for a car heading `heading` (the host eases the view after it).
 */
export const restAxes = (
  turns: number,
  heading: number | undefined,
): { readonly up: Vec2.Vec2; readonly right: Vec2.Vec2 } =>
  heading === undefined ? screenAxes(turns) : axesAt(followYaw(heading))

/**
 * The quarter seat nearest a view turned `yaw` rad, as the count of quarter turns (see `View`)
 * nearest `turns` that is that seat, so the count winds on with the view instead of jumping by a
 * whole turn.
 */
export const nearestSeat = (turns: number, yaw: number): number =>
  turns + ((((Math.round(yaw / QUARTER) - turns) % 4) + 6) % 4) - 2

/** The camera leads the player by this many seconds of their velocity, at most `max` metres. */
export const LOOK_AHEAD = { seconds: 0.6, max: 14 } as const

/**
 * Farthest ground the camera shows from the player, m: half the diagonal of the widest view (16:9,
 * 270 texels tall at 5 texels/m from 30° up: 96 × 108 m, so 72 m) plus the full look-ahead, rounded
 * up. Populate spawns, and quietly removes bodies, only beyond it. The diagonal does not depend on
 * which way the view is turned.
 */
// ponytail: sized for 16:9; ultrawide screens, and phones held sideways (up to 17 m, under mobile mode's corner controls), see further. Cap PixelView's aspect if that pop-in shows.
export const VIEW_REACH = 90
