import assert from "node:assert/strict"
import { test } from "node:test"

import { MAP } from "../sim/map/index.ts"
import { buildingPieces } from "./buildings.ts"
import { linear, Triangles, type Sink } from "./geometry.ts"
import { PALETTE } from "./palette.ts"

const shutters = [linear(PALETTE.shutterGreen), linear(PALETTE.woodBrown)], lit = [linear(PALETTE.windowLit), linear(PALETTE.windowAmber)]
const same = (a: ArrayLike<number>, k: number, rgb: readonly [number, number, number]) => a[k] === rgb[0] && a[k + 1] === rgb[1] && a[k + 2] === rgb[2]

/** One building drawn into a fresh sink: its windows (shutters, 1.2 m tall, two triangles each), its glass panes (two triangles each) and the sink. */
const drawn = (piece: ReturnType<typeof buildingPieces>[number]) => {
  const sink: Sink = { solid: new Triangles(), decal: new Triangles(), water: new Triangles(), glow: new Triangles(), pieces: [] }
  piece.draw(() => sink, 0, 0)
  let triangles = 0
  for (let t = 0; t < sink.solid.position.length; t += 9) {
    const p = sink.solid.position, height = Math.max(p[t + 1]!, p[t + 4]!, p[t + 7]!) - Math.min(p[t + 1]!, p[t + 4]!, p[t + 7]!)
    if (shutters.some((rgb) => same(sink.solid.color, t, rgb)) && Math.abs(height - 1.2) < 1e-6) triangles++
  }
  return { windows: triangles / 2, panes: sink.glow.position.length / 18, sink }
}

/** Kinds nobody lives in, as the map holds them (CTR sheds, garages, barns and building sites; OSM farm outbuildings). */
const OUTBUILDINGS = ["shed", "garage", "barn", "farm_auxiliary", "construction"]

test("about half a home's windows stand open, a lit glass pane over the shutter; the glow layer holds nothing else", () => {
  const { x, y } = MAP.spawns.player, pieces = buildingPieces()
  let windows = 0, panes = 0
  MAP.buildings.forEach((b, i) => {
    if (OUTBUILDINGS.includes(b.kind) || Math.hypot(b.outer[0]! - x, b.outer[1]! - y) > 400) return
    const one = drawn(pieces[i]!)
    windows += one.windows
    panes += one.panes
    for (let v = 0; v < one.sink.glow.color.length; v += 3) assert.ok(lit.some((rgb) => same(one.sink.glow.color, v, rgb)), "lit window colours only")
  })
  assert.ok(windows > 500, `${windows} windows around the station`)
  assert.ok(panes / windows > 0.4 && panes / windows < 0.6, `${panes} panes over ${windows} windows`)
})

// Regression: sheds and garages standing alone in the fields lit their windows all night like houses.
test("sheds, garages, barns and farm outbuildings keep their shutters and never light a window", () => {
  const { x, y } = MAP.spawns.player, pieces = buildingPieces(), seen = new Map<string, number>()
  let windows = 0
  MAP.buildings.forEach((b, i) => {
    if (!OUTBUILDINGS.includes(b.kind) || Math.hypot(b.outer[0]! - x, b.outer[1]! - y) > 1500) return
    const one = drawn(pieces[i]!)
    assert.equal(one.panes, 0, `${b.kind} ${b.id}: ${one.panes} lit panes`)
    windows += one.windows
    seen.set(b.kind, (seen.get(b.kind) ?? 0) + 1)
  })
  assert.ok(windows > 500 && (seen.get("shed") ?? 0) > 100 && (seen.get("garage") ?? 0) > 100 && (seen.get("barn") ?? 0) > 0, `${windows} shuttered windows on ${JSON.stringify([...seen])}`)
})
