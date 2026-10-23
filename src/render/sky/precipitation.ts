/**
 * Rain and snow: one static buffer each (rain 1-texel line streaks, snow 1–2-texel points) whose
 * drops are anchored to the world on the camera plane and wrapped in a box around the focus by the
 * vertex shader, so the camera never drags them and nothing is uploaded per frame. In this
 * orthographic view rain falls in front of whatever it falls on, so the drops ignore depth and draw
 * after the world. How many show is the draw range, from mm/h; the fall is integrated on the CPU in
 * float64 from sim seconds (frozen in the pause) and wrapped, slanted by the wind. Each drop snaps
 * to the texel grid, so a streak keeps its pixel shape as it falls. Unlit: colour × `ambient`.
 *
 * @module render/sky/precipitation
 */
import { BufferGeometry, Color, Float32BufferAttribute, Group, LineSegments, Points, ShaderMaterial, Vector2, Vector3 } from "three"

import { PALETTE } from "../palette.ts"
import type { SkyFrame } from "./frame.ts"
import { stream } from "./random.ts"
import { phaseLocked, TIME_WRAP } from "./uniforms.ts"

/** The two kinds of precipitation drawn. */
type Kind = "rain" | "snow"

/**
 * Most drops drawn at once, per kind (the static buffers' size: 12288 streaks and 36864 flakes, 0.84 MB): over the widest
 * 1080p view (a 112 × 64 m box at 16:9, 144 × 64 m at 21:9) rain keeps thickening to ≈ 57 (21:9: 38) mm/h and snow to
 * ≈ 54 (33) mm/h of water, past the heaviest the weather sends on high ground (the day plan's 15 mm/h at sea level, twice that
 * from about 1700 m up: `orographic`). The flakes are laid in order, so snow under ≈ 11 (6.5) mm/h draws only the first 16384.
 */
export const MOST = { rain: 12288, snow: 36864 } as const satisfies Record<Kind, number>
/** Fall speed, m/s: rain at its terminal speed (2–5 mm drops fall 6.5–9 m/s), snow ≈ 1 m/s. */
const FALL = { rain: 8, snow: 1 } as const satisfies Record<Kind, number>
/** Speed of each of the three depth layers × the kind's fall: a slower far layer, a faster near one (drops pick one by seed). */
const LAYERS = [0.75, 1, 1.3] as const
/**
 * Drops per square metre of the camera plane at the reference rate `at` (mm/h), growing as the
 * rate^`power`: heavy rain (10 mm/h) ≈ 1 streak per 100 texels at 8 texels/m, moderate snow (1 mm/h
 * of water) ≈ 1 flake per 90. Snow falls 8× slower than rain, so the same water is many more flakes.
 */
const DENSITY = { rain: { perM2: 0.6, at: 10, power: 0.6 }, snow: { perM2: 0.7, at: 1, power: 0.5 } } as const satisfies Record<Kind, unknown>
/** Rain streak length on the camera plane, m (4–6 texels): motion blur, exaggerated. */
const STREAK = 0.7
/** Snowflakes drift this far sideways, m, as they fall, swaying at ≈ 1.3 rad/s (phase-locked to the uTime wrap). */
const WOBBLE = { metres: 0.3, rate: phaseLocked(1.3) } as const
/** The wrap box is the view plus this margin, m, rounded up to whole BOX_STEP: it changes (reshuffling the drops) only when the zoom does. */
const BOX = { margin: 4, step: 16 } as const
/** Longest frame step integrated, s: a hitch or a jump in sim time does not fling the drops. */
const MAX_DT = 0.25
/** Draw order among the transparent effects: after the bolt and every other effect, the rain and snow lie over the view. */
const PRECIPITATION_ORDER = 3

/** Drops per square metre of the camera plane for `mmPerHour` (liquid water) of `kind`. */
export const dropDensity = (kind: Kind, mmPerHour: number): number => {
  const { perM2, at, power } = DENSITY[kind]
  return mmPerHour > 0 ? perM2 * (mmPerHour / at) ** power : 0
}

/** How many drops of `kind` a wrap box of `area` m² holds at `mmPerHour`, capped at the buffer. */
export const dropCount = (kind: Kind, mmPerHour: number, area: number): number => Math.min(MOST[kind], Math.round(dropDensity(kind, mmPerHour) * area))

