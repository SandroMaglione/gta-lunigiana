# Gameplay

All rules are simulation systems in `src/sim/systems`. The step order is in
[architecture.md](architecture.md). Units are metres, seconds and radians. One step is 1/60 s. The
keys named here are the keyboard's; in mobile mode the touch controls press the same keys
([architecture.md](architecture.md#input)).

## Start

`SpawnWorld` puts the player on the Via Cesare Battisti sidewalk in front of the Carabinieri
station. 200 of the map's parked spots (`PARKED`) get a car, picked at random, so the cars spread
over the villages as the spots do. Spots where a parked car would tilt more than 15° are skipped
(72 of the 805: the 4 m terrain puts some verges on a bank), and each car settles on its springs
with the ground's slope. The two spots nearest the station get Carabinieri cars. The rest
are randomly chosen spots, about 80% Pandas and 20% Apes. On a tertiary-road spot where it fits,
a roll under 10% makes a marble truck instead, at most two of them. The world's `Rng` makes every
choice, so `?seed=N` replays the same start. The game begins on today's date at 08:00 in Rome,
under a clear sky on dry roads, once the title card is dismissed; the clock, the sun and the weather
are in [weather.md](weather.md).

## The view

`TurnView` (`src/sim/index.ts`) turns the camera a quarter left (Q, counter-clockwise seen from
above) or right (E), once per press, on foot or driving. The `View` resource counts the net
quarter turns. It is saved state, because the on-foot keys follow it. In the home view (0), the
camera sits north-west of the player and looks south-east: the mountains rise to the south and
east, so this side sees every street. Driving keys steer the car and do not depend on the view.

The host swings the camera through each turn in about a third of a second, or turns it at once
under `prefers-reduced-motion`. The sun and the minimap turn with it, so the lit and shaded walls
and the minimap's top always match the screen.

## On foot

`PlayerFoot` (`systems/foot.ts`):

- The movement keys walk along the screen axes of the turned view (`screenAxes` in
  `src/sim/view.ts`). In the home view, up walks south-east on the ground and right south-west;
  each quarter turn of the view swings both a quarter. The body turns to face the keys.
- Walking speed is 2.2 m/s, sprinting (Shift) 5.5 m/s, with an acceleration of 30 m/s². Wet
  ground and snow slow only tyres, not feet.
- The body is a circle of radius 0.35 m. It slides along walk walls and never passes through them
  (`walkBy` in `src/sim/body.ts`). Velocity is what actually happened, so a wall stops it.
- Knocked down, the player cannot steer and slides to a stop (10 m/s²).

## Entering, stealing, carjacking, exiting

`EnterExit` (`systems/enter-exit.ts`) handles the action key (F or Enter), once per press:

- **Enter**: on foot and standing, the player enters the vehicle whose body is nearest, within
  2 m (`ENTER_GAP`), with no walk wall in between, unless it lies on its side or roof or is
  destroyed ([Damage](#damage)). The HUD prompt uses the same test (`vehicleInReach`), so it shows
  exactly what the key would do: `steal`, `enter` or `carjack`.
- **Steal**: the first entry of any vehicle scores one theft and tags it `Stolen`. Entering it
  again scores nothing.
- **Carjack**: entering a traffic car removes its AI. Its driver gets out at the first free door
  as a pedestrian, on the verge on that side, and flees for 4 s. If no door is free, no driver
  appears.
- **Exit**: the player gets out at the first free door, tried in this order: left (the driver's
  side, in Italy), right, front, back. A door is free when it is clear of walk walls with no wall
  between it and the car. If no door is free, the player stays in. The car is left with its
  handbrake on.

Entering or leaving sets the player's velocity to zero. The camera's look-ahead follows velocity,
not the pose, so the hop to the seat or the door does not swing the view.

## Driving

Every vehicle is driven by its physics, whoever is at the wheel. `PlayerDrive` maps the keys to
the car's `CarInput`: throttle = up − down, steer = left − right (left turns counter-clockwise),
and Space for the handbrake. `VehiclePhysics` (`systems/physics.ts`) moves every vehicle, player or
AI, from its `CarInput` and its model's data in `src/sim/vehicles.ts`. Nothing about the handling
is tuned per model: top speed, acceleration, braking, grip and tipping follow from the masses,
dimensions, engines, gears and tyres. The handling knobs ([Handling](#handling)) scale that data
for every vehicle alike; outside that subsection every figure here is at their real values (the
Simulation preset). A new game starts on the Balanced preset ([Presets](#presets)).

### Controls to forces

- **Steering** turns the road wheels toward the keys at 2.5 rad/s (back to straight at 4 rad/s),
  within a lock that shrinks with speed: full lock at walking pace (each model's turning radius),
  at speed just enough to turn at the tyres' grip (0.85 g × the tyres' grip factor × the share of
  their dry grip the wet or snowy ground leaves them), or at 0.6 of the sideways acceleration that
  tips the vehicle over when that comes first (the Ape ≈ 3.2 m/s², the laden truck ≈ 3.7 m/s²). A
  held key corners at about the grip limit; yanking the wheel or the handbrake can still tip the
  tippy ones. The lock follows the weather because keys steer all or nothing: on packed snow a held
  key would otherwise ask the tyres for 0.85 g of their 0.3 and slide the car straight on (a design
  call the user approved). At 15 m/s on Simulation a Panda's wheels turn 8.9° on a dry road, 0.92
  of that on a wet one and 0.66 on snow; braking, the handbrake or more speed in a bend still slide
  it.
- **Engine and gearbox** (`src/sim/drivetrain.ts`): a full-load torque curve per engine (60% of
  peak at idle, peak torque from `torqueRpm`, the rated power at `powerRpm`, a fuel cut at the
  redline) through an automatic gearbox: up at 50–92% of the redline and down at 24–42% (more
  pedal, later), never hunting, the drive cut while a shift lasts. In first gear and reverse the
  clutch slips up to idle plus the pedal's share of the launch revs. With the pedal up, the
  engine brakes. The truck's limiter holds it to 90 km/h.
- **Throttle against the motion** above 0.5 m/s is the brake pedal; slower, it drives the other
  way (reverse). Standing (under 0.5 m/s) with no pedal, the driver keeps a foot on the brake, so a
  car sat in on a hill stays put. The handbrake locks the wheels that do not steer.

### The body

`integrate` (`src/sim/dynamics.ts`) advances each vehicle in four substeps of 1/240 s:

- **Suspension**: each wheel is a spring (the body's ride frequency, 1.5–2 Hz) and a damper
  against the ground under it (`groundZ`: the drawn terrain and road ribbons, blended where a
  junction's ribbons overlap, see [map.md](map.md#known-data-limitations)), plus a bump stop
  past 0.1 m of travel and anti-roll bars, stiffer at the front so cars understeer at the limit.
  The body pitches when it brakes or accelerates, rolls in corners (about 4° per g in a Panda),
  leaves the ground over a crest or a ramp and lands. In the air the tumbling slows a little.
- **Tyres** (`src/sim/tyres.ts`): sideways force rises with the slip angle to a peak (0.12–0.15
  rad) and falls toward sliding friction past it; along the tyre the drive, the brakes and the
  rolling resistance share one friction ellipse. A tyre asked for more than its grip spins (drive)
  or locks (brakes without ABS, the handbrake) and slides. ABS holds a braked tyre at 85% of its
  grip, leaving some to steer with; traction control holds a driven one under what cornering
  leaves. A loaded tyre grips less per newton (12% less at twice its static load). Nearly
  standing, a tyre holds like static friction, so the brakes and the handbrake hold a car on a
  slope up to the tyres' grip; past it, it slides.
- **Surfaces** (`GRIP` in `tyres.ts`, per wheel from `surfaceAt`): peak friction, sliding share
  and rolling resistance, dry and wet (`WET`).

  | Surface | Peak μ dry / wet | Sliding / peak, dry / wet | Rolling resistance, dry / wet |
  |---|---|---|---|
  | asphalt | 1.1 / 0.79 (×0.72) | 0.7 / 0.65 | 0.013 / 0.015 |
  | stone (setts, paving) | 0.9 / 0.59 (×0.65) | 0.75 / 0.7 | 0.016 / 0.018 |
  | gravel | 0.62 / 0.56 (×0.9: it drains) | 0.9 / 0.9 | 0.03 / 0.033 |
  | dirt | 0.6 / 0.39 (×0.65: mud) | 0.85 / 0.85 | 0.045 / 0.06 |
  | grass | 0.45 / 0.32 (×0.7) | 0.8 / 0.75 | 0.07 / 0.075 |
  | leaves (forest floor) | 0.5 / 0.33 (×0.65) | 0.8 / 0.75 | 0.06 / 0.065 |
  | packed snow (`SNOW`, over any surface) | 0.3 | 0.85 | 0.03 |

- **Weather** (`weathered` in `tyres.ts`): each wheel asks the weather how wet and how
  snow-covered the ground is at its contact (`groundAt`,
  [weather.md](weather.md#the-ground-wetness-snow-and-meltwater)). Its surface's grip goes from dry
  toward wet by the wetness, then toward packed snow by the snow cover, and the handling's weather
  grip loss scales the difference from dry ([Knobs](#knobs)). A wet road keeps 0.72 of its dry grip,
  as wet asphalt holds 0.7–0.8 against about 1.1 dry, and packed snow about 0.27 of it.

- **Gravity** pulls along the slope (the springs push along the ground's normal), and air drag is
  ½ ρ Cd·A v².
- **Rollover**: past 60° of tilt the wheels carry nothing and the body's eight corners take the
  ground (stiff contacts, sliding friction 0.6; each measures the ground's slope over ±0.1 m and
  ignores a sample more than 0.3 m off, the far side of a step): a car rolls onto its side or
  roof and slides to a stop there. An overturned vehicle cannot be driven or entered (`vehicleInReach`); the player
  can still get out.
- **Walls**: the body is a row of circles of radius width/2 along its length. Its planar move
  sweeps against drive walls. A hit keeps the sliding part of the motion, bounces back 0.2 of the
  impact speed, and loses 4% of its speed per m/s of impact (keeping at least 20%). A turn that
  would wedge the body into a wall is undone; if any move would, the car stops.
- **Sleep**: a vehicle with its pedal up that has been still (under 0.05 m/s) for two steps
  without gathering speed is tried 10 steps from exact rest under the same pedals. If it ends
  under 0.002 m/s, or creeping no faster than half way through and under 0.045 m/s (the creep a
  body on the ground keeps under its friction's cap), it settles to exact zero and costs no work
  until something moves it or its driver presses a pedal. What its brakes cannot hold (a bank
  steeper than its tyres' grip, a car on its roof on a slope steeper than its sliding friction)
  slides on instead: a Panda coasting up a 50% grass bank at 0.5–14 m/s never sleeps on it, one
  on its roof sleeps on a 50% slope and slides off a 62% one. With the handling's self-righting
  on ([Handling](#handling)), a vehicle lying on its side or roof does not sleep, and one already
  asleep there wakes to roll back onto its wheels; a destroyed one stays where it lies
  ([Damage](#damage)).

Events: a wall or ground hit is an `Impact` (a ground hit names the face that struck: `under`
when the suspension bottoms out on landing, `roof`, `side`, `front`, `rear`), and each step a
tyre slides past its grip it is a `Skid` (sliding speed, how far past its grip: 0.25 for ABS at
the limit, 1 sliding, spinning or locked; the surface, and how snow-covered the ground is there).
The renderer lays tyre marks and smoke from `Skid`, dark slush ruts and white spray on snow; the
audio plays both ([audio.md](audio.md)), and every crash `Impact` harder than a scuff wears the
vehicles it struck ([Damage](#damage)).

### Vehicles

`src/sim/vehicles.ts` holds each model as it is: kerb mass with a driver, wheels, centre of mass,
tyres, brakes, engine and gearbox, from the Fiat Panda III 1.2 FIRE and Alfa Romeo Giulia 2.0
Turbo data sheets, the Piaggio Ape 50 (1.8 kW two-stroke) and an Iveco Trakker 6x4 tipper laden
with a marble block. Gear ratios are representative, set so each engine reaches its published top
speed.

| Model | Label | Length × width (m) | Mass | Drive | Engine | Gears |
|---|---|---|---|---|---|---|
| `panda` | Fiat Panda | 3.7 × 1.65 | 1015 kg | front | 1242 cm³ petrol four, 102 N·m, 51 kW | 5, manual-style |
| `ape` | Piaggio Ape | 2.9 × 1.4, three wheels | 385 kg | rear | 50 cm³ two-stroke single, 3.4 N·m, 1.8 kW | 4 |
| `truck` | Camion del marmo | 7.6 × 2.45 | 26,000 kg | rear tandem | 12,880 cm³ turbodiesel six, 2100 N·m, 302 kW | 12, limiter 90 km/h |
| `carabinieri` | Alfa Romeo Giulia dei Carabinieri | 4.6 × 1.85 | 1580 kg | rear, ABS, traction control | 1995 cm³ turbo petrol four, 330 N·m, 147 kW | 8 |

What follows from them, measured on flat ground with `advance` (the physics tests in
`src/sim/__tests__/physics.test.ts`; published figures in brackets):

| Model | 0–100 km/h | Top speed | Stop from 100 km/h | Cornering limit | Tips over at |
|---|---|---|---|---|---|
| `panda` | 12.6 s (14.2) | 164 km/h (164) | 42.4 m, ABS | 0.84–0.96 g, understeers | never on the flat (static 1.29 g) |
| `ape` | 0–30 km/h in 17 s | 41 km/h (37–45) | 9.6 m from 40 km/h, wheels locked | lifts a rear wheel past ≈ 0.4 g | 0.55 g static: a handbrake turn at its top speed |
| `truck` | 0–50 km/h in 15.1 s | 90 km/h (limiter) | 56.9 m from 90 km/h, ABS | ≈ 0.5 g | 0.63 g static: full lock from 16 m/s (58 km/h) |
| `carabinieri` | 6.5 s (6.6) | 242 km/h (235) | 39.4 m, ABS | ≈ 1.0 g | never on the flat (static 1.65 g) |

On gravel a Panda stops from 100 km/h in 68.4 m and on grass in 84.9 m; full throttle from rest
spins its front wheels on gravel but not on asphalt, and after 10 s up a 15% grade it does 16 m/s
on asphalt and 1.5 m/s on grass. On a new game's Balanced handling it stops in 47.0 m on gravel
and does 14.9 m/s up the 15% grass ([Presets](#presets)). On a fully wet road it stops from
100 km/h in 56.1 m and on packed snow in 128 m. The Ape climbs 15% at 2.6 m/s. Adding a model to
`VEHICLE_MODELS` fails to compile until it has data here, a durability ([Damage](#damage)), a mesh
and an engine for its smoke and fire in `src/render/actors.ts`, and a trim in the audio.

The camera zooms out with speed (6 texels/m in a car, 5 above 16 m/s). The HUD speedometer shows
km/h.

### Handling

The handling is 16 knobs over the vehicles' real data that make driving easier or harder: each is
a multiplier (×) of the real value, a share from 0 (none) to 1 (real), or an on/off switch
(`HANDLING` in `src/sim/handling.ts`). At every knob's real value (`REAL_HANDLING`) each vehicle
drives as its data says. Three presets set every knob at once ([Presets](#presets)), and a new
game starts on Balanced (`DEFAULT_HANDLING`).

- **Every vehicle**: one handling applies to every vehicle on the map, the player's, parked and
  traffic alike. `tuned` applies the knobs that are part of a vehicle's data to its spec, and
  `rigFor` (`src/sim/chassis.ts`) adds the surface grips, the weight transfer and the steering.
- **Traffic keeps its real comfort**: the traffic AI keeps the sideways acceleration it takes a
  curve at and the lean at which it stops ([Traffic AI](#traffic-ai)) from the real rigs
  (`RIGS`), so it drives no faster where a knob adds grip and no slower where one takes it away;
  it reads only how far the physics will turn its wheels (`comfortSpeed` steers with `rigFor`),
  so at steering at speed ×2 it slows to the same comfort rather than corner twice as hard. Its
  caution on wet and snowy roads does follow a knob, the weather grip loss: it drives as carefully
  as the grip that knob leaves, as a real driver feels the road.
- **Saved**: the `Handling` resource is part of the saved world, so a restored snapshot or a
  replay drives with the handling it was played with.
- **Set from the settings and the debug menu**: the player picks a preset in the game settings
  (Esc, Gameplay, "Vehicle physics"), in every build; the dev-only debug menu (P, or the Debug
  button beside the Ritmo monitor) has the same presets and every knob (see
  [architecture.md](architecture.md#hud)). Each change is a `SetHandling` request, which
  `ApplyHandling` keeps inside the knob's range (a switch to 0 or 1) and drops when it is not a
  number. The choice persists in the browser (`localStorage`), so a reload keeps it, and a mix of
  knobs set by hand that matches no preset shows as Custom in both.

#### Presets

Each preset (`HANDLING_PRESETS` in `src/sim/handling.ts`) sets all 16 knobs; their values are
the Simulation, Balanced and Arcade columns of the [knob table](#knobs).

- **Simulation** (`REAL_HANDLING`): the real data. Cars slide on gravel, grass, wet roads and
  snow, wheels lock and spin without driver aids, and the Ape and the laden truck roll over in
  sharp turns.
- **Balanced**, a new game's (`DEFAULT_HANDLING`): in the middle. A little more grip, power,
  braking and steering, ABS and traction control on every vehicle, half the off-road grip loss and
  0.6 of the weather's, less weight transfer and stiffer bars: the Panda and the Giulia stay upright
  in corners, while the Ape still tips in a hard handbrake turn and the laden truck at full lock
  from 84 km/h.
- **Arcade**: pure fun. Twice the grip, off the road too (no off-road loss), rain and snow taking
  0.3 of what they really take, two and a half times
  the power and the brakes, razor-sharp steering, and the two assists no real car has at full: the
  stability assist keeps a car on the line it steers (full lock held 5 s at 100–160 km/h slides a
  Giulia or a Panda at most 4°, and a Giulia floored at full lock circles at 128 km/h), and
  self-righting rolls a vehicle left on its side or roof back onto its wheels. Nothing rolls over
  in a turn. Less weight transfer leans a vehicle further on a side slope: an Ape crawling across
  a grass bank at 2 m/s stays upright up to 45% on Balanced and 75% on Simulation, and on Arcade
  to 75% because self-righting catches it (50% without).

What each preset drives like, measured with `drive` (`src/sim/testing.ts`) on flat test ground
and asphalt unless named; `src/sim/__tests__/handling.test.ts` pins the Panda's quicker 0–100 km/h and
shorter gravel stop from preset to preset, which vehicles roll over on which, and Arcade's
half-second tap. Top speed is the speed after 180 s floored; a lateral g is the steady sideways acceleration at full lock held
at 15 m/s; a rollover is the lowest speed a vehicle set going at 15–120 km/h, in 3 km/h steps,
tips over from, at full lock held for 10 s or in a handbrake turn (the Ape is set going faster
than it can drive):

| Model | Case | Simulation | Balanced | Arcade |
|---|---|---|---|---|
| `panda` | 0–100 km/h | 12.6 s | 10.9 s | 5.2 s |
| | top speed | 164 km/h | 176 km/h | 182 km/h |
| | stop from 100 km/h, asphalt | 42.4 m | 38.0 m | 20.9 m |
| | stop from 100 km/h, gravel | 68.4 m | 47.0 m | 20.9 m |
| | stop from 50 km/h, asphalt: dry / fully wet / packed snow | 10.8 / 14.2 / 33.2 m | 9.6 / 11.3 / 16.0 m | 5.4 / 5.8 / 6.7 m |
| | after 10 s floored up a 15% grass bank | 1.5 m/s | 14.9 m/s | 31.6 m/s |
| | lateral g | 1.01 | 1.06 | 2.08 |
| `carabinieri` | 0–100 km/h | 6.5 s | 5.8 s | 3.1 s |
| | top speed | 243 km/h | 260 km/h | 357 km/h |
| | stop from 100 km/h | 39.4 m | 35.8 m | 19.8 m |
| | lateral g | 0.99 | 1.11 | 2.26 |
| `ape` | 0–30 km/h | 16.9 s | 13.5 s | 5.7 s |
| | top speed | 41 km/h | 45 km/h | 47 km/h |
| | stop from 40 km/h | 9.6 m | 8.4 m | 4.4 m |
| | lateral g | 0.70 | 0.74 | 1.09 |
| | rolls over at full lock from | 78 km/h | 90 km/h | never |
| | rolls over in a handbrake turn from | 39 km/h | 42 km/h | never |
| `truck` | 0–50 km/h | 15.1 s | 13.4 s | 8.1 s |
| | top speed | 90 km/h | 90 km/h | 90 km/h |
| | stop from 90 km/h | 56.9 m | 49.9 m | 25.5 m |
| | lateral g | 0.55 | 0.54 | 0.95 |
| | rolls over at full lock from | 57 km/h | 84 km/h | never |

The Panda and the Giulia roll over in neither test on any preset, nor the truck in a handbrake
turn; on Arcade nothing does, and on Balanced the Ape's full-lock rollover lies beyond its top
speed.

#### Knobs

The knobs, in the menu's order and groups (Tyres; Engine and brakes; Driving aids; Steering;
Body and suspension), with each preset's value. Multipliers and shares move in steps of 0.05.

| Knob | Key | Range | Simulation (real) | Balanced (new game) | Arcade | Changing it |
|---|---|---|---|---|---|---|
| Tyre grip | `grip` | 0.5–2.5 × | 1 | 1.1 | 2 | every tyre's grip on every surface: higher corners faster, stops shorter and slides less, but lets a tall vehicle corner hard enough to roll over (a Panda held at full lock tips from 36 km/h at ×1.1 once held for 30 s, 41 km/h within 5 s, and from 24 km/h at ×1.5), so lower the weight transfer with it (at 0.5 none of the four tips at full lock at ×1.5); lower slides and spins sooner |
| Off-road grip loss | `looseGround` | 0–1 | 1 | 0.5 | 0 | how far every surface but asphalt (stone, gravel, dirt, grass, leaves) differs from it in grip, sliding friction and rolling resistance; at 0 every surface drives like asphalt |
| Weather grip loss | `weatherGrip` | 0–1 | 1 | 0.6 | 0.3 | how much wet ground and snow cover take from every tyre's grip ([Surfaces](#the-body)): at 1 a wet road keeps 0.72 of its dry grip and packed snow 0.27, so stops are longer, corners slower and the lock at speed smaller; at 0 every vehicle drives as on a dry day whatever the weather. The traffic AI drives as carefully as the grip it leaves |
| Engine power | `power` | 0.5–4 × | 1 | 1.15 | 2.5 | every engine's torque and power: harder acceleration where the tyres can take it (else the driven wheels spin), steeper climbs and a higher top speed; the truck's limiter still holds it to 90 km/h |
| Brake power | `brakes` | 0.5–4 × | 1 | 1.15 | 2.5 | the brakes' force: higher stops shorter until the tyres' grip runs out, lower stops longer |
| Air drag | `drag` | 0–2 × | 1 | 0.9 | 0.6 | air resistance: lower raises the top speed and coasts further, higher holds a vehicle back at speed |
| ABS on every vehicle | `abs` | off, on | off (each vehicle's own) | on | on | on: no vehicle's brakes lock its wheels, so it still steers braking hard (the Ape has no ABS of its own); the handbrake still locks the rear wheels |
| Stability assist | `stability` | 0–1 | 0 (off) | 0 | 1 | an assist no real car has: it turns a sliding car's yaw back toward the line it steers (the steered yaw rate, v · tan(steer) / wheelbase, capped at what the tyres' grip can turn the path at) and damps the rear axle's sideways slide (not the centre of mass's, which a clean turn has too); at 1 a car holds the line it steers and does not spin (a Panda tapped to full lock at 160 km/h off the throttle, which spins round at 0; on Arcade, full lock held 5 s at 100–160 km/h slides a Giulia or a Panda at most 4°), except while the handbrake is held, so a handbrake turn swings it round exactly as without it; off in the air and under 2 m/s |
| Self-righting | `selfRighting` | off, on | off | off | on | on: a vehicle lying on its side or roof, or rolling up onto some of its wheels, tilted more than 25° and nearly stopped (under 3 m/s), rolls back onto its wheels by itself, hopping off its roof: every model from its side in 0.3 s and from its roof in about 1.1 s on flat ground, and the laden truck across a 20% slope too, without falling back; an overturned vehicle asleep wakes for it; a destroyed one stays where it lies ([Damage](#damage)) |
| Traction control on every vehicle | `traction` | off, on | off (each vehicle's own) | on | on | on: no vehicle spins its driven wheels; the engine gives only what the tyres can take and leaves them grip to corner (only the truck and the Giulia have it of their own) |
| Steering at speed | `steering` | 0.5–2.5 × | 1 | 1 | 2 | how far the wheels turn at speed, where the lock shrinks to what the grip (the weather's included) and the tipping point allow (full lock at walking pace stays): higher turns tighter but slides or tips sooner, lower is steadier |
| Steering speed | `steeringRate` | 0.5–4 × | 1 | 1.4 | 3 | how fast the wheels turn toward the keys (2.5 rad/s) and back to straight (4 rad/s): higher reacts at once but is twitchy, lower is smoother but slower |
| Weight transfer | `weightTransfer` | 0–1 | 1 | 0.8 | 0.4 | how much cornering, braking, accelerating and a crash's sideways shove tilt the body onto its outer, front or rear wheels (the lever of the tyres' forces about the centre of mass): lower keeps the body flatter and the grip even; at 0 none of them tips a vehicle over, though a jump or a side slope still can, and a side slope leans it further (with no lever the tyres no longer hold the body up against it: an Ape parked across a 40% slope leans about 38° at 0 against 23.5° at 1) |
| Anti-roll bars | `antiRoll` | 0–3 × | 1 | 1.3 | 2.5 | the bars that share the load between an axle's left and right wheels: stiffer leans less and, on four wheels, resists tipping (the Ape's only bar is at the rear, and stiffer tips it a little sooner), softer leans more and keeps the wheels on the ground over bumps |
| Suspension stiffness | `stiffness` | 0.5–2 × | 1 | 1.1 | 1.5 | the springs' stiffness (the ride frequency goes as its square root): stiffer leans, dives and bottoms out less, softer soaks up bumps but wallows and dives |
| Suspension damping | `damping` | 0.3–2 × | 1 | 1.2 | 1.8 | the dampers: higher settles the body at once after a bump or a landing, lower lets it bounce |

What one knob changes, measured with `drive` (`src/sim/testing.ts`: `advance` alone, flat test
ground and asphalt unless named, no walls), the scenarios of `src/sim/__tests__/handling.test.ts`:

| Knob | Case | Real | Changed |
|---|---|---|---|
| Tyre grip 1.5 | a Panda's stop from 100 km/h on gravel | 68.4 m | 47.7 m |
| Off-road grip loss 0 | a Panda floored for 10 s up a 15% grass bank | 1.5 m/s | 16.2 m/s |
| Weather grip loss 0 | a Panda's stop from 50 km/h on packed snow (on a fully wet road) | 33.2 m (14.2 m) | 10.8 m, as dry (10.8 m) |
| Weather grip loss 0 | a Panda's road-wheel angle after 0.5 s of full left at 15 m/s on packed snow | 5.9° (0.66 of dry) | 8.9°, as dry |
| Engine power 2 | a Panda floored from 20 m/s, 5 s on | 25.4 m/s | 32.1 m/s |
| Brake power 0.5 | a Panda's stop from 100 km/h | 42.4 m | 72.0 m |
| Air drag 0 | a Panda coasting from 30 m/s, 5 s on | 27.2 m/s | 28.8 m/s |
| ABS on | an Ape braking from 11 m/s: steps of the first 2 s (120) with a locked wheel | 17 | 0 |
| Traction control on | a Panda floored from rest on gravel: steps of the first 2 s (120) with a wheel spinning | 120 | 0 |
| Steering at speed 2 | a Panda's road-wheel angle after 1 s of full left at 20 m/s | 7.1° | 14.4° |
| Steering speed 2 | a standing Panda's road wheels after 5 steps (1/12 s) of full left from straight | 11.9° | 23.9° |
| Weight transfer 0 | an Ape's handbrake turn at 11.5 m/s | tips over | stays upright |
| Anti-roll bars 3 | a Panda's lean 2.5 s into a corner at 14 m/s, steering 0.6 | 3.0° | 1.5° |
| Suspension stiffness 2 | a Panda's deepest dive braking hard from 20 m/s | 3.5° | 1.7° |
| Suspension damping 2 | a Panda dropped 0.3 m onto its wheels: still (under 1 cm/s) after | 1.7 s | 0.8 s |
| Stability assist 1 | a Panda tapped to full lock for 0.5 s at 160 km/h, off the throttle | spins round | holds its line |
| Self-righting on | a Panda left on its roof | stays there | on its wheels after 1.1 s |

### Horn and siren

H sounds the car's horn while held, from the driver's seat only: on foot, or in a destroyed car
([Damage](#damage)), it does nothing. In the Carabinieri Giulia each press of H turns the two-tone
siren on or off instead; the siren stops when the player gets out or the car is destroyed. Neither
has a gameplay effect: nobody gets out of the way. The `horn` binding is read only by the audio
host ([audio.md](audio.md)).

## Damage

Crashes wear vehicles out, every vehicle alike: the player's, parked and traffic. `CrashDamage`
(`systems/damage.ts`, the rules in `src/sim/damage.ts`) keeps each vehicle's `Damage`: the share of
its durability its crashes have used up, from 0 (as new) to 1 (destroyed). Nothing repairs it.

- **What a crash costs.** Each `Impact` is a hit at the struck vehicle's barrier-equivalent speed:
  the speed into a wall that would shake it as hard. A wall counts at the impact's speed; two
  vehicles split their closing speed by mass, each taking the other's share, so a Panda driven
  into the laden truck takes 96% of it and the truck 4%. A landing on the wheels (`under`) counts
  less the 2 m/s the bump stops take, and a side or the roof striking the ground counts at least
  half the body's speed over it, so a car rolling over at speed takes a beating at each turn.
  Knocking a person down costs nothing, but a person pinned against a wall does not cushion the
  car: it is a wall hit as hard as the car was going into it. A hit up to 3 m/s (`SCUFF`) only
  scuffs. Past that a crash at `v` costs ((v − 3) / (d − 3))^1.5, where the durability `d` is the
  barrier speed of the one crash that destroys the model outright (`DURABILITY`): growing faster
  than the speed but slower than the crash's energy, so one ordinary fast crash rarely skips a
  stage. A crash makes more than one contact with what it strikes (the body still pressing into
  the wall the next step, a rebound), so hits within 0.2 s of the crash's first on the same
  vehicle, or on any wall or the ground (an `Impact` does not say which wall), cost only what a
  harder one adds: a crash costs what its hardest hit does.
- **Stages.** What the player sees and hears, by damage (`STAGE_FROM`): under 0.4 no smoke shows and
  the engine loses no drive, though it already sounds duller, and rough from 0.2
  ([audio.md](audio.md#engines)); from 0.4 (medium) the engine smokes white, from 0.7 (severe)
  black, and at 1 (destroyed) it burns under black smoke
  ([architecture.md](architecture.md#rendering), [audio.md](audio.md)).
- **The engine.** From the medium stage the engine gives less torque, falling in a straight line
  to 60% just short of destroyed, and from the severe stage it misfires: a share of 0.25 s
  windows, none at 0.7 and 20% at the brink, gives no drive at all, so the car coughs and lurches
  under the pedal. The drivetrain reports both (`engineRevs`), so the engine heard misfires when
  the one that drives does. The misfires are drawn per vehicle and window from its entity id, so
  a replay misfires alike.
- **Destroyed.** The engine is dead, and with it the horn and the siren: no drive and no engine
  braking, though the steering and the brakes still work and the wreck rolls. It burns until it
  blows up ([Explosions](#explosions)), and the handling's self-righting leaves it where it lies.
  Nobody can get in (`vehicleInReach`, so the HUD offers nothing); a player inside can still get
  out. A traffic car is abandoned the step it is destroyed: its driver gets out at the first free
  door and flees for 4 s, as from a carjacking, and it stops being traffic, its handbrake on.
  `Populate` removes a wreck once it is out of view (farther than `VIEW_REACH`, 90 m), whoever it
  belonged to, so wrecks never pile up.

A vehicle rolled square on into a house wall on Via Cesare Battisti, its damage after the one
crash (the handling does not change what a crash costs):

| Model | Durability | 30 km/h | 50 | 70 | 90 | 110 | 130 | 150 |
|---|---|---|---|---|---|---|---|---|
| `ape` | 26 m/s (94 km/h) | 0.11 | 0.32 | 0.60 medium | 0.93 severe | destroyed | | |
| `panda` | 40 m/s (144 km/h) | 0.05 | 0.16 | 0.30 | 0.46 medium | 0.64 medium | 0.84 severe | destroyed |
| `carabinieri` | 46 m/s (166 km/h) | 0.04 | 0.13 | 0.24 | 0.37 | 0.51 medium | 0.67 medium | 0.85 severe |
| `truck` | 60 m/s (216 km/h) | 0.03 | 0.08 | 0.15 | 0.24 | 0.34 | 0.45 medium | 0.56 medium |

So a Panda turns white after three crashes into a wall at 50 km/h, black after five and burns
after seven; at 90 km/h it takes one, two and three.

How a worn engine drives, floored from rest on flat test ground (`drive`, the Simulation preset,
misfire seed 7): the time to 100 km/h (30 km/h for the Ape, 50 km/h for the truck), the speed
after 180 s, and the steepest grade it still climbs from rest. The 0.85 and 0.99 columns depend on
when the misfires fall, drawn from the vehicle's id: over seeds 1, 3, 7, 42 and 100 the times move
by 1–4 s, except the Ape at 0.85, which reaches 30 km/h in 61–107 s:

| Model | As new (and up to 0.4) | 0.55 | 0.7 | 0.85 | 0.99 |
|---|---|---|---|---|---|
| `panda` | 12.7 s, 164 km/h, 36% | 14.2 s, 159 km/h, 32% | 16.3 s, 152 km/h, 28% | 22.0 s, 137 km/h, 21% | 30.7 s, 125 km/h, 16% |
| `carabinieri` | 6.5 s, 243 km/h, 60% | 7.0 s, 233 km/h, 60% | 7.6 s, 222 km/h, 60% | 9.0 s, 204 km/h, 55% | 11.6 s, 184 km/h, 42% |
| `ape` | 17.0 s, 41 km/h, 18% | 20.3 s, 40 km/h, 16% | 25.9 s, 38 km/h, 14% | 106.9 s, 31 km/h, 10% | never, 24 km/h, 8% |
| `truck` | 15.1 s, 90 km/h, 16% | 16.5 s, 90 km/h, 15% | 18.3 s, 90 km/h, 16% | 24.3 s, 90 km/h, 15% | 31.6 s, 84 km/h, 16% |

The Giulia's climb is held by its grip on the steepest grades (60% is as far as was tried), and the
laden truck's by its tyres at about 15% whatever the damage. Traffic hardly wears itself out: with
the player standing 3 minutes at the start while traffic fills the roads (seed 1), 6 of the 220
vehicles on the map in that time (210 at once) took any damage, at most 0.17.

### Explosions

`Explode` (`systems/explosions.ts`) blows burning wrecks up:

- **The fuse.** The step after a vehicle is destroyed its fuse is lit: 5–10 s (`FUSE`), drawn from
  the world's `Rng`, so a replay blows up alike. When it burns down the wreck explodes (an
  `Explosion` event, which the render draws and the audio plays) and is left a charred shell
  (`Damage.exploded`): it leaps 4 m/s and tumbles at up to 1.5 rad/s, then lies smoking.
- **Vehicles.** Every other vehicle whose body is within 10 m of the wreck's (their half lengths
  apart) takes a hit like a crash at up to 45 m/s barrier-equivalent, less in a straight line with
  the gap, and a shove of up to 12,000 N·s away from it and a third as much again upward (`BLAST`).
  A Panda parked bumper to bumper (0.8 m) is destroyed and blows up in turn 5–10 s later, one 6.3 m
  off takes 0.22, and the laden truck 2.35 m behind 0.41; the shove sends a Panda off at up to 12
  m/s and the truck at under 0.5.
- **People.** On foot within 5 m of the wreck's body they die (`Dead`), within 12 m of it they are
  knocked down for 2.5 s, and both are thrown away from its centre at up to 9 m/s; walkers within
  30 m of its centre run off for 4 s. The reach is from the body (`offBody`: the hull its collision
  circles sweep), not the centre, so standing 1.3 m off a truck's tail, 5.1 m from its centre, is
  as deadly as standing beside a Panda. The player sitting in the wreck dies with it, thrown out at
  a door. Anyone sitting in another vehicle is shielded by it. The dead lie where they fall and
  never get up; traffic does not wait for them (a car nudges a body aside) and `Populate` removes a
  body once it is out of view (beyond 90 m). Nothing scores.
- **Dying and coming back.** Killed, the player lies still for 4 s (`WASTED`) under the HUD's "Sei
  morto", unable to act, then `Respawn` brings them back on foot at the start, where a new game
  begins (in front of the Carabinieri station). The score, the world and its wrecks stay as they
  are.

## Traffic AI

`TrafficAI` (`systems/traffic.ts`) drives the cars tagged `Traffic` on `graph.trafficEdges`, using
the lane helpers in `src/sim/route.ts`.

- **Keep right.** The lane offset is w/4 + 0.2 m on roads at least 5 m wide, otherwise 0.5 m. It
  shrinks in 0.25 m steps where houses crowd the road, until the body clears the walls. Each model
  has its own lane table. A model only uses edges where it fits, and where the drive walls across
  the road leave room for it and an oncoming Panda plus 0.3 m (`PASS_MARGIN`): in single-file
  lanes between houses two cars met head-on with no room to back out or turn round. It only uses
  the largest connected part of those edges, so villages reached only by such lanes (Terma, Monte
  dei Bianchi, Vezzanello) get no AI traffic; the player can still drive there. Trucks keep to
  tertiary and unclassified roads and to the loops of that network, because they cannot turn round.
- **Steering.** The car aims at a point 6 m + 0.6 s × speed ahead along this edge and the next.
- **Route choice.** At each node the car picks a random legal edge. Oneways are driven a → b only.
  It avoids dead-end spurs, then hairpins, while another way exists, and makes a U-turn only at a
  dead end.
- **Speed.** Cruising speed by class: tertiary 12 m/s, unclassified 9, residential 7, service 5.
  The car slows before sharp corners (down to 3 m/s) and when pointing away from its target, and
  never goes faster than the curve it steers allows in comfort: a sideways acceleration under
  3.5 m/s², or under 0.45 of what tips its vehicle over (the Ape ≈ 2.4 m/s², the laden truck
  ≈ 2.8). The physics decides how fast it actually goes: an Ape climbs the steep village streets
  at walking pace.
- **Leaning.** A car rolled sideways more than half the angle that tips it (the Ape ≈ 14°, the
  laden truck ≈ 16°, a Panda ≈ 26°, the Giulia ≈ 29°), a wheel up a bank or down the edge of a
  stream, stops rather than tip over: it brakes while moving, then holds the handbrake with the
  wheel straight once under 0.5 m/s. Stuck there, it backs up like for anything else.
- **Braking.** Anything whose body reaches into a cone ahead, vehicle or living person, slows the
  car to keep a 2 m gap. The cone is 8 m + 1.2 s × speed long, bends along the arc the front
  wheels steer (a straight line under a curvature of 0.001 per m), and is as wide as the car plus
  0.15 m to either side (`CONE_CLEARANCE`); an obstacle counts by its footprint (half its length
  and width turned to the car's heading), so a car standing across the road holds it back as well
  as one ahead. For a Panda following a Panda in line that is 1.8 m to either side of its axis.
  Standing still, it holds the handbrake.
- **Unsticking.** A car stuck below 1 m/s for 3 s reverses for 1.5 s at 3 m/s. If it is lined up
  with its lane, it may turn round: half the time when the way back is not a dead end, always
  from its second try, never on a oneway, and never on a bridge or in a tunnel, nor on an edge
  touching one (`roomToTurn`: a circle there leaves the deck). A truck never turns round: it
  only backs up. Waiting for a person in the way (ahead of the bumper, on the carriageway or the
  verge pedestrians walk) counts four times slower: the car holds about 12 s for them to move
  on, then backs up and turns round like for anything else. A person beside the car or off the
  road counts like any other obstacle. Backing up, the car slows as its tail nears anything behind
  it, as when following, and stops 0.5 m short (`BACK_GAP`; about 1 m in practice, as it stops once
  the gap allows less than 0.5 m/s), holding the handbrake, so it does not reverse into the car
  queued behind it; with anything within 0.6 m alongside (`ALONGSIDE`) it keeps the wheel straight,
  so its swinging nose does not sweep into it.
- **Honking.** Half-way to backing up (`HONK_STEPS`: 1.5 s stuck, about 6 s when waiting for a
  person) the driver honks once, a `Honk` event the audio host plays. It honks again only in a new
  stuck episode: after backing up, or after getting going above 2.5 m/s.
- **Lost.** A car more than 12 m from its edge joins the nearest usable road.
- **Wrecked.** A damaged car drives on, as slowly as its worn engine goes; a destroyed one is
  abandoned, its driver fleeing ([Damage](#damage)). Other traffic treats the wreck like a parked
  car in its lane until it is removed out of view.
- **Wet and snowy roads.** The driver reads the share of its dry grip the road under the car
  leaves (`weatherFactor`: 1 dry, 0.72 fully wet and 0.27 on packed snow at a weather grip loss of
  1, [Knobs](#knobs)). It cruises and corners slower by its square root, as the speed a curve
  allows goes with the grip, takes curves at that share of its comfort, looks further ahead for
  braking (the cone's length ÷ the share), and follows and backs up more gently (both limits × the
  share). On a fully wet road at a weather grip loss of 1 its top speed is 0.85 of the dry one.
- **Tests.** `src/sim/__tests__/walls.test.ts` stages each rule on Via Cesare Battisti, and each
  test fails with its rule removed: a car standing across the lane (the footprint cone), a car
  queued 4.5 m behind one that backs up (the backing limit), a car alongside one backing up askew
  (the straight wheel), a driver steering back into its lane beside a standing car (the bent cone),
  and the same road wet (slower, easing off sooner, stopping and backing further from the cars
  around it).
- **How it flows.** With the player standing 3 real minutes while traffic fills the roads, on a
  new game (22 October 2026 from 08:00, Balanced handling) with the weather held clear, the share
  of the traffic's time under 1 m/s and the honks were 0.18 and 82 in Monzone's street, 0.13 and
  61 at Equi Terme, and 0.17–0.28 and 71–119 at four spots 15 m apart in Gragnola's walled centre;
  the mean speed was 18–22 km/h. Cars wait rather than shove through each other: the six runs gave
  4 car-to-car hits of 1.5 m/s or more, the speed the audio plays a crash from. Traffic is
  chaotic, and a run is one sample: a few junctions and narrow streets still deadlock head-on until
  the drivers back up and retry. In settled rain the same runs gave 0.12, 0.08 and 0.13–0.34 at
  13.9–22.2 km/h; on full snow cover, the clock stopped, 0.10, 0.08 and 0.17–0.39 at
  11.1–17.9 km/h. Now and then a car overturns, nearly always slowly on a steep bank: in the six
  clear runs a Panda at 0.3 m/s at (1677, 704) near Equi Terme, the bank where Pandas overturn in
  every weather, and an Ape at 1.5 m/s at (1790, 805).

## Pedestrians

`Pedestrians` (`systems/pedestrians.ts`) moves people along `graph.walkEdges`:

- They keep to the verge of roads (w/2 + 0.8 m, on a random side) and to the middle of paths,
  steps and tracks. They walk at 1.3 m/s and turn at random at nodes, turning back only at dead
  ends.
- A vehicle faster than 10 m/s passing within 5 m scares a walker. The walker then runs at
  4.5 m/s along its route, away from the car, for 4 s.
- When blocked (making less than half the wanted progress along the lane), they try the other
  verge after 0.5 s, then turn back, alternating. Stepping across to the other verge is progress;
  sliding sideways along a wall that blocks the way is not.
- Knocked down, they slide to a stop.
- Rain, snow and the night do not change how they walk.

## Knockdowns and score

`Contacts` (`systems/contacts.ts`) resolves touching bodies after physics. Nothing is ever shoved
through a wall.

- **Car and car**: they separate by mass share and exchange an impulse (restitution 0.2).
- **Car and standing person**: a car moving into them faster than 3 m/s (`KNOCK_SPEED`) knocks
  them down for 2.5 s. They are thrown with 0.6 of the car's velocity plus 3 m/s away from it.
  Slower, the car pushes them aside. A person pinned against a wall stops the car instead (a wall
  hit for the car, [Damage](#damage)). The car's own speed decides, so running into a parked car
  never floors the runner.
- **Person and person**: they step apart.

The player can be knocked down too, and cannot act until they get up; an explosion can kill them
([Explosions](#explosions)). `Recover` lifts people when their time is over. A pedestrian then runs
from the nearest vehicle for 4 s.

`Score` has two counters, shown on the HUD:

- **Auto rubate** (cars stolen): +1 on the first entry of a vehicle.
- **Persone investite** (people hit): +1 for each knockdown by the car the player is driving.

## Population

`Populate` (`systems/populate.ts`) runs every 0.5 s around the player. It spawns out of view,
farther than `VIEW_REACH` (90 m, the farthest ground the camera shows).

| | Traffic | Pedestrians |
|---|---|---|
| At most | 10 | 22 |
| Spawn distance | 110–220 m (edge midpoint) | 90–120 m |
| Spawns per run | 2 | 3 |
| Despawn beyond | 320 m | 140 m |
| Also despawned, once beyond 90 m | more than 12 m off its road, or 4 unstick tries | blocked for more than 5 s |

- Pedestrians only spawn on walk edges with a building within 50 m of the edge's midpoint
  (`PEOPLED`): the villages and hamlets, not the woods and fields between them. They never spawn
  inside a building, where a verge runs into houses that crowd the road.
- New traffic is 75% Pandas, 15% Apes and 10% trucks, falling back to a smaller model where one
  does not fit. It spawns at least 15 m from any vehicle and clear of walls, heads out of dead-end
  spurs, and starts at 0.6 × cruising speed.
- The player's car is never despawned. Parked, stolen and carjacked cars are not traffic, so they
  stay where they are left. A destroyed vehicle, traffic or not, and a dead body go once they are
  beyond 90 m (`VIEW_REACH`), out of view; the dead do not count toward the 22 pedestrians.

## Tuning

| Where | What |
|---|---|
| `src/sim/tuning.ts` | `ENTER_GAP`, `PERSON_RADIUS`, `WALK_SPEED`, `SPRINT_SPEED`, `KNOCK_SPEED` |
| `src/sim/handling.ts` | `HANDLING`: each handling knob's group, name, description, kind, range and step; `REAL_HANDLING`; `HANDLING_PRESETS`, the three presets; `DEFAULT_HANDLING` (a new game's: Balanced) |
| `src/sim/vehicles.ts` | `VEHICLES`: each model's body, mass, wheels, tyres, brakes, engine, gearbox, drag and suspension; `CAR_COLORS` |
| `src/sim/systems/explosions.ts` | `FUSE` (how long a wreck burns before it blows), `BLAST` (who dies, falls, flees, how hard vehicles are hit and shoved), `WASTED` (how long the dead player lies) |
| `src/sim/damage.ts` | `DURABILITY` per model, `SCUFF`, the stages (`STAGE_FROM`), how ground hits count (bump stops, tumbling), how long one crash lasts, the torque a worn engine keeps and how often it misfires |
| `src/sim/tyres.ts` | `GRIP` per surface, wet (`WET`) and packed snow (`SNOW`), the slip curve, ABS and traction-control shares, load sensitivity, the static-friction speed |
| `src/sim/dynamics.ts` | substeps, bump-stop travel, damper limit, the body's ground contacts, in-air tumbling damping, the ground-hit speed |
| `src/sim/drivetrain.ts` | shift points, engine braking, driveline efficiency |
| `src/sim/view.ts` | `screenAxes` (screen axes of the home view), `LOOK_AHEAD`, `VIEW_REACH` |
| `src/sim/route.ts` | lane offsets, passing room (`PASS_MARGIN`), pedestrian verge, `cruiseSpeed`, truck road classes, hairpin limit |
| `src/sim/systems/populate.ts` | `TRAFFIC`, `PEDESTRIANS` population limits, `PEOPLED` (where pedestrians spawn), spawn model mix |
| `src/sim/systems/spawn.ts` | parked cars (`PARKED`), trucks (`TRUCKS`) |
| `src/sim/systems/*.ts` | each system's own constants at the top of its file (physics: steering rates and the speed-sensitive lock; traffic: comfort, leaning, turning room, the cone's `CONE_CLEARANCE`, backing's `BACK_GAP` and `ALONGSIDE`; pedestrians, contacts, foot, enter/exit) |
| `src/sim/sky/` | the clock, the map's place, the climate, the odds, the day plan, the regimes and the ground's weather (see [weather.md](weather.md#tuning)) |
| `src/sim/map/kinds.ts` | road widths and which classes carry traffic, the player's car, or only people |
| `src/render/pipeline.ts` | `zoomFor` zoom levels, `turnToward` view turn speed |
| `src/audio/director/levels.ts` | how loud each sound is and how far it carries (see [audio.md](audio.md#known-limits-and-tuning)) |

Gameplay changes need a test: the scenario tests in `src/sim/__tests__/index.test.ts`,
`src/sim/__tests__/walls.test.ts`, `src/sim/__tests__/damage.test.ts` and
`src/sim/__tests__/explosions.test.ts` stage exact situations with `src/sim/testing.ts`,
`src/sim/__tests__/physics.test.ts` drives each model on flat, sloping and ramped test ground with
`advance` (no walls), and `src/sim/__tests__/handling.test.ts` proves each handling knob's effect
the same way, the weather grip loss's on wet and snowy ground included. Fixtures find map features
by geometry, never by index (`BATTISTI` is the Via Cesare Battisti traffic edge nearest
(-412, 438), eastbound), so they survive map rebuilds. Re-run `pnpm check` after any change.
