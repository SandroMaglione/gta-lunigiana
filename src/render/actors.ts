/**
 * Actor nodes and the vehicle models: one low-poly model per vehicle model, with a charred variant
 * for the shell left after it blows up (people are in `people.ts`, animals in `animals.ts`).
 * Everything faces local +X, so `rotation.y = heading` (radians CCW from east). The player's node
 * and their car's show an x-ray proxy: a flat silhouette drawn only where the world hides the
 * actor. A vehicle's mesh stands on y = 0 at rest, centred on its centre of mass, with its wheels
 * where `VEHICLES` puts them; its node sits at the centre of mass, so body and proxy hang `cg`
 * below it. Its head and tail lamps are a child of the body, one unlit mesh per model that shines
 * at night when on.
 *
 * @module render/actors
 */
import {
  Box3,
  BoxGeometry,
  Color,
  CylinderGeometry,
  GreaterDepth,
  Group,
  Mesh,
  ShaderMaterial,
  Vector3,
  type BufferGeometry,
  type Material,
} from "three"

import { VEHICLES, type VehicleModel } from "../sim/vehicles.ts"
import { linear, merge, paint } from "./geometry.ts"
import { DRAW_ORDER } from "./order.ts"
import { PALETTE } from "./palette.ts"
import { vehicleLampMaterials } from "./sky/glow.ts"
import { SKY_UNIFORMS } from "./sky/uniforms.ts"

const box = (
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  hex: number,
): BufferGeometry => paint(new BoxGeometry(w, h, d).translate(x, y + h / 2, z), hex)

/** How far either side of the sim's axle a drawn tandem's two axles sit: the truck's rear pair is one axle in the sim. */
const TANDEM: Partial<Record<VehicleModel, number>> = { truck: 0.65 }

/** Where a model's wheels are drawn: forward of the centre of mass (x) and to its right (z, three's −left), m. */
export const wheelLayout = (
  model: VehicleModel,
): ReadonlyArray<{ readonly x: number; readonly z: number }> => {
  const { wheels } = VEHICLES[model],
    rear = Math.min(...wheels.map((w) => w.x)),
    split = TANDEM[model]
  return wheels.flatMap((w) =>
    (split !== undefined && w.x === rear ? [w.x + split, w.x - split] : [w.x]).map((x) => ({
      x,
      z: -w.y,
    })),
  )
}

const wheels = (model: VehicleModel): Array<BufferGeometry> => {
  const r = VEHICLES[model].wheelRadius
  return wheelLayout(model).map(({ x, z }) =>
    paint(
      new CylinderGeometry(r, r, 0.24, 8).rotateX(Math.PI / 2).translate(x, r, z),
      PALETTE.outline,
    ),
  )
}
const glass = PALETTE.carabinieriBlue

