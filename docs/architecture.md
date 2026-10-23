# Architecture

The game is a Ritmo ECS simulation plus a browser host. The simulation (`src/sim`) owns every rule
that changes the world. It is headless and deterministic: no DOM, no Three.js, no wall clock, no
`Math.random`. The host (`src/main.ts`, `src/render`, `src/audio`, `src/hud`) captures input,
draws, plays the sound, and shows the HUD. It reads the world and never writes saved state: its
requests go in as events that a system applies. `SetHandling` carries the handling the player picks
in the settings or the dev debug menu, `SetClock` the game clock held behind the title card and
the time and rate set in the dev debug menu, and `SetWeather` a regime forced in the dev debug menu.

```
keys, touch ──► KeyboardInput service ──► CaptureInput ──► Input resource ──► systems
                                                                                │
             HUD ◄── PlayerView, SkyView ◄───────────── world (components, resources, events)
             three.js nodes, sky host ◄── render schedule ◄─────┤
             speakers ◄── director ◄── audio schedule (Hear) ◄──┘
```

## Simulation

`src/sim/index.ts` is the entry. It re-exports the schema, defines the schedules, and exports
`makeRuntime({ seed, start?, services, debug? })`, which makes a runtime with the starting
resources: `Time` (60 Hz clock), `Rng` (seeded from `seed`), `WeatherRng` (seeded from
`seed ^ 0x9e3779b9`), `Score` (zeroed), `View` (home view), `Handling` (a new game's knobs,
`DEFAULT_HANDLING`: the Balanced preset), `GameClock` (`start` at rate 1), `Weather`
(`initialWeather(start, weatherSeed)`, `weatherSeed` being `WeatherRng`'s first state: clear and
calm, dry ground, the season's snow line, and a calm plan the first step draws that holds clear for
90 game minutes, so the tests' first 600 steps stay storm-free) and `Input` (idle keys).

- `start` is the game time a new game begins at, in whole Unix UTC seconds: a fraction fails to
  decode and no runtime is made. Without it the game starts at `DEFAULT_START`, 1792648800
  (2026-10-22 08:00 CEST), so tests replay the same day.
- The weather draws from its own stream so that it never changes traffic, pedestrians or parking.
  mulberry32 runs through every 32-bit state in one cycle, so the two streams are one sequence at
  an offset the seed sets: at least 7,179 draws apart over all 2³² seeds, and at least 1.2 million
  for seeds 0–200,000. Only the storm cell and its lightning draw from `WeatherRng`; each day's
  plan comes from the weather seed (kept in `Weather.seed`) and the day alone, so a storm never
  changes the days after it.
- The clock, the sun and moon, the climate and the weather are pure functions in `src/sim/sky/`
  ([weather.md](weather.md)). The host calls the same functions to draw, play and show them, so the
  snow it draws is the snow the tyres feel.

### Schedules and system order

`setup` runs once after the runtime is made:

1. `SpawnWorld` (`systems/spawn.ts`): the player and the parked cars on 200 of the map's parked
   spots (`PARKED`), the two Carabinieri cars included.
2. `ApplyHandling` (`index.ts`)
3. `ApplyClock` (`index.ts`)
4. `ApplyWeather` (`index.ts`)
5. `applyDeferred`

The three apply systems run here once, before any request exists, so they are listening when the
host first sends: a request sent before the first `update` (the host re-sending the player's
stored handling at load, or holding the clock behind the title card) would otherwise be dropped by
whichever schedule ticked first.

`update` is one fixed step (`STEP = Clock.hz(60)`):

| # | System | File | Does |
|---|---|---|---|
| 1 | `AdvanceTime` | `index.ts` | advances `Time` (Ritmo `Clock.system`) |
| 2 | `CaptureInput` | `index.ts` | copies the `KeyboardInput` snapshot into `Input` |
| 3 | `StorePrevious` | `index.ts` | copies every `Pose` into `PrevPose` (for interpolation) |
| 4 | `TurnView` | `index.ts` | turn keys: the view's quarter turns (`View`) |
| 5 | `ApplyHandling` | `index.ts` | each `SetHandling` request sets its knob in `Handling`, kept in the knob's range |
| 6 | `ApplyClock` | `index.ts` | each `SetClock` request sets the game time and/or its rate in `GameClock`, kept in range (2000-01-01 to 2100-01-01, rate a whole 0–3600) |
| 7 | `ApplyWeather` | `index.ts` | each `SetWeather` request forces a regime or hands the weather back to the day's plan, settled at once when asked, under the plan of the day the clock is on |
| 8 | `AdvanceClock` | `systems/sky.ts` | moves `GameClock` on by its rate (a game second a step at rate 1); at rate 0 it stands still, unwritten |
| 9 | `AdvanceWeather` | `systems/sky.ts` | over the step's game seconds, draws the day's plan from the weather seed when a new Rome day begins (at rate 0 only that), moves toward the regime it sets for the hour and eases `Weather` toward it, wetting, drying, snowing and thawing the ground; over its real time, drifts a thunderstorm's cell and emits `Lightning`, drawing from `WeatherRng` |
| 10 | `EnterExit` | `systems/enter-exit.ts` | action key: enter, steal, carjack, get out |
| 11 | `applyDeferred` | | applies the enter/exit commands before anything moves |
| 12 | `PlayerFoot` | `systems/foot.ts` | player walking, sprinting, sliding when down |
| 13 | `PlayerDrive` | `systems/drive.ts` | player keys into the driven car's `CarInput` |
| 14 | `TrafficAI` | `systems/traffic.ts` | AI drivers write their `CarInput`, slower and keeping further back where the road is wet or snowy; a driver held up honks (`Honk`) |
| 15 | `Pedestrians` | `systems/pedestrians.ts` | walkers follow their routes, flee, slide |
| 16 | `VehiclePhysics` | `systems/physics.ts` | every vehicle moves on its springs and tyres from its `CarInput` under the `Handling`, each tyre's grip lowered by the wet and the snow under it; wall and ground hits are `Impact` events, sliding tyres `Skid` events |
| 17 | `Contacts` | `systems/contacts.ts` | car–car, car–person and person–person contacts, knockdowns; car–car hits and knockdowns are `Impact` events |
| 18 | `RideAlong` | `systems/drive.ts` | the driving player takes the car's pose and motion |
| 19 | `Recover` | `systems/contacts.ts` | knocked-down people get up; pedestrians then flee |
| 20 | `Populate` | `systems/populate.ts` | every 0.5 s spawns and despawns traffic and pedestrians |
| 21 | `applyDeferred` | | applies spawns, despawns, inserts and removals |

Controls, the handling, the clock and the weather are settled before movement, all movement
happens before contacts, and contacts happen before the player's pose follows the car. `TrafficAI`
and `VehiclePhysics` read `GameClock` and `Weather` and work out the air once a step (`airAt`), so
every wheel meets the wet and the snow this step's weather left, meltwater included. Gameplay is in
[gameplay.md](gameplay.md), the weather in [weather.md](weather.md).

### Where state lives

Saved world state (in snapshots), declared in `src/sim/schema.ts`:

| Component | On | Holds |
|---|---|---|
| `Pose`, `PrevPose` | every body | x, y (m, east/north from the map origin), angle (rad CCW from east) |
| `Motion` | every body | velocity vx, vy (m/s) and spin (rad/s) |
| `Player` | the player | tag |
| `Person` | player, pedestrians | look: skin, hair, shirt, trousers colours (immutable) |
| `Pedestrian` | pedestrians | mood (`walk` or `flee`), flee end step, steps blocked |
| `Down` | knocked-down people | step at which they get up |
| `Vehicle` | vehicles | model and paint colour (immutable) |
| `CarInput` | vehicles | throttle, steer, handbrake for this step |
| `Chassis` | vehicles | centre-of-mass elevation and vertical speed, pitch and roll with their rates, road-wheel steering angle, gear, step the current shift ends |
| `Traffic` | AI vehicles | tag |
| `Route` | traffic, pedestrians | current graph edge, direction, lateral offset |
| `Autopilot` | traffic | next edge, stuck counter, reverse end step, unstick tries |
| `Stolen` | vehicles | tag: already entered once by the player |
| `Driving` | the player | handle of the vehicle being driven |

`Schema.requires` enforces the bundles: a `Player` has a pose, previous pose, motion and look; a
`Vehicle` has a pose, previous pose, motion, `CarInput` and `Chassis`; `Traffic` also needs
`Route` and `Autopilot`. Spawns put a vehicle on its springs at rest on the ground (`settle` in
`src/sim/chassis.ts`), in the gear for its speed. No save is ever persisted, so `Chassis`,
`Handling` (with its `weatherGrip` knob), `GameClock`, `WeatherRng` and `Weather` need no snapshot
migration.

Saved resources:

| Resource | Holds |
|---|---|
| `Time` | the fixed step's count and length (Ritmo's clock) |
| `Rng` | the world's random stream: traffic, pedestrians, parking |
| `WeatherRng` | the weather's own random stream: the storm cell and lightning (its first state is the weather seed) |
| `Score` | `stolen`, `knocked` |
| `View` | `turns`, the net quarter turns of the camera |
| `Handling` | the 16 handling knobs ([gameplay.md](gameplay.md#handling)) |
| `GameClock` | `seconds`, the game time in whole Unix UTC seconds, and `rate`, the game seconds each step adds: 1 in play (a game minute per real second, a 24-minute day), 0 standing still, up to 3600 from the dev debug menu |
| `Weather` | the weather `seed` (never changed); the `regime` it moves toward and whether it is `forced`; the eased `cloud`, `precip` (mm/h at sea level), `storm`, `wind` (on the map's low ground) and `windAngle`, `gust`, `fog` and temperature `anomaly`; the ground's `wet` and `snowLine` (m a.s.l.); the storm cell's centre (`cellX`, `cellY`); and the day's `plan` (its Rome `day`, whether `drawn`, `from` when it holds, `wet`, a wet day's `event`, `intensity`, `start`, `end` and `precip`, the `sky`, a dry day's `fog` until `lift` and strong wind from `windyFrom` to `windyTo`, and the `airMass`; times in seconds since the Rome day's midnight) |

`Input` is transient: it is rebuilt every step and never saved.

Events are transient too. `Impact` (a vehicle hit a wall, another vehicle, a person or the ground:
where, which is the contact point for a wall, a vehicle or the ground, how hard, with how much mass
in tonnes, and for the ground which face of the body struck), `Skid` (a tyre slid this step: where,
how fast, how far past its grip, on what surface, how snow-covered), `Honk` (an AI driver held up
sounds the horn) and `Lightning` (a thunderstorm's flash this step: a ground strike or a flash in
the cloud at x, y, its power 0…1, the seed of its bolt and its thunder, its step) carry moments that
leave no trace in the components. `VehiclePhysics`, `Contacts`, `TrafficAI` and `AdvanceWeather`
emit them; the audio schedule reads all four ([audio.md](audio.md#data-flow)) and the render
schedule reads `Skid` (tyre marks and smoke) and `Lightning` (the bolt and the flash). An in-cloud
flash may lie off the map; a bolt never does. Three events are host intents, which no system
emits and the host sends with `runtime.send`:

- `SetHandling` (set one handling knob to a value): the host's handling store
  (`src/hud/handling.ts`) sends it for the settings and the dev debug menu; `ApplyHandling` reads
  it.
- `SetClock` (set the game time and/or its rate): the host sends it to hold the clock behind the
  title card (`holdClock`, see [Host loop](#host-loop)), and the dev sky store for the debug menu;
  `ApplyClock` reads it.
- `SetWeather` (force a regime, or `null` to hand the weather back to the day's plan, `settle` to
  jump to its steady state): the dev sky store sends it; `ApplyWeather` reads it.

Snapshots hold no events, and emitting them changes neither the determinism nor the saves test.

Static data is module content, not state. `MAP` and `graph` (`src/sim/map/index.ts`), the wall,
tree, building and edge lookups, the per-model lane tables in `src/sim/route.ts` and the per-model
rigs in `src/sim/chassis.ts` (`RIGS`: static wheel loads, springs, inertias, steering lock, tipping
threshold) are built once at load and never change, so they are safe to share between runtimes.
A rig under a handling off its real values (`rigFor`) is a pure function of the model and the
`Handling`, derived on first use and cached (the whole cache empties once it holds 64 rigs, 16
for each of the four models), so it is safe to share too.
The sky's tables (the national temperature normals, the odds' rows, the regimes' `REGIME_SPECS`)
are module content as well. The map's place (`place()`, `src/sim/sky/place.ts`: its origin, its
5th-percentile height and the way its ground falls) is per-load map content: `src/sim/map/index.ts`
works it out once it decodes the map (13–20 ms) and hands it over with `providePlace`, as the host
hands the map file to `provideMap`; with no map loaded it is the reference site, the shipped map's
place. So the sky modules the schema and the HUD import (`regimes`, `clock`, `calendar`, `astro`,
`place`, `day`, `climate`, `odds`, `plan`, `local`, `readout`) decode no map, and every Italian map
gets its own sun and climate (`sky/mapfree.test.ts` asserts both); `sky/weather.ts` decodes it,
for the heights and the bounds. `ORIGIN` in `src/sim/map/kinds.ts` now serves only the build.
The land-cover raster (`mapCover` in `src/sim/map/cover.ts`, ≈ 105 ms and 4.9 MB) and the road
index of `surfaceAt` (`src/sim/map/surface.ts`) are built on first use: pure functions of `MAP`,
never written after; `main.ts` builds the raster in its "Painting land cover" loading step, so
the first physics step finds it ready. The lookups are compact static grids (`staticGrid` in
`src/sim/collide.ts`, item indices packed into one `Int32Array`):

- `wallsNear` indexes the walls straight from the decoded flat arrays and the trees as points,
  making each trunk's square (`pushTrunk` in `src/sim/map/kinds.ts`) only when a query reaches it.
  It reuses its answer array and the segment objects in it until the next call of the same kind:
  copy the coordinates to keep them.
- `buildingsIn` (over `buildingBoxes`, 64 m cells) and `treesIn` (the trees as points) in
  `src/sim/map/index.ts` are broad phases that call back with candidate indices; callers run the
  exact test. The sim (`Populate`'s pedestrian spawns) and the audio host (occlusion, streets,
  birds) share them.
- `edgeIndex`, `trafficIndex` and `walkIndex` (`src/sim/route.ts`) answer nearest-edge and
  spawn-band lookups without scanning the whole graph.
- `groundZ` (`src/sim/map/ground.ts`) is where every wheel, foot, sound source and drawn actor
  stands, in m a.s.l.: the terrain as its mesh is drawn (each 4 m cell split along its SW–NE
  diagonal), at-grade roads `ROAD_LIFT` above their profile (blended where several overlap, so a
  junction's ground stays continuous where their profiles disagree), and bridge decks and tunnels
  kept to the level nearest the caller's previous height. Road segments are bucketed in 16 m
  cells at load. The renderer converts it to render y (`src/render/ground.ts`).

Host state stays in the host: the camera, the render clock, the three.js scene and nodes, the
streamed world's chunks, the tyre marks and smoke, the sky host (its lights, the eased exposure and
lamps, the clouds' drift and the shared sky uniforms, worked out again from the saved clock and
weather every frame, so a loaded save needs nothing), the HUD's DOM, the player's handling (a
preset's name or the knobs set by hand, kept in `localStorage` by `src/hud/handling.ts`), the dev
sky store (nothing stored), and the audio context, live voices and the director's memory of each
sound source, thunders on their way included (pruned as sources go; see
[audio.md](audio.md#where-state-lives)).

## Input

1. `src/main.ts` makes `Keyboard.actions(window, bindings)` and passes it as the `KeyboardInput`
   service. In mobile mode ([HUD](#hud)) it passes `withTouch` (`src/hud/touch.ts`) instead: the
   keyboard's snapshot with the touch controls' added. The stick holds the direction keys it leans
   more than 22.5° toward, so it has the keys' eight directions, and each button holds its key;
   every key has a button. A key is held while any of them holds it, so the sim cannot tell a tap
   from a key. Only the controls shown in the player's mode count: one the mode hides under a
   thumb that stays down (the stick on getting in, ◀ on getting out) lets go of its keys.
2. `CaptureInput` (Ritmo's `InputCapture.system`) copies its snapshot into the `Input` resource
   at the start of each step.
3. Systems read `Input`: `held` for movement, steering and handbrake, `pressed` (once per press)
   for the action and turn keys. No sim system reads `horn` (H): only the audio schedule does.

`bindings` in `src/sim/schema.ts` is the only list of keys. Tests and replays use the same path:
`Keyboard.scripted(bindings, timeline)` replaces the live keyboard.

## Start-up

The title card doubles as the loading screen: it says the game is in early development, downloads
the map, builds in named steps, and asks for a key only once the first frame is drawn.

1. `index.html` is static, so the card shows before any script runs. Its entry, `src/boot.ts`,
   is a few kB and imports only the card (`src/hud/title.ts`) and the map file's handover
   (`src/sim/map/packed.ts`), so the bar moves within milliseconds.
2. `boot.ts` fetches `monzone.bin` (6.7 MB of gzip, a hashed asset) and counts the bytes against
   `Content-Length` (the first 60% of the bar, with MB so far). It gunzips with
   `DecompressionStream` while the file arrives, then hands the bytes to `provideMap`. The file is
   named `.bin`, not `.gz`: Vite's server would label a `.gz` as `Content-Encoding: gzip`, and the
   browser would then gunzip it first.
3. It imports the game in three parts, with a paint between them, because each import evaluates
   only the modules the earlier ones left: `src/sim/map/index.ts` (decoding, collision grids),
   `src/sim/route.ts` (each vehicle model's lanes), then `main.ts`.
4. `main.ts` first makes the sky host, every light and weather mesh in it, so they exist before
   any shader compiles. It then builds the rest in steps with top-level `await`, each named on the
   card: the land cover (`mapCover`), the world (`new World`, which places the street lamps), then
   the HUD, the runtime, `setup`, the clock's hold and the first audio tick, then every chunk of
   the first view.
5. `main.ts` compiles every program the game draws (`view.compile` with the stand-ins, see
   [Rendering](#rendering)) and draws the first frame itself: a throw there reaches the card,
   where inside the loop's animation frame it would stop the loop behind "Press any key".
   It then drops the presses of keys hit while loading (held keys stay held, as `pausable` does),
   starts the loop, arms M and calls `titleReady`. The card swaps the bar for "Press any key"
   ("Tap to play" in mobile mode) and hides on the next key, click or tap, which runs the game
   clock ([Host loop](#host-loop)).
6. If any step throws (the download, a missing WebGL), the card keeps the step's name, shows the
   error (`role="alert"`) and a Retry button that reloads; a failed module import stays failed
   until a reload. Retry stops Enter and Space from reaching the game's keyboard, which cancels
   them at the window. When the scripts themselves fail to load (a network error, or an
   `index.html` cached from before a deploy asking for removed assets), a small inline script in
   `index.html` shows the same error and Retry.

The step name is a polite live region, so screen readers hear each step; the byte count beside it
is not, so chunks stay quiet. A background tab has no animation frames and slows timers to about
one a second, so there each step yields on a `MessageChannel` message instead (eight steps would
otherwise add ≈ 8 s).

Measured with the production build in headless Chrome on an M4 Pro, 1280×720, before the day
cycle (its dev-server numbers are under [Measured](#measured)):

| Case | Before | After |
|---|---|---|
| local server | first frame at 1.9 s; JS heap after GC 117 MB | "Press any key" at 0.63 s; 88 MB |
| 4× CPU, 1.5 MB/s | the 15 MB script in at 9.8 s (a dead "Press any key" until then), one 3.5 s task, first frame at 13.5 s | map in at 4.6 s, ready at 7.1 s, longest task 0.64 s |

## Host loop

`src/main.ts` drives everything from one `FixedLoop`: 60 Hz steps, at most 5 steps per frame, and
frames clamped to 0.25 s. Before the loop starts it ticks `setup`, holds the game clock, ticks the
`audio` schedule once, and draws the first frame (the `render` schedule's first run): a system
reads the events published since its own last run, so a reader that has never run would miss the
first steps' `Impact`, `Honk`, `Skid` and `Lightning` events. Each animation frame it:

1. writes the loop's `alpha` (fraction of a step since the last one) into `RenderClock`;
2. ticks the `render` and `audio` schedules (`runtime.tick(render, audio)`); the render's `DrawSky`
   hands the sky host the clock, the weather, the steps' lightning and the cars with lamps on;
3. reads `PlayerView` and moves and turns the camera;
4. draws the sky for the moved camera (`skyHost.draw`: light, shadows, fog, rain, bolts, night
   lights; see [The sky](#the-sky));
5. streams the static world around the camera focus (see below);
6. renders the pixel view, then updates the HUD with `PlayerView` and `SkyView` and, in mobile
   mode, the touch controls.

The seed comes from `?seed=N`, or a random 32-bit number.

A new game starts today, on the browser's local date, at 08:00 in Rome:
`start = utcFromRome(daysFromCivil(year, month, day) · DAY + 8 h)`, from the sim's calendar
(`src/sim/sky/calendar.ts`), which keeps Rome's summer time. The clock stands still behind the title
card, so the player starts at 08:00 however long the card stays up: right after `setup`,
`holdClock` (`src/hud/title.ts`) sends `SetClock { rate: 0 }`, and `titleReady` calls the release
it returns when the card hides, which sends `{ rate: 1 }`. Only the clock waits: traffic and people
move on behind the card. `title.test.ts` wires it as `main.ts` does: after 300 steps on the card
the clock reads `DEFAULT_START` and the HUD 08:00, and 60 steps after the card goes it reads
`DEFAULT_START + 60` at rate 1.

## Rendering

The render schedule (`src/render/index.ts`) uses `@typeonce/ritmo-render`:

- `SyncPeople` and `SyncVehicles` (`RenderSync.system`) keep one three.js node per entity with a
  `Person` or a `Vehicle`, in the `People` and `Vehicles` node registries. A person in a car is
  hidden; a knocked-down person lies flat.
- `MarkDriven` shows the x-ray silhouette (drawn only where the world hides the actor) on the
  player's car and no other vehicle. `SyncPeople` shows it on the player's figure. Its yellow is
  divided by the post pass's exposure, as the lamps are, so it stays the same yellow at night as at
  noon (at a night's exposure of 4 it would clip to lemon).
- `PlacePeople` (`RenderSync.interpolate`) blends `PrevPose` → `Pose` at the render alpha and
  stands each person on the ground or road under them (`groundY` in `src/render/ground.ts`, kept
  to the level they were on); people swap between three walk frames.
- `PlaceVehicles` puts each vehicle's node at its centre of mass from the sim, with no ground
  lookup of its own: x and y blended `PrevPose` → `Pose`, and the `Chassis` height, pitch and
  roll stepped back from the current step along their rates (`vz`, `pitchRate`, `rollRate`) by
  (1 − alpha) of a step: close to the previous step's values (within a few cm and about 1° as a
  car lands from a jump, since the physics moves them in four substeps), with no previous copy
  saved. A heading more than a quarter turn on from `PrevPose` is a tumble's angles folding
  (heading + π, pitch π − pitch, roll + π: the same body), so the blend unfolds them first.
  Rotation order YZX turns the node as the sim turns the body: heading, pitch about its right
  axis, roll about its forward axis (a positive roll tips the roof to the right). Each mesh
  stands on y = 0 at rest, centred on the centre of mass, with its wheels where `VEHICLES` puts
  them (the truck's one sim rear axle drawn as a tandem 1.3 m apart); body and x-ray proxy hang
  `cg` below the node (`VehicleNode` in `src/render/actors.ts`).
- `DrawEffects` reads the `Skid` events since the last frame and feeds the effects host
  (`makeEffects` in `src/render/index.ts`, made in `main.ts` beside the registries, passed as the
  `Effects` service, and `gta.effects` in dev builds). The marks and the smoke age by sim time
  (`Time.step` plus the render alpha), so both stand still while the game is paused. They are
  host state for the page's life: nothing loads a save in the browser.
  - Tyre marks (`src/render/marks.ts`): one dynamic mesh for the whole map, a ring buffer of 4,096
    quads, the oldest overwritten first. Each (car, wheel) draws a strip joining its consecutive
    steps; a step without a skid breaks it. Width by model's tread (Panda 0.18 m, Ape 0.1 m,
    Giulia 0.22 m, the truck's twin tyres 0.35 m), rubber on asphalt and stone, an earth rut on the
    rest, turning to a dark slush rut with the snow under the wheel (`Skid.snow`), opacity by
    `amount`, fading out over 60 s. A quad lies 4 cm over the ground the event
    names or the highest road ribbon drawn within 3 m over it (`drawnZ`; on a hairpin or at a
    junction the wheels' blended ground can sit under it, while a tunnel's hill stands higher),
    which clears the centre dash (2 cm over its road), and the material is pulled towards the
    camera in depth like the decals. Only the slots written since the last
    frame are uploaded (`addUpdateRange`), plus the whole colour buffer on a fade pass every
    0.25 s of sim time (≈ 0.5 ms for a full buffer). It is the first transparent effect drawn
    (render order 0).
  - Smoke and dust (`src/render/smoke.ts`): one `InstancedMesh` of up to 256 low-poly puffs
    (an icosahedron tinted per puff, 60 % opaque), spawned at `rate` × `amount` × `slip` puffs a
    second: white-grey burnt rubber on asphalt and stone, tan dust on gravel and dirt, dark brown
    on leaves, hardly any on grass, turning to white spray with the snow (`Skid.snow`). A puff
    swells, rises, drifts and thins away over 1–2 s; when all 256 are in the air, the puffs owed
    meanwhile are dropped. Being transparent it draws after every opaque mesh, the x-ray
    silhouettes included, and after the marks (render order 1), and it writes no depth.
  - Marks and smoke are lit like the people and cars (the `actor` weather variant: cloud shadows,
    no snow, no wet darkening), so they are not left sunlit under an overcast sky.
  - Measured in headless Chrome on an M4 Pro, 1280×720, dev server, seed 7: "Press any key" at
    ≈ 0.66–0.69 s (0.68–0.85 s before the change); JS heap after GC at the spawn 96.1–96.6 MB
    (96.0 MB before), 97.2 MB with a full ring of marks and the smoke at its cap; 60 fps and no
    frame over 16.8 ms through handbrake slides on asphalt and a dirt track, and with 4,095 marks
    and up to 256 puffs in view.
- `DrawSky`, last in the schedule so the cars stand where they are drawn, hands the sky host
  (the `Sky` service, [The sky](#the-sky)) the game time blended at the render alpha
  (`seconds + alpha · rate`), the clock's rate, the `Weather`, the sim time
  (`(Time.step + alpha) · STEP.dt`) and every `Lightning` since the last frame. It switches every
  car's lamps, on in traffic and in the player's car, off when parked, and hands the sky the cars
  whose lamps are on, for the headlight beams. Like every render system it writes nothing:
  `src/render/index.test.ts` counts the schedule's 7 systems and checks their declared access.

The static world (`src/render/world.ts`) is cut into 128 m chunks (`src/render/chunks.ts`), and
only the chunks around the camera exist as meshes. A built chunk has a terrain mesh, a solid mesh
(buildings, roofs, bridges, platforms, the street lamps' iron and lantern bodies), a decal mesh
(roads, rail), a water mesh (rivers and streams), a glow mesh (lit window panes and lantern glass)
and one `InstancedMesh` per tree kind; the water and glow meshes exist only where the chunk has
some. A 192 m apron of extra chunks continues the terrain, lines and trees beyond the map
bounds. Terrain cells take their colours from the land cover (`src/sim/map/cover.ts`, painted by
`COVER_LOOK` in `src/render/terrain.ts`): the
map's areas, meadow where none covers a cell, paving where open ground lies within 3 m of both a
wall and a road's edge (house fronts, sidewalks, alleys), and pebble beds along the wide streams.

Streaming:

- `new World(scene)` prepares, once (216–222 ms in Node for the whole valley, three runs; 189–195 ms
  before the street lamps): the land-cover raster
  for the whole map (`mapCover()` in `src/sim/map/cover.ts`, ≈ 105 ms and 4.9 MB, cheaper than
  clipping areas per chunk; built on first use and shared read-only with the sim's surfaces and the
  audio host), the street lamps (`streetLamps()`, 31–33 ms on first use), every
  static item as a `Piece` (an anchor polyline plus a `draw` function; each lamp is a one-point
  piece at its lantern), the pieces bucketed per
  chunk with the range of segments that reach it, and the trees bucketed per chunk and kind. A chunk
  build reads only its own bucket; it draws each piece's segments plus one neighbour on each side
  (for ribbon mitres) and keeps exactly the triangles that fall in the chunk, so the result is the
  same as cutting a whole-map build.
- Distances are measured on the screen plane, from the focus to each chunk's box projected along
  the camera's right and up axes, terrain relief included. A valley far below a ridge counts as
  near when the camera shows it beside the focus. The boxes are measured once (`chunkBoxes`);
  their screen rectangles are projected again whenever the view's yaw changes, which is every
  frame of a turn (≈ 1,600 boxes of 8 corners each).
- `world.update(focus, yaw, reach, budgetMs)` runs every frame. `reach` is the half-diagonal of the
  view at the widest zoom (`WIDEST_ZOOM`, 5 texels/m), so zooming out never shows a missing chunk.
  Chunks within reach + 64 m are built, nearest first, until 4 ms of the frame are spent (at least
  one per frame). Chunks beyond reach + 64 + 128 m are dropped: removed from the scene, their
  geometry and instance buffers disposed (the tree shapes are shared and stay).
- Before the first frame, `main.ts` builds every chunk the spawn view needs, so nothing pops in.
- Measured (1280×720 and 2560×1440, focus swept at 40 m/s through Monzone, Equi Terme, Gragnola,
  Colognola, Campiglione and Viano): 20–37 chunks loaded, chunk builds ≈ 0.25 ms on average and
  under 3 ms at worst, first frame after ≈ 0.6–0.85 s, JS heap ≈ 185 MB (was ≈ 550 MB building the
  whole map), no frame over 30 ms, 60 fps. Widened to the whole valley (7.8 × 10 km, 3.3× the
  area), chunks per view do not grow; load times and heap are under [Start-up](#start-up).

The pixel pipeline (`src/render/pipeline.ts`):

- An orthographic camera at 30° elevation. At that angle the ground axes project to exact 2:1
  pixel lines.
- In its home view the camera sits north-west of the focus and looks south-east: the mountains
  rise to the south and east, so this side sees every street. Q and E turn it a quarter at a time
  (the sim's `View`). `screenAxes(turns)` in `src/sim/view.ts` gives the screen axes on the
  ground for each turn. The sim maps on-foot keys through them, and the camera and minimap are
  built from them.
- The host eases the camera's yaw toward `turns × π/2` (`turnToward`). A quarter turn takes
  about a third of a second and stops exactly on the heading, so at rest the 2:1 lines and the
  texel snapping are exact again. Under `prefers-reduced-motion` the view turns at once.
- The scene renders into a low-resolution HalfFloat target about 270 texels tall. One fullscreen
  pass then darkens depth edges (outlines), lays the sky's atmosphere over each texel (fog, haze,
  exposure and grades: [Post pass](#post-pass)), converts to sRGB, and upscales by an integer
  factor.
- The camera snaps to the texel grid and the remainder becomes a sub-texel scroll offset. The
  static world never shimmers, but the view still scrolls smoothly.
- Zoom (`zoomFor`): 8 texels/m on foot, 6 in a car, 5 above 16 m/s (back to 6 below 13 m/s).
- The camera leads the player by 0.6 s of velocity, at most 14 m (`LOOK_AHEAD`), and eases
  toward its target.
- The key light (the sun, or the moon at night) stands on its real arc for the game time over the
  map's origin, turned with the view's yaw ([Lights](#lights)): in the home view it stands where it
  really is, and a turn carries it round with the camera, so the lit and shaded wall faces look the
  same whichever way the camera looks. Its shadow box follows the view, snapped to shadow-map
  texels. The box
  covers the ground the view shows (`shadowFit`): a 5 × 5 grid of rays across the view is marched
  down to the terrain, because a slope falling away from the camera shows ground far past the flat
  rectangle (at most 300 m across the light) and a valley seen between the view's edges can lie
  hundreds of metres deeper along the light. Its depth also reaches 1.5 km toward the sun for the
  ridges that shade a valley. The depth bias stays 0.45 m whatever the depth range.
- The far plane is 3 km from the camera (2.5 km past the focus): from the Apuan summits the
  deepest ground in view is ≈ 2.45 km from the camera, past the 1 km the plane used to stop at.

### The sky

The sky host (`src/render/sky/host.ts`) turns the saved clock and weather into the light, the
atmosphere and the weather on screen every frame; the parts it drives live beside it in
`src/render/sky/`. How each hour and regime looks is in [weather.md](weather.md).

- **One host, made before the first frame.** `main.ts` makes one `SkyHost` before the world and
  passes it as the `Sky` service. Its constructor adds every light and weather mesh to the scene
  (the key light and its target, the hemisphere, the rain and snow, the bolts, the night lights),
  so each lit program compiles once with the final light count; after that it drives them only by
  colour and intensity. In dev builds `gta.skyLook()` returns what it drew last: the sky frame, the
  sun and moon, the light, the exposure, whether shadows are drawn, the fog layers and the weather
  at the focus.
- **Each frame**, once the camera has moved, `draw(view, renderer)`:
  1. works out the sun (`sunOver`), the moon and its phase (`moonAt` over `place()`, the place
     `sunOver` reads, and `moonPhase`), the weather at the focus (`conditionsAt`) and the fog layers
     (`fogLayers`), all the sim's pure functions;
  2. takes this frame's light (`skyLight`) and eases the exposure (time constant 1.5 s, in log
     space) and the lamps (1.2 s), landing both at once after a clock jump of more than 1,800 game
     seconds beyond the clock's own run (the dev menu);
  3. strikes the steps' lightning and takes the scene flash;
  4. aims, colours and fits the key light and its shadows, and sets the hemisphere (which carries
     the flash) and the clear colour (dark forest, lit like the ground, where nothing is drawn);
  5. builds the `SkyFrame` every effect reads (sim time, night and lamp levels, ambient light,
     flash, wind, rain and snow at the focus), writes the shared uniforms (`applyFrame`), the post
     pass (`writePost`) and the surface weather (`applySurface`), and moves the rain, the snow and
     the night lights.
- **Two clocks.** Everything that animates (the rain's and snow's fall, the clouds' drift, the
  canopies' sway, bolts, flashes) runs on sim seconds, `(Time.step + alpha) · STEP.dt`, so it
  stands still in the pause and does not run 60 times too fast with the game clock. Only the sun
  and moon, the temperature, the regimes, the wetness and the snow line follow game time.
- **Shared uniforms** (`uniforms.ts`, `SKY_UNIFORMS`): the `{ value }` cells every patched and
  glowing material holds by reference. Three gives each program its own uniforms object, so a cell
  replaced or cloned would reach no material: write `.value` only. They are `uLamps`, `uNight`,
  `uAmbient`, `uExposure`, `uTime` and the 12 surface-weather cells. `uTime` is sim seconds modulo
  600 (`TIME_WRAP`), and every sine on it turns a whole number of times in 600 s (`phaseLocked`),
  so nothing jumps at the wrap (`uniforms.test.ts` and `surface.test.ts` check every shader).

#### Lights

The light is a pure function (`light.ts`) anchored on the settled look: with the sun 50.4° up in a
clear sky it gives exactly the fixed light the game had before the day cycle (sun 0xfff0d8 × 2,
hemisphere 0xdbe8f5 / 0x9a8a68 × 1.8, exposure 1).

- **One key light**, a `DirectionalLight`: the sun, or the moon once the sun is 4° under the
  horizon (fading in by 8° under, at 0.17 × its lit fraction^1.5 when full and high). One light and
  one shadow map at every hour, so the light count, and with it every program, never changes. The
  sun's colour comes from the clear sky's optical depth along its air mass, with half the real
  dimming toward the horizon kept so the golden hour still warms the walls it faces; it sets over
  2° to −1°. A `HemisphereLight` gives the sky and the ground's bounce, by keyframes of the sun's
  elevation from −18° (night) to 30° (the settled noon).
- **Its aim moves in steps** of 0.75° (every 3–4 real seconds at the normal clock), so hard shadow
  edges do not crawl; a clock jump lands at once. `keyDirection` turns it about the vertical by the
  view's yaw: the settled rule that the sun turns with the view.
- **Shadows are cast from at least 20° up** (`SHADOW_FLOOR`) while the colour follows the true
  elevation: long low shadows stay legible and inside the streamed chunks, and at 15° a shadow edge
  across a wall broke into light dashes. The shadow pass is skipped (`shadowMap.autoUpdate =
  false`) while the key light times its share through the clouds is under 0.002, on a moonless
  night or under a full overcast: the costliest GPU item, saved without a recompile.
- **Clouds take the direct light only where their shadows fall** (the surface shader), so the key
  light keeps the clear sky's intensity and a cloudy sky keeps its sunny gaps. `Lighting.direct`,
  `throughClouds(cover)`, is the mean share through the clouds: it sets the irradiance, the
  exposure, the lamps, the fog's light and the shadow skip.
- **The exposure** is a partial adaptation, (settled noon / clear sky now)^0.6 × (clear sky /
  weather-dimmed sky)^0.15, clamped to 1…4; a flash never moves it. The lamps come on as the light,
  relative to the settled noon, falls from 0.125 to 0.08 (about 10 minutes after sunset), in a
  thunderstorm and in thick fog.

#### Post pass

The atmosphere (`post.ts`) runs per low-resolution texel in the blit, after the outlines: the
orthographic camera makes each texel's world point exact from the depth texture, so the fog is
world-locked and costs no extra texture taps.

- **Fog**: the valley fog and the hill cloud of the sim's `fogLayers`. A point is veiled along 60 m
  of view ray plus its depth past the focus plane, at most 0.6 at the focus plane, rising to 0.92
  400 m deeper, and thinned to 0.45 of itself within 6–50 m of the player, so the player and the
  road ahead stay readable in the thickest fog. It is lit as a level face of albedo `PALETTE.fog`:
  the key light as it falls on level ground through the clouds (a low sun only grazes its top),
  plus 0.8 of the sky and 0.2 of the ground's bounce.
- **Haze** from the rain and snow falling at the focus, more on ground deeper than the focus plane.
- **Exposure**, then two grades: an overcast or rainy sky's flat light takes colour out (up to 0.4
  overcast and 0.2 in rain), and at night dark texels move toward a scotopic blue (tint 0.66, 0.9,
  1.6 at weight 0.8). Both spare bright texels, so lamps, lit windows and what they light keep
  their colour.
- **The limit**: a texel past full brightness in any channel is scaled down whole, so it keeps its
  hue (at a night's exposure of 4 a lamp's pool would clip from amber to pale lemon).

At exposure 1, with no fog, haze or grade, every texel within full brightness is left exactly as
it was, so the outlines, the texel snapping and the integer upscale stay exact
(`pipeline.test.ts`).

#### Surface weather

The lit world's materials are patched once into five weather variants (`surface.ts`), and every
effect is driven by the shared uniforms, never by a `#define` flipped at run time, so the weather
never recompiles a shader.

| Material | Variant | Draws | Weather on it |
|---|---|---|---|
| `solidMaterial` | `solid` | terrain, buildings, bridges, platforms, the lamps' iron | snow, wet darkening, cloud shadows |
| `decalMaterial` | `road` | roads, rail | snow (0.6 of it), wet darkening, puddles, cloud shadows |
| `waterMaterial` | `water` | rivers, streams | rain rings, cloud shadows; no snow, no darkening |
| `treeMaterial` | `tree` | the instanced trees | snow on the canopy tops, wet darkening, cloud shadows, sway |
| `actorMaterial` | `actor` | people, vehicles, tyre marks, smoke | cloud shadows only |

- `onBeforeCompile` replaces each anchor chunk exactly once (it throws on a missing or repeated
  anchor) and `customProgramCacheKey` returns `weather-<variant>`, so each variant is one program.
  Only the key light is clouded (`directLight.color *= weatherSun`), never the hemisphere or the
  night lights.
- The snow cover and the wetness are the sim's (`groundAt`): the snow edge's lattice hash and value
  noise are ported to 32-bit unsigned GLSL, with the sim's `EDGE`, `FEATHER`, `MELT_BAND` and
  `MELT_FULL` written into the shader text, so the white edge on screen is where the tyres lose
  grip. On the GPU the edge came within 2 mm of the sim's over 65,536 map points;
  `surface.test.ts` holds the key GLSL lines verbatim and checks a line-for-line port against the
  sim.
- Snow settles only on faces flatter than `ROCK_NORMAL_Y` (0.64, `terrain.ts`), the slope the
  terrain paints as bare rock, so cliffs stay bare.
- Rivers and streams left the decal mesh for their own layer (`RibbonSpec.layer` in `lines.ts`),
  cut by the same chunk rule, so a chunk still equals a cut: water takes no snow and no wet
  darkening.
- Cost: +0.015 ms a render at Monzone with snow, wet, clouds and wind on (0.25–0.27 ms against
  0.24–0.26 ms unpatched, 640 × 317 target, about 92 draw calls).

#### Night lights and glow

Night is lit by a fixed pool of real lights and by unlit glowing materials, all made before the
first frame.

- **The light pool** (`night-lights.ts`): 4 `SpotLight`s for headlight beams (the first follows the
  player's car, the others the nearest cars with lamps on, taken within 80 m and kept to 110 m) and
  8 `PointLight`s under the street lamps nearest the focus (taken within 60 m, kept to 80 m). The
  sky host's constructor makes them, and they are never added, removed or hidden after: the light
  counts are in every lit program's key, so changing one would recompile everything, a frame
  hitch. An unused light has intensity 0; none casts shadows; a light hands over to another car or
  lamp only after fading out over 0.35 s.
- **The glow layer** (`Sink.glow`, `glow.ts`): half the windows of homes (a hash per window) add a
  0.56 × 0.9 m pane, while sheds, garages, barns, farm outbuildings, building sites and greenhouses
  keep their shutters closed; each lantern adds its glass. One glow mesh per chunk, unlit
  (`glowMaterial`, reading `uLamps`, `uAmbient` and `uExposure`), casting no shadow. By day the
  panes are not drawn at all (under `uLamps` 0.02), so the windows keep their settled daytime look;
  lit, their colour is divided by the exposure, so a window shines as bright at dusk as at
  midnight. The whole map holds 21,201 lit panes and 2,952 lantern-glass quads.
- **Street lamps** (`lamps.ts`): the map has no lamp data (two `street_lamp` nodes in the raw OSM),
  so wall lanterns are placed from `MAP` at load: along tertiary, unclassified, residential and
  service roads, about every 28 m, on a house wall that fronts the road within 6 m, with at least
  four buildings within 40 m, the bracket 4.5 m up between two windows. 492 lamps, placed in
  31–33 ms on first use; `lampsIn` (32 m cells) finds them for the light pool. Bracket, cap,
  lantern body and foot are solid; the glass glows.
- **Vehicle lamps** (`actors.ts`): head and tail lamps are a per-model shared child mesh of the
  body (the Ape and the truck have them too), never disposed with a node;
  `vehicleLampMaterials.on` and `.off` share one program, and `DrawSky` picks one per car each
  frame.

#### Rain, snow and lightning

Precipitation and bolts are scene objects the sky host makes, drawn after the world.

- **Rain and snow** (`precipitation.ts`): static buffers of 12,288 one-texel streaks and 36,864
  one- to two-texel flakes (0.84 MB), anchored to the world on the camera plane and wrapped by the
  vertex shader in a box around the focus (the widest zoom's view plus 4 m a side, in 16 m steps),
  so nothing is uploaded per frame and zooming never reshuffles them. The count shown is the draw
  range, from the mm/h at the focus; the fall is integrated on the CPU in float64 from sim seconds,
  slanted by the wind. Over the widest 1080p view the buffers keep thickening past the heaviest the
  weather sends on high ground, 30 mm/h of water: rain to about 57 mm/h at 16:9 and 38 at 21:9,
  snow to about 54 and 33. The flakes are laid in order, so snow under about 11 mm/h (6.5 at 21:9)
  draws only the first 16,384, as before the buffer grew. In this orthographic view rain falls in
  front of what it falls on, so the drops ignore depth.
- **Bolts** (`lightning.ts`): a fixed pool of 3 `LineSegments` in an HDR colour, depth-tested but
  writing no depth; each channel is drawn from its flash's seed and timed at the event's
  `step · STEP.dt`. The scene flash is one smooth pulse per flash, carried by the hemisphere, and a
  new pulse waits at least 0.4 s after the last, so the screen never flickers (WCAG 2.3.1). Under
  `prefers-reduced-motion` the bolt does not flicker and the flash is halved. An in-cloud flash
  draws no bolt, only the flash, and may lie off the map (`terrainY` clamps its ground).

#### Shader warm-up and draw order

Every program is compiled before the first frame, and every transparent object has a fixed draw
order.

- `PixelView.compile(scene, extra)` binds the HalfFloat target, then compiles the scene and the
  stand-ins (`src/render/stand-ins.ts`): one tiny mesh per material the world and the actors draw,
  built as the real meshes are (vertex colours; a tree instanced with instance colours; a car with
  its x-ray box and its lamps off, and a mesh with lamps on), never drawn and freed after. Without
  the target bound, each program compiled as an sRGB-output twin no frame uses (26 programs at
  ready), and the real one again at the first draw. `stand-ins.test.ts` fails when a material a
  world build or an actor draws is missing from the stand-ins.
- Transparent objects draw in an explicit `renderOrder`, so their order never depends on three's
  sort by distance: tyre marks 0, smoke and the x-ray proxies 1, bolts 2, rain and snow 3.
- 16 programs at "Press any key", still 16 after a tour of the map's corners, Monte Sagro and
  Viano at every hour and regime, bolts and a night drive (10 before the day cycle):
  `weather-solid`, `-road`, `-water` and `-tree`; `weather-actor` three times (people and cars,
  marks with vertex alpha, instanced smoke); the glow and vehicle-lamp materials; rain and snow;
  the bolts' line material; the x-ray; two depth programs; the blit. All but the blit write linear
  colour into the target.

#### Measured

Measured in headless Chrome (ANGLE Metal, 1280×720, seed 42, dev server), against `main` before
the day cycle:

| Measure | Day cycle | Before |
|---|---|---|
| "Press any key", warm server | 686–751 ms over 8 loads | 687–828 ms over 4 loads |
| programs at ready / after 60 s | 16 / 16 | 10 / 10 |
| JS heap after GC, after 60 s | 99.3 MB, a night storm | 97.2 MB, a clear noon |
| draw calls a frame (scene and blit) | 40, a night storm | 52, noon |
| 60 s of frames | 60 fps, worst 16.8 ms: a settled storm at 23:00, 5 mm/h, lamps on, 10 flashes with bolts | 60 fps, worst 16.8 ms: a clear noon |

A four-minute night drive in the storm also held 60 fps with no frame over 16.8 ms. In Node, 83
chunk builds swept through Monzone take 0.92 ms on average and 2.6 ms at worst, against 0.88 and
2.3 ms before the glow and water meshes and the lamps.

## Audio

The audio schedule (`src/audio/index.ts`) is host code beside render. Its one system,
`Lunigiana/Hear`, reads the player, the vehicles that run or move (with the revs and load the sim's
drivetrain gives for their `Chassis`, speed and pedal at the `Time` step, and whether their wheels
are down), the people on foot, the `Impact`, `Skid`, `Honk` and `Lightning` events, the horn key,
the view's turns (the stereo image turns with the screen), the game clock (the Rome day, the time
of day and the sun's elevation, `skyAt`) and a copy of the `Weather`, and hands them as plain
`Heard` data to the `Audio` service.
`main.ts` provides the director (`src/audio/director`, plain TypeScript), which works out the
weather at the ears with the sim's `conditionsAt`, runs the outdoor acoustics, holds each thunder
until its sound arrives, and drives the Web Audio speaker (`src/audio/speaker.ts`) and its synths
(`src/audio/synth`). The speaker starts its AudioContext on the first key, click or tap once it exists
(made during the last loading steps, so normally the one that dismisses the title card), and
suspends it while the full map or the settings are open or the tab is hidden. In dev builds
`gta.audio` exposes the speaker, its output level and the context. Everything else is in
[audio.md](audio.md).

## HUD

The HUD (`src/hud`) is plain DOM over the canvas, with its markup in `index.html`. It reads only
the `PlayerView` and `SkyView` inspectors (`src/sim/views.ts`, `hud.update(view, x, y, angle,
yaw, sky)`) and the map; the handling store also reads the `HandlingView` inspector, and the dev
sky store `SkyView`:

- `PlayerView` returns a `PlayerViewModel`: previous and current pose, velocity, mode (`foot`,
  `driving`, `down`), the driven vehicle's label and speed, the vehicle in reach (label,
  occupied, stolen), the score, and the view's quarter turns.
- `SkyView` returns a `SkyViewModel`: the game time (`seconds`) and `rate`, the Rome wall clock at
  that time (`local`), and the `Weather` value, its seed and day plan included. Host code calls the
  sim's pure sky functions on it itself (`conditionsAt`, `sunOver`, `describeWeather`, `regimeAt`,
  `untilChange`), so the HUD reads the weather as the physics and the sound do; the month's odds
  are module content, which the menu reads with `oddsAt` at `place()`'s latitude.
- The clock and weather readout (`src/hud/clock.ts`, `.when` in `index.html`): `#hud-clock`, a
  `<time>`, shows Rome's time as a 24-hour "HH:MM" (`clockText`), and `#hud-weather` (`lang="en"`)
  the sim's word for the weather where the player stands and the air's temperature at the ground
  under them, to the whole degree ("Rain · 9 °C", `weatherText`). The ground's height is looked up
  with the place names, after 2 m of movement; the DOM is touched only when a text changes; neither
  is a live region, so screen readers are not told every minute. The top row is a three-column
  grid (`.top`: place, clock, score), so the clock stays at the screen's centre and a long road
  name wraps in its own column. At 600 px wide or less the clock moves under the score, in the
  top-right corner; under 360 px the score and the clock keep their narrowest width and the road
  name may break inside a word; a count never shrinks below its digits.
- `vehicleInReach` (`src/sim/body.ts`) answers both the HUD prompt and the `EnterExit` action, so
  the prompt never offers something the key will not do. The touch controls' action button shows
  the prompt's verb (`actionFor` in `src/hud/hud.ts`).
- Location: the name of the nearest road within 15 m, if it has one (tracks and paths skipped,
  so an unnamed road never borrows a side street's name), and the district disc from `districtAt`.
  Looked up again only after moving 2 m.
- The minimap is drawn once to an offscreen canvas and then blitted around the player, 300 m
  across, turned with the view so that screen-up is up. At 0.3 px/m, the minimap's own scale (90
  canvas px over 300 m, so the blit is 1:1), the whole map is 2340 × 3000 px (7 MP, 28 MB): under
  every browser's canvas limit (the strictest, Safari's, is 16.7 MP). Drawing it takes ≈ 15 ms at
  load; the per-frame blit ≈ 1 ms. hud.css shows its 90 px at 180 CSS px (120 in mobile mode),
  and a click or tap on it opens the full map.
- The full map (`src/hud/worldmap.ts`, `#hud-map` in `index.html`): the key labelled M toggles it
  (matched by the character it types, so AZERTY works; non-Latin layouts fall back to the key's
  position) and Esc closes it; repeats and Ctrl/Cmd/Alt chords are ignored. A click or tap on the
  minimap opens it, one on the map closes it. It paints the whole area north-up at the resolution of
  its own box (the page's, which a phone held upright lays out sideways) with the same layers as the
  minimap (`paintMap`), but roads light and at least 1.5–2 px wide so the network reads. It names
  the OSM villages (big, placed first) and hamlets (`place=*` POIs, localities left out), then the
  peaks that are HUD landmark districts (Monte Sagro, Pizzo d'Uccello...), once per name; a label
  that would overlap another or the north arrow is dropped with its dot. The player is a red arrow
  in a red ring (no label is red), drawn on its own canvas over the map so CSS blinks it (steady
  under `prefers-reduced-motion`), with a 1 km bar and the player's district in the header. It is
  repainted on open, on resize, and when the pixel ratio changes. The dialog takes focus when it
  opens, so screen readers announce its title and the district.
- The settings (`src/hud/settings.ts`), in every build: Esc opens and closes them, except that
  Esc closes the full map first while it is open, and does nothing on the title card; mobile mode
  has no touch control for them yet. They pause
  the game as the map does, the last frame drawn dimmed behind them (drawn again when the window
  is resized). Their Gameplay section holds "Vehicle physics": a radio button for each preset
  (`HANDLING_PRESETS`, with its description), the current one checked, and none with a Custom note
  when the knobs match no preset ([gameplay.md](gameplay.md#presets)).
- The handling store (`src/hud/handling.ts`) holds the player's handling for the settings and the
  debug menu, so both show the same choice: it sends each change as `SetHandling` events and
  keeps it in `localStorage` under `gta-lunigiana/handling`. A preset is stored by its name, so a
  preset retuned in a later build reaches the player; knobs set by hand are stored as the knobs.
  At load it sends the stored handling before the first step.
- While the full map or the settings are open the host pauses the game: the FixedLoop keeps
  running, but `pausable` (`src/hud/hud.ts`) skips the sim update and `main.ts` skips the frame
  (no world render, so actors do not jitter between `PrevPose` and `Pose`, and no audio tick) and
  suspends the AudioContext (`speaker.pause`). With no update the game clock stops too. Each
  skipped update drains the controls' press edges, keys and touch, so a key tapped on the map (F,
  Enter) does nothing on resume, while a key held through the pause is still held.
- The debug menu exists in dev builds only: `main.ts` loads it inside its `import.meta.env.DEV`
  block, beside the Ritmo monitor, so production builds leave it out. P or the Debug button beside
  the Ritmo monitor's (bottom left; under the minimap in mobile mode, off the touch controls and
  the clock) opens and closes it, and keys pressed inside it do not reach the game.
  `src/hud/debug.ts` is the shell (the panel, its keys and styles, focus on the first control at
  open); it holds three areas, each a `section` under an h3 heading, whose readouts refresh in an
  animation-frame loop that runs only while the menu is open and never moves a focused slider or
  date input:
  - Time (`debug-sky.ts`): the rates Stopped, Normal (a game minute a second), ×10 and ×60, a
    time-of-day slider, a date, and Sunrise and Sunset buttons from the sim's `sunTimes`, with the
    sun and moon read out.
  - Weather (`debug-sky.ts`): Auto and a button for each regime (`REGIME_SPECS`), "Settle now",
    readouts of the regime (and when the day's plan next changes it, `untilChange`), the air, the
    ground, the snow line, the wind and the sky where the player stands, and the weather seed in
    hex (`seedText`); then an Odds group, an h4 headed with Rome's month ("Odds (October)"), a line
    naming the map's latitude, and one row per `DayOdds` field from `oddsAt` through `oddsReadout`,
    snowfall at the player's ground height ([weather.md](weather.md#the-hud-and-the-dev-menu)).
    Over the paused map a regime sent but not yet taken reads "(on resume)".
  - Handling (`debug-handling.ts`, [gameplay.md](gameplay.md#handling)): a button for each preset,
    Custom shown when the knobs match none, and a control for every knob. It reads the handling
    from the store, not from the game: the game applies a `SetHandling` event only on its next
    step, and not while the full map or the settings pause it, so reading the game could show and
    store a stale value. What it sets goes through the store, so the settings show it and a reload
    keeps it.
- The sky store (`src/hud/sky.ts`, dev builds only) holds the clock and the weather for the debug
  menu and for `gta.sky` in the console, so each shows what the other set. It checks a request as
  the sim does (`setClock`, `isRegime`), sends `SetClock` or `SetWeather`, and shows what it sent
  only until the game has stepped (the game takes requests on its next step, and not while
  paused), then the game's own state, whoever set it: the host holds the clock behind the title
  card, so it reads Stopped there. `heading()` is the regime the weather moves toward: the one held,
  else (Auto) the game's, or, while a hand-back to Auto has not been taken yet, the day's plan's
  regime now (`regimeAt`); "Settle now" sends one request, `{ regime, settle: true }` with the
  regime held, or in Auto `{ regime: null, settle: true }`, which hands the weather back to the
  day's plan settled on its values. It stores nothing: the clock and the weather are saved sim
  state.
- Mobile mode: an inline script in `index.html`'s head marks the page `touch` when a touch screen
  is the main pointer (`(pointer: coarse)`), before the first paint, so the title card shows right.
  hud.css then shows the touch controls and a smaller HUD (the minimap top left, the speedometer
  and credits between the left controls and the right ones) and hides the key prompt: the action
  button shows its verb, without the vehicle. The card trades its key list for two touch hints and
  "Tap to play", and hides on the tap's click, not its press, so the click cannot land on the
  minimap under it. The keyboard keeps working. In headless Chrome emulating an 844 × 390 phone at 3× on an M4
  Pro, the view is 633 × 293 texels and runs at 60 fps with no frame over 30 ms while the stick is
  held; no real phone has been measured.
- Touch controls (`src/hud/touch.ts`, `#hud-touch`): Ritmo's `Touch` tracks the fingers on the
  canvas. On foot, a thumb on the left half brings the stick under it (full tilt at 56 px), and
  Run shows on the right. In a car the stick goes, and buttons hold the arrow keys like the
  keyboard: ◀ and ▶ on the left steer, Gas and Brake take the bottom right, and Hand brake, the
  action button and Horn a row above them. The action button shows only when it would act; ↺ and
  ↻ always. The zones are read from the drawn buttons on every new touch, so they follow
  hud.css and the mode, and a control the mode hides lets go of its key. `withTouch` turns them
  into keys ([Input](#input)).
- Landscape only: a phone held upright lays the page out sideways (`width: 100dvh`, the height
  Safari's toolbars leave) and turns it a quarter clockwise, to be held sideways (hud.css). The
  renderer and the full map size to the page's box, not the window, and each touch is turned back
  through the inverse of the page's transform about its origin (`unturn`) before `Touch` reads it.
  The settings dialog opens in the top layer, which the page's turn does not reach, so it turns
  on its own.
  On the first tap's click, `holdLandscape` asks for the full screen and then locks the screen to
  landscape, which Android grants; iPhones grant neither to a page, so the page turns itself there.
  It waits for the click because the full screen uses up the tap's user activation, which the
  speaker needs first, on the `touchend`, to start the sound.

## Checks

`pnpm check` runs:

- `tsc`: strict TypeScript, no emit.
- `oxlint` (`.oxlintrc.json`) with `@typeonce/oxlint-plugin-ritmo`:
  - everywhere: `handle-tick-result`, `prefix-descriptor-and-system-names`, `use-cell-value`;
  - in `src/sim/**`: `use-clock-for-time`, `use-random-for-randomness`, `use-ops-for-math`,
    `keep-simulation-headless`, `no-infinity-in-simulation-data`, and a ban on importing
    `render`, `hud`, `audio` or `main.ts`;
  - in `src/audio/**`: a ban on importing `hud` or `main.ts` (they wire the audio host, never the
    reverse).
- `ritmo-devtools lint src/sim/index.ts`: loads `lintTarget` and lints the `setup`, `update` and
  (described, not run) `render` and `audio` schedules. Any warning fails: without the audio
  schedule described, `Impact` and `Honk` would be `event-never-read` (`Lightning` has two
  readers, the render's `DrawSky` and the audio's `Hear`). `lintTarget` declares `SetHandling`,
  `SetClock` and `SetWeather` host events (`hostEvents`), since only the host sends them;
  undeclared they would be `event-never-written`. It also fails if a module the sim loads is not
  covered by the oxlint simulation override.
- `node --test`. Beside the unit tests, these guard the architecture:
  - `determinism` (`src/sim/index.test.ts`): `Determinism.check` runs a 600-frame scripted joyride
    twice, with the handling off its real values (`SetHandling`) and the clock at ten game minutes
    a step (`SetClock { rate: 600 }`: 100 game hours of weather, its days planned from the weather
    seed, the roads wetting and drying under the car), and requires identical state,
    transient components included.
  - `saves`: a snapshot taken mid-joyride, with a changed handling, the clock at rate 600 and a
    forced, settled thunderstorm, goes through JSON, restores into a fresh runtime, and plays on
    identically for 1,200 frames, its lightning included (some, and the same).
  - `src/sim/sky.test.ts`: the clock in the runtime (08:00 in Rome on the start day, each step's
    rate, none at rate 0, through a save), `SetClock` and `SetWeather` sent before the first
    update still applied, a forced storm's lightning (bolts on the map, with the clock stopped,
    the same in the same game), the weather seed kept through a save and replaying the same days,
    the seed alone planning the days whatever the storms drew, the weather's stream never reaching
    traffic or pedestrians, and a car braking further on a wet road.
  - `src/sim/sky/*.test.ts`: the calendar (every day from 1900 to 2100, the summer-time switches),
    the sun and the moon against JPL Horizons and USNO, the national normals, the odds and the day
    plan against their tables (300 years at 38, 42 and 45.5 N), the weather as it falls against the
    table and the snow targets (30 years, `calibration.test.ts`), the weather's steps, ground, fog,
    wind, storm cell and lightning, and the readout's words; `mapfree.test.ts`: the schema and the
    map-free sky modules decode no map, and once the map is decoded `place()` is its origin, its
    5th-percentile height and its slope.
  - `src/sim/handling.test.ts`: each handling knob's effect, the weather grip loss's included (a
    Panda brakes about 1.3 times further on a wet road and 3 times on packed snow, and turns its
    wheels less at speed; at 0 the weather changes nothing), each preset's behaviour, and
    `SetHandling` kept in range and through a save.
  - `src/sim/walls.test.ts` (traffic): a driver stops for a car standing across its lane, backs up
    short of the car queued behind, waits for a car beside its front as it steers back into its
    lane, backs up straight past a car alongside, and keeps slower and further back on a wet road.
  - `src/hud/handling.test.ts`: the handling store (what it stores, restores and sends);
    `src/hud/settings.test.ts`: the settings' keys (Esc on to the router, every other key kept
    from the game) and the preset they show (Custom for a hand-set mix); `src/hud/hud.test.ts`:
    the Esc and M routing (`overlayKey`) and the pause.
  - `src/hud/clock.test.ts`: the clock's and the weather's texts; `src/hud/sky.test.ts`: the sky
    store (clamped as the sim clamps, what it sent shown until the game steps, Auto heading for and
    settling on the day's plan, the title card's hold); `src/hud/debug-sky.test.ts`: the menu's
    rates and readouts, the odds and seed texts, the odds readout equal to `oddsAt`, and the
    regime's countdown;
    `src/hud/title.test.ts`: the clock held behind the title card while the world moves on.
  - `src/render/index.test.ts`: every system of every described schedule (`render`, 7 systems, and
    `audio`) declares no writes; people and vehicles draw with the actor material; traffic and the
    player's car shine and get the headlight beams, parked cars stay dark.
  - `src/render/sky/*.test.ts`: the light (the settled look at 50.4°, the key turned with the view
    at three yaws, clouds taking the sun only under their shadows), the post pass against a mirror
    of its GLSL (fog, grades, the limit), the surface shader's key lines verbatim and its port
    against the sim's snow cover and wetness (its melt band's straight line equal to `celsiusAt`),
    the host (the shadow skip, the fog's colour, the puddles' mirror, the sun and the moon over the
    loaded map's place), the lamps' placement and lanterns, the bolts and the flash's limits, the
    drop counts and wrap (both buffers under their cap at 30 mm/h), the light pool, and the
    phase-locked sines; `stand-ins.test.ts`: every
    material a world build and the actors draw has a stand-in; `pipeline.test.ts`: `compile`
    builds into the scene's target; `actors.test.ts`: the vehicle lamps and the x-ray's yellow;
    `buildings.test.ts`: lit panes on homes only; `world.test.ts`: the glow and water meshes.
  - `src/sim/map/map.test.ts`: invariants of the generated map (see [map.md](map.md)).
  - the audio tests, in Node without Web Audio (see [audio.md](audio.md#tests)).

`src/sim/testing.ts` is the headless test kit: `start(timeline, staging)` makes a runtime with
scripted keys and collects every `Impact`, `Honk` and `Lightning` emitted (`heard`), `stage`
clears the map and places exactly the cars and pedestrians a test needs (`battistiTraffic(color,
at?, speed?)` a traffic car on Via Cesare Battisti), `World` inspects everything as plain data,
the handling, the clock, the weather and the world's random stream (`rng`) included, and `drive`
steps one vehicle with `advance` alone (test ground, no walls) under a given handling, on ground
as wet and snowy as its `weather` (dry when omitted).
