import assert from "node:assert/strict"
import { test } from "node:test"

import { Random } from "@typeonce/ritmo-math"
import { Color, type InstancedMesh, Matrix4, Vector3 } from "three"

import { BLAST_SMOKE, BLASTS_AT_ONCE, Blasts, DEBRIS, EMBERS, FIREBALL, FLASH } from "./blasts.ts"
import { PALETTE } from "./palette.ts"

/** A fixed sequence: every piece flies the same way every run. */
const steady = () => 0.5
/** A seeded sequence: pieces fly every way, the same every run. */
const seeded = (seed = 7) => {
  const random = Random.make(seed)
  return () => random.next()
}
/** The blast's centre (three space) and the ground under it. */
const AT = { x: 10, y: 100, z: -20 }, GROUND = 99.4
const blast = (random: () => number = steady) => {
  const blasts = new Blasts(random)
  blasts.start(AT.x, AT.y, AT.z, () => GROUND, 0, PALETTE.signalRed)
  return blasts
}
/** Where instance `i` of `mesh` is, how big (its matrix's scale: decompose reads a zero scale as 1) and its colour. */
const piece = (mesh: InstancedMesh, i: number) => {
  const m = new Matrix4()
  mesh.getMatrixAt(i, m)
  return { at: new Vector3().setFromMatrixPosition(m), size: new Vector3().setFromMatrixColumn(m, 0).length(), color: new Color().fromArray(mesh.instanceColor!.array, i * 3) }
}
const counts = (blasts: Blasts) => blasts.meshes.map((mesh) => mesh.count)

test("a blast sets off every layer, and the pools hold four blasts in full and drop the pieces of any more", () => {
  const blasts = blast()
  blasts.update(0.01)
  const one = [BLAST_SMOKE.count, DEBRIS.count, FLASH.count, FIREBALL.count, EMBERS.count]
  assert.deepEqual(counts(blasts), one)
  for (let n = 0; n < 5; n++) blasts.start(AT.x, AT.y, AT.z, () => GROUND, 0, PALETTE.signalRed)
  blasts.update(0.01)
  assert.deepEqual(counts(blasts), one.map((count) => count * BLASTS_AT_ONCE))
})

test("the flash shows the moment the wreck blows, swells to a 4 m radius in 0.12 s at the blast, then shrinks away and is gone by 0.3 s", () => {
  const blasts = blast()
  const size = (t: number) => {
    blasts.update(t)
    return blasts.flash.mesh.count === 0 ? undefined : piece(blasts.flash.mesh, 0)
  }
  assert.ok(size(0)!.size > 1, "over a metre in radius already in the frame it blows")
  const early = size(0.06)!, peak = size(0.12)!, late = size(0.25)!
  assert.ok(early.size < peak.size && late.size < peak.size, `${early.size} → ${peak.size} → ${late.size} m`)
  assert.ok(Math.abs(peak.size - 4) < 1e-3, `${peak.size} m at its largest`)
  assert.ok(peak.at.distanceTo(new Vector3(AT.x, AT.y, AT.z)) < 1e-3, "on the blast's centre")
  assert.equal(size(0.31), undefined)
})

test("the fireball flies out every way and up, and burns from white to red as it dies", () => {
  const blasts = blast(seeded())
  const look = (t: number) => {
    blasts.update(t)
    return Array.from({ length: blasts.fireball.mesh.count }, (_, i) => piece(blasts.fireball.mesh, i))
  }
  const early = look(0.05), centre = new Vector3(AT.x, AT.y, AT.z)
  const later = look(0.35)
  assert.equal(later.length, FIREBALL.count, "none burns out so soon")
  const out = (pieces: typeof early) => pieces.reduce((sum, p) => sum + p.at.distanceTo(centre), 0) / pieces.length
  assert.ok(out(later) > out(early) + 1, `${out(early)} → ${out(later)} m out on average`)
  assert.ok(later.every((p) => p.at.y > AT.y), "every piece above the blast's centre")
  for (const axis of ["x", "z"] as const) {
    assert.ok(later.some((p) => p.at[axis] > AT[axis] + 1) && later.some((p) => p.at[axis] < AT[axis] - 1), `flung both ways along ${axis}`)
  }
  // One piece through its life: its green and blue fall away against its red.
  const one = blast()
  const color = (t: number) => {
    one.update(t)
    return piece(one.fireball.mesh, 0).color
  }
  const life = (FIREBALL.life[0] + FIREBALL.life[1]) / 2 // the steady draw's
  const white = color(0.02), red = color(life * 0.95)
  assert.ok(white.g / white.r > 0.85 && white.r > 1, `white hot at first: ${white.toArray()}`)
  assert.ok(red.g / red.r < 0.2 && red.b / red.r < 0.2, `red as it dies: ${red.toArray()}`)
  one.update(life + 0.01)
  assert.equal(one.fireball.mesh.count, 0, "gone at the end of its life")
})

