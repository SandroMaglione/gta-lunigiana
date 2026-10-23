/**
 * Unlit materials for things that shine at night: the chunks' glow layer (window panes, lantern
 * glass) and the vehicle lamps. They read `SKY_UNIFORMS` by reference, so the sky host turns every
 * window, lantern and lamp on and off by writing `uLamps` once a frame. Unlit colours do not darken
 * with the lights, so their day colour is scaled by `uAmbient`. The lit colour is divided by the post
 * pass's exposure, so a lamp shines as bright on screen at dusk as at midnight; bright, it is spared
 * the night grade, and past full brightness the post pass dims it whole, so it keeps its hue.
 * By day the panes are not drawn at all: the windows keep their settled daytime look.
 *
 * @module render/sky/glow
 */
import { Color, ShaderMaterial } from "three"

import { PALETTE } from "../palette.ts"
import { SKY_UNIFORMS } from "./uniforms.ts"

/** Lit colour gain of a glow pane at full `uLamps` (vertex colour × this, on screen): bright enough to keep its hue through the night grade. */
const GLOW_GAIN = 1.2
/** Below this `uLamps` (day) the panes are not drawn. */
const GLOW_FROM = 0.02
/** Vehicle lamps: day colour × ambient × LAMP_DAY (a lit painted box), lit colour × LAMP_GAIN on screen at full `uLamps`. */
const LAMP_DAY = 0.7
const LAMP_GAIN = 3

const VERTEX = /* glsl */ `
  varying vec3 vLit;
  void main() {
    vLit = color;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

/**
 * The glow layer of every chunk (one material, shared): by day each pane is dark glass lit by the
 * ambient light, at night it adds its vertex colour (warm window light, lantern light) × `uLamps`.
 */
export const glowMaterial = new ShaderMaterial({
  uniforms: {
    uLamps: SKY_UNIFORMS.uLamps,
    uAmbient: SKY_UNIFORMS.uAmbient,
    uExposure: SKY_UNIFORMS.uExposure,
    uGlass: { value: new Color(PALETTE.windowGlass) },
  },
  vertexColors: true,
  vertexShader: VERTEX,
  fragmentShader: /* glsl */ `
    uniform float uLamps;
    uniform float uAmbient;
    uniform float uExposure;
    uniform vec3 uGlass;
    varying vec3 vLit;
    void main() {
      if (uLamps < ${GLOW_FROM.toFixed(2)}) discard;
      gl_FragColor = vec4(uGlass * uAmbient + vLit * (uLamps * ${GLOW_GAIN.toFixed(2)} / uExposure), 1.0);
    }
  `,
})

const LAMP_FRAGMENT = /* glsl */ `
  uniform float uLamps;
  uniform float uAmbient;
  uniform float uExposure;
  uniform float uOn;
  varying vec3 vLit;
  void main() {
    gl_FragColor = vec4(vLit * (uAmbient * ${LAMP_DAY.toFixed(2)} + uOn * uLamps * ${LAMP_GAIN.toFixed(2)} / uExposure), 1.0);
  }
`
/** A vehicle lamp material: `on` shines at night (HDR), off keeps the day look (vertex colour × ambient). One program for both. */
const lampMaterial = (on: boolean): ShaderMaterial =>
  new ShaderMaterial({
    uniforms: {
      uLamps: SKY_UNIFORMS.uLamps,
      uAmbient: SKY_UNIFORMS.uAmbient,
      uExposure: SKY_UNIFORMS.uExposure,
      uOn: { value: on ? 1 : 0 },
    },
    vertexColors: true,
    vertexShader: VERTEX,
    fragmentShader: LAMP_FRAGMENT,
  })

/** The vehicle lamp materials (shared by every vehicle): lamps on (moving traffic, the player's car) and off (parked). */
export const vehicleLampMaterials = { on: lampMaterial(true), off: lampMaterial(false) } as const
