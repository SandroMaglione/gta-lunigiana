import assert from "node:assert/strict"
import { test } from "node:test"

import { Ops } from "@typeonce/ritmo-math"

import { carClear } from "../body.ts"
import { graph, MAP } from "../map/index.ts"
import { allowsModel, distanceToEdge, laneOf, lanePoint, laneSide, leadsToDeadEnd, roadOf, trafficIndex, walkIndex } from "../route.ts"

test("dead ends: driving into a dead-end node is flagged, driving out of it is not", () => {
  let checked = 0
  graph.adjacency.forEach((edges, node) => {
    const own = edges.filter((e) => allowsModel(e, "panda"))
    if (own.length !== 1) return
    const into = { edge: own[0]!, forward: graph.edges[own[0]!]!.b === node }
    assert.ok(leadsToDeadEnd(into, "panda"))
    assert.ok(!leadsToDeadEnd({ edge: into.edge, forward: !into.forward }, "panda"))
    checked++
  })
  assert.ok(checked > 0)
})

// Regression: lanes a quarter of the road right of centre ran through houses that crowd the road (traffic wedged for minutes).
test("lanes: every lane AI traffic may drive keeps its body out of the walls", () => {
  for (const model of ["panda", "ape", "truck"] as const) {
    let lanes = 0
    for (const edge of graph.trafficEdges) for (const forward of [true, false]) {
      if (!allowsModel(edge, model)) continue
      const lane = laneOf(edge, forward)
      const angle = Ops.atan2(lane.dy, lane.dx)
      for (let f = 0.15; f < 0.9; f += 0.1) {
        const at = lanePoint(lane, lane.length * f, laneSide({ edge, forward }, model))
        assert.ok(carClear(model, { ...at, angle }, 0.05), `${model} on edge ${edge} (${forward ? "a -> b" : "b -> a"}) at ${f.toFixed(2)}`)
      }
      lanes++
    }
    assert.ok(lanes > 100, `${model}: ${lanes} lanes`)
  }
})

// Regression: in walled single-file lanes AI cars met head-on, or turned into a corner they could not take, and wedged for good.
test("lanes: AI traffic keeps off lanes where the walls leave no room to pass an oncoming car", () => {
  // Where cars wedged: Gragnola's alley between the houses by the Lucido, Via Bezzecca in Terma, Via Carlo del Prete in Fazzano.
  for (const [x, y] of [[-1774, 3335], [-1525, 652], [428, 2029]] as const) {
    const edge = trafficIndex.nearest(x, y)
    assert.ok(distanceToEdge(edge, x, y) < 2)
    for (const model of ["panda", "ape", "carabinieri"] as const) assert.ok(!allowsModel(edge, model), `${model} on ${roadOf(edge).name ?? roadOf(edge).id} at ${x},${y}`)
  }
  assert.ok(graph.trafficEdges.filter((e) => roadOf(e).name === "Via Cesare Battisti").every((e) => allowsModel(e, "panda")), "two cars pass on Via Cesare Battisti")
})

test("edgeIndex.nearest: the nearest edge by brute force (first on a tie), also far outside the map", () => {
  const { minX, minY, maxX, maxY } = MAP.bounds
  for (const [index, edges] of [[trafficIndex, graph.trafficEdges], [walkIndex, graph.walkEdges]] as const) {
    // A 20 x 15 lattice from 300 m outside the bounds, plus a point on every 97th edge's midpoint.
    const points = Array.from({ length: 300 }, (_, k) => ({ x: minX - 300 + ((maxX - minX + 600) * (k % 20)) / 19, y: minY - 300 + ((maxY - minY + 600) * Math.floor(k / 20)) / 14 }))
    for (let k = 0; k < edges.length; k += 97) {
      const { a, b } = graph.edges[edges[k]!]!
      points.push({ x: (graph.nodes[a]!.x + graph.nodes[b]!.x) / 2, y: (graph.nodes[a]!.y + graph.nodes[b]!.y) / 2 })
    }
    for (const p of points) {
      let best = edges[0]!, distance = Infinity
      for (const e of edges) {
        const d = distanceToEdge(e, p.x, p.y)
        if (d < distance) [best, distance] = [e, d]
      }
      assert.equal(index.nearest(p.x, p.y), best, `at ${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    }
  }
})
