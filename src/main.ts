/// <reference types="vite/client" />
/**
 * Browser host (imported by `boot.ts` once the map is in): makes the streamed world and the pixel
 * view, makes the runtime with the live keyboard, the render registries, the tyre marks and smoke
 * and the audio director, and drives everything from one FixedLoop: fixed sim steps, then once per
 * animation frame the render and audio schedules, the camera, world streaming, the frame and the
 * HUD. While the full map (M) is open, both are skipped and the sound is suspended: the game is
 * paused. The build runs in steps the title card names; the card says "Press any key" once the
 * first frame is drawn.
 *
 * @module main
 */
import { FixedLoop, Result } from "@typeonce/ritmo"
import { BrowserHostClock, BrowserTickSource, Keyboard } from "@typeonce/ritmo-browser"
import { Vec2 } from "@typeonce/ritmo-math"
import { BasicShadowMap, DirectionalLight, HemisphereLight, Object3D, Scene, Vector3, WebGLRenderer } from "three"

import { makeDirector } from "./audio/director/index.ts"
import { Audio, audio } from "./audio/index.ts"
import { makeSpeaker } from "./audio/speaker.ts"
import { VEHICLE_SHOTS, VEHICLE_VOICES } from "./audio/synth/vehicles.ts"
import { WORLD_SHOTS, WORLD_VOICES } from "./audio/synth/world.ts"
import type { Shots, Voices } from "./audio/types.ts"
import { makeHud, pausable, toggleMapOnKey } from "./hud/hud.ts"
import { step, titleReady } from "./hud/title.ts"
import { groundY, terrainY } from "./render/ground.ts"
import { blend, Effects, makeEffects, makeRegistries, People, render, RenderClock, Vehicles } from "./render/index.ts"
import { PALETTE } from "./render/palette.ts"
import { followSun, PixelView, QUARTER, turnToward, WIDEST_ZOOM, zoomFor } from "./render/pipeline.ts"
import { World } from "./render/world.ts"
import { mapCover } from "./sim/map/cover.ts"
import { heightAt } from "./sim/map/index.ts"
import { bindings, Game, KeyboardInput, makeRuntime, PlayerView, setup, STEP, update } from "./sim/index.ts"
import { LOOK_AHEAD } from "./sim/view.ts"

const canvas = document.querySelector<HTMLCanvasElement>("#game")
if (canvas === null) throw new Error("index.html lacks canvas#game")

const renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" })
renderer.shadowMap.enabled = true
renderer.shadowMap.type = BasicShadowMap
renderer.setClearColor(PALETTE.forestDark)
renderer.info.autoReset = false // two renders per frame (scene + blit): reset once per frame instead

const scene = new Scene()
// Sky from above, warm bounce from the ground: shaded walls stay readable.
scene.add(new HemisphereLight(0xdbe8f5, 0x9a8a68, 1.8))
// At its home seat the camera sits north-west, so the sun comes from its side (west-south-west): west walls lit,
// north walls in shade. The sun turns with the view, so whichever way it looks the walls it shows keep that look.
const HOME_SUN = new Vector3(-0.75, 1, 0.35).normalize()
const toSun = new Vector3()
const sun = new DirectionalLight(0xfff0d8, 2)
sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
sun.shadow.normalBias = 0.05 // depth bias and range: followSun
scene.add(sun, sun.target)
await step(document, "Painting land cover", 0.8)
mapCover() // built once, shared by the world, the tyres' grip and the sound
await step(document, "Planting trees", 0.86)
const world = new World(scene)
await step(document, "Waking the valley", 0.92)
// Before the pixel-ratio listener below, which repaints the maps.
const hud = makeHud(document)

const view = new PixelView(renderer)
/** Screen metres from the view's centre to its corner at the widest zoom: what streaming must cover. */
const reach = () => Math.hypot(view.view.x, view.view.y) / 2 / WIDEST_ZOOM
/** Milliseconds per frame spent building chunks (at least one chunk is built when any is missing). */
const STREAM_BUDGET_MS = 4
const resize = () => view.resize(innerWidth, innerHeight, devicePixelRatio)
resize()
addEventListener("resize", resize)
// Moving the window to a screen with another pixel ratio fires no resize.
let dpr = matchMedia(`(resolution: ${devicePixelRatio}dppx)`)
const onDpr = () => {
  resize()
  hud.repaintMap()
  dpr = matchMedia(`(resolution: ${devicePixelRatio}dppx)`)
  dpr.addEventListener("change", onDpr, { once: true })
}
dpr.addEventListener("change", onDpr, { once: true })

