/**
 * The post pass's atmosphere, in the blit after the outlines (`pipeline.ts`): height fog, rain haze,
 * the exposure and the night grade, per low-res texel. The orthographic camera makes each texel's
 * world point exact from the depth texture, so the fog is world-locked (it never swims as the view
 * scrolls) and costs no extra texture taps.
 *
 * - Fog: the valley fog (dense under its top, thinning above it) and the hill cloud (dense over its
 *   base, thinning under it), from the sim's `fogLayers`. A point is veiled by the fog along PATH m of
 *   its view ray, as if the eye stood 60 m from the focus (the camera itself stands 250 m up, inside any
 *   cloud, and the whole ray would grey out the picture): ground deeper than the focus plane (up the
 *   screen, or a valley below a ridge) lies further off and fades more. From a ridge the valley fog
 *   reads as a white sea; inside it, as a veil capped near the player, and thinner around them.
 * - Haze: falling rain and snow veil everything a little, and the ground deeper than the focus plane
 *   (valleys seen from a ridge) more.
 * - Exposure (the eye's adaptation, from the sky's light), then the grades: an overcast or rainy sky's
 *   flat light takes some colour out (lamps keep theirs), and at night dark texels lose colour toward a
 *   scotopic blue, bright ones (lamps, windows, what they light) keep theirs.
 * - The limit: a texel past full brightness in any channel is scaled down whole to it, so it keeps its
 *   hue. At a night exposure of 4 a street lamp's pool would otherwise clip its amber to pale lemon,
 *   and a headlight's beam on the grass to lemon green.
 *
 * A clear dry sky at exposure 1 and no night leaves every texel within full brightness exactly as it
 * was (a settled day has none past it).
 *
 * @module render/sky/post
 */
import { Color, Vector2, Vector3 } from "three"

import type { FogLayers } from "../../sim/sky/local.ts"
import { linear } from "../geometry.ts"
import { yOf } from "../ground.ts"
import { PALETTE } from "../palette.ts"
import type { Rgb } from "./light.ts"

/** Extinction of fog at density 1, per metre (about 100 m of visibility), × density²: a regime's mist (0.3) is a light haze, its fog (0.9) thick. */
const EXTINCTION = 0.03
/** The view ray a point is veiled along, m: `near` at the focus plane plus the depth past it, kept within `least` and `most` (it climbs at sin 30°). */
const PATH = { near: 60, least: 16, most: 240 } as const
/** The valley fog thins over this height above its top, the cloud under its base, m. */
const FALLOFF = { valley: 25, cloud: 40 } as const
/** The most a texel is veiled: `near` at and before the focus plane (the player and the road stay readable in the thickest fog), rising to `far` over `over` m deeper. */
const MOST: { readonly near: number; readonly far: number; readonly over: number } = { near: 0.6, far: 0.92, over: 400 }
/** Around the player the veil thins to BUBBLE.least of itself, from `near` to `far` m on the ground: the road ahead stays readable. */
const BUBBLE = { least: 0.45, near: 6, far: 50 } as const
/**
 * Rain and snow haze from the precipitation at the focus (rain + 3 × snow, mm/h of water: snow hides
 * more): an optical depth `veil` × p^0.5 everywhere and `perMetre` × p^0.7 per metre of ground deeper
 * than the focus plane.
 */
const HAZE = { snow: 3, veil: 0.05, perMetre: 0.00025 } as const
/**
 * How the fog gathers light, as a level face of albedo PALETTE.fog: the key light as it falls on level
 * ground (`FogLight.key`: a low sun only grazes it, so its orange tints the fog faintly) and the
 * hemisphere, mostly its sky, some ground bounce from under the fog.
 */
const FOG = { sky: 0.8, ground: 0.2 } as const
/**
 * The night grade: a dark texel's colour moves toward its luminance × `tint`, a scotopic blue-grey
 * (Thompson, Shirley & Ferwerda 2002), by `weight` × night, less as the texel brightens from `from` to `to`
 * (lamps, lit windows and what they light keep their colour). The tint multiplies a luminance, so it is
 * no palette colour (its blue is above 1); its own luminance, 0.90, also dims the dark a little.
 */
