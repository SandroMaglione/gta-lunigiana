/**
 * Actor meshes: box-figure people (three walk frames) and one low-poly model per vehicle model,
 * with a charred variant for the shell left after it blows up. Everything faces local +X, so
 * `rotation.y = heading` (radians CCW from east). Each node carries an x-ray proxy: a flat
 * silhouette drawn only where the world hides the actor. A vehicle's mesh stands on y = 0 at rest,
 * centred on its centre of mass, with its wheels where `VEHICLES` puts them; its node sits at the
 * centre of mass, so body and proxy hang `cg` below it.
 *
 * @module render/actors
 */
import {
  Box3, BoxGeometry, CylinderGeometry, GreaterDepth, Group, Mesh, MeshBasicMaterial, Vector3, type BufferGeometry, type Material
} from "three"

import type { Look } from "../sim/index.ts"
import { VEHICLES, type VehicleModel } from "../sim/vehicles.ts"
import { linear, merge, paint } from "./geometry.ts"
import { PALETTE } from "./palette.ts"

const box = (w: number, h: number, d: number, x: number, y: number, z: number, hex: number): BufferGeometry =>
  paint(new BoxGeometry(w, h, d).translate(x, y + h / 2, z), hex)

/** Walk frames: standing, left leg forward, right leg forward. */
const personFrames = (look: Look): readonly [BufferGeometry, BufferGeometry, BufferGeometry] => {
  const body = (stride: number) => merge([
    box(0.2, 0.82, 0.18, stride, 0, 0.11, look.pants),
    box(0.2, 0.82, 0.18, -stride, 0, -0.11, look.pants),
    box(0.3, 0.6, 0.5, 0, 0.82, 0, look.shirt),
    box(0.16, 0.56, 0.12, -stride, 0.84, 0.32, look.shirt),
    box(0.16, 0.56, 0.12, stride, 0.84, -0.32, look.shirt),
    box(0.34, 0.34, 0.34, 0.02, 1.42, 0, look.skin),
    box(0.38, 0.12, 0.38, -0.02, 1.72, 0, look.hair)
  ])
  return [body(0), body(0.16), body(-0.16)]
}

/** How far either side of the sim's axle a drawn tandem's two axles sit: the truck's rear pair is one axle in the sim. */
const TANDEM: Partial<Record<VehicleModel, number>> = { truck: 0.65 }

/** Where a model's wheels are drawn: forward of the centre of mass (x) and to its right (z, three's −left), m. */
export const wheelLayout = (model: VehicleModel): ReadonlyArray<{ readonly x: number; readonly z: number }> => {
  const { wheels } = VEHICLES[model], rear = Math.min(...wheels.map((w) => w.x)), split = TANDEM[model]
  return wheels.flatMap((w) => (split !== undefined && w.x === rear ? [w.x + split, w.x - split] : [w.x]).map((x) => ({ x, z: -w.y })))
}

const wheels = (model: VehicleModel): Array<BufferGeometry> => {
  const r = VEHICLES[model].wheelRadius
  return wheelLayout(model).map(({ x, z }) => paint(new CylinderGeometry(r, r, 0.24, 8).rotateX(Math.PI / 2).translate(x, r, z), PALETTE.outline))
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
      box(0.06, 0.16, 0.3, l / 2, 0.75, w * 0.32, PALETTE.marbleWhite),
      box(0.06, 0.16, 0.3, l / 2, 0.75, -w * 0.32, PALETTE.marbleWhite)
    ]
  },
  ape: (body) => {
    const { length: l, width: w } = VEHICLES.ape
    return [
      box(l * 0.38, 1.05, w * 0.9, l * 0.3, 0.35, 0, body),
      box(0.06, 0.4, w * 0.75, l * 0.49, 0.95, 0, glass),
      box(l * 0.6, 0.1, w, -l * 0.18, 0.55, 0, PALETTE.woodBrown),
      box(l * 0.6, 0.4, 0.06, -l * 0.18, 0.65, w / 2 - 0.03, PALETTE.woodBrown),
      box(l * 0.6, 0.4, 0.06, -l * 0.18, 0.65, -w / 2 + 0.03, PALETTE.woodBrown)
    ]
  },
  truck: (body) => {
    const { length: l, width: w } = VEHICLES.truck
    return [
      box(1.9, 1.9, w, l / 2 - 0.95, 0.6, 0, body),
      box(0.06, 0.7, w * 0.85, l / 2, 1.6, 0, glass),
      box(l - 2.1, 0.25, w, -1.05, 0.9, 0, PALETTE.stoneDark),
      box(2.4, 1.5, w * 0.8, -1.4, 1.15, 0, PALETTE.marbleWhite)
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
      box(0.06, 0.16, 0.34, l / 2, 0.7, w * 0.32, PALETTE.marbleWhite),
      box(0.06, 0.16, 0.34, l / 2, 0.7, -w * 0.32, PALETTE.marbleWhite)
    ]
  }
} as const satisfies Record<VehicleModel, (paint: number) => Array<BufferGeometry>>