/** Body builders per vehicle model (the wheels come from `wheelLayout`), sized from VEHICLES; `paint` is the body colour. */
const VEHICLE_BODIES = {
  panda: (body) => {
    const { length: l, width: w } = VEHICLES.panda
    return [
      box(l, 0.75, w, 0, 0.3, 0, body),
      box(l * 0.6, 0.55, w * 0.92, -l * 0.08, 1.05, 0, glass),
      box(l * 0.62, 0.08, w * 0.94, -l * 0.08, 1.6, 0, body),
    ]
  },
  ape: (body) => {
    const { length: l, width: w } = VEHICLES.ape
    return [
      box(l * 0.38, 1.05, w * 0.9, l * 0.3, 0.35, 0, body),
      box(0.06, 0.4, w * 0.75, l * 0.49, 0.95, 0, glass),
      box(l * 0.6, 0.1, w, -l * 0.18, 0.55, 0, PALETTE.woodBrown),
      box(l * 0.6, 0.4, 0.06, -l * 0.18, 0.65, w / 2 - 0.03, PALETTE.woodBrown),
      box(l * 0.6, 0.4, 0.06, -l * 0.18, 0.65, -w / 2 + 0.03, PALETTE.woodBrown),
    ]
  },
  truck: (body) => {
    const { length: l, width: w } = VEHICLES.truck
    return [
      box(1.9, 1.9, w, l / 2 - 0.95, 0.6, 0, body),
      box(0.06, 0.7, w * 0.85, l / 2, 1.6, 0, glass),
      box(l - 2.1, 0.25, w, -1.05, 0.9, 0, PALETTE.stoneDark),
      box(2.4, 1.5, w * 0.8, -1.4, 1.15, 0, PALETTE.marbleWhite),
    ]
  },
  carabinieri: () => {
    const { length: l, width: w } = VEHICLES.carabinieri
    return [
      box(l, 0.7, w, 0, 0.3, 0, PALETTE.carabinieriBlue),
      box(l, 0.12, w + 0.02, 0, 0.62, 0, PALETTE.signalRed),
      box(l * 0.5, 0.45, w * 0.9, -l * 0.06, 1.0, 0, PALETTE.outline),
      box(l * 0.52, 0.08, w * 0.92, -l * 0.06, 1.45, 0, PALETTE.marbleWhite),
      box(0.3, 0.12, w * 0.7, -l * 0.02, 1.53, 0, PALETTE.limestone),
      box(0.3, 0.1, w * 0.3, -l * 0.02, 1.55, w * 0.2, PALETTE.carabinieriBlue),
    ]
  },
} as const satisfies Record<VehicleModel, (paint: number) => Array<BufferGeometry>>

/** A pair of lamps (or one, at `z` 0) on a front or back face: centre x, bottom y, half the spacing z, box size. */
const lampPair = (
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  hex: number,
): Array<BufferGeometry> =>
  z === 0
    ? [box(0.06, h, w, x, y, 0, hex)]
    : [box(0.06, h, w, x, y, z, hex), box(0.06, h, w, x, y, -z, hex)]

/** Head lamps (white, on the front face) and tail lamps (red, on the back face) per model, standing 3 cm proud of the body. */
const VEHICLE_LAMPS = {
  panda: () => {
    const { length: l, width: w } = VEHICLES.panda
    return [
      ...lampPair(l / 2, 0.75, w * 0.32, 0.3, 0.16, PALETTE.marbleWhite),
      ...lampPair(-l / 2, 0.8, w * 0.36, 0.24, 0.14, PALETTE.signalRed),
    ]
  },
  ape: () => {
    const { length: l, width: w } = VEHICLES.ape
    return [
      ...lampPair(l * 0.49, 0.62, 0, 0.22, 0.16, PALETTE.marbleWhite),
      ...lampPair(-l * 0.48, 0.72, w / 2 - 0.06, 0.12, 0.12, PALETTE.signalRed),
    ]
  },
  truck: () => {
    const { length: l, width: w } = VEHICLES.truck
    return [
      ...lampPair(l / 2, 0.8, w * 0.36, 0.3, 0.16, PALETTE.marbleWhite),
      ...lampPair(-l / 2, 0.92, w * 0.4, 0.26, 0.14, PALETTE.signalRed),
    ]
  },
  carabinieri: () => {
    const { length: l, width: w } = VEHICLES.carabinieri
    return [
      ...lampPair(l / 2, 0.7, w * 0.32, 0.34, 0.16, PALETTE.marbleWhite),
      ...lampPair(-l / 2, 0.78, w * 0.35, 0.3, 0.14, PALETTE.signalRed),
    ]
  },
} as const satisfies Record<VehicleModel, () => Array<BufferGeometry>>

const lampGeometry = new Map<VehicleModel, BufferGeometry>()
/** A model's lamps, built once and shared by every vehicle of the model (never disposed). */
const lampsOf = (model: VehicleModel): BufferGeometry => {
  let geometry = lampGeometry.get(model)
  if (geometry === undefined) lampGeometry.set(model, (geometry = merge(VEHICLE_LAMPS[model]())))
  return geometry
}

