import type { Vec2 } from "@typeonce/ritmo-math"

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