const keyboard = Keyboard.actions(window, bindings)
const renderClock = { alpha: 0 }
const { people, vehicles } = makeRegistries(scene)
const effects = makeEffects(scene)
// The speaker starts its AudioContext on the first key or click from here on: pressed while loading, or the one that dismisses the title card.
const speaker = makeSpeaker(window, { ...VEHICLE_VOICES, ...WORLD_VOICES } satisfies Voices, { ...VEHICLE_SHOTS, ...WORLD_SHOTS } satisfies Shots)
const director = makeDirector(speaker)
const made = makeRuntime({
  // `?seed=123` replays a world; otherwise every load is a new one.
  seed: Number(new URLSearchParams(location.search).get("seed") ?? Math.floor(Math.random() * 2 ** 32)) >>> 0,
  services: Game.Runtime.services(
    Game.Runtime.service(KeyboardInput, keyboard),
    Game.Runtime.service(People, people),
    Game.Runtime.service(Vehicles, vehicles),
    Game.Runtime.service(RenderClock, renderClock),
    Game.Runtime.service(Effects, effects),
    Game.Runtime.service(Audio, director)
  ),
  ...(import.meta.env.DEV ? { debug: { hostClock: BrowserHostClock.make(window) } } : {})
})
if (!made.ok) throw new Error(`runtime: ${JSON.stringify(made.error)}`)
const runtime = made.value
const ready = runtime.tick(setup)
if (!ready.ok) throw new Error(`setup: ${JSON.stringify(ready.error)}`)
// Before the first update: the audio system starts reading the Impact, Honk and Skid events from here on.
const listening = runtime.tick(audio)
if (!listening.ok) throw new Error(`audio: ${JSON.stringify(listening.error)}`)
await step(document, "Building the first view", 0.97)
// Build everything the first frame shows now, so nothing pops in at the start.
const spawn = runtime.inspect(PlayerView)
if (spawn !== undefined) world.update(new Vector3(spawn.pose.x, groundY(spawn.pose.x, spawn.pose.y), -spawn.pose.y), spawn.turns * QUARTER, reach(), Infinity)

const camera = { x: 0, y: 0, elevation: 0, placed: false, zoom: 8 }
// The view swings through each quarter turn, or jumps when the player asks for less motion.
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)")

const draw = (frame: FixedLoop.Frame): void => {
  renderer.info.reset()
  renderClock.alpha = frame.alpha
  const drawn = runtime.tick(render, audio)
  if (!drawn.ok) console.error("render", drawn.error)
  const player = runtime.inspect(PlayerView)
  if (player === undefined) return
  const { x, y, angle } = blend(player.prev, player.pose, frame.alpha)
  // Look ahead along the velocity, not the pose change: getting in or out hops the pose a door's width.
  const lead = Vec2.clampLength(Vec2.scale(player.velocity, LOOK_AHEAD.seconds), LOOK_AHEAD.max)
  const dt = frame.elapsedSeconds
  const ease = camera.placed ? 1 - Math.exp(-5 * dt) : 1
  camera.x += (x + lead.x - camera.x) * ease
  camera.y += (y + lead.y - camera.y) * ease
  camera.elevation += (groundY(x, y, camera.placed ? camera.elevation : undefined) - camera.elevation) * ease
  view.focus.set(camera.x, camera.elevation, -camera.y)
  const yaw = player.turns * QUARTER
  view.yaw = camera.placed && !reduceMotion.matches ? turnToward(view.yaw, yaw, dt) : yaw
  camera.placed = true
  const zoom = (camera.zoom = zoomFor(player.vehicle?.speed, camera.zoom))
  view.texelsPerMetre += Math.abs(zoom - view.texelsPerMetre) < 0.01 ? zoom - view.texelsPerMetre : (zoom - view.texelsPerMetre) * (1 - Math.exp(-3 * dt))
  toSun.copy(HOME_SUN).applyAxisAngle(Object3D.DEFAULT_UP, view.yaw)
  followSun(sun, view.focus, toSun, view.shadowFit(toSun, (gx, gz) => terrainY(gx, -gz)))
  world.update(view.focus, view.yaw, reach(), STREAM_BUDGET_MS)
  view.render(scene)
  hud.update(player, x, y, angle, view.yaw)
}

// The first frame here, shader compiles included: one that throws lands on the card (boot.ts),
// where in the loop's animation frame it would stop the loop behind "Press any key". It also
// starts the render schedule reading Skid events before the first update.
draw({ elapsedSeconds: 0, fixedSteps: 0, alpha: 0, droppedSeconds: 0 })
// Keys pressed while loading arrive during the steps: drop their presses (held keys stay held).
keyboard.snapshot()
const loop = FixedLoop.start({
  source: BrowserTickSource.make(window),
  step: STEP,
  maxFrameSeconds: 0.25,
  maxStepsPerFrame: 5,
  update: pausable(hud.mapOpen, keyboard, () => runtime.tick(update), Result.success(undefined)),
  // The map covers the screen: no world to draw, and actors stay put (no interpolation jitter).
  render: (frame) => {
    speaker.pause(hud.mapOpen())
    if (!hud.mapOpen()) draw(frame)
  },
  onFailure: (failure) => console.error("loop stopped", failure)
})
if (!loop.ok) throw new Error(`loop: ${JSON.stringify(loop.error)}`)
toggleMapOnKey(window, hud)
titleReady(window)

// Dev only: the Ritmo monitor (backslash toggles it) and a handle for measuring from the console.
// No HMR hooks: nothing accepts updates, so Vite reloads the page on every edit.
if (import.meta.env.DEV) {
  Object.assign(window, {
    gta: { renderer, view, scene, world, effects, heightAt, player: () => runtime.inspect(PlayerView), audio: { speaker, level: speaker.level, context: speaker.context } }
  })
  const debug = runtime.debug
  if (debug !== undefined) {
    void import("@typeonce/ritmo-devtools").then(({ Monitor }) => Monitor.attach({ debug }, { schedules: { update, render, audio }, host: window }))
  }
}
