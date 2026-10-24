/**
 * The see-through cut: while the world hides the player, a circle round them on screen opens, and
 * the world inside it that stands between them and the camera is not drawn, as Baldur's Gate 3 and
 * Divinity: Original Sin 2 cut round their characters (`SeeThrough` in `sightline.ts` opens and
 * shuts it). Buildings, bridges and tree crowns are cut above the player's feet, so their walls
 * stand as stubs round the ground the player walks on, as in The Sims' cutaway. The terrain, the
 * roads and the water are cut only nearer the camera than where the player's sight line first meets
 * the terrain: a hill that hides the player goes, while the ground between them and the hill stays,
 * and while no terrain hides them none is cut. The edge is hard: the outline pass draws a crisp ring round the hole. The shadow
 * pass draws the whole world, so the cut moves no shadow. Every material reads the cut from the
 * shared `CUT_UNIFORMS` cells, and each variant's rule is a `#define` fixed at compile time, so
 * opening the cut recompiles nothing.
 *
 * @module render/see-through
 */
import { Vector3 } from "three"

/** Buildings, bridges and trees are cut only this many metres above the player's feet: their walls stand as stubs. */
const ABOVE_FEET = 0.4

/** The cut's uniform cells, held by reference by every material it cuts: write `.value`, never replace the objects. */
export const CUT_UNIFORMS = {
  /** The middle of the player's body, three space. */
  uCutCentre: { value: new Vector3() },
  /** Render y of the player's feet. */
  uCutFeet: { value: 0 },
  /** The cut's radius on screen, m: 0 while it is shut. */
  uCutRadius: { value: 0 },
  /** How far nearer the camera than the player's middle the terrain, roads and water are cut, m: far off while no terrain hides them. */
  uCutGround: { value: 1e6 },
}

/**
 * GLSL for a fragment shader that defines `CUT_ABOVE` or `CUT_GROUND`: `cutAway(at, y)` says
 * whether the fragment at view-space `at`, render y `y`, is cut. It is cut when it lies within
 * the radius of the player on screen, nearer the camera than the player, and above their feet
 * (`CUT_ABOVE`) or more than `uCutGround` m nearer (`CUT_GROUND`). The orthographic view's x and
 * y are metres on the screen plane, and its z grows toward the camera.
 */
export const CUT_GLSL = /* glsl */ `
uniform vec3 uCutCentre;
uniform float uCutFeet;
uniform float uCutRadius;
uniform float uCutGround;
bool cutAway(vec3 at, float y) {
  if (uCutRadius <= 0.0) return false;
  vec3 centre = (viewMatrix * vec4(uCutCentre, 1.0)).xyz;
  vec2 off = at.xy - centre.xy;
  if (at.z <= centre.z || dot(off, off) > uCutRadius * uCutRadius) return false;
  #ifdef CUT_GROUND
    return at.z - centre.z > uCutGround;
  #else
    return y > uCutFeet + ${ABOVE_FEET.toFixed(2)};
  #endif
}
`
