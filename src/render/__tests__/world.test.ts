import assert from "node:assert/strict"
import { test } from "node:test"

import { Group, InstancedMesh, Vector3, type Mesh } from "three"

import { MAP } from "../../sim/map/index.ts"
import { chunkBoxes, CHUNKS, radiiFor, screenDistances, screenRects } from "../chunks.ts"
import { terrainY } from "../ground.ts"
import { QUARTER, viewAxes } from "../pipeline.ts"
import { World } from "../world.ts"

const boxes = chunkBoxes()
const REACH = 60
const ground = (x: number, y: number) => new Vector3(x, terrainY(x, y), -y)
/** Chunk keys within `radius` screen metres of `focus` for a view turned `yaw`. */
const within = (focus: Vector3, radius: number, yaw = 0): Array<number> => {
  const { right, up } = viewAxes(yaw)
  const rects = screenRects(boxes, right, up, new Float32Array(CHUNKS.x * CHUNKS.y * 4))
  const d = screenDistances(
    rects,
    focus.dot(right),
    focus.dot(up),
    new Float32Array(CHUNKS.x * CHUNKS.y),
  )
  return [...d.keys()].filter((key) => d[key]! <= radius)
}

test("world streaming: nearest chunk first on a tight budget, everything in the load radius on a free one", () => {
  const parent = new Group(),
    world = new World(parent)
  const { x, y } = MAP.spawns.player,
    focus = ground(x, y)
  world.update(focus, 0, REACH, 0)
  assert.equal(world.loaded.size, 1, "a zero budget still builds one chunk")
  assert.ok(within(focus, 0).includes([...world.loaded.keys()][0]!), "the one under the focus")
  world.update(focus, 0, REACH, Infinity)
  assert.deepEqual(
    [...world.loaded.keys()].sort((a, b) => a - b),
    within(focus, radiiFor(REACH).load),
  )
  assert.equal(
    parent.children.length,
    [...world.loaded.values()].reduce((n, meshes) => n + meshes.length, 0),
  )
})

test("world streaming: a quarter turn of the view builds what the turned view shows", () => {
  const parent = new Group(),
    world = new World(parent)
  const { x, y } = MAP.spawns.player,
    focus = ground(x, y),
    { load } = radiiFor(REACH)
  world.update(focus, 0, REACH, Infinity)
  const turned = within(focus, load, QUARTER)
  assert.ok(
    turned.some((key) => !world.loaded.has(key)),
    "the turned view needs chunks the home view did not",
  )
  world.update(focus, QUARTER, REACH, Infinity)
  for (const key of turned) assert.ok(world.loaded.has(key), `chunk ${key} built`)
})

test("world streaming: small moves keep chunks (hysteresis), leaving frees their geometry but not the shared tree shapes", () => {
  const parent = new Group(),
    world = new World(parent)
  const { x, y } = MAP.spawns.player
  world.update(ground(x, y), 0, REACH, Infinity)
  const before = new Map(world.loaded)
  // Moving a little past the load radius builds new chunks but drops none.
  world.update(ground(x + 100, y), 0, REACH, Infinity)
  for (const key of before.keys()) assert.ok(world.loaded.has(key), `chunk ${key} kept`)

  const freed = new Set<object>()
  const meshes: Array<Mesh> = [...before.values()].flat()
  const trees = meshes.filter((m): m is InstancedMesh => m instanceof InstancedMesh)
  assert.ok(trees.length > 0, "the spawn area has trees")
  for (const m of meshes) {
    if (m instanceof InstancedMesh) m.addEventListener("dispose", () => freed.add(m))
    else m.geometry.addEventListener("dispose", () => freed.add(m))
  }
  for (const t of trees)
    t.geometry.addEventListener("dispose", () => assert.fail("shared tree shape disposed"))

  world.update(ground(x + 2000, y + 1500), 0, REACH, Infinity)
  for (const key of before.keys()) assert.ok(!world.loaded.has(key), `chunk ${key} dropped`)
  assert.equal(freed.size, meshes.length, "every mesh of every dropped chunk freed")
  assert.ok(meshes.every((m) => m.parent === null))
})
