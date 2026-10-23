import { roadHex } from "../render/lines.ts"
import { css, PALETTE } from "../render/palette.ts"
/**
 * The minimap: the whole map drawn once (areas, water, rail, roads, buildings) into an offscreen
 * canvas, then blitted every frame around the player, turned with the view so that screen-up is
 * minimap-up, with the player as an arrow. `paintMap` and `paintArrow` also draw the full map (`worldmap.ts`).
 *
 * @module hud/minimap
 */
import { type AreaKind, isAreaKind, MAP, roadClassOf } from "../sim/map/index.ts"
import { screenAxes } from "../sim/view.ts"

/** Base map pixels per metre: the minimap's own scale (90 canvas px over SPAN), so the blit is 1:1. */
const BASE = 0.3
/** Metres across the minimap. */
const SPAN = 300

/** Area fills; kinds left out (grassland, residential) show the grass background. */
const AREA_HEX: Partial<Record<AreaKind, number>> = {
  forest: PALETTE.forest,
  cemetery: PALETTE.plasterGrey,
  pitch: PALETTE.forestLight,
  park: PALETTE.forestLight,
  parking: PALETTE.asphaltWorn,
  vineyard: PALETTE.grassDry,
  farmland: PALETTE.grassDry,
  farmyard: PALETTE.dirtTrack,
  industrial: PALETTE.stoneMid,
  platform: PALETTE.asphaltWorn,
  school: PALETTE.grass,
  ruins: PALETTE.stoneMid,
  paved: PALETTE.asphaltWorn,
  quarry: PALETTE.marbleWhite,
  rock: PALETTE.limestone,
  scree: PALETTE.stoneLight,
  sparse: PALETTE.grassDry,
  scrub: PALETTE.forestLight,
}

const HOME_UP = screenAxes(0).up
/**
 * Canvas rotation that turns screen-up to minimap-up for a view turned `yaw` rad to the left of its
 * home seat: the canvas is drawn north-up (v = −y), where the home screen-up points at angle
 * atan2(−up.y, up.x); rotating by −π/2 minus that brings it to the top. The view's turn takes
 * screen-up to canvas angle atan2(−up.y, up.x) − yaw, so the rotation grows by `yaw`.
 */
export const minimapRotation = (yaw: number): number =>
  yaw - Math.PI / 2 - Math.atan2(-HOME_UP.y, HOME_UP.x)

/**
 * Paints the map layers (areas, water, rail, roads, buildings) north-up at `scale` px/m, with the
 * map's north-west corner at canvas pixel (ox, oy). Lines stay at least 1 px wide; those thinner
 * than that at this scale fade instead. `overview` (the full map) draws roads light and at least
 * 2 px (main roads) or 1.5 px wide, so the network reads at a few pixels per hundred metres.
 */
