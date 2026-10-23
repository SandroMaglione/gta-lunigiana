/**
 * The look of fire, shared by the burning wrecks' flames and the blasts: palette colours burning
 * hot (over 1, so they glow through the pipeline), the ramp a flame burns along, and the unlit
 * low-poly shape and material each tongue of fire or spark is drawn with.
 *
 * @module render/fire
 */
import { Color, MeshBasicMaterial, OctahedronGeometry } from "three"

import { paint } from "./geometry.ts"
import { PALETTE } from "./palette.ts"

/** A palette colour burning hot: over 1, so it glows through the pipeline. */
export const hot = (hex: number): Color => new Color().setHex(hex).multiplyScalar(1.3)
/** A flame's colours over its life: yellow at the root, orange, red as it dies. */
export const HOT = [PALETTE.signYellow, PALETTE.flameOrange, PALETTE.signalRed].map(hot)
/** `out` set to the colour `u` of the way (0 to 1) along `ramp`, blending between its neighbours. */
export const along = (ramp: ReadonlyArray<Color>, u: number, out: Color): Color => {
  const k = Math.min(ramp.length - 1.001, Math.max(0, u) * (ramp.length - 1)),
    i = Math.floor(k)
  return out.copy(ramp[i]!).lerp(ramp[i + 1]!, k - i)
}
/** A tongue of fire or a spark: a low-poly octahedron of radius 1 in white, tinted per instance by its colour. */
export const fireShape = paint(new OctahedronGeometry(1, 0), 0xffffff)
/** What fire is drawn with: unlit, so it glows in shadow, a little see-through, and writing no depth, so it burns over the smoke drawn before it. */
export const fireMaterial = new MeshBasicMaterial({
  vertexColors: true,
  transparent: true,
  opacity: 0.9,
  depthWrite: false,
})