/**
 * Where smoke and fire leave each model's engine, in its mesh's frame (forward, up from the ground, right; m), just outside the
 * body so they show: over the Panda's and the Giulia's bonnet, in front of the truck's grille (its engine sits under the cab-over
 * cab), and behind the Ape's cab over the bed (its two-stroke sits under the seat).
 */
const ENGINE = {
  panda: { x: 1.35, y: 1.05, z: 0 },
  ape: { x: 0.1, y: 0.75, z: 0 },
  truck: { x: 4.05, y: 1.1, z: 0 },
  carabinieri: { x: 1.6, y: 1, z: 0 },
} as const satisfies Record<
  VehicleModel,
  { readonly x: number; readonly y: number; readonly z: number }
>

/**
 * The x-ray's flat yellow, unlit. It is divided by the post pass's exposure, as the lamps are
 * (`sky/glow`), so it shows the same yellow on screen at any hour, not one brightened 4× at night.
 */
const xrayMaterial = new ShaderMaterial({
  uniforms: { uColor: { value: new Color(PALETTE.signYellow) }, uExposure: SKY_UNIFORMS.uExposure },
  vertexShader:
    "void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
  fragmentShader:
    "uniform vec3 uColor; uniform float uExposure; void main() { gl_FragColor = vec4(uColor / uExposure, 1.0); }",
  depthFunc: GreaterDepth,
  depthWrite: false,
})
/** How far over the ground an x-ray proxy's bottom stays, m: sloped terrain at the feet would light it up. */
const XRAY_FLOOR = 0.15

/**
 * A silhouette box drawn only where something nearer covers it. It encloses every given shape, so
 * the actor's own body is always behind its front faces and never shows through; its bottom stays
 * a little above the ground.
 */
export const xray = (shapes: ReadonlyArray<BufferGeometry>): Mesh => {
  const bounds = new Box3()
  for (const shape of shapes) {
    shape.computeBoundingBox()
    if (shape.boundingBox !== null) bounds.union(shape.boundingBox)
  }
  bounds.expandByScalar(0.05)
  bounds.min.y = XRAY_FLOOR
  const size = bounds.getSize(new Vector3()),
    centre = bounds.getCenter(new Vector3())
  const proxy = new Mesh(
    new BoxGeometry(size.x, size.y, size.z).translate(centre.x, centre.y, centre.z),
    xrayMaterial,
  )
  proxy.renderOrder = DRAW_ORDER.xray // after the opaque world, so the depth buffer is complete
  return proxy
}

/**
 * A rendered actor: its body, and the x-ray proxies it shows while the world hides it. A proxy is
 * built the first time it shows: only the player and the car they drive ever show one, so the
 * other people, animals and cars never build one.
 */
export class ActorNode extends Group {
  readonly body: Mesh
  private readonly proxies = new Map<string, Mesh>()
  private shown: Mesh | undefined = undefined
  constructor(geometry: BufferGeometry, material: Material) {
    super()
    this.body = new Mesh(geometry, material)
    this.body.castShadow = true
    this.rotation.order = "YZX" // heading outermost, then pitch (or lying down) about the right axis, then roll about the forward one
    this.add(this.body)
  }

  /** Shows its x-ray silhouette (`on`) or hides it. */
  showXray(on: boolean): void {
    this.showProxy(on ? "body" : undefined)
  }

  /** Shows the proxy named `key`, built by `proxy` the first time, in place of the one shown before; `undefined` shows none. */
  protected showProxy(key: string | undefined): void {
    let next = key === undefined ? undefined : this.proxies.get(key)
    if (key !== undefined && next === undefined) {
      next = this.proxy(key)
      this.proxies.set(key, next)
      this.add(next)
    }
    if (next === this.shown) return
    if (this.shown !== undefined) this.shown.visible = false
    if (next !== undefined) next.visible = true
    this.shown = next
  }