export const paintMap = (
  ctx: CanvasRenderingContext2D,
  scale: number,
  ox = 0,
  oy = 0,
  overview = false,
): void => {
  const { minX, minY, maxX, maxY } = MAP.bounds
  const u = (x: number) => ox + (x - minX) * scale,
    v = (y: number) => oy + (maxY - y) * scale
  const path = (flat: ArrayLike<number>, closed: boolean, into = new Path2D()) => {
    into.moveTo(u(flat[0]!), v(flat[1]!))
    for (let i = 2; i + 1 < flat.length; i += 2) into.lineTo(u(flat[i]!), v(flat[i + 1]!))
    if (closed) into.closePath()
    return into
  }
  ctx.fillStyle = css(PALETTE.grass)
  ctx.fillRect(u(minX), v(maxY), (maxX - minX) * scale, (maxY - minY) * scale)
  for (const area of MAP.areas) {
    const hex = isAreaKind(area.kind) ? AREA_HEX[area.kind] : undefined
    if (hex === undefined) continue
    const p = new Path2D()
    for (const ring of area.rings) path(ring, true, p)
    ctx.fillStyle = css(hex)
    ctx.fill(p, "evenodd")
  }
  ctx.lineCap = "round"
  ctx.lineJoin = "round"
  const stroke = (flat: ArrayLike<number>, width: number, hex: number, min = 1) => {
    ctx.strokeStyle = css(hex)
    ctx.lineWidth = Math.max(min, width * scale)
    ctx.globalAlpha = Math.min(1, Math.max(0.3, (width * scale) / min))
    ctx.stroke(path(flat, false))
    ctx.globalAlpha = 1
  }
  for (const w of MAP.water) stroke(w.pts, w.w, PALETTE.waterShallow)
  for (const r of MAP.rail) if (r.tunnel !== true) stroke(r.pts, 2, PALETTE.stoneDark)
  for (const road of MAP.roads) {
    const cls = roadClassOf(road)
    if (road.tunnel === true || cls === "path") continue
    if (overview) {
      ctx.strokeStyle = css(cls === "track" ? PALETTE.stoneLight : PALETTE.limestone)
      ctx.lineWidth = Math.max(cls === "tertiary" ? 2 : 1.5, road.w * 1.6 * scale)
      ctx.stroke(path(road.pts, false))
    } else {
      stroke(road.pts, road.w * 1.6, roadHex(road))
    }
  }
  ctx.fillStyle = css(PALETTE.roofTile)
  for (const b of MAP.buildings) ctx.fill(path(b.outer, true))
}

/** The player marker: an arrow along +x, `size` px from tail to tip, centred on the current origin. */
export const paintArrow = (
  ctx: CanvasRenderingContext2D,
  size = 9,
  fill: number = PALETTE.signYellow,
): void => {
  const k = size / 9
  ctx.beginPath()
  ctx.moveTo(5 * k, 0)
  ctx.lineTo(-4 * k, 3.5 * k)
  ctx.lineTo(-2 * k, 0)
  ctx.lineTo(-4 * k, -3.5 * k)
  ctx.closePath()
  ctx.fillStyle = css(fill)
  ctx.strokeStyle = css(PALETTE.outline)
  ctx.lineWidth = Math.max(1, k)
  ctx.fill()
  ctx.stroke()
}

const drawBase = (document: Document): HTMLCanvasElement => {
  const { minX, minY, maxX, maxY } = MAP.bounds
  const canvas = document.createElement("canvas")
  canvas.width = Math.ceil((maxX - minX) * BASE)
  canvas.height = Math.ceil((maxY - minY) * BASE)
  const ctx = canvas.getContext("2d")
  if (ctx !== null) paintMap(ctx, BASE)
  return canvas
}

/** The minimap canvas (90 px square, which hud.css shows larger for chunky pixels) and its per-frame draw. */
export const makeMinimap = (document: Document) => {
  const canvas = document.createElement("canvas")
  canvas.className = "minimap"
  canvas.width = canvas.height = SPAN * BASE
  const base = drawBase(document)
  const ctx = canvas.getContext("2d")
  const s = canvas.width
  return {
    canvas,
    /** Draws the map around (x, y), turned with the view's `yaw`, with the player arrow pointing along `angle` (radians CCW from east). */
    draw: (x: number, y: number, angle: number, yaw: number): void => {
      if (ctx === null) return
      ctx.imageSmoothingEnabled = false
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.fillStyle = css(PALETTE.forestDark)
      ctx.fillRect(0, 0, s, s)
      ctx.setTransform(1, 0, 0, 1, s / 2, s / 2)
      const rotation = minimapRotation(yaw)
      ctx.rotate(rotation)
      ctx.drawImage(base, -(x - MAP.bounds.minX) * BASE, -(MAP.bounds.maxY - y) * BASE)
      ctx.setTransform(1, 0, 0, 1, s / 2, s / 2)
      ctx.rotate(rotation - angle)
      paintArrow(ctx)
    },
  }
}
