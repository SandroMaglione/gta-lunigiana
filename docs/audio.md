# Audio

Every sound in the game is synthesised at run time with Web Audio; there are no sample files.
Vehicles, people, the wind, crickets, birds, dogs, church bells and running water all make sound,
and each one reaches the player's ears through a model of outdoor acoustics. A sound gets quieter
and duller with distance, is muffled by houses, hills and woods, shifts in pitch when it moves,
arrives late from far away, and fades out under the background noise. That last step is what lets
the player hear only what is near.

Audio is host code beside render and the HUD (`src/audio`). The simulation never imports it; the
audio reads three of its events (`Impact`, `Skid`, `Honk`) and its components. No sound has a
gameplay effect.

## Data flow

```
VehiclePhysics, Contacts ──Impact──┐
VehiclePhysics ─────────────Skid───┤
TrafficAI ──────────────────Honk───┤
components, Time, Input (horn) ────┴─► audio schedule (Lunigiana/Hear) ──Heard──► director
                                                                                     │
                                       hold / play / flush, each with a Placement    │
                                                                                     ▼
          speakers ◄── mixer (reverb, limiter) ◄── emitters ◄── synths ◄── Speaker (Web Audio)
```

1. **Simulation events** (`src/sim/schema.ts`). Three events carry moments that leave no trace in
   the world's state:
   - `Impact` (`hit`, `x`, `y`, `speed`, `mass`, `car`, `other?`, `face?`): a vehicle hit something
     this step, with the mass behind it in tonnes (the vehicle's, or the reduced mass of two).
     `VehiclePhysics` emits `ground` when a car lands hard or its body strikes the ground rolling
     over, naming the `face` that struck: `under` (the suspension bottoming out over a hump or on a
     landing: routinely 1.5–4 m/s on rough roads, a few steps a landing), `roof`, `side`, `front` or
     `rear`. It emits `wall` for every drive-wall hit that costs over 0.05 m/s, with the
     car's velocity into the wall at contact (a car wedged so that no move fits emits its whole
     speed). The speed lost in the step would be less by what the step travelled before contact,
     the rest lost the next step, so one hit would read as two softer ones: a 15 m/s hit as 7 and
     4 m/s. The contact point is where the car's collision capsule (circles of radius W/2 along
     ±(L/2 − W/2)) reaches furthest in the direction of the lost velocity u (the velocity, when
     wedged): the end circle that leads, W/2 along u from its centre. So an oblique hit lands on the
     front corner, on the wall itself, and a square-on side hit in the middle of the side.
     `Contacts` emits `car` when two vehicles close on each other: the closing speed, the reduced
     mass 1/(1/m₁ + 1/m₂), at the contact point (`car` and `other` follow query order, not who
     struck whom). It emits `person` for each knockdown: the car's speed before a pin stops it, the
     car's mass, at the person.
   - `Skid` (`car`, `wheel`, `x`, `y`, `z`, `slip`, `amount`, `surface`, `step`): a tyre slid this
     step, sideways past its grip, spinning or locked: `slip` its sliding speed in m/s, `amount`
     0…1 how far past its grip (0.25 an ABS stop at the limit, 1 sliding, locked or spinning), on
     `surface`. The render lays tyre marks from it too.
   - `Honk` (`car`, `model`, `x`, `y`): `TrafficAI` emits it once per stuck episode, when a driver
     has been held up for `HONK_STEPS` (1.5 s; see [gameplay.md](gameplay.md#traffic-ai)).
   - The `horn` binding (H) is read only by the audio schedule.

   Events are not saved: snapshots hold components and resources only. Emitting them changes
   neither determinism nor saves (both tests run with the events emitted).
2. **The audio schedule** (`src/audio/index.ts`): one system, `Lunigiana/Hear`, ticked once per
   animation frame. It reads the world and builds one `Heard` (`src/audio/types.ts`):
   - `listener`: the player's pose and velocity, the vehicle they sit in, and the view's quarter
     turns (the `View` resource), which the stereo image turns with;
   - `vehicles`: every vehicle that runs (AI traffic, or the player's car) or moves (faster than
     0.01 m/s, spinning, or its body rising, falling, pitching or rolling faster than 0.01 m/s or
     rad/s, so a car rolling over on the spot is heard). Parked cars nobody touches are left out.
     Each carries the elevation of its centre of mass (`Chassis.z`), the engine's revs and load as
     the sim's drivetrain turns them (`engineRevs` from the `Chassis` gear and shift, the forward
     speed, the `CarInput` throttle and the `Time` step: what is heard is what pushes the car),
     whether its wheels are down (not overturned, as `chassis.ts` has it, and its centre of mass
     less than 0.3 m above where it sits at rest over the ground under it), whether its body is
     down (`hullDown`: a corner of its box at or under the ground, as the physics's hull contacts
     take it: on its roof, side or belly, never on the bump stops alone), and its skid: of the
     `Skid` events since the last frame, the most any wheel went past its grip, the fastest any
     slid, and the surface under the one furthest past;
   - `people`: everyone on foot (pedestrians, and the player when not driving), with their
     fleeing and knocked-down flags;
   - `happenings`: the `Impact` and `Honk` events since its last run, impacts first. Each impact
     carries the `body` of the vehicle `car` (and `otherBody` of `other`, for a `car` hit): its
     model, and the zone of its L × W box the contact point lies on, by the face it is nearest in
     proportion (front when along/L exceeds |across|/W, rear when −along/L does, else the side: a
     Panda's wall hit is front to about 54° off square, a T-bone on its front door a side). A
     ground hit's zone is its face's: `under` under, the roof and a side the side (no bumper and
     no airbag, the glass goes), the nose the front, the tail the rear. They come from every
     vehicle, parked ones too (a struck parked car is not in `vehicles`); an impact whose vehicle
     has despawned since is dropped;
   - `horn`: whether the horn key is held.

   It hands that to the `Audio` service and writes nothing (`src/render/__tests__/index.test.ts` checks it).
   It does no acoustics. Once a system has run, it receives every event of the update steps
   between two frames; `main.ts` ticks the schedule once right after `setup`, so the first steps'
   events are not lost.
3. **The director** (`src/audio/director`) is the `Audio` service: plain TypeScript, tested in
   Node. Each frame (`index.ts`) it:
   - places the ears 1.6 m above the ground under the listener (a bridge deck, not the river under
     it), or in a car 1.6 m above the level it stands on (`Chassis.z` − `cg`, so they fly with it),
     and notes the cabin around them;
   - asks the world part for the masking floor and how enclosed the street is (`world.ts`), and
     every 1 s or 10 m looks up the rock faces that echo;
   - lets its vehicle (`vehicles.ts`), people (`people.ts`) and world (`world.ts`) parts place
     their sounds through the acoustic chain (`hearing.ts`);
   - plays one-shots at once (with their echoes; a crash's direct sound at most 8 dB over gain 1,
     `CRASH_MOST_DB`), and keeps the loudest offered continuous voices of each kind up to its cap
     (`frame.ts`);
   - re-measures a few stale obstacle paths (`occluder.ts`) and flushes the speaker.

   Time is the speaker's clock. Before the AudioContext exists it reads 0: the director still
   tracks who sits where, but measures and plays nothing. A frame longer than 0.25 s counts as a
   stall, not as time passing.
4. **The speaker** (`src/audio/speaker.ts`) plays the requests with Web Audio. `hold(key, sound,
   at)` keeps one live voice per key, built from the `Voices` table on the first frame it is held
   and updated every frame after; at `flush` every voice not held since the last flush fades out
   and is freed. `play(sound, at, delay)` schedules a one-shot from the `Shots` table. At most 32
   one-shots play (or wait to) at once: a new one replaces the quietest if it is louder, else it is
   dropped. A synth that throws is logged once and that kind is muted for the session; the game
   loop never sees the error.
5. **Emitters and the mixer.** Each voice or one-shot plays through its own emitter
   (`emitter.ts`): a lowpass (Butterworth, at the placement's cutoff), the placement gain, a
   stereo pan, and a send to the shared reverb. A started `ConstantSourceNode` carries the Doppler
   shift in cents into the synth's detunes. Gain, pan, send and pitch glide with a 50 ms time
   constant, the cutoff with 100 ms. The mixer (`mixer.ts`) sums the dry signals and the reverb
   return into a master gain (0.8), then a limiter (threshold −6 dBFS, knee 6 dB, ratio 12, attack
   1 ms, release 250 ms, its built-in makeup gain of 2.14 dB trimmed off), an analyser for the
   level meter, and the output. The 1 ms attack holds the near sounds that still go past gain 1 (the
   own horn and siren, a clunk, a door): before their cap, crashes got through a 3 ms attack to
   +0.1…+2.4 dBFS (see [Calibration and mix](#calibration-and-mix)).

## Where state lives

- **Nothing is saved.** The events are transient, and the audio host never writes the world.
- **The director's memory**, all of it per entity and pruned:
  - vehicles: the listener's car and the running vehicles of the last frame (to hear getting in,
    getting out and the starter), the horn key's last state (the siren toggles on a press),
    engines still cranking, sirens on, each car's last crash or clunk (to merge one hit's steps),
    the cars scraping, with what they scrape along (and a new wall met but not yet switched to),
    and each car's last skid, held 0.05 s (a frame with no sim step in it, as on a 120 Hz
    display, reports none, and the squeal would flutter). Each
    entry ends when its time is over or its vehicle stops running. Each crashed vehicle's wear,
    the hardest crush each of its zones took, is kept for the 256 most recently crashed;
  - people: per person on foot, the last position, the step phase, the mood and the last voice
    cue. A person not heard in a frame (despawned, or the player now in a car) is dropped;
  - the valley: the water and dogs near the ears (looked up again every 0.25 s or 2 m), the eased
    street, the loudest water heard last frame, the last bell ring and its strokes to come;
  - the occluder: the obstacles of each source's path, forgotten 2 s after nobody asks for them;
  - the echoes around the ears, looked up again every 1 s or 10 m.
- **The speaker:** the live voices by key, the one-shots playing, and the kinds muted after a
  failure.
- **Static data** never changes once built. The bells are found at load; the ambience grid, the
  water reaches and the dogs in the first `hear`, during the audio tick after `setup` (≈ 155 ms in
  Node, ≈ 100 of it the cover raster, which the browser has already built for the renderer); the
  road-surface index on the first footstep or tyre, unless the physics built it first. The
  land-cover raster and `surfaceAt` are the sim's (`src/sim/map/cover.ts` and `surface.ts`), built
  once and shared with the tyres' grip and the renderer.
- **Randomness** in the director (birds, dogs) and the synths (variants, jitter) is `Math.random`:
  `?seed=N` replays the world, not the birds. The crash renderer takes its random source as a
  parameter (the game passes `Math.random`), so its tests seed it and every render is reproducible.

## How sound travels

`hearing.ts` runs one chain per source, every loss in dB relative to the source's level at 1 m,
summed and converted once:

- level at the ears = level at 1 m − spreading − ground − foliage − diffraction − cabin;
- gain = `mixGain(level at 1 m, losses)` × `audibility(level at the ears, floor)` (the beds and
  water, whose level is known at the ears, are compressed at that level: see
  [Calibration and mix](#calibration-and-mix));
- lowpass = the lowest of the air, diffraction and cabin cutoffs;
- pitch = the Doppler shift (vehicle voices only);
- reverb send = from the street around the ears and the distance; none in the open.

Distances are three-dimensional. The ears are 1.6 m above the ground; sources stand at their own
height above theirs: a vehicle's voices at its centre of mass (`Chassis.z`: at rest the Panda's
0.56 m up, the truck's 1.7 m, and in the air wherever it flies), a vehicle's one-shots 0.8 m over
the contact point, a person 1 m, water 2 m (lifted out of its carved bed), a bell at its tower's
top, a bird 6–12 m up a tree, a dog 0.5 m.

Each class of sound behaves differently:

| Class | Source | Doppler | Waits its travel time | Echoes | Occluded |
|---|---|---|---|---|---|
| Vehicle voices: engine, tyres, horn, siren, beeper, scrape | point | yes | no (continuous) | no | yes, except the player's own car |
| Vehicle one-shots: crash, clunk, thud, door, ignition, honk | point | no | past 40 m | crashes from 6 m/s, honks | yes, except the player's own crashes, clunks, doors and starter |
| People: steps, scream, shout, groan | point | no | past 40 m | screams, shouts | yes, except the player's own steps |
| Water | line (rivers, streams), point (fountains, the Cascata di Equi) | no | no (continuous) | no | yes |
| Birds, dogs, bells | point | no | past 40 m | barks, bells | yes |
| Wind, crickets | a bed at the ears, centred | no | no | no | no (through the cabin only) |

### Point and line sources

- **Point sources** lose 20·log10(r) dB: 6 dB per doubling of distance. Inside `rMin`, the
  source's size, they get no louder (the calibration table gives it per kind).
- **Rivers and streams are line sources** (`lineLevel` in `acoustics.ts`): each water piece is a
  polyline of incoherent segments, and the level at the ears is the exact sum
  Lp = 10·log10 Σ 10^(Lw′/10)·θ/(4π·d), with d the distance to each segment's line (at least 1 m)
  and θ the angle it subtends. Close to a long reach that falls 3 dB per doubling; far away, 6.
  Pieces of one named river are one body, heard from its nearest point.
- **Water loudness** (`places/water.ts`): each reach's sound power Lw′ comes from the water's
  width (a stand-in for discharge) and its grade smoothed over ±40 m (rapids against calm
  reaches), calibrated at 2 m from the bank: the Torrente Lucido ≈ 70 dB(A) in rapids and ≈ 62 on
  calm reaches, the 8 m torrents ≈ 64, the 4 m named streams ≈ 55, the unnamed 2 m gullies ≈ 40.
  Drinking fountains, taps and the Fontana di Aiola lavoir are point sources of 65 dB(A) at 1 m,
  and the Cascata di Equi (hard-coded at (1835, 530): only the raw OSM has it) one of 80. Bodies
  within 400 m are looked up; those under 20 dB(A) at the ears, even in the clear, are left out.

### Air absorption

Air absorbs high frequencies first, so distance is a lowpass, not a level loss. The cutoff is where
absorption reaches 3 dB (ISO 9613-1, 15 °C, 70 % relative humidity), log-log between the rows:

| Distance | 6 m | 10 m | 25 m | 50 m | 100 m | 200 m | 500 m | 1 km | 2 km |
|---|---|---|---|---|---|---|---|---|---|
| Cutoff | 20 kHz | 15.1 kHz | 9.1 kHz | 6.3 kHz | 4.3 kHz | 2.9 kHz | 1.5 kHz | 680 Hz | 315 Hz |

### Ground and foliage

- **Ground effect** over soft ground (ISO 9613-2 §7.3.2): max(0, 4.8 − (2h/r)(17 + 300/r)) dB,
  h the mean height of the path above the terrain at both ends. Up to 4.8 dB at a distance.
- **Foliage** (ISO 9613-2 Annex A, at 1 kHz): the metres of forest on the straight path (sampled
  every 8 m on the cover raster) cost nothing under 10 m, 1 dB for 10–20 m, then 0.06 dB per
  metre, at most 12 dB.

### Buildings and terrain

`occlusion.ts` finds the worst edge between source and ears: building walls up to their eaves
(`z0 + h`; the outline's exact crossings, found through the shared building grid) and the terrain
sampled every 7 m (3 m in from each end). The edge with the largest Maekawa path difference
δ = |ST| + |TR| − |SR| wins; `diffraction` turns it into a loss and a lowpass (the 250 Hz Maekawa
value, and a cutoff matching the tilt):

| δ | 0 | 0.05 m | 0.1 m | 0.25 m | 0.5 m | 1 m and more |
|---|---|---|---|---|---|---|
| Loss | 0 | 6.5 dB | 7.7 dB | 10.1 dB | 12.5 dB | 15 dB |
| Cutoff | 20 kHz | 1.8 kHz | 1.5 kHz | 1.4 kHz | 1.9 kHz | 2.8 kHz |

- A building an endpoint stands in hides nothing from it: a bell at the top of its tower rings
  out over its own walls.
- Trees, water banks and the sim's collision walls are not edges (trees count as foliage).
- Paths are cached per source (`occluder.ts`): a new source is measured at once; a known one keeps
  its value until a refresh, at most every 150 ms, at most 12 a frame (oldest first), and only if
  someone asked for it since. A source too faint to hear even in the clear is never measured.

### Doppler

Vehicle voices shift with the motion of both ends: f′/f = (c − v_L·u)/(c − v_S·u), u the unit
vector from source to listener, c = 340.4 m/s (15 °C), the ratio clamped to 0.7–1.4 and no shift
within 1 m. A car at 12 m/s coming straight at the player sounds 62 cents sharp; at 42 m/s,
+228 cents approaching and −201 receding. Water, the beds and one-shots do not shift.

### Propagation delay

One-shots farther than 40 m start r/c later: 0.29 s from 100 m, 0.88 s from 300 m. Nearer, the lag
(under about 120 ms) goes unnoticed, so they play at once (ITU-R BT.1359). Continuous voices are
never delayed.

### Inside a vehicle

From the driver's seat, outside sounds pass the body's insertion loss: 15 dB and a 1.4 kHz lowpass
in the closed cabins (Panda, truck, Giulia), 6 dB and 3.5 kHz in the Ape's cab, open at the back.
Sounds of the player's own car are heard from inside it:

- the engine has its own fixed level (68 dB(A), centred, no Doppler), and its voice switches to
  the cabin tone behind the firewall (a 2.5 kHz lowpass and +4 dB at 120 Hz);
- the horn (in the grille) and the siren (on the roof) pass the whole cabin, like any outside sound;
- its crashes, scrapes, doors, starter and the thud of a person it hits pass none, but their
  street reverb and their echoes come back from outside and pass the whole cabin;
- the tyres, the truck's beeper and the beds pass the whole cabin.

### Masking and proximity

Every sound is heard against a floor: the energy sum of the wind bed, which is never stiller than
the rural daytime background (35 dB(A), `AMBIENT_DB`), and the loudest water heard in the last
frame (occlusion included, so a river behind houses masks only as loud as it sounds). What masks
is what plays: the background is the wind bed, not a silent number. A sound at most 5 dB under the
floor plays at full gain. Below that it fades linearly in dB, and 15 dB under the floor it is
culled: a one-shot is dropped, a voice is no longer held and fades out. The margin is there because
a narrow-band sound stays detectable 5–10 dB under a broadband dB(A) floor.

The wind's strength rises with altitude, from 0.15 on the valley floor to 0.85 at 1,000 m
(a smoothstep from 150 m), up to 0.15 more on open ground, and 0.3 less in a street, but never
under 0.24 (`STILL` in `director/world.ts`), where it is the 35 dB(A) background itself: leaves and
the far valley, heard even in a sheltered street. Its level is 60 + 40·log10(strength) dB(A): 35
in Monzone's streets, about 40–43 on open ground on the valley floor, 57–60 on the ridges.

Over flat, open ground with nothing in the way, at the 35 dB(A) floor:

| Source (dB(A) at 1 m) | Full level up to | Silent beyond |
|---|---|---|
| walking step (58) | 22 m | 52 m |
| running step (62) | 30 m | 80 m |
| groan (72) | 80 m | 240 m |
| shout (88) | 460 m | 1.5 km |
| Panda engine at the redline under full load (90) | 580 m | 1.8 km |
| scream (100) | 1.8 km | 5.8 km |
| crash, horn, bell (115–118) | over 10 km | |

At a ridge's 57 dB(A) floor every radius is about ten times shorter. In the valley the obstacles
shorten them more (a house or a spur in the way takes up to 15 dB, the woods up to 12), and so do
the sim's ranges: traffic despawns beyond 320 m and pedestrians beyond 140 m. Far sounds are faint
in the mix long before they are culled.

### Voice caps

At most this many continuous voices of each kind play, the loudest at the ears first:

| `engine` | `tyres` | `scrape` | `horn` | `siren` | `beeper` | `water` | `wind` | `crickets` |
|---|---|---|---|---|---|---|---|---|
| 8 | 4 | 2 | 3 | 2 | 2 | 4 | 1 | 1 |

An engine ranks, and is masked, at its gain law's level for its revs and load (`engineQuiet`): an
idling one 11 dB under one at the redline under full load, so a car revving 100 m away keeps its
voice over idling ones 40–54 m away. A voice held in the last frame ranks 3 dB louder (`KEEP_DB`),
so two near-equal engines do not swap every frame (each swap would build a new voice). At the
hour, only the 4 loudest bell towers in
earshot ring (`TOWERS`).

### Echoes

Loud impulsive one-shots answer off rock faces (`echoesAt` in `places.ts`): crashes from 6 m/s,
honks, barks, shouts, screams and bells. The search runs along 16 directions from 40 to 400 m in
8 m steps and takes the first face the listener can see (rising above every sight line before it)
that climbs at least 50°, the slope the terrain paints as bare rock, and stands at least 10 m above
the ears. A gentler slope, grassed or wooded, mirrors sound up into the sky and scatters back too
little to hear (even a forest edge returns 16–31 dB under the direct sound), so it does not echo.
Rock is in sight from about half of the map. Up to two echoes play, the strongest first and
at least 45° apart:

- delay 2d/c after the direct sound;
- loss 20·log10(2d) + air absorption (0.0041 dB/m at 1 kHz) + 10 dB off the rock; always at least
  10 dB under the direct sound (natural cliffs return 10–20 dB under it), which is what a distant
  source's echo gets;
- times the open share around the ears, 1 − street: facades hide the faces, so a narrow street
  hears none;
- panned toward the face, low-passed at the direct sound's cutoff or the echo path's air cutoff,
  whichever is lower, with the direct sound's reverb send (none in the open);
- skipped when the masking rule would cull it.

Buildings are not echo faces: village streets get reverb, not echoes.

### Street reverb

Reverb is sound scattered back by the surfaces around the listener. Over open ground the energy
that arrives after the direct sound stays 15 dB and more under it (the ground's own reflection,
under 2 ms late, is the ground effect), so the fields and the open valley play dry. A forest's
trunks scatter more: its tail sits about 30 dB under the direct sound 10 m away, but the direct
sound falls faster than the diffuse tail, which is only 10–16 dB under it 100 m away. The woods
play dry all the same (see Known limits): only streets send to the reverb.

`streetAt` measures how enclosed the ears are: 8 directions out to 15 m, each counting the facade it
meets by its height above the listener's ground (4 m and more count fully). The mean, 0 (open) to 1
(a narrow stone street), eases with a 0.5 s time constant. The mixer has one reverb, a generated
stone street's impulse response (1.2 s long, RT60 1 s, 12 ms pre-delay: the first facade's return
across a 4 m lane), and a fully wet send returns 12 dB under the dry sound. Each source's send
(`REVERB`) is

wet = street² · 10^(8/20) · √(r / 10), with r clamped to 2.5–40 m

- **Distance.** In a narrow street the reverb returns 10 dB under the dry sound 2.5 m away, 4 dB
  under at 10 m and 2 dB over from 40 m. Along a street the reverberant field falls like a line
  source's and the direct sound like a point's, so the reverb gains 3 dB on it per doubling.
- **Gaps.** The tail leaks out of every gap in the facades, hence street²: a straight lane open at
  both ends (0.75) is 5 dB drier, a lane with gaps (0.5) 12 dB, a single wall (0.3) 21 dB, which is
  as good as dry.
- **Cabin and beds.** Inside a vehicle the send is a quarter (the cabin's own noise masks the
  tail). The tail comes back from outside, so a sound of the player's own car that skips the
  cabin sends that much less again (15 dB in the closed cabins, 6 dB in the Ape). The wind and
  cricket beds are diffuse already and send nothing.

Held voices glide their send as the street eases, so walking into a village fades the reverb in.

### Stereo

The pan is the source's direction along the screen's right axis, scaled to ±0.85 so nothing sits
in one ear only, and fading to the centre within 2 m. The axis is `screenAxes(turns).right` for the
view's quarter turns, so a car on the right of the screen is heard on the right whichever way the
camera looks; an echo pans toward its face the same way. A turn moves the pan at once: held voices
glide to it with a 50 ms time constant, about as fast as the camera eases through the turn (83 ms).
There is no front and back.

## Sound catalogue

Levels are dB(A) at 1 m at the synth's nominal peak, with the source's size `rMin` in brackets.

Continuous voices (held every frame they play):

| Kind | Made of | Plays when | Level |
|---|---|---|---|
| `engine` | `synth/engine.ts`: an oscillator at the firing frequency (a sawtooth, or a band-limited pulse for the Ape's two-stroke and the truck's diesel), a half-order sub, a waveshaper driven by the load, two exhaust formants, noise gated at the firing rate, and a turbo whine on the truck and the Giulia, all from how the engine is built ([Engines](#engines)). The revs and load are the sim's; each vehicle's `variant` (from its id) moves its pitch ±2 % and its formants ±4 % | a vehicle runs (AI traffic, or the player at the wheel), once its starter, if any, has caught | at the redline under full load: Panda 90 (2 m), Ape 92 (2 m), truck 98 (4 m), Giulia 93 (2.5 m); the player's own 68 from the seat |
| `tyres` | `synth/tyres.ts`: rolling noise rising as (v / 70 km/h)^1.5, a sett rumble at v / 0.14 m on stone, a two-tone squeal (980 and 1460 Hz) on asphalt and stone while the tyres skid, a gravel crunch on loose ground that grows with the skid; the truck's 6 dB louder and darker. The skid is the sim's: its `amount` past grip, faded in as the tyre slides from 0.5 to 2.5 m/s, so a standing burnout and a locked wheel in a straight line squeal, an ABS stop at the limit (0.25) faintly | its wheels are down and it moves faster than 1 m/s or skids (a skid holds 0.05 s). The surface is the skidding wheel's, else the road's OSM surface on a carriageway (or within 0.5 m of its edge), else the land cover's | 98 (2 m) |
| `scrape` | `synth/scrape.ts`: the wall's surface played at the car's speed, ringing the car's panels and the wall's own modes, by `material` (below) | a car hits a wall at under 1.5 m/s while still moving faster than 2 m/s, or slides faster than that with its body down on the ground (`hullDown`: a corner of its box on the ground, on its roof, side or belly; the physics reports no hit for a slide); held 0.2 s past the last such frame, along the material of the wall or of the ground under the car (below). The wheels bottoming out do not grind; a landing hard enough to put the belly on the ground (the Giulia from about 0.6 m) does | 105 (2 m) |
| `horn` | `synth/horns.ts`: Panda 420 Hz, Ape 610 Hz, truck air horn 150 + 185 Hz, Giulia 410 + 500 Hz | the player holds H at the wheel of anything but the Giulia | 116 (2 m) |
| `siren` | `synth/horns.ts`: the Italian *bitonale*, 466 and 622 Hz for 0.75 s each (D.M. 20/03/1979) | toggled by H in the Giulia the player drives; it stops when they get out | 117 (2.5 m) |
| `beeper` | `synth/horns.ts`: a 1 kHz tone, 0.5 s on and 0.5 s off | a running truck reverses (faster than 0.3 m/s backwards) | 100 (2 m) |
| `water` | `synth/water.ts`: bubbles ringing at their Minnaert frequency (van den Doel's model, `synth/bubbles.ts`), a pink-noise bed, and in rivers a boulder rumble and a slow surge. `body` is `river` (OSM rivers, and water 8 m wide or more), `stream` or `fountain`; `flow` comes from width and grade | the 4 loudest bodies within 400 m | from the water's level at the ears (above) |
| `wind` | `synth/nature.ts`: a brown-noise band breathing with gusts, a whistle on strong gusts, leaves in proportion to the forest around | always, one bed | 60 at the ears at strength 1, never under 35 |
| `crickets` | `synth/nature.ts`: six Italian tree crickets (*Oecanthus pellucens*) on a 2.6 kHz carrier, 0.59 echemes (chirps) a second (Dolbear's law at the game's fixed 15 °C October afternoon) | open ground outweighs buildings around the ears (`open − built` > 0) | 42 at the ears at density 1 |

The scrape is built from what the wall is made of. Each material has a surface: 32 m of wall
ridden at 10 m/s (3.2 s), rendered in plain TypeScript the first time that material is scraped
(4–10 ms in Chrome, once per material). It holds a pink bed (equal energy per octave, as in the reference recordings), grit (micro-impacts
with power-law heights), level dips at the joints between stones or sheet ribs, and damped knocks:
a guard rail's posts every 2 m and splices every 4 m, glazing bars, chips. The voice loops it at
v / 10 m/s like a record, so stones pass at v / 0.3 m and rail posts thump at v / 2 m. The loop
rings 8–12 of the car's panel resonances, drawn fresh for every scrape (Q 60–120, 150–3000 Hz),
and the wall's own modes:

- the guard rail: 12 bands at Q 300–500, half of them near its 176, 428 and 771 Hz bands, and a
  stick-slip squeal below about 3 m/s;
- sheet cladding: a wobbling ring;
- a tree: a short wood bank.

Masonry, stone and rock add grit and chips only; masonry is finer and brighter, stone swings
10 dB at every stone, rock is the harshest. Earth rings nothing: a dirt hiss at 0.8–3 kHz. Glass
adds a rare shard screech. The judder (the gust signal ×40) shakes the grind and opens the squeal
and the screech. The level rises 4.5 dB per doubling of speed (roughness noise, v^0.75), up to
full at 12 m/s, where every material peaks near 0.5. Doppler moves every band. A car sliding from
one wall onto another switches to the new material once it has met it for 0.25 s (a trunk passed
along a wooded bank, or contact jitter, keeps the old one) and crossfades in about 0.3 s; the voice
fades out over 0.3 s once it is no longer held.

Measured in Chrome at 12 m/s against the closest reference (a car's slide and grind after a BBC
crash: centroid 1.5–1.8 kHz, band flatness 0.33–0.51, octaves within 5 dB from 125 Hz to 2 kHz):

- the walls: centroid 1.8 kHz on stone and 2.0–2.1 on masonry, rock and sheet, band flatness
  0.36–0.45, octaves within 6 dB from 125 Hz to 2 kHz;
- the rail is the tonal one (band flatness 0.18–0.31);
- a tree is the darkest (1.5 kHz), earth sits at 2.4 kHz and glass at 3.8 kHz.

One-shots:

| Kind | Made of | Plays when | Level |
|---|---|---|---|
| `crash` | `synth/crash/`: rendered on demand from its exact params (pure TypeScript, a few ms; an echo replays the same render): each body's crunch, the parts that break and fall, what it hit: a wall's or the ground's material, or the other car's shell ([Crashes](#crashes)) | a `wall`, `car` or `ground` Impact of 1.5 m/s or more, but an underbody one under 5 m/s (a clunk). One hit spans a few steps: within 0.1 s of a car's crash or clunk only a 1.5× harder hit plays again. Its params (below): the closing speed, the mass behind it (t), both bodies and their wear, the wall's or the ground's material, the surface debris lands on | 115 (2 m) for the reference crash; the render plays its own level under or over that. Its direct sound plays at most 8 dB over gain 1 (`CRASH_MOST_DB`) |
| `clunk` | `synth/impacts.ts`: the bump stops' rubber thump (110 → 55 Hz, the truck's a third lower), the suspension's steel clunking at about 330 and 760 Hz, loose trim ticking; three variants each, light and heavy | an underbody `ground` Impact of 1.5–5 m/s: the suspension bottoming out over a hump or on a light landing, several a second on a rough road, a landing's few steps merged like a crash's | 85 (1.5 m) at 5 m/s, 20 dB under a Panda's crash at that speed, 6 dB less per halving of speed down to 14 dB under; estimated, not measured against a recording |
| `thud` | a low thump and a cloth swish, full level from 12 m/s | a `person` Impact (a knockdown) | 85 (1 m) |
| `groan` | `synth/voices.ts`, a formant voice | 0.25 s after a thud, from the person hit | 72 (1 m) |
| `door` | per model: opening (latch clicks, the seal), closing (thump, latch, panel ring) | the player gets in (open, then close 0.7 s later) or out (at their new spot) | 82 (1 m) |
| `ignition` | the starter whirring with a dip at each compression, then the engine catching: the engine voice blipped 70 % of the way from idle to the gearbox's `launch` revs at 70 % load for 0.12 s, settling back with a 0.25 s time constant | the player gets into a car whose engine was off; the engine voice takes over after `CRANK` (Panda 0.8 s, Ape 0.4 s, truck 1.5 s, Giulia 0.6 s). Carjacking a running car plays doors only | 85 (1 m) |
| `honk` | one long or two short presses of the model's horn | a `Honk` event | 116 (2 m) |
| `step` | `synth/steps.ts`: heel then ball, per surface (asphalt, stone, gravel, dirt, grass, leaves) and gait, four variants each, played ±8 % in rate and ±2 dB | everyone on foot, at 2 steps a second at a 2.2 m/s walk and 3 at a 5.5 m/s sprint, counted from the distance actually moved (none while down, none for a jump of more than 3 m in a frame); a run above 3.5 m/s. The player's steps come from under the ears | 62 (0.5 m) for a running step on stone; walking 4 dB under |
| `scream`, `shout` | `synth/voices.ts`: a sawtooth glottis on a pitch contour, breath noise, three vowel formants and a fast roughness; each person keeps one voice (sex and pitch from their id) | a pedestrian starts to flee (scared by a fast car, or back on their feet after a knockdown) screams or shouts "Ehi!"; a carjacked driver within 15 m shouts. At most one cue per person per 4 s | scream 100 (1 m), shout 88 (1 m) |
| `bell` | `synth/nature.ts`: a bell's inharmonic partials (hum, prime, tierce, quint, nominal...), each split to beat; four primes rendered, any pitch resampled from the nearest | the computer's local clock: the hours (1–12 strokes, 2.5 s apart) on the hour and one stroke on the half hour, from the 4 loudest towers in earshot, each starting up to 6 s late | 118 (5 m) |
| `bird` | `synth/nature.ts`: autumn calls of the robin, great tit, blackbird ("chink" or "seee") and chaffinch ("pink"), 35/30/20/15 % | from a tree 15–70 m away: 0.3 calls a second in full forest, plus 0.05 near houses | 85 (1 m) |
| `bark` | `synth/nature.ts`: two to five barks of a big or a small dog through a formant tract | 225 farm dogs (about one in eight barns, sheds, houses and farm buildings with open ground and no paving 5 m out): those within 200 m bark every 45 s on average, four times as often while the player runs or drives within 30 m | 96 (1 m) |

A crash's params say what met: `body` is the Impact's `car` (query order, not necessarily the one
that struck; model and zone), `against` either the wall's or the ground's `material` or the other
vehicle's body (the contact sounds the same from either car). Each body carries its
`worn`: the director's record of the hardest crush (the barrier-equivalent speed, `crushSpeeds`
in `synth/crash/hit.ts`) that zone of that vehicle took before, so a mirror, a window, a lamp, a
windscreen or an airbag that went then does not go again. `surface` is what debris lands on: read
like a tyre's under the car for a wall hit (its contact point lies on the house front, often on a
verge or a paved strip off the street), at the contact point between two cars or under a car that
struck the ground. The ground a car lands or rolls on is no drive wall, so `wallAt` (which would
find the nearest house, trunk or rail within 3 m) is not asked: the road and paving (`asphalt`,
`stone`) crash against `road` (a heavy thump under the car's weight, the body grating on it) and
scrape like `masonry`, loose ground (`gravel`, `dirt`, `grass`, `leaves`) like `earth` (the soft,
slow contact, the thud, dirt sprayed up). The material of a
drive wall (`wallAt` in `places.ts`) is that of the nearest wall source within 3 m of the contact
point, if it is the wall the car met (within 0.6 m of the nearest drive wall of any kind): a tree
trunk (`tree`); a building's walls by kind and style (a greenhouse `glass`, the industrial style,
which takes in substations and silos, `sheet`, the stone, church, tower and ruin styles `stone`,
the rest `masonry`); a barrier (a guard rail `rail`, a wall `stone`, a cliff `rock`); else the
bank itself: `rock` in the bare-stone covers (a quarry's cut face, a crag, scree), and anything
else, a steep bank, a stream's edge or the end of the map, is `earth`, though trees stand a metre
or two off it (35 % of the probes 0.15 m off the map's banks read `tree` before that rule, 3.6 %
after).

### Engines

Each engine's sound comes from how the sim says it is built (`VEHICLES[model].engine`: fuel,
strokes, cylinders, displacement, aspiration, idle and redline), through `timbreOf` in
`synth/engine.ts`; the revs and load it plays are the sim's drivetrain's. The rules were fitted to
the four hand-tuned engines they replaced:

- **Pulses** per crank revolution: half the cylinders on a four-stroke, all of them on a
  two-stroke. The firing frequency is rpm / 60 × pulses.
- **The cycle and fuel** set the class: the waveform (a petrol four's sawtooth, a diesel's 0.3
  pulse, a two-stroke's sharp 0.12 pulse), the mechanical noise (a diesel's knock gated at the
  firing rate at 0.6, a two-stroke's rattle at 0.15, a petrol four's valve train not gated), the
  formants' Q, gains and spacing (the second at 3.3× the first on a four-stroke, 2.3× on a
  two-stroke) and the waveshaper's drive (2.5; 4 on a two-stroke).
- **Size scaling**: the first exhaust formant is 330 Hz for 1242 cm³ and goes as the cube root of
  the displacement (a resonance goes as 1/length), 1.3× higher on a two-stroke's expansion
  chamber. The idle lowpass sits 2.7× above it (2× on a two-stroke), the highpass at an eighth of
  it (a fifth on a two-stroke), never under 30 Hz. The sub (the half-order triangle) is 0.25 at
  310 cm³ a cylinder, rising 0.15 per decade of the size of each cylinder, held to 0.1–0.4.
- **The redline lowpass** keeps a number of harmonics of the firing frequency there: 20 on a petrol
  four, 11 on a diesel, 66 on a two-stroke.
- **A turbo** whines (0.015, the diesel's bigger one 0.02), tightens the formants' Q by 0.8,
  lifts their gains to 0.8 and 0.35, the drive by 1 and takes a fifth off the noise.

| Model | Pulses | Wave | Sub | Formants (Hz) | Lowpass idle–redline (Hz) | Highpass (Hz) | Noise gated | Turbo |
|---|---|---|---|---|---|---|---|---|
| Panda (1242 cm³ petrol four) | 2 | sawtooth | 0.25 | 330, 1089 | 891–4133 | 41 | no | no |
| Ape (50 cm³ two-stroke single) | 1 | 0.12 pulse | 0.13 | 1252, 2879 | 2503–7480 | 250 | 0.15 | no |
| Truck (12 880 cm³ turbo-diesel six) | 3 | 0.3 pulse | 0.38 | 151, 499 | 409–1265 | 30 | 0.6 | 0.02 |
| Giulia (1995 cm³ turbo petrol four) | 2 | sawtooth | 0.28 | 211, 697 | 571–4000 | 30 | no | 0.015 |

Geometry alone is wrong for the Giulia: its 2 l would put its formants at 282 and 930 Hz, barely
under the Panda's, but its sports exhaust is voiced darker, so `EXHAUST` scales its formants by
0.75. Each vehicle also draws a `variant` from its entity id (`hash01`), which moves its pitch ±2 %
and its formants ±4 %, so two Pandas side by side do not sound alike; the calibration renders and
the ignition's catch play the nominal 0.5.

### Crashes

A crash is rendered in pure TypeScript (`synth/crash/render.ts`) into a buffer the `crash` shot
plays (`synth/crash/index.ts`), once per params object: the director's echoes pass the same object,
so they replay the same render. Its structure comes from the crash research (physics of crash
pulses, crumpling, panel damping and glass; synthesis methods; a critique that measured 16 real
crash recordings and set the acceptance targets), and every number below is tuned against those
measurements, not by ear.

What a crash is made of, in time:

- **The contact** builds over 11–20 ms (earth ×2.8, a greenhouse or rail ×1.1, a tree ×1.2, a
  side hit ×0.9) and is the loudest moment of its first 50 ms. Its brightness follows how long the
  two surfaces stay in contact, springs in series (−6 dB at 0.83/τ): a PP bumper cover over foam
  (3–8 ms) is dull, bare steel (0.3–1 ms), a door skin (0.6–1.5 ms) and steel on stone bright.
- **The crunch** of each body (`render.ts`): dense Gaussian band noise, overlapping buckle grains
  (1500–3000 a second, 2–5 ms each), whose power follows the crush rate cos(πt/T) inside the crush
  pulse T = 0.1 s·√(μ/k) (±10 %; k the two stiffnesses in series), is held by the rebound and the
  continued deformation for the **main block** (60–75 ms for a bump, 150–400 ms for a crash, longer
  with speed and on a side hit), then falls into the tail; its drive tops out the same whether it
  crumples or only rubs, so the level law alone sets how loud it is. Its spectrum is flat within
  ~5 dB over 125 Hz–2 kHz with a random tilt per render (±1.3 dB per octave) and falls away above
  and below it (the medians over the exterior matrix at 30–150 ms, re the loudest octave: 63 Hz
  −9…−17 dB, 4 kHz −6.5…−13, 8 kHz −15…−22, 16 kHz −25…−35, the brightest a side hit and a wreck,
  the dullest earth and the truck): no boom outside. It rings on in the body's dense modal field,
  each octave decaying with T60 = 2.2 / (f·η), η 0.015–0.045 (at most 0.8 s). A bump (no crumple
  under ~3 m/s) is the cover rubbing instead: darker, peaking near 250 Hz; so is a landing on the
  wheels at any speed, as the floor does not crumple.
- **1–3 sub-hits** at +80…600 ms (more on a side hit and with speed): a second contact, rising in
  4–10 ms, 40–120 ms long, driven at 15–40 % of the block's top. They come back 13 dB and more under
  the hit in most renders (a Panda into a house at 10 and 14 m/s: medians 15 and 19 dB under, in
  10 ms RMS, within 6 dB in 2 and 1 of twenty): a real second contact the physics reports as its
  own Impact, which plays its own crash, and twice as strong they sounded like an echo of the hit.
  Past the level cap (a barrier-equivalent of about 30 m/s) a wreck goes on
  growing in time: from 25 to 60 m/s equivalent the block lengthens by up to 80 ms, the third
  sub-hit grows likelier, the sub-hits spread to 1.2 s and the tail by up to a second.
- **3–30 major buckles** (power-law energies, α 1.3–1.6, over 20 dB), mostly inside the pulse, the
  rest through the block and the sub-hits: each a bright burst and 4–8 freshly drawn panel modes
  (fewer each past a dozen buckles, where they merge into the dense field anyway).
- **1–3 long partials**, stiff parts ringing through the crunch: 0.6–4.3 kHz, T60 0.3–0.9 s
  (η 0.001–0.01), about 9–18 dB clear of it in a narrow band.
- **What breaks** (`parts.ts`), by threshold, read at each body's barrier-equivalent speed (the
  speed into a wall that crushes it as much) and chosen by the zone hit. Front and rear: the PP
  cover's thock (modes at 150–700 Hz ringing 20–100 ms), cracks and clip pops from 3 m/s, the lamps
  from 4–6 m/s. Front only: the airbag from 5–7.2 m/s (a muffled whump) and the laminated windscreen from 10–15 m/s (a crack chain, no shower). A side: the
  door skin (a brighter crunch), the mirror snapping, the tempered side glass from 5–10 m/s; front
  and rear take it from 15–20 m/s. **Tempered glass**: a pop, a near-silent gap, then cubes landing
  in 10–60 clumps over a granular bed from 150–250 ms to ~1.4 s, centred on the 8 kHz octave, a
  second cascade 1.5–2 s later in 40 % of panes; about 9 dB under the crunch it rides on (the
  pop 5 dB), so a hard frontal or a side hit stays under 3.5 kHz of centroid through 600 ms like
  the recordings. Under (a hard landing from 5 m/s; softer ones are clunks): nothing breaks, as no
  bumper, lamp, pane or airbag faces the ground, and the floor meets it through the tyres and bump
  stops, as dull a contact as a PP cover's (3–8 ms), without crumpling. A part breaks once: the mirror, the side
  glass, a lamp, the windscreen and the airbag go only if no earlier hit on that zone of the
  vehicle (its `worn`) passed their threshold.
- **The aftermath**: the car settling (a low-mid bed 8–13 dB under the block, the recordings'
  tails are loudest at 125–500 Hz), debris landing from 0.25 s (none at 2 m/s, dozens at 10–15,
  ~220 in a wreck, up to ~440 at 60 m/s; a third of it metal clinks ringing 20–100 ms), loose
  parts rattling, creaks at an Omori rate (t + 0.2 s)^−0.9 (more past the cap), coolant hiss after
  a hard frontal hit. The tail lasts 0.5–2.5 s, growing with speed, to 3.5 s past the cap; a
  render is at most 4 s (a 35 m/s Giulia wreck reaches it), trimmed 60 dB under its peak and faded.

Each vehicle (`bodies.ts`; masses are the sim's, which the laws count in Panda masses: the Ape
0.38, the laden truck 25.6, the Giulia 1.56; the rest the research's estimates):

| Model | Stiffness | Crunch | Field η | Partials | Front and rear | Its own |
|---|---|---|---|---|---|---|
| Panda | 1 | the reference | 0.025–0.045 | 1–2, 0.7–3.5 kHz | PP cover | a hubcap wobbling down after 9 m/s (40 %) |
| Ape | 0.5 | thin and tinny, little boom | 0.015–0.03 | 2–3, longer | bare steel, no airbag | big rattles (2.5× a car's) |
| Truck | 3 | deeper (the frame sweetener from 10 m/s) | 0.02–0.04 | 1–2, 0.6–2.5 kHz | a heavy steel bumper's clang (4 modes at 150–900 Hz, η 0.004, driven by the closing speed; 12 dB clear of the crunch in about half of Panda–truck hits at 12 m/s, its 250–500 Hz lifting the spectrum to within 8 dB) | the marble shifting by its velocity change (2–6 thunks from 0.5–3 m/s: its own hits shift it, while a Panda hitting it at 12 m/s barely moves it, 0.5 m/s), a chain rattling from 2.5 m/s |
| Giulia | 1.3 | aluminium skins: brighter | 0.025–0.045 | 1–2, 0.9–4.3 kHz | PP cover | the light bar cracking, its electronics rattling (not on a landing) |

Car into car: both bodies crunch from one pulse, sharing it by compliance (each takes
k_other / (k + k_other): a Panda takes 75 % against the truck, an Ape 67 % against a Panda), each
with its own spectrum, partials and parts; the contact sounds the same from either car. Both
steel shells clank where they met (`shells` in `render.ts`): 6 modes each from 0.7 kHz to the top
of the model's panel range, η 0.008–0.015, driven up over the crush pulse, so a Panda–Panda hit at
10 m/s measures a band flatness of 0.45 in its first 30 ms against a house wall's 0.55 (medians):
metal on metal rings where a wall's dead mass rings nothing.

What was hit (`targets.ts`) takes part of the crush (the car's share is k / (k + k_car)) and adds
its own sound:

| Material | Stiffness | What it adds |
|---|---|---|
| `masonry` | rigid | plaster grit, chips landing above ~8 m/s, the building's dull mass (40–80 Hz, η 0.1); no ring |
| `stone` | 6 | more grit; above ~8 m/s stones knocked out, thudding and clacking as they land; a short rumble |
| `rock` | rigid, the hardest contact | harsh grit, pebbles trickling down for seconds |
| `sheet` | 3 | a big, wobbly thin-sheet ring (14 modes at 100–2500 Hz, η 0.002–0.004, each beating against a near-twin, driven up while the sheet deflects: band flatness 0.38 through 150–600 ms against masonry's 0.55), the sheet clattering |
| `glass` | 1 | annealed greenhouse panes: a crack as the pane breaks (fading in from 1.5 to 4 m/s), ringing shards falling over 0.1–2 s from about 2 m/s, a granular bed |
| `rail` | 2 | the only long tonal ring: W-beam modes near 180, 430, 770 Hz and 2–2.7 kHz with split partners, T60 1.4–2.4 s, driven while it deflects; a post's thud, bolts rattling |
| `earth` | 0.43 (the car crushes 30 %) | the softest, slowest contact, a dull crunch, a 60–110 Hz thud, dirt sprayed up, clods |
| `tree` | 1.5 (the car crushes 60 %) | a wood knock (Farnell's wood bank), a creak above ~8 m/s, leaves rustling faintly for 2–4 s (at 2–2.5 s about 23 dB under the crash's first 300 ms in 2.5–8 kHz, 9–13 dB over a house wall's tail there), twigs and burrs ticking dully on the bonnet (300–2000 Hz, η 0.01) |
| `road` | rigid | the asphalt or paving a car lands or rolls on: the body's slap and a 50–90 Hz thump under its weight, grating along the coarse surface for 0.2–0.5 s, grit flicked; landing on its wheels, the bump stops' 70–110 Hz thump and the suspension's steel clanking (about 330 and 760 Hz, as a clunk's). Medians: a 6 m/s landing has 56 % of its energy under 200 Hz and falls 10 dB in 80 ms (a house wall as hard: 30 % and 220 ms); an 8 m/s roll lifts 63 Hz to 0.4 dB under the loudest octave (a side into a house wall: 12 dB under) |

Pieces land on the `surface` under the car: asphalt as is, stone setts brighter and bouncier,
gravel, dirt, leaves and grass muffled and quieter (grass about 16 dB under asphalt). A crash is
always rendered as heard from outside, the listener's own too: through a cabin's balance (most of
the energy under 200 Hz, 2–16 kHz 18–20 dB down) a wall, a car and the road sounded alike, and
the cabin's air mode boomed again at every sub-hit.

**One level law, applied once.** The render's gain is the dissipated energy ½·μ·v²·(1 − e²)
(e from Cipriani's fit, 0.46 at 1 m/s to 0.1 from 7 m/s; μ the Impact's tonnes in Panda masses),
each body's share of it (all of it against a wall but the wall's own share; two cars split it by
compliance) counted at 1/√ of the body's mass in Panda masses, relative to the reference crash: a
Panda nose-first into masonry at 15 m/s, which peaks near the nominal 0.5. That is −18 dB at
2 m/s, −10 at 5, −3.5 at 10, +2.5 at 20; +6.5 dB per doubling of speed; a Panda–Panda 3 dB under
a Panda into a wall at the same closing speed (μ = 0.5); an earth bank 5.2 dB and a tree 2.2 dB
under masonry. The √ is there because a heavier vehicle's extra mass is mostly frame, running
gear and load, which do not crumple and ring like a light car's thin skins: the laden truck plays
7 dB over a Panda at the same speed, not 14, so its 2 m/s nudge into a house plays at −11.2 dB
(a Panda's 4 m/s bump is −11.8) with nothing broken, and it reaches the cap from about 13.4 m/s.
It also gives back the masses the crashes were tuned with (Ape 0.62, Giulia 1.25, truck 5.1, where
the hand-set table had 0.6, 1.3 and 4). Above +6 dB (a Panda at ~30 m/s) the level stops:
the front is used up, and the main block's length, the sub-hits, the debris and the tail carry
the severity. `crashQuiet` is that level, negated, for masking, less what a ringing wall or two
clanking shells add to it (`adds`, measured: the guard rail and a sheet wall play 2 dB over the law
once their ring is driven fully, from 8 m/s, and the road's thump 3.5 (a roll) to 6 dB (a landing),
counted as 4.5; `SHELL_ADDS`, 1 dB of the 0.5–2.6 dB a car–car clank adds). Event counts, durations and thresholds never touch the level. The
peaks follow it within about 1 dB from a 2 m/s bump to a 20 m/s hit on every material (a
Panda–truck hit, its bumper clang, 1.8 dB over). A render never peaks over 0.95.

**Cost.** A render is mostly multiply-adds: every noise layer only adds power to ten octave
bands' envelopes (at 6 kHz control rate), played at the end over ten precomputed loops of band
noise (2.7 s each, read forth and back so they repeat only after 5.5 s, longer than any render;
made once per sample rate in `prepare`: 24–33 ms in Node, 5.2 MB); each mode is one recurrence
step a sample until it falls 60 dB (or to −80 dBFS). A crash renders at the device's rate up to
48 kHz (above it Web Audio resamples: at 96 kHz every mode would cost twice as much). In Node on
this machine (busy, a load of 6), over 20 seeds: a Panda into a house at 14 m/s renders in 4.7 ms
(median; 6.7 worst), the heaviest reachable crashes (the Giulia into a rail or a house at 40 m/s,
a Panda into a tree at 40, a Giulia–truck head-on at 62, two trucks at 40) in 8–15 ms (18 worst);
in headless Chrome 3.5 ms and 7–13.5 ms (14.5 worst). In the game (headless Chrome, `?seed=3`,
90 s at Monzone station and the player's Panda driven into houses, a stone wall and a tree, 115
crash plays) a play took 2 ms (median; 4.6 for nine in ten, 8.8 at most) and no long task fell
within a second of one. ponytail: the render runs on the main thread; move it to a Worker if the
browser shows long tasks.

The bells are the tallest church or tower of each district, 27 in all. A tower of 10 m or less
rings an 800 Hz prime; taller towers ring lower, down to 400 Hz at 30 m.

## Calibration and mix

`src/audio/director/levels.ts` is the mix's one calibration table:

- `ENGINE`, `OWN_ENGINE_DB` and `LEVELS`: each kind's level at 1 m and size, as in the catalogue.
  Every synth peaks near 0.5 (−6 dBFS) at the loudest params it is meant for and scales itself
  with its physical params: an engine idles 17–26 dB (RMS) under full load at the redline, tyres
  follow the rolling law, a crash its speed. The level in the table is the one at that peak.
- `BEDS`: the wind and cricket beds at the ears at full strength and density. `windDb` (here),
  `cricketsQuiet` (`synth/nature.ts`), `WALK_DB` (`synth/steps.ts`), `engineQuiet`
  (`synth/engine.ts`, the engine's gain law: 11 dB under at idle, none at the redline under full
  load), `clunkQuiet` (`synth/impacts.ts`) and `crashQuiet` (`synth/crash/index.ts`, the crash's
  level law: 18 dB under at a 2 m/s bump, none at the 15 m/s reference, 6 dB over from about
  30 m/s, 2 dB more for a ringing guard rail or sheet wall): how far the wind, crickets,
  walking-step, engine, clunk and crash synths play under (or over) that, so masking counts the
  sound actually played. All but `windDb` live beside the synths they describe, derived from the
  same numbers.

**Engine trims.** Each model's `TRIM` (`synth/engine.ts`) is 1 / its own peak at the redline under
full load, measured on the audition page: "Render all" plays every model at {rpm: redline, load: 1}
and at idle, and flags a redline row whose peak falls outside 0.42–0.6 as "off nominal". With the
derived timbres and the old hand-set trims (0.538, 0.336, 0.435, 0.48) the redline rows peaked at
0.551, 0.531, 0.587 and 0.512 (three runs in headless Chrome within 0.001 of each other), so the
trims are 0.488 (Panda), 0.316 (Ape), 0.371 (truck) and 0.469 (Giulia), which peak at 0.499–0.501.
Idle plays under the redline by (RMS) 20.4 dB on the Panda, 25.8 on the Ape (its 250 Hz highpass
and its lowpass closing to 2.5 kHz), 17.0 on the truck (its clatter) and 22.1 on the Giulia.
- `HEIGHT`, `WATER_R_MIN`: source heights and the water's 1 m clamp.
- `CAPS`, `KEEP_DB`, `TOWERS`: the voice caps and their hysteresis.
- `DELAY_FROM` (40 m), `REVERB`, `ECHO_MIN_DB` and `echoes(sound)`: delay, the reverb send and
  echoes.

`mixGain` (`acoustics.ts`) turns a level into a gain. Real levels span 54 dB from a running step
to a horn, too much for a game mix, so only the source levels are compressed, around 120 dB(A) by 0.6;
the losses on the way stay physical, so distance and occlusion cues keep their size:

gain = 10^((120 + 0.6·(L1m − 120) − losses − 85.2) / 20)

The 85.2 (`FULL_SCALE`) puts a running step on stone heard from 1 m (62 dB(A)) at gain 1: its
synth's nominal peak. After compression a horn is 32 dB above a running step at 1 m instead of 54.
A number in the table moves one kind against the others and nothing else.

The beds and water are known by their level at the ears, so that level is what is compressed:

- the wind at its strength, 60 + 40·log10(strength) dB(A). Its voice (body and leaves alike follow
  strength²) already plays that far under its nominal by itself, so the bed's gain gives back what the compression leaves of it;
- water at the line-source level `places` finds at the ears, with only the obstacles and the cabin
  as losses, so a river 200 m away is not compressed as if it were a louder source 1 m away.

The crickets' density moves their level by up to about 12 dB (fewer singers in a quieter chorus)
and is played as is.

What comes out, on the game's meter (`gta.audio.level()`, the master's RMS over 43 ms of the mono
downmix (L + R) / 2, which reads a centred voice at its per-channel level, 3 dB under the voice
before the pan, and a panned one lower):

- on foot in Monzone's street the valley sits near −40 dBFS (the wind bed at the 35 dB(A)
  background, the Lucido behind the houses), a meadow near −36, a windy ridge near −31;
- the player's own walking steps peak near −22 dBFS (−20 at the loudest);
- the Lucido 15 m away in the clear reads −25; behind the houses it plays 15 dB lower through a
  2.8 kHz lowpass;
- a car cruising past 10 m away at 14 m/s peaks near −20 dBFS, 71 cents sharp coming and 69 flat
  going;
- the player's cabin idles near −30.5 (Panda) and −28.7 (Giulia), and pulling away from a
  standstill at full throttle for 4 s (the revs the sim's drivetrain reports climbing from the
  clutch's launch through the gears, load 1) reads a median of −14.4 (Panda, peaks −13.2) and
  −13.4 to −13.7 (Giulia, peaks −10.2 to −10.6);
- the loudest near sounds go past gain 1 and the master limiter holds them near −2 dBFS: the
  player's own horn and siren (about 19 and 17.5 dB over, so the limiter takes up to 11 dB and the
  rest of the mix dips while they sound), a honk 10 m away, and the door slam and starter heard
  from the seat;
- crashes, as the sample peak of either channel. Within about 15 m in the open a crash's way
  would play it more than 8 dB over gain 1 (the player's own comes 21–26 dB over, no cabin, 2–3 m
  from the contact point), so its direct sound plays at that cap: in Chrome (single renders, the
  output captured) a Panda at 12 m/s into a house peaks −6.4 dBFS and into another Panda −7.2, an
  8 m/s roll onto the road −5.4 and a 7 m/s landing on it −3.6, each 11–21 dB under its peak
  300 ms later. Played at 25 dB over, the limiter took up to 20 dB off the same hits and, released,
  held the output within 1–3 dB of the peak 300 ms on, the crunch's sub-hits as loud as the hit.
  Further away (the game's own chain rendered offline, the median of six renders, before the cap,
  which does not reach them): a Panda into a house at 10 m/s peaks −15.5 dBFS 30 m away (−27 on
  the meter), at 5 m/s −23.5, at 15 and 20 m/s −12.6 and −9.7; a Panda–Panda, a tree, a bank, the
  guard rail and a stone wall at 10 m/s −12 to −20 at 30 m.
- the player's own clunk plays 10.3 dB over gain 1 (no cabin, from the seat) and peaks, into the
  limiter, at −8.1 dBFS bottoming out at 1.5 m/s, −5.6 at 2 m/s, −2.1 at 3 m/s and +2.1 just under
  a crash's 5 m/s (its buffer's 0.5 peak × the speed's gain × the director's × the master's 0.8),
  so from about 2 m/s the limiter takes it, and the rest of the mix dips for its 0.25 s release.

## Controls

| Key | Where | Does |
|---|---|---|
| H | at the wheel | sounds the horn while held |
| H | at the wheel of the Carabinieri Giulia | each press turns the two-tone siren on or off |

On foot H does nothing. The keyboard's title card lists it; in mobile mode the Horn button shows while
driving.

## Start, pause and hidden tabs

- **Autoplay.** Browsers allow audio only after a user gesture, so the AudioContext is made on the
  first trusted `keydown`, `pointerdown` or `touchend` with user activation once the speaker exists
  (made during the last loading steps): normally the key or tap that dismisses the title card (Esc
  does not count). Until then nothing plays and no sound time passes. The gesture's own task builds
  only the context, the noise kit and the mixer. The kit's samples take ≈ 17 ms in Node; ≈ 7 of
  them are the gust signal, which turns each sine by a rotation per sample instead of calling
  `Math.sin` (three times slower). Each one-shot then pre-renders its buffers in tasks of its own:
  the crash its noise loops, the footsteps their 48 variants one bake at a time (a bake builds its
  whole graph before it renders, so baking all at once built some 1,200 noise bursts in one task).
  A later gesture resumes a context the browser has left suspended or interrupted (Safari,
  Firefox).
- **Pause.** While the full map (M) or the settings (Esc) are open, `main.ts` calls
  `speaker.pause(true)` every frame, which suspends the context, and skips the frame, so the audio
  schedule does not run either. Closing them resumes both.
- **Hidden tab.** The context is suspended while the page is hidden and resumed when it shows
  again (unless the map or the settings are open).
- **Failures.** A non-finite placement or delay is never sent (it would mute its kind for the
  session); a synth that throws mutes only its own kind.

## The audition page

`pnpm dev` also serves the audition page at http://localhost:5173/lab.html (`lab.html`,
`src/audio/lab.ts`); the production build leaves it out. It plays every synth through the game's
own emitter and mixer:

- **Listener:** the distance (a logarithmic slider, 0.5 m to 2 km), the side of the screen, a cabin
  (none or a model), how enclosed the street is (it sets the reverb send), and the master level
  meter.
- **One panel per kind:** each continuous kind has Hold / Release and each one-shot Play, with a
  control for every param (sliders, menus, checkboxes): the engine's `rpm` (0–7000), `load` and
  `variant`, the tyres' `speed`, `skid` and `slip`. The crash's are flat: speed and mass (0.1–30 t)
  sliders, the `model` and `zone` of the body that hits, `against` (a material for a wall or the
  ground, or a model for a car, struck on its `struck` zone) and the `surface`. Each
  panel shows how its sound is heard at that spot: the level at 1 m (at the ears for the beds) and
  at the listener (an engine `engineQuiet`, a clunk `clunkQuiet`, a crash `crashQuiet` under it),
  the gain, pan, lowpass, reverb send and delay. The first press starts the audio.
- **Render all** (also `window.lab.renderAll()`, which returns the rows) renders every voice and
  shot offline at 48 kHz at a few representative params (88 renders, about 3 s) and tabulates peak,
  RMS (dBFS), spectral centroid (`measure.ts`), NaNs and length. It flags silence (peak under
  1e-4), clipping (over 0.95), an engine at the redline under full load peaking outside 0.42–0.6
  ("off nominal": its trim needs measuring again), NaNs, and any sound left after a voice's stop
  or a shot's end. Each engine plays at {rpm: redline, load: 1} and idling, the Giulia's from its
  seat at 3500 rpm and half load; the tyres a full slide at the Giulia's top speed, rolling, a
  standing burnout, a locked wheel and an ABS stop at the limit. The crashes cover a matrix, each at
  the sim's mass (the car's, the reduced mass of two): a Panda into a house wall at 2 (a bump), 5,
  14 and 20 m/s, a Panda–Panda at 10, a Panda–truck at 12, an Ape into stone at 8, the Giulia into
  the guard rail at 12, a Panda into a tree at 10 and into earth at 8, a side hit at 12, the Giulia
  wrecked at 40, the laden truck into a house at 2 and 12 and a Panda landing hard on the road and
  rolling onto it at 8, each drawn anew on every run (a fresh params object, so the crash's
  per-object memo never replays an earlier run); the scrape plays along every material at 12 m/s,
  along masonry at 4 and along the guard rail at 2.5, where it squeals. An engine with `inside`
  ticked plays through no cabin, as the game plays the listener's own (the synth makes its cabin).
  Adding a kind fails to compile until the page has a panel and render rows for it. Two low peaks
  are by design: the wind swells with gusts over seconds, so at strength 1 a 2 s render peaks near
  0.2–0.3 while its 64 s gust loop reaches 0.45–0.65; and the blackbird's thin "seee" (30 % of its
  calls) peaks at 0.25 yet is 6 dB louder over 125 ms than its "chink" series at 0.5.

The page places every sound with the director's own facts: the levels from `levels.ts` through
`hear` in `hearing.ts`, the source at ear height over open, flat ground with nothing in the way, no
Doppler, masked against 35 dB(A), and the wind bed compressed at its strength as `world.ts` does.
Only water is a stand-in: a point source, the river (the Lucido) and the stream (a 4 m one) at their
2 m bank level + 6 dB and the fountain at its 1 m level, where the game takes each body's
line-source level at the listener.

## Tests

`pnpm test` runs them all in Node, which has no Web Audio: the synth modules make nodes only inside
functions (`synth/__tests__/world.test.ts` imports them to check).

| File | Checks |
|---|---|
| `src/sim/__tests__/index.test.ts`, `src/sim/__tests__/walls.test.ts` | the events: a car driven into a building is a `wall` Impact as fast as the car was, where its nose meets the wall; rolled into it 45° and 60° off square, on the wall itself (within 5 cm) at its front end; a car rolling into a parked one a `car` Impact at the closing speed, the reduced mass and where the bumpers meet; a knockdown one `person` Impact faster than `KNOCK_SPEED`; a car pinning the player a `person` Impact as fast as the car was; a car blocked by a parked one honks once per stuck episode, `HONK_STEPS` before each time it backs up |
| `src/audio/__tests__/index.test.ts` | `Hear`: the listener on foot and at the wheel with the horn held, AI traffic running while standing, an untouched car heard only while it moves, rolls, pitches or bounces, impacts (with the struck vehicle's model and zone, the mass in tonnes as the sim gave it; none for a vehicle gone since) then honks each heard once, a ground hit's zone from its face, the revs and load `engineRevs` gives for the vehicle's chassis, speed and pedal, each vehicle's skids since the last frame (the most past grip, the fastest, the surface of the wheel furthest past), wheels down on the springs and not in the air, on a side or on the roof, the body down on the ground sliding on its roof or side and not on its wheels or in the air, an Ape rolling into a parked Panda front on rear, an Ape T-boning a parked Panda's front door on its side, a Panda rolling 50° off square into a house wall on its front |
| `src/render/__tests__/index.test.ts` | every system of the render and audio schedules declares no writes |
| `src/audio/__tests__/acoustics.test.ts` | the laws: the line source against the exact table, the air cutoffs, Doppler, the pan, diffraction, ground, foliage, masking, the mix calibration |
| `src/audio/__tests__/occlusion.test.ts` | path differences on real map spots: a flat meadow, Monzone Alto's 30 m tower, a bell over its own walls, Monte San Giorgio between its flanks |
| `src/sim/map/__tests__/surface.test.ts` | the surfaces the tyres and the sounds share: carriageways by their OSM surface, the forest floor, a meadow; by level, the hillside over a tunnel and the deck only on the deck |
| `src/audio/__tests__/places.test.ts`, `src/audio/places/__tests__/water.test.ts` | wall materials (a trunk, buildings by kind and style, the guard rail, the stone wall, a cliff, bare ground, a quarry's bank; the nearer of a trunk and a house wall 1.2–2.5 m apart wins; a bank with trees 1.5–3 m off it is earth), ambience shares, streets, echoes off the rock at Equi Terme, none on an open meadow nor at any Monzone street with no slope as steep as bare rock (50°) in sight, bells, dogs and birds, the Torrente Lucido from Monzone station, the Fontana di Aiola |
| `src/audio/director/__tests__/index.test.ts` | the director on a recording speaker at real map spots: proximity (in the open and behind a ridge), a building's muffling, Doppler, step cadence, travel delay, crash merging and scrapes, a house wall's material and cobbles in the crash and scrape params, a car crash's bodies the same from either car, a zone's wear carried to the next crash, a wall crash's debris surface read under the car, a scrape's material held through a brief other contact, a wall crash on foot muffled by the house in the way, a bump culled nearer than a crash, the engine's revs, load and variant passed on, engines ranked by their load, the tyres on the sim's skids (a standing burnout, the skid held over a frame with no step, silent in the air), a vehicle heard where its body is, a hard landing against the ground's material and not the nearest wall's and a body down on it grinding it (no hit needed), under a bridge the tyres and a landing on the riverbed's own surface and not the deck's, the own siren as loud in the air as on the ground (the ears ride in the car), cresting a hump as one clunk and a hard landing as a crash, echoes off a rock face and hidden in a street, the reverb dry in the open and wet in a walled street, nothing before the context, the cabin (the own crash open and at its cap, its tail and echoes through it), getting in and out, horn and siren, the bells, water and its masking, the valley's never-silent bed and the river 15 m away against behind the houses, voice caps and their hysteresis, flee cues |
| `src/audio/director/__tests__/hearing.test.ts`, `occluder.test.ts` | the reverb send: none in the open, in a street by distance (capped), gaps and the cabin, even for a sound of the own car that skips it; the obstacle cache's refresh and forgetting |
| `src/audio/__tests__/speaker.test.ts`, `mixer.test.ts`, `buffers.test.ts`, `measure.test.ts` | the one-shot cap, the speaker inert until a trusted gesture, the level meter, seamless noise loops, the gust signal against its closed-form sine sum, the render measurements |
| `src/audio/synth/__tests__/*.test.ts` | each engine's timbre from how it is built (pulses from cylinders and cycle, formants falling with displacement and the sub rising with each cylinder's size, a two-stroke brighter and rattling, a diesel's clatter, a turbo's whine only with a turbo, the Giulia's exhaust voiced darker than its size), the engine law (idle 11 dB under the redline, the cabin tone, every model at its trimmed peak, a variant's pitch and formants); the tyre law (a standing burnout and a locked wheel squeal, a creep barely past grip does not, the full slide at the Giulia's top speed); the scrape's surface loops (seamless, at their RMS, a stone every 0.3 m and a rail post every 2 m) and its speed law; step and cricket rates; bubbles at their Minnaert frequency; synth params clamped, NaN to silence |
| `src/audio/synth/crash/__tests__/crash.test.ts` | the crash renderer over the design's matrix, each at the sim's mass (a Panda into a house at 2, 5, 12, 14 and 20 m/s, Panda–Panda 10, Panda–truck 12, an Ape into stone 8, the Giulia into the guard rail 12, a sheet wall 12, a tree 10, earth 8, a side hit 12, a 40 m/s wreck, the laden truck into a house at 2 and 12, a hard landing on the road at 6 and a roll onto it at 8, against a house wall at 6 and 10 and a side into it at 8), twenty seeds each (the bounds checked on seeds 1–80, twenty at a time), measured by `testing.ts` (the research's analysis tools, ported): finite, ≤ 1, ≤ 4 s, faded, finite from an 8 kHz device rate; noise that never repeats inside a render; deterministic per seed; the level law, its cap and the peaks following it within 2 dB (a bump, the rail, a sheet wall, Panda–Panda, the truck's nudge); the laden truck 7 dB over a Panda, its nudge like a Panda's 4 m/s bump, capped by 14 m/s, the barrier speeds of a Panda against it and of it; a landing breaking nothing; growth past the cap (tail, block, at most 3 sub-hits, 42 m/s against 60 audibly different); the critique's targets on the exterior crashes (medians: −10 dB at 150–450 ms, rise 8–25 ms, crest 9–15 dB, band flatness 0.35–0.6, 1–8 kHz kurtosis 2.8–4.5, 8 kHz −12…−25 dB, 16 kHz −22…−36, centroid 1.5–3.5 kHz through 600 ms; 97 % of renders with 63 Hz ≤ −5 dB and the loudest octave in 125 Hz–2 kHz); the tail's −20 dB at 0.25–2.5 s, later the harder the hit; a flat median spectrum (the truck within 8 dB); the long partials layer (each model's count at 0.6–4.3 kHz, η 0.001–0.01) and 1–3 of them clear in the render; the bump's 40–100 ms; the rail's tonal ring; the sheet wall's ring against masonry; the truck's bumper clang; the tree's faint rustle past 2 s and its tail under 3.5 kHz; earth the slowest, dullest; a car–car hit's clank against a house wall's dead mass; the road's thump on a landing and slap on a roll; sub-hits 13 dB and more under the hit; a greenhouse nudge's dull crack; a worn side breaking nothing again; the glass shower's 6–10 kHz centroid and grass swallowing it |

### In a browser

1. `pnpm dev`, open http://localhost:5173 and, once the title card says "Press any key", press a
   key: it dismisses the card and starts the sound.
2. In the console (dev builds only), `gta.audio.context()?.state` should read `"running"`, and
   `gta.audio.level()` returns the master's RMS in dBFS (−100 when silent). `gta.audio.speaker` is
   the speaker: wrap its `hold` and `play` to count requests or check placements.
3. The Ritmo monitor (backslash) lists the audio schedule beside `update` and `render`.

Measured in headless Chrome (`?seed=3`, keys sent over CDP, `gta.audio.level()` every 100 ms):
standing at the spawn −40 to −42 dBFS, walking there with step peaks up to −20, 15 m from the
Lucido in the clear −25, in the Carabinieri Giulia driving with the siren on −10.5 (peaks −3.5),
in a stolen Panda honking −13 (peaks −3.5); no console errors and no non-finite placement or
param. With the engines on the sim's revs (the speaker's `hold` wrapped to read the own engine's
params): in the Giulia idling −28.7 (750 rpm, load 0), pulling away from a standstill at full
throttle for 4 s a median of −13.4 to −13.7 and peaks −10.2 to −10.6 over three runs (1800 rpm
at the launch to 5419–5498, load 1 between shifts, to 13.6–14.6 m/s); in a parked Panda idling
−30.5 (800 rpm), the same pull-away −14.4 and peaks −13.2 (1800 to 5714 rpm, to 13.8 m/s), a
handbrake turn onto grass −9.9 (its tyres played at skid 1, sliding 27.9 m/s). On the
audition page "Render all" gives 87 rows, none flagged.
Crashes (a Panda driven by CDP keys into a house, a stone wall, a tree and a bank at 5–15 m/s and
into parked cars at 9–15 m/s, `gta.audio.level()` and each channel's sample peak every 20 ms): the
played speed is the car's at contact (wall hits within 0.3 m/s of it, an oblique tree hit 0.5 under;
before the sim reported it, a 15 m/s hit played as 2.9 then 9.9 m/s); from the seat each peaks −0.3 to
−1.9 dBFS (the meter −12 to −14 over a cabin at −15 to −20 under throttle; −1.3 to −2.2 and the
meter −12.2 to −13.2 with the cabin balance on the crunch); on foot 6.6 m from an
11.4 m/s hit −2.8 (the meter −10), 10.5 m from a 5.1 m/s one −9.8; a play's render 1–8 ms, no long
task, no console error, no non-finite placement.

## Known limits and tuning

- **The loudest near sounds touch the limiter.** The player's own horn and siren pass the whole
  cabin, yet still play over gain 1, so the limiter takes a few dB while they sound (peaks near
  −3.5 dBFS) and the rest of the mix dips that much with them.
- **Beds against traffic.** Compressing the beds at their level lifts a quiet valley more than a
  car 10 m away (whose 20 dB of spreading stays physical): a car cruising past 10 m away stands
  some 10 dB over a village street's bed on the meter and 6 dB over a meadow's, not the physical
  20–30.
- **The own engine's range** is the voice's: idle to the redline under full load spans 17–26 dB
  (RMS), so with the cabin idling near −29 to −31 dBFS the Giulia peaks near −10.6 pulling away.
- **Engines mask and rank by their gain law only.** Masking and the voice caps count an idling
  engine 11 dB under full load at the redline (`engineQuiet`), but the synth plays it 17–26 dB
  quieter (the filters closing take the rest), so an idling car is culled a little later than
  it should be.
- **A clunk's level is estimated.** The suspension bottoming out plays at 85 dB(A) at 1 m at
  5 m/s, a guess with no recording measured; nor does it depend on the model beyond the truck's
  lower bump stops.
- **The tyres hear a car's skid, not each wheel's.** The sim reports every sliding wheel; the
  audio plays one voice per car, at the most any wheel went past grip, the fastest any slid, on
  the surface of the one furthest past, from the car's centre of mass.
- **One edge.** Only the worst edge on the path counts, capped at 15 dB: two rows of houses are no
  quieter than one. Trees cost foliage loss but do not diffract.
- **Echoes inherit the direct path's occlusion**, and only rock faces echo.
- **The woods play dry.** A forest's tail reaches 10–16 dB under the direct sound 100 m away
  (Huisman and Attenborough 1991), so a bark, a bell or a crash heard across the woods should
  carry a faint tail, but only streets send to the reverb.
- **The reverb is the listener's street.** A source in a street heard from outside it plays dry:
  its street's tail, escaping through the street's mouth, is left out. Every street shares one
  reverb time; only the send scales.
- **Bells follow the computer's clock**, not a game time of day. A ring that falls before the
  audio starts is skipped.
- **Fixed weather:** 15 °C, 70 % humidity, an October afternoon. No night, no wind direction.
- **Water** loudness comes from width and grade, not discharge; the Cascata di Equi is hard-coded.
- **Stereo** is a pan along the screen's right axis, with no front or back; it follows the view's
  turns, not the camera's eased swing between them, and a one-shot or echo already on its way (a
  far bell stroke, a bark 200 m off) keeps the pan it was sent with.
- **The occluder is bounded:** at most 12 paths a frame are re-measured, each at most every
  150 ms, so a source moving fast behind houses can lag a few frames.
- **A car rubbing along a wall** keeps a faint scrape held while the sim reports the small hits.
- **Crashes are tuned by measurement, not by ear.** Their features match the research's real
  recordings (onset, block length, crest, noisiness, kurtosis, octave balance, centroid,
  partials), the medians over twenty seeds within the critique's ranges on any twenty; single
  renders still miss one now and then (a rise over 25 ms or a crest over 15 dB in about one
  render in five, 63 Hz over −5 dB in about one in eighty, as the recordings themselves vary). A
  parking bump's crest is about 15.3 dB (a bumper tap's 13.7–15.2) and its −10 dB about 90 ms,
  both near the edge of their targets. A tree's tail is still brighter than the one recorded tree
  crash's (3.3 kHz of centroid after 0.6 s against 1.4). Nobody has listened to them blind
  against the recordings yet.
- **Near crashes play alike loud.** Within about 15 m in the open every crash's direct sound plays
  at its 8 dB cap, so nearer no longer sounds louder there: only the pan, the reverb and the echoes
  move. Uncapped, the limiter held them near −2 dBFS anyway, and gave their tails back as loud as
  the hit.
- **The road and the shells' clank are tuned by measured features only:** no recording of a car
  landing or rolling onto the road, nor of two cars' shells, was measured; their levels (`ROAD`,
  `SHELL`) are set so each kind stands apart from a house wall in the features above.
- **Crashes render on the main thread** when they play: 2–9 ms each, the heaviest reachable
  (two trucks head-on at 40 m/s) about 15 ms in Node and 13.5 in Chrome.
- **Traffic brushes houses.** Near Monzone station (`?seed=3`) AI cars hit house walls 10–17
  times a minute (front corners and sides at 1.5–9 m/s where a lane passes close to a facade, the
  same cars again and again: in one 90 s run 16 of 26 crashes landed on a zone already worn), and
  each hit is a crash: distant bumps, now and then a loud one in a nearby street, its mirror and
  glass gone after the first.
- **What a crash leaves out:** a parked car's alarm, a stuck horn, the engine stalling, tyre
  scrub after the hit, a hanging part swinging; the zone is front, side, rear or under (no
  corners: an oblique hit on a front corner is the front; the roof is a side, sharing its wear).
  The ground is the road or earth by its surface; a body sliding on the road grinds like a rendered
  wall (the scrape has no asphalt of its own). A part's threshold is drawn per render, so a harder
  later hit can break a part again when its draw lands between the two speeds; the Giulia's light
  bar and the Panda's hubcap are not remembered at all.
- **A scrape's level follows speed only.** The sim reports no contact force, so a car pressed hard
  along a wall grinds as loud as one brushing it.

Where to tune:

| Where | What |
|---|---|
| `src/audio/director/levels.ts` | every source level and size, heights, caps and hysteresis, the crash's gain cap, the bell towers, delay, the reverb send and the echo floor |
| `src/audio/acoustics.ts` | `AMBIENT_DB`, `CABIN`, the mix rule (`L_REF`, `K`, `FULL_SCALE`), the air and diffraction tables |
| `src/audio/index.ts` | when a still vehicle is heard (`STILL`), when its wheels are off the ground (`AIRBORNE`), the zone of each face that strikes the ground |
| `src/audio/director/vehicles.ts` | when tyres roll and how long a skid holds, the beeper sounds, a hit crashes, clunks or scrapes, hits merge; the ground's materials; the groan and door timings; how much of the cabin the own horn and siren pass |
| `src/audio/director/people.ts` | jumps, running, the shout radius and the cue gap |
| `src/audio/director/world.ts` | the wind law and its floor (`STILL`), the beds and water compressed at their level, birds, dogs, the bell strokes, how often water and dogs are looked up |
| `src/audio/director/occluder.ts` | the obstacle refresh rate, per-frame budget and forgetting |
| `src/sim/map/surface.ts` | surfaces: the road surface names, the cover each surface is, the verge (shared with the tyres' grip) |
| `src/audio/places.ts`, `src/audio/places/water.ts` | wall materials and their reach, ambience, street probes, the echo search and the rock's reflection loss, bells, dogs, bird trees; water power, fountains and the Cascata |
| `src/audio/synth/engine.ts` | how an engine's build sets its sound (`CYCLES`, the formant's size law, `timbreOf`), each model's measured `TRIM` and `EXHAUST` voicing, the variants' spread, the engine law |
| `src/audio/synth/crash/` | the crash: its level law, the mass's 1/√ and timing (`hit.ts`), the crunch, partials, contact and the shells' clank (`render.ts`, with `SCALE`, the reference crash's output scale, and `SHELL`), each model (`bodies.ts`), each material and the road (`targets.ts`, with `ROAD`), what breaks and falls (`parts.ts`), grit, trains and landings by surface (`textures.ts`) |
| `src/audio/mixer.ts`, `src/audio/speaker.ts` | master gain, limiter, the street reverb and its return; the one-shot cap |
| `src/audio/synth/*.ts` | each synth's own table: horns, tyre grounds and the skid's fade-in, the clunk (`BOTTOMED`), the scrape's materials, treads, voices, calls, bubbles |

Sources for the numbers: ISO 9613-1 (air absorption) and ISO 9613-2 (ground effect, foliage),
Maekawa's barrier chart (diffraction), Thomas et al. 2013 (reverb in streets and in the open),
Picaut et al. 2005 (a street's reverb time), Huisman and Attenborough 1991 (forest reverb), Pieren
and Wunderli 2011 (cliff echoes), Wunderli and Salomons 2009 (forest edges), ITU-R BT.1359 (audio
lag), D.M. 20/03/1979 (the siren), CNOSSOS-EU (tyre rolling noise), van den Doel 2005 (bubbles),
Farnell, *Designing Sound* (footsteps, wind), Peterson and Barney 1952 (vowel formants), Arnal et
al. 2015 (the roughness of screams) and Dolbear's law (cricket rate). For crashes: crash-pulse
durations (Locey et al. 2012, NHTSA fleet data), restitution (Cipriani 2002), crumpling's power law
(Houle and Sethna 1996), modal synthesis and contact spectra (van den Doel and Pai; Chadwick, Zheng
and James 2012), PhISEM grain streams (Cook, STK), tempered glass (UN R43 Annex 5; Nielsen et al.
2009), the W-beam's bands (a highway guard rail's contact-mic recording) and 16 crash recordings
measured for the critique (Freesound CC0/CC BY, BBC Sound Effects for analysis only).