const SCOTOPIC = { tint: [0.66, 0.9, 1.6], weight: 0.8, from: 0.05, to: 0.35 } as const
/** View distance of the focus plane, m (pipeline's DISTANCE): haze grows past it. */
const FOCUS_DEPTH = 500
const NEAR = 1

/** The post pass's uniforms (pipeline's blit material holds these very cells): the camera's, written by PixelView.render, and the atmosphere's, by `writePost`. */
export const makePost = () => ({
  /** The snapped camera's position and axes, three space, and metres per texel. */
  uCamPos: { value: new Vector3() },
  uRight: { value: new Vector3(1, 0, 0) },
  uUp: { value: new Vector3(0, 1, 0) },
  uBack: { value: new Vector3(0, 0, 1) },
  uTexel: { value: 0.125 },
  /** The view's focus, three space. */
  uFocus: { value: new Vector3() },
  /** Valley fog: top (render y), extinction per m, fall-off above the top (m). */
  uValley: { value: new Vector3(0, 0, FALLOFF.valley) },
  /** Hill cloud: base (render y), extinction per m, fall-off under the base (m). */
  uCloud: { value: new Vector3(0, 0, FALLOFF.cloud) },
  /** Haze: optical depth everywhere, and per metre past the focus plane. */
  uHaze: { value: new Vector2() },
  uFogMost: { value: MOST.near },
  uFogColor: { value: new Color() },
  uExposure: { value: 1 },
  uNight: { value: 0 },
  uGrey: { value: 0 }
})
/** One view's post uniforms. */
export type PostUniforms = ReturnType<typeof makePost>

/**
 * The post pass's GLSL: the uniforms above and `vec3 atmosphere(vec3 c, vec2 t, float d)`, the
 * linear colour `c` of target texel `t` at depth-buffer distance `d` (m past the near plane) after
 * fog, haze, exposure and the night grade. The including shader declares `uRtSize`.
 */
export const POST_GLSL = /* glsl */ `
  uniform vec3 uCamPos;
  uniform vec3 uRight;
  uniform vec3 uUp;
  uniform vec3 uBack;
  uniform float uTexel;
  uniform vec3 uFocus;
  uniform vec3 uValley;
  uniform vec3 uCloud;
  uniform vec2 uHaze;
  uniform float uFogMost;
  uniform vec3 uFogColor;
  uniform float uExposure;
  uniform float uNight;
  uniform float uGrey;

  // Fog in heights [a, b] per unit extinction: the valley layer (full under its top, falling off over it) and the cloud (full over its base, falling off under it).
  float valleyFog(float a, float b) {
    float top = uValley.x, h = uValley.z;
    return max(min(b, top) - a, 0.0) + h * (exp(-max(a - top, 0.0) / h) - exp(-max(b - top, 0.0) / h));
  }
  float cloudFog(float a, float b) {
    float base = uCloud.x, h = uCloud.z;
    return max(b - max(a, base), 0.0) + h * (exp(-(base - min(b, base)) / h) - exp(-(base - min(a, base)) / h));
  }

  vec3 atmosphere(vec3 c, vec2 t, float d) {
    float dist = ${NEAR.toFixed(1)} + d;
    vec2 plane = (t + 0.5 - 0.5 * uRtSize) * uTexel;
    vec3 p = uCamPos + uRight * plane.x + uUp * plane.y - uBack * dist;
    float beyond = dist - ${FOCUS_DEPTH.toFixed(1)};
    // The view ray climbs at sin 30°: a path of 2h m spans h m of height.
    float b = p.y + 0.5 * clamp(${PATH.near.toFixed(1)} + beyond, ${PATH.least.toFixed(1)}, ${PATH.most.toFixed(1)});
    float tau = 2.0 * (uValley.y * valleyFog(p.y, b) + uCloud.y * cloudFog(p.y, b)) + uHaze.x + uHaze.y * max(beyond, 0.0);
    float most = mix(uFogMost, ${MOST.far.toFixed(2)}, smoothstep(0.0, ${MOST.over.toFixed(1)}, beyond));
    float bubble = mix(${BUBBLE.least.toFixed(2)}, 1.0, smoothstep(${BUBBLE.near.toFixed(1)}, ${BUBBLE.far.toFixed(1)}, length(p.xz - uFocus.xz)));
    c = mix(c, uFogColor, min(1.0 - exp(-tau), most) * bubble);
    c *= uExposure;
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    // Overcast and rain: flat light, duller colours; lamps and lit windows (bright on screen) keep theirs.
    c = mix(c, vec3(l), uGrey * (1.0 - smoothstep(0.3, 0.7, l)));
    // Night: dark texels shift toward a scotopic blue-grey; lamps and lit windows keep their colour.
    c = mix(c, l * vec3(${SCOTOPIC.tint.map((v) => v.toFixed(2)).join(", ")}), ${SCOTOPIC.weight.toFixed(2)} * uNight * (1.0 - smoothstep(${SCOTOPIC.from.toFixed(2)}, ${SCOTOPIC.to.toFixed(2)}, l)));
    // Past full brightness (a lamp's pool, a headlight's beam at a night exposure) a texel dims as a whole instead of clipping per channel: it keeps its hue.
    return c / max(1.0, max(c.r, max(c.g, c.b)));
  }
`

