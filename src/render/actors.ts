/**
 * Actor nodes and the vehicle models: one low-poly model per vehicle model (people are in
 * `people.ts`, animals in `animals.ts`). Everything faces local +X, so `rotation.y = heading`
 * (radians CCW from east). The player's node and their car's show an x-ray proxy: a flat
 * silhouette drawn only where the world hides the actor. A vehicle's mesh stands on y = 0 at rest,
 * centred on its centre of mass, with its wheels where `VEHICLES` puts them; its node sits at the
 * centre of mass, so body and proxy hang `cg` below it.
 *
 * @module render/actors
 */
import {
  Box3, BoxGeometry, CylinderGeometry, GreaterDepth, Group, Mesh, MeshBasicMaterial, Vector3, type BufferGeometry, type Material
} from "three"

import { VEHICLES, type VehicleModel } from "../sim/vehicles.ts"
import { merge, paint } from "./geometry.ts"
import { PALETTE } from "./palette.ts"

const box = (w: number, h: number, d: number, x: number, y: number, z: number, hex: number): BufferGeometry =>
  paint(new BoxGeometry(w, h, d).translate(x, y + h / 2, z), hex)

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

const xrayMaterial = new MeshBasicMaterial({ color: PALETTE.signYellow, depthFunc: GreaterDepth, depthWrite: false })
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
  const size = bounds.getSize(new Vector3()), centre = bounds.getCenter(new Vector3())
  const proxy = new Mesh(new BoxGeometry(size.x, size.y, size.z).translate(centre.x, centre.y, centre.z), xrayMaterial)
  proxy.renderOrder = 1 // after the opaque world, so the depth buffer is complete
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
  constructor(model: VehicleModel, geometry: BufferGeometry, material: Material) {
    super(geometry, material)
    this.model = model
    this.body.position.y = -VEHICLES[model].cg
  }
}

const vehicleGeometry = new Map<string, BufferGeometry>()
/** A vehicle node; geometry is shared per model and paint. */
export const vehicleNode = (model: VehicleModel, color: number, material: Material): VehicleNode => {
  const key = `${model}:${color}`
  let geometry = vehicleGeometry.get(key)
  if (geometry === undefined) vehicleGeometry.set(key, (geometry = merge([...VEHICLE_BODIES[model](color), ...wheels(model)])))
  return new VehicleNode(model, geometry, material)
}
