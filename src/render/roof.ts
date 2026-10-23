/**
 * Roofs: a hip roof over a footprint's minimum-area rectangle when the footprint nearly fills it,
 * a flat roof otherwise.
 *
 * @module render/roof
 */
import type { Triangles } from "./geometry.ts"

/** An oriented rectangle: centre, unit long axis (ux, uy), half sizes a ≥ b. */
interface OrientedBox {
  readonly cx: number
  readonly cy: number
  readonly ux: number
  readonly uy: number
  readonly a: number
  readonly b: number
}

/** Minimum-area rectangle over a flat `[x0, y0, x1, y1, ...]` ring, tried along each edge direction. */
export const orientedBox = (ring: ReadonlyArray<number>): OrientedBox => {
  const n = ring.length / 2
  let best: OrientedBox = { cx: ring[0] ?? 0, cy: ring[1] ?? 0, ux: 1, uy: 0, a: 0, b: 0 }
  let bestArea = Number.MAX_VALUE
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const ex = ring[2 * j]! - ring[2 * i]!,
      ey = ring[2 * j + 1]! - ring[2 * i + 1]!,
      l = Math.hypot(ex, ey)
    if (l < 1e-6) continue
    const ux = ex / l,
      uy = ey / l
    let minU = Number.MAX_VALUE,
      maxU = -Number.MAX_VALUE,
      minV = Number.MAX_VALUE,
      maxV = -Number.MAX_VALUE
    for (let k = 0; k < n; k++) {
      const x = ring[2 * k]!,
        y = ring[2 * k + 1]!
      const u = x * ux + y * uy,
        v = -x * uy + y * ux
      minU = Math.min(minU, u)
      maxU = Math.max(maxU, u)
      minV = Math.min(minV, v)
      maxV = Math.max(maxV, v)
    }
    const area = (maxU - minU) * (maxV - minV)
    if (area >= bestArea) continue
    bestArea = area
    const mu = (minU + maxU) / 2,
      mv = (minV + maxV) / 2,
      a = (maxU - minU) / 2,
      b = (maxV - minV) / 2
    best =
      a >= b
        ? { cx: mu * ux - mv * uy, cy: mu * uy + mv * ux, ux, uy, a, b }
        : { cx: mu * ux - mv * uy, cy: mu * uy + mv * ux, ux: -uy, uy: ux, a: b, b: a }
  }
  return best
}

/** Shoelace area of a flat ring (positive when counter-clockwise). */
const ringArea = (ring: ReadonlyArray<number>): number => {
  let sum = 0
  for (let i = 0, n = ring.length / 2, j = n - 1; i < n; j = i++)
    sum += ring[2 * j]! * ring[2 * i + 1]! - ring[2 * i]! * ring[2 * j + 1]!
  return sum / 2
}

/** Whether a footprint gets a hip roof: it fills > 78% of its rectangle and is at most 24 m deep. */
export const hasHipRoof = (
  ring: ReadonlyArray<number>,
  box: OrientedBox = orientedBox(ring),
): boolean => box.b > 0 && box.b < 12 && Math.abs(ringArea(ring)) / (4 * box.a * box.b) > 0.78

/** Rise per metre of a hip roof (≈ 22°, Tuscan coppi). */
const PITCH = 0.4
/** Eave overhang, metres. */
const OVERHANG = 0.4

const UP = [0, 1, 0] as const

/** A hip roof (a pyramid when square) over `box` grown by the overhang, eaves at render height `eave`. */
export const hipRoof = (tris: Triangles, box: OrientedBox, eave: number, hex: number): void => {
  const a = box.a + OVERHANG,
    b = box.b + OVERHANG,
    r = a - b,
    top = eave + b * PITCH
  const vx = -box.uy,
    vy = box.ux
  const p = (su: number, sv: number, y: number) =>
    [box.cx + box.ux * su + vx * sv, y, -(box.cy + box.uy * su + vy * sv)] as const
  const c00 = p(-a, -b, eave),
    c10 = p(a, -b, eave),
    c11 = p(a, b, eave),
    c01 = p(-a, b, eave)
  const r0 = p(-r, 0, top),
    r1 = p(r, 0, top)
  // Every roof face looks up; the hip ends are triangles (their quad repeats the ridge end).
  tris.face(c00, c10, r1, r0, UP, hex)
  tris.face(c11, c01, r0, r1, UP, hex)
  tris.face(c01, c00, r0, r0, UP, hex)
  tris.face(c10, c11, r1, r1, UP, hex)
}