  /** Builds the proxy named `key`: here the one there is, round the body where it hangs. */
  protected proxy(_key: string): Mesh {
    const proxy = xray([this.body.geometry])
    proxy.position.copy(this.body.position)
    return proxy
  }

  /** Frees the node's own geometry: its x-ray proxies (a vehicle's body is shared per model and paint). */
  dispose(): void {
    for (const proxy of this.proxies.values()) proxy.geometry.dispose()
  }
}

/** A vehicle node, placed at the vehicle's centre of mass: body and proxy hang its `cg` below. */
export class VehicleNode extends ActorNode {
  readonly model: VehicleModel
  /** Its body colour, as the sim gave it (sRGB hex). */
  readonly paint: number
  /** Where its engine's smoke and fire leave, in the node's frame. */
  readonly engine: Vector3
  /** Engine smoke and flames owed but not yet spawned (a fraction of a puff a frame still smokes, every few frames). */
  smokeDebt = 0
  flameDebt = 0
  /** Where its engine was when it last gave off smoke, and when (sim s): the next frame's smoke trails out from there. */
  readonly smoked = new Vector3()
  smokedAt = -1
  /** Head and tail lamps, a child of the body: the model's shared geometry, unlit, dark (off) until `setLamps(true)`. */
  readonly lamps: Mesh
  constructor(model: VehicleModel, paint: number, geometry: BufferGeometry, material: Material) {
    super(geometry, material)
    this.model = model
    this.paint = paint
    this.body.position.y = -VEHICLES[model].cg
    this.engine = new Vector3(
      ENGINE[model].x,
      ENGINE[model].y - VEHICLES[model].cg,
      ENGINE[model].z,
    )
    this.lamps = new Mesh(lampsOf(model), vehicleLampMaterials.off)
    this.body.add(this.lamps)
  }
  /** Lamps on (they shine at night: moving traffic, the player's car) or off (parked cars keep the day look). */
  setLamps(on: boolean): void {
    this.lamps.material = on ? vehicleLampMaterials.on : vehicleLampMaterials.off
  }
}

/** A burnt-out shell's soot: the palette's charcoal, with this share of each part's lightness still showing through, its hue burnt off. */
const SOOT = { hex: PALETTE.outline, left: 0.1 } as const
/** `intact` charred: a copy with every vertex colour turned grey and darkened most of the way to charcoal. */
const charred = (intact: BufferGeometry): BufferGeometry => {
  const shell = intact.clone(),
    color = shell.getAttribute("color"),
    [r, g, b] = linear(SOOT.hex),
    left = SOOT.left
  for (let i = 0; i < color.count; i++) {
    const grey = 0.2126 * color.getX(i) + 0.7152 * color.getY(i) + 0.0722 * color.getZ(i) // linear luminance
    color.setXYZ(i, r + (grey - r) * left, g + (grey - g) * left, b + (grey - b) * left)
  }
  return shell
}

const vehicleGeometry = new Map<string, BufferGeometry>()
/** A `model`'s body painted `color`, or once it has blown up (`burnt`) its charred shell: shared per model, paint and state, never freed. */
export const vehicleBody = (model: VehicleModel, color: number, burnt = false): BufferGeometry => {
  const key = burnt ? `${model}:${color}:burnt` : `${model}:${color}`
  let geometry = vehicleGeometry.get(key)
  if (geometry === undefined) {
    geometry = burnt
      ? charred(vehicleBody(model, color))
      : merge([...VEHICLE_BODIES[model](color), ...wheels(model)])
    vehicleGeometry.set(key, geometry)
  }
  return geometry
}
/** A vehicle node, its body intact (`vehicleBody`). */
export const vehicleNode = (model: VehicleModel, color: number, material: Material): VehicleNode =>
  new VehicleNode(model, color, vehicleBody(model, color), material)