/** The atmosphere's settings for one frame: fog layers (render y), haze, the cap and the lit fog colour. */
export interface Atmosphere {
  readonly valley: { readonly top: number; readonly density: number }
  readonly cloud: { readonly base: number; readonly density: number }
  readonly haze: { readonly veil: number; readonly perMetre: number }
  readonly most: number
  readonly colour: Rgb
}

/**
 * The scene's light as the fog gathers it (linear, a lightning flash included): the key light on level
 * ground (colour × intensity × the sine of its elevation), and the hemisphere's sky and ground colours × its intensity.
 */
export interface FogLight { readonly key: Rgb; readonly sky: Rgb; readonly ground: Rgb }

const FOG_COLOUR = linear(PALETTE.fog)

/** The atmosphere for `layers` (the sim's fog, m a.s.l.), the rain and snow falling at the focus (mm/h) and the scene's `light`. */
export const atmosphere = (layers: FogLayers, falling: { readonly rain: number; readonly snow: number }, light: FogLight): Atmosphere => {
  const p = Math.max(0, falling.rain) + HAZE.snow * Math.max(0, falling.snow)
  const gather = (c: 0 | 1 | 2) => (FOG_COLOUR[c] * (light.key[c] + FOG.sky * light.sky[c] + FOG.ground * light.ground[c])) / Math.PI
  return {
    valley: { top: yOf(layers.valleyTop), density: EXTINCTION * layers.valleyDensity ** 2 },
    cloud: { base: yOf(layers.cloudBase), density: EXTINCTION * layers.cloudDensity ** 2 },
    haze: { veil: HAZE.veil * p ** 0.5, perMetre: HAZE.perMetre * p ** 0.7 },
    most: MOST.near,
    colour: [gather(0), gather(1), gather(2)]
  }
}

/** The exposure, the night and weather grades and the focus (three space) the post pass takes besides the atmosphere. */
export interface PostView { readonly exposure: number; readonly night: number; readonly grey: number; readonly x: number; readonly y: number; readonly z: number }

/** Writes `a` and `view` into `post`'s cells (in place: the blit material holds them). */
export const writePost = (post: PostUniforms, a: Atmosphere, view: PostView): void => {
  post.uValley.value.set(a.valley.top, a.valley.density, FALLOFF.valley)
  post.uCloud.value.set(a.cloud.base, a.cloud.density, FALLOFF.cloud)
  post.uHaze.value.set(a.haze.veil, a.haze.perMetre)
  post.uFogMost.value = a.most
  post.uFogColor.value.setRGB(a.colour[0], a.colour[1], a.colour[2])
  post.uExposure.value = view.exposure
  post.uNight.value = view.night
  post.uGrey.value = view.grey
  post.uFocus.value.set(view.x, view.y, view.z)
}