/** The wrap box for a view of `width` × `height` screen metres: the view plus a margin, in whole 16 m steps. */
export const wrapBox = (width: number, height: number, out: Vector2): Vector2 =>
  out.set(Math.ceil((width + 2 * BOX.margin) / BOX.step) * BOX.step, Math.ceil((height + 2 * BOX.margin) / BOX.step) * BOX.step)

/**
 * The on-screen velocity (camera plane: along `right`, along `up`, m/s) of something falling at
 * `fall` m/s through air moving with `wind` (sim frame: x east, y north).
 */
export const planeVelocity = (wind: { readonly x: number; readonly y: number }, fall: number, right: Vector3, up: Vector3, out: Vector2): Vector2 => {
  // three space: (east, up, −north)
  return out.set(wind.x * right.x - fall * right.y - wind.y * right.z, wind.x * up.x - fall * up.y - wind.y * up.z)
}

/** `scroll` moved by `velocity` × `dt` and wrapped into [0, box) per axis (float64 on the CPU: no drift after hours of play). */
export const advanceScroll = (scroll: Vector2, velocity: Vector2, dt: number, box: Vector2): Vector2 => {
  const x = (scroll.x + velocity.x * dt) % box.x, y = (scroll.y + velocity.y * dt) % box.y
  return scroll.set(x < 0 ? x + box.x : x, y < 0 ? y + box.y : y)
}

/**
 * The shared vertex code: `position` is the drop's seed in [0, 1)³ (x, y: where in the box; z: its
 * layer and shade). The drop's plane position is wrapped around the focus, then snapped a quarter
 * texel off the texel grid, never on a texel edge, so it rasterises the same way every frame.
 */
const PLACE = /* glsl */ `
  uniform vec2 uBox;
  uniform vec2 uScroll[3];
  uniform vec2 uFocus;
  uniform vec3 uCentre;
  uniform vec3 uRight;
  uniform vec3 uUp;
  uniform float uTexel;
  varying float vShade;
  vec2 wrapped() {
    int layer = int(min(position.z * 3.0, 2.0));
    vec2 p = position.xy * uBox + uScroll[layer];
    return mod(p - uFocus + 0.5 * uBox, uBox) - 0.5 * uBox;
  }
  vec4 project(vec2 local) {
    vec2 plane = (floor((uFocus + local) / uTexel) + 0.25) * uTexel - uFocus;
    return projectionMatrix * viewMatrix * vec4(uCentre + uRight * plane.x + uUp * plane.y, 1.0);
  }
`

const FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAlpha;
  varying float vShade;
  void main() {
    gl_FragColor = vec4(uColor * vShade, uAlpha);
  }