/**
 * Where smoke and fire leave each model's engine, in its mesh's frame (forward, up from the ground, right; m), just outside the
 * body so they show: over the Panda's and the Giulia's bonnet, in front of the truck's grille (its engine sits under the cab-over
 * cab), and behind the Ape's cab over the bed (its two-stroke sits under the seat).
 */
const ENGINE = {
  panda: { x: 1.35, y: 1.05, z: 0 },
  ape: { x: 0.1, y: 0.75, z: 0 },
  truck: { x: 4.05, y: 1.1, z: 0 },
  carabinieri: { x: 1.6, y: 1, z: 0 }
} as const satisfies Record<VehicleModel, { readonly x: number; readonly y: number; readonly z: number }>

const xrayMaterial = new MeshBasicMaterial({ color: PALETTE.signYellow, depthFunc: GreaterDepth, depthWrite: false })
/**
 * A silhouette box drawn only where something nearer covers it. It encloses every given shape, so
 * the actor's own body is always behind its front faces and never shows through; its bottom stays
 * a little above the ground so sloped terrain at the feet does not light it up.
 */
const xray = (shapes: ReadonlyArray<BufferGeometry>): Mesh => {
  const bounds = new Box3()
  for (const shape of shapes) {
    shape.computeBoundingBox()
    if (shape.boundingBox !== null) bounds.union(shape.boundingBox)
  }
  bounds.expandByScalar(0.05)
  bounds.min.y = 0.15
  const size = bounds.getSize(new Vector3()), centre = bounds.getCenter(new Vector3())
  const proxy = new Mesh(new BoxGeometry(size.x, size.y, size.z).translate(centre.x, centre.y, centre.z), xrayMaterial)
  proxy.renderOrder = 1 // after the opaque world, so the depth buffer is complete
  proxy.visible = false
  return proxy
}

/** A rendered actor: its body and its x-ray proxy. */
export class ActorNode extends Group {
  readonly body: Mesh
  readonly xray: Mesh
  constructor(geometry: BufferGeometry, material: Material, proxy: Mesh) {
    super()
    this.body = new Mesh(geometry, material)
    this.body.castShadow = true
    this.xray = proxy
    this.rotation.order = "YZX" // heading outermost, then pitch (or lying down) about the right axis, then roll about the forward one
    this.add(this.body, proxy)
  }
  /** Frees the node's own geometry: its x-ray proxy (a vehicle's body is shared per model and paint). */
  dispose(): void {
    this.xray.geometry.dispose()
  }
}

/** A person node: walk frames swap as it covers ground. */
export class PersonNode extends ActorNode {
  readonly frames: readonly [BufferGeometry, BufferGeometry, BufferGeometry]
  /** Render height last frame (keeps the person on the deck or lane they were on). */
  elevation: number | undefined = undefined
  /** Metres walked (drives the frame) and where it was last frame. */
  walked = 0
  last: { x: number; y: number } | undefined = undefined
  constructor(look: Look, material: Material) {
    const frames = personFrames(look)
    super(frames[0], material, xray(frames))
    this.frames = frames
  }
  /** Frees the per-person geometry: x-ray proxy and walk frames. */
  override dispose(): void {
    super.dispose()
    for (const frame of this.frames) frame.dispose()
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
  constructor(model: VehicleModel, paint: number, geometry: BufferGeometry, material: Material) {
    super(geometry, material, xray([geometry]))
    this.model = model
    this.paint = paint
    this.body.position.y = this.xray.position.y = -VEHICLES[model].cg
    this.engine = new Vector3(ENGINE[model].x, ENGINE[model].y - VEHICLES[model].cg, ENGINE[model].z)
  }
}

/** A burnt-out shell's soot: the palette's charcoal, with this share of each part's lightness still showing through, its hue burnt off. */
const SOOT = { hex: PALETTE.outline, left: 0.1 } as const
/** `intact` charred: a copy with every vertex colour turned grey and darkened most of the way to charcoal. */
const charred = (intact: BufferGeometry): BufferGeometry => {
  const shell = intact.clone(), color = shell.getAttribute("color"), [r, g, b] = linear(SOOT.hex), left = SOOT.left
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
    geometry = burnt ? charred(vehicleBody(model, color)) : merge([...VEHICLE_BODIES[model](color), ...wheels(model)])
    vehicleGeometry.set(key, geometry)
  }
  return geometry
}
/** A vehicle node, its body intact (`vehicleBody`). */
export const vehicleNode = (model: VehicleModel, color: number, material: Material): VehicleNode =>
  new VehicleNode(model, color, vehicleBody(model, color), material)
