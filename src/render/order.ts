/**
 * The draw order of the transparent effects (`renderOrder`): three otherwise sorts transparents by
 * distance, and their order flips as the camera moves. The tyre marks first; then the smoke (tyres,
 * engines, blasts) and the x-ray silhouettes; fire over the smoke it burns in (a wreck's flames and
 * a blast's flash, then the fireball and its embers through them); the bolts; and the rain and snow
 * over everything.
 *
 * @module render/order
 */
export const DRAW_ORDER = {
  marks: 0,
  smoke: 1,
  xray: 1,
  flames: 2,
  fireball: 3,
  bolt: 4,
  precipitation: 5,
} as const