test("debris is thrown up and falls back under gravity, gone once it reaches the ground or after 2.5 s", () => {
  const blasts = blast()
  const heights: Array<number> = []
  let landed = Infinity
  for (let frame = 1; frame <= 180; frame++) {
    blasts.update(frame / 60)
    if (blasts.debris.mesh.count === 0) {
      landed = Math.min(landed, frame / 60)
      continue
    }
    heights.push(piece(blasts.debris.mesh, 0).at.y)
  }
  const top = Math.max(...heights), apex = heights.indexOf(top)
  assert.ok(top > AT.y + 2, `up to ${top - AT.y} m over the blast`)
  assert.ok(apex > 0 && apex < heights.length - 1, "it rises, then falls")
  // Falling, it gains about 9.81 m/s every second: over the last tenth of a second ~1 m/s more.
  const fall = (i: number) => (heights[i - 1]! - heights[i]!) * 60
  const late = heights.length - 1, gained = fall(late) - fall(late - 6)
  assert.ok(gained > 0.95 && gained < 1.01, `${gained} m/s gained in 0.1 s`)
  assert.ok(landed < 2.5 && heights.every((y) => y >= GROUND), `gone at ${landed} s, never under the ground`)
  // Over a deep drop it lasts its life.
  const cliff = new Blasts(steady)
  cliff.start(AT.x, AT.y, AT.z, () => AT.y - 500, 0, PALETTE.signalRed)
  cliff.update(2.49)
  assert.equal(cliff.debris.mesh.count, DEBRIS.count)
  cliff.update(2.51)
  assert.equal(cliff.debris.mesh.count, 0)
})

// Regression: every piece's floor was the ground under the blast, so where the ground falls away (a hillside, beside a bridge) debris
// vanished metres up in the air.
test("debris comes down to the ground where it lands, on a slope falling away from the blast too", () => {
  const ground = (x: number, z: number) => GROUND - 0.5 * Math.hypot(x - AT.x, z - AT.z) // 50 %, every way
  const blasts = new Blasts(seeded())
  blasts.start(AT.x, AT.y, AT.z, ground, 0, PALETTE.signalRed)
  // Each shard keeps its size all its life, and no two are the same size: where each was last drawn, and when.
  const last = new Map<string, { at: Vector3; t: number }>()
  for (let frame = 0; frame <= 180; frame++) {
    blasts.update(frame / 60)
    for (let i = 0; i < blasts.debris.mesh.count; i++) {
      const { at, size } = piece(blasts.debris.mesh, i)
      last.set(size.toFixed(4), { at, t: frame / 60 })
    }
  }
  assert.equal(last.size, DEBRIS.count)
  for (const { at, t } of last.values()) {
    const over = at.y - ground(at.x, at.z), out = Math.hypot(at.x - AT.x, at.z - AT.z)
    assert.ok(t < DEBRIS.life[0] - 0.05, `a shard still in the air at ${t} s`)
    assert.ok(over > -1e-3 && over < 0.4, `a shard ${out.toFixed(1)} m out gone ${over.toFixed(2)} m over the ground`)
  }
})

test("debris: a third in the body's paint, the rest charred", () => {
  const blasts = blast()
  blasts.update(0.1)
  const colors = Array.from({ length: DEBRIS.count }, (_, i) => piece(blasts.debris.mesh, i).color)
  const painted = colors.filter((c) => c.getHex() === PALETTE.signalRed), charred = colors.filter((c) => c.getHex() !== PALETTE.signalRed)
  assert.equal(painted.length, DEBRIS.count / 3)
  assert.ok(charred.every((c) => c.r + c.g + c.b < 0.2), "charred: near black")
})

test("the blast's black smoke rolls up and lingers for seconds", () => {
  const blasts = blast()
  const at = (t: number) => {
    blasts.update(t)
    return piece(blasts.smoke.mesh, 0)
  }
  const early = at(1), late = at(3)
  assert.ok(late.at.y > early.at.y + 2, `${early.at.y} → ${late.at.y}`)
  assert.equal(blasts.smoke.mesh.count, BLAST_SMOKE.count, "still in the air at 3 s")
  assert.equal(early.color.getHex(), PALETTE.outline)
  blasts.update(BLAST_SMOKE.over + BLAST_SMOKE.look.life[1] + 0.01)
  assert.equal(blasts.smoke.mesh.count, 0)
})

test("a blast stands still while sim time does, and empty pools upload nothing", () => {
  const blasts = blast(seeded())
  blasts.update(0.2)
  const before = blasts.meshes.map((mesh) => mesh.instanceMatrix.array.slice(0, mesh.count * 16))
  for (let frame = 0; frame < 30; frame++) blasts.update(0.2)
  assert.deepEqual(blasts.meshes.map((mesh) => mesh.instanceMatrix.array.slice(0, mesh.count * 16)), before)

  const idle = new Blasts(steady)
  idle.update(1)
  idle.update(2)
  assert.deepEqual(idle.meshes.map((mesh) => mesh.instanceMatrix.version + mesh.instanceColor!.version), [0, 0, 0, 0, 0])
  blasts.update(10)
  const spent = blasts.meshes.map((mesh) => mesh.instanceMatrix.version)
  blasts.update(11)
  assert.deepEqual(blasts.meshes.map((mesh) => mesh.instanceMatrix.version), spent, "burnt out: nothing more uploaded")
})