`

/** Rain and snow around the focus; add `object` to the scene once and `update` it every frame. */
export class Precipitation {
  /** Add to the scene once: the rain and snow stay in it (none falling draws nothing). */
  readonly object = new Group()
  /** The rain streaks and the snowflakes (children of `object`). */
  readonly rain: LineSegments<BufferGeometry, ShaderMaterial>
  readonly snow: Points<BufferGeometry, ShaderMaterial>
  /** The wrap box on the camera plane, m. */
  readonly box = new Vector2(1, 1)
  private readonly scroll = { rain: LAYERS.map(() => new Vector2()), snow: LAYERS.map(() => new Vector2()) } as const satisfies Record<Kind, unknown>
  private readonly shared = {
    uBox: { value: this.box },
    uFocus: { value: new Vector2() },
    uCentre: { value: new Vector3() },
    uRight: { value: new Vector3() },
    uUp: { value: new Vector3() },
    uTexel: { value: 0.125 }
  }
  private readonly velocity = new Vector2()
  private readonly layer = new Vector2()
  private last = Number.NaN

  /** `seed` lays the drops (the same every load). */
  constructor(seed = 1) {
    const r = stream(seed)
    const rainSeeds = new Float32Array(MOST.rain * 6), tail = new Float32Array(MOST.rain * 2)
    for (let i = 0; i < MOST.rain; i++) {
      const x = r(), y = r(), z = r()
      rainSeeds.set([x, y, z, x, y, z], i * 6)
      tail[i * 2 + 1] = 1
    }
    const rainGeometry = new BufferGeometry()
    rainGeometry.setAttribute("position", new Float32BufferAttribute(rainSeeds, 3))
    rainGeometry.setAttribute("tail", new Float32BufferAttribute(tail, 1))
    this.rain = new LineSegments(rainGeometry, new ShaderMaterial({
      uniforms: { ...this.shared, uScroll: { value: this.scroll.rain }, uStreak: { value: new Vector2() }, uColor: { value: new Color() }, uAlpha: { value: 0.55 } },
      vertexShader: /* glsl */ `
        attribute float tail;
        uniform vec2 uStreak;
        ${PLACE}
        void main() {
          vShade = 0.7 + 0.3 * fract(position.z * 3.0);
          // The tail is the head minus a whole-texel streak: every streak has the same pixel shape.
          gl_Position = project(wrapped() - uStreak * tail);
        }
      `,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthTest: false,
      depthWrite: false
    }))
    const snowSeeds = new Float32Array(MOST.snow * 3)
    for (let i = 0; i < snowSeeds.length; i++) snowSeeds[i] = r()
    const snowGeometry = new BufferGeometry()
    snowGeometry.setAttribute("position", new Float32BufferAttribute(snowSeeds, 3))
    this.snow = new Points(snowGeometry, new ShaderMaterial({
      uniforms: { ...this.shared, uScroll: { value: this.scroll.snow }, uTime: { value: 0 }, uColor: { value: new Color() }, uAlpha: { value: 0.9 } },
      vertexShader: /* glsl */ `
        uniform float uTime;
        ${PLACE}
        void main() {
          vShade = 0.75 + 0.25 * fract(position.z * 3.0);
          vec2 local = wrapped();
          local.x += ${WOBBLE.metres.toFixed(2)} * sin(uTime * ${WOBBLE.rate.toFixed(8)} + position.z * 40.0);
          gl_Position = project(local);
          gl_PointSize = position.z > 0.9 ? 2.0 : 1.0; // texels of the render target (not PointsMaterial: it multiplies by the pixel ratio)
        }
      `,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthTest: false,
      depthWrite: false
    }))
    for (const drops of [this.rain, this.snow]) {
      drops.geometry.setDrawRange(0, 0)
      drops.frustumCulled = false // drawn around the focus by the shader, wherever the geometry's bounds say
      drops.renderOrder = PRECIPITATION_ORDER
      this.object.add(drops)
    }
  }

  /**
   * Moves the drops to sim time `frame.now` around `focus` (three space) for a camera with plane
   * axes `axes` at `texelsPerMetre`, and sets how many fall from `frame.rain` and `frame.snow`.
   * `viewMetres` sizes the wrap box: pass the view at the widest zoom (`view.view / WIDEST_ZOOM`),
   * so the zoom easing never resizes the box (which reshuffles every drop).
   */
  update(frame: SkyFrame, focus: Vector3, axes: { readonly right: Vector3; readonly up: Vector3 }, texelsPerMetre: number, viewMetres: { readonly width: number; readonly height: number }): void {
    const dt = Number.isNaN(this.last) ? 0 : Math.min(MAX_DT, Math.max(0, frame.now - this.last))
    this.last = frame.now
    wrapBox(viewMetres.width, viewMetres.height, this.box)
    const u = this.shared, texel = 1 / texelsPerMetre
    u.uFocus.value.set(focus.dot(axes.right), focus.dot(axes.up))
    u.uCentre.value.copy(focus)
    u.uRight.value.copy(axes.right)
    u.uUp.value.copy(axes.up)
    u.uTexel.value = texel
    const area = this.box.x * this.box.y
    for (const kind of ["rain", "snow"] as const) {
      const drops = kind === "rain" ? this.rain : this.snow, uniforms = drops.material.uniforms
      planeVelocity(frame.wind, FALL[kind], axes.right, axes.up, this.velocity)
      this.scroll[kind].forEach((scroll, i) => advanceScroll(scroll, this.layer.copy(this.velocity).multiplyScalar(LAYERS[i]!), dt, this.box))
      const count = dropCount(kind, kind === "rain" ? frame.rain : frame.snow, area)
      drops.geometry.setDrawRange(0, kind === "rain" ? 2 * count : count)
      uniforms["uColor"]!.value.setHex(kind === "rain" ? PALETTE.rain : PALETTE.snowFlake).multiplyScalar(frame.ambient)
    }
    // The streak points back along the rain's on-screen velocity, rounded to whole texels.
    const v = planeVelocity(frame.wind, FALL.rain, axes.right, axes.up, this.velocity), speed = v.length() || 1
    this.rain.material.uniforms["uStreak"]!.value.set(Math.round((v.x / speed) * STREAK / texel) * texel, Math.round((v.y / speed) * STREAK / texel) * texel)
    this.snow.material.uniforms["uTime"]!.value = frame.now % TIME_WRAP
  }
}
