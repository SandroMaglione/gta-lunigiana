/**
 * Test helpers for the render tests.
 *
 * @module render/testing
 */
import { Mesh, type Object3D } from "three"

import { DRAW_ORDER } from "./order.ts"

/** The x-ray proxy an actor shows now, if any: its one visible child drawn after the world (`DRAW_ORDER.xray`). */
export const shownProxy = (node: Object3D): Mesh | undefined =>
  node.children.find(
    (c): c is Mesh => c instanceof Mesh && c.visible && c.renderOrder === DRAW_ORDER.xray,
  )
