# Weather and the time of day

The game keeps a clock and a weather in its saved state, and pure functions turn them into the sun,
the moon, the air's temperature, the rain and snow falling, the wet and the snow on the ground, the
fog and the wind at any point of the map. The physics, the traffic, the renderer, the audio and the
HUD all read the weather through those same functions, so a road grips, looks and sounds as wet as
it is. The code is in `src/sim/sky/` and `src/sim/systems/sky.ts`; the systems' order and the saved
resources are in [architecture.md](architecture.md#schedules-and-system-order). Heights are metres
above sea level, the map frame is x east and y north, and times of day are Rome's.

## The game clock

`GameClock` holds the game time and how fast it runs: `seconds`, whole Unix UTC seconds, and `rate`,
the game seconds each 60 Hz step adds.

- **A game minute a real second.** At rate 1 each step adds a game second, so a real second is a
  game minute and a game day lasts 24 real minutes: long enough to drive a while in one light, short
  enough to see a dusk and a dawn in one session (the user's choice). `AdvanceClock` adds the rate
  each step; at rate 0 the clock stands still and is not written.
- **The pause stops it.** The full map (M) and the settings (Esc) stop the `update` schedule, and
  the clock with it.
- **A new game starts today at 08:00.** `main.ts` gives `makeRuntime` the browser's local date at
  08:00 in Rome as `start`: the simulation never reads a date itself, or a replay would not replay.
  Without a `start` the runtime begins at `DEFAULT_START`, 2026-10-22 08:00 CEST (1792648800), so
  tests replay the same day. Behind the title card the clock is held at rate 0 (`holdClock`,
  `src/hud/title.ts`) and set going at rate 1 when the card goes, so play starts at 08:00 however
  long the card stayed up; traffic and people move on behind it.
- **Requests.** `SetClock { seconds?, rate? }` sets the time, the rate or both (`setClock`,
  `src/sim/sky/clock.ts`): the seconds are rounded and kept from 2000-01-01 to 2100-01-01 UTC
  (`SECONDS_RANGE`, inside the calendar's summer-time rule), the rate is a whole number from 0 to
  3600 (`MAX_RATE`, a game hour a step), and a request with neither as a finite number is dropped.
  The host sends one to hold the clock behind the card, the dev menu to set the time
  ([The HUD and the dev menu](#the-hud-and-the-dev-menu)).
- **Two kinds of time.** The sun, the moon, the temperature, the regimes, the wetness and the snow
  line follow the game time. What moves on screen or in the ears (rain falling, clouds drifting,
  lightning, trees swaying) runs on sim seconds, `(Time.step + alpha) · STEP.dt`: game time runs 60
  times faster and would fling them, and sim seconds stand still in the pause like the rest of the
  game.

## The calendar and Rome time

`src/sim/sky/calendar.ts` turns the clock into dates and Rome's wall clock with exact integer
arithmetic, so every host and every replay reads the same date: the simulation's lint bans `Date`,
and `Intl`'s time-zone data comes from the host.

- **Dates**: Howard Hinnant's `days_from_civil` and `civil_from_days` (`daysFromCivil`,
  `civilFromDays`, day numbers from 1970-01-01) and `weekday`.
- **Rome's offset**: CET (UTC+1), and CEST (UTC+2) from 01:00 UTC on the last Sunday of March to
  01:00 UTC on the last Sunday of October, the EU rule Italy has kept since 1996 (`romeOffset`).
- **Wall clock**: `romeTime` gives the date, hour, minute and second, keeping the fraction of a
  host's fractional time. `utcFromRome` reads a wall-clock time back to UTC: the hour skipped in
  March reads an hour later, the hour repeated in October as its first, summer-time pass.
- **Checks**: `calendar.test.ts` round-trips every day from 1900 to 2100 and checks the switches of
  2026, 2027 and 2032 against IANA's Europe/Rome.

## The sun and the moon

`src/sim/sky/astro.ts` places the sun and the moon over `ORIGIN` (44.16175 N, 10.13 E, the map's
centre, in `src/sim/map/kinds.ts`) from the game time, in degrees: azimuth clockwise from north,
elevation geometric (no refraction).

- **Models.** The sun follows NOAA's Solar Calculator equations (Meeus, *Astronomical Algorithms*,
  ch. 25), the moon the Astronomical Almanac's low-precision series with the topocentric parallax
  (about 1°; without it the moon's elevation is off by up to 1.18° against JPL Horizons). Both turn
  to the horizon through Greenwich mean sidereal time; TT − UT (about 69 s) is ignored. `moonPhase`
  gives the lit fraction, the age (0 new, 0.5 full) and whether the moon waxes.
- **Accuracy.** `astro.test.ts` holds reference values from JPL Horizons and the USNO API for the
  map's centre: the sun within 0.02° on 22 October 2026 at 09, 12 and 15 UTC; its highest elevation
  69.3° on 21 June, 34.7° on 22 October and 22.4° on 21 December, to 0.02°; sunrise and sunset
  within 60 s of USNO on four dates; the moon within 0.7° in azimuth, 0.4° in elevation and 0.01 in
  lit fraction at six instants; and the phase at USNO's new, first-quarter and full moons of October
  2026.
- **Sunrise and sunset.** `sunTimes` (`src/sim/sky/day.ts`) finds them on a Rome calendar day: the
  sun's centre at −0.833° (the disc's radius plus the horizon's refraction, USNO's convention),
  scanned hour by hour from local midnight, then bisected to half a second. On 22 October 2026 they
  are 07:42 and 18:24, on 21 June 05:36 and 21:06, on 21 December 07:51 and 16:43. The dev menu's
  sunrise and sunset buttons jump to them.
- **The view turns the sky with it.** The renderer takes the real direction and turns it about the
  vertical by the view's yaw (`keyDirection`, `src/render/sky/light.ts`): in the home view the sun
  stands where it really is, and each quarter turn swings it with the camera, so the lit and shaded
  walls always match the screen, the settled rule of [render.md](standards/render.md). The home view
  looks south-east, so a morning sun shines toward the camera; the user accepted that backlight.

## The climate model

`src/sim/sky/climate.ts` holds the valley's climate as a small model: the temperature normals each
month and how they fall with height, the day's cycle, the share of precipitation that falls as snow,
and how much more falls higher up. Every number comes from a source in the
[record](#the-climate-sources-record) or is labelled a design value.

### Temperature with height and month

Each month has a daily mean extrapolated to sea level, a lapse rate up to 1100 m and a gentler one
above, and a daily range on the valley floor (250 m and below) and on the ridges (1100 m and above),
blended between them with a smoothstep (`CLIMATE`). A day takes the straight line between the two
nearest mid-month values (`normalsAt`).

- **Up to 1100 m** the mean runs straight from ISPRA SCIA's Pontremoli depuratore (290 m, on the
  Magra's floor, 1991–2020) to the Aeronautica Militare's Passo della Cisa (1048 m, 1971–2000): SCIA
  has no other temperature station in Lunigiana, the Garfagnana or the Apuan Alps.
- **Above 1100 m** it runs on to Monte Cimone (2173 m: SCIA's 1991–2020 maximum, the Aeronautica
  Militare's 1971–2000 minimum). In winter the lapse up there is half the valleys' (3.1 against
  6.8 K/km in January): the summits stand above the valleys' cold-air inversions.
- **One period.** The Aeronautica Militare's 1971–2000 values are brought to 1991–2020 by the change
  SCIA measures between the two periods at Pontremoli depuratore, Ligonchio, Sestola and Diga del
  Brugneto: +0.15 to +1.9 °C on the maximum and +0.15 to +1.0 °C on the minimum, by month.
- **Daily range.** The valley's is Pontremoli depuratore's mean maximum less its minimum, the
  ridges' the mean of Cisa's and Cimone's: valley floors heat strongly by day and pool cold air at
  night, while ridges stand in the free air.

`climate.test.ts` checks the mid-month model against the stations themselves, within 0.25 °C:
Pontremoli depuratore's maximum and minimum at 290 m, Cisa's mean at 1048 m and Cimone's at 2173 m,
in January, April, July and October. The normals it gives on the 15th, before any weather (°C):

| Month | 250 m max / min | 1040 m max / min | 1800 m max / min |
|---|---|---|---|
| January | 10.4 / 1.2 | 2.7 / −1.8 | 0.1 / −4.3 |
| April | 18.1 / 5.7 | 10.0 / 4.0 | 5.3 / −0.6 |
| July | 29.5 / 14.7 | 22.3 / 14.8 | 17.7 / 10.3 |
| October | 19.6 / 9.0 | 12.1 / 7.3 | 8.6 / 3.8 |

### The day's cycle

`airAt` places each moment between the day's minimum (−0.5 of the range) and maximum (+0.5) on
Parton and Logan's (1981) curve, closed as Felber, Stoeckli and Calanca (2017) close it, and adds
the weather's anomaly; `celsiusAt` then takes it to a height.

- **By day** a sine rises from the minimum at sunrise to the maximum at 14:30 local solar time and
  falls on toward sunset. Felber et al.'s own fit puts the minimum 0.75 h after sunrise and the
  maximum at 14:43; the game keeps sunrise and 14:30, as designed.
- **By night** the curve decays toward the next sunrise's minimum as e^(−b·x) − x·e^(−b), x the
  share of the night gone: fast just after sunset, slowly toward dawn, as clear air radiates its
  heat away early. It meets the minimum at sunrise with no jump: no 10 s step over a day is more
  than 0.02 °C (asserted).
- **The weather's share of the range** (`rangeShare`): 0.4 under a full cloud cover, 1 under a clear
  sky in a wind, 1.15 clear and calm (calm at 2 m/s or less, windy from 6 m/s), as valley floors
  cool most on still, clear nights. The night's decay b is 3.14 × that share: 3.61 clear and calm,
  3.14 clear in a wind, 1.26 overcast. 3.14 is Felber et al.'s generic fit to clear-sky days at
  Swiss stations below 800 m; a cloudy or windy night cools more evenly.

On a clear, calm 22 October at the Monzone spawn (209 m, wind 2 m/s, no anomaly) the air reaches
19.4 °C at 15:33, falls to 17.5 °C at sunset (18:24), 12.5 °C at 21:00 and 9.7 °C at midnight, and
bottoms out at 7.7 °C at 07:43; under a full overcast it is 14.0 °C at 21:00.

### Rain or snow

`snowShare` is the share of precipitation that falls as snow: all of it at or below 0.5 °C, none at
or above 1.5 °C, half at 1.0 °C, where Jennings et al. (2018) find the rain–snow threshold of the
Northern Hemisphere's air temperature on average. The rule reads the temperature only, as the
simulation keeps no humidity. `freezingLevel` is the height where the air is at 1.0 °C, half snow,
found by bisection between −1000 and 5000 m.

### More precipitation higher up

Precipitation is set on the valley floor (250 m) and grows with height as `orographic(z)`: 0.95 more
per km, the least-squares line through the ISPRA SCIA 1991–2020 annual totals of the 11 gauges at
141–1020 m in Lunigiana, the Serchio valley and the Apuan Alps (from Pontremoli depuratore, 1654 mm
at 290 m, to Campagrina, 2982 mm at 1020 m), so ×1.75 at 1040 m. It is held at ×2.3 from about
1620 m up, a design value, as no gauge stands on the crests. Over 16 simulated years the regimes
drop 1643 mm a year on the valley floor, against Pontremoli depuratore's 1654 mm. Month by month the
match is loose and not asserted: 176 mm in April and 170 in May, next to October's 193 and
November's 191, and 60 in August.

## Regimes

The weather moves through nine regimes (`REGIME_SPECS`, `src/sim/sky/regimes.ts`): each holds the
targets the `Weather` resource eases toward, how long it lasts and what may follow it, with a label
and a description for the menus. The targets are design values, calibrated against the climate
([Calibration](#calibration)).

| Regime | Label | Cloud | Precipitation at 250 m (mm/h) | Storm | Wind (m/s) | Air moves toward | Gust factor | Fog | Anomaly (°C) | Lasts (game h) |
|---|---|---|---|---|---|---|---|---|---|---|
| `clear` | Clear | 0.05 | 0 | 0 | 1.5 | the valley breeze | 1.4 | 0 | +0.5 | 3–6 |
| `fair` | Fair | 0.3 | 0 | 0 | 2.5 | the valley breeze | 1.5 | 0 | +0.3 | 2–5 |
| `cloudy` | Cloudy | 0.65 | 0 | 0 | 3 | north-east | 1.5 | 0 | 0 | 2–5 |
| `overcast` | Overcast | 0.95 | 0.03 | 0 | 2.5 | north-east | 1.4 | 0.15 | 0 | 2–6 |
| `fog` | Fog | 0.9 | 0 | 0 | 0.6 | the valley breeze | 1.3 | 0.9 | −0.5 | 1.5–4 |
| `rain` | Rain | 1 | 3 | 0 | 5 | north-east | 1.7 | 0.3 | +1 | 2–6 |
| `storm` | Thunderstorm | 1 | 5 | 1 | 6 | north-east | 2.3 | 0.2 | −1 | 1.5–3 |
| `windy` | Tramontana | 0.2 | 0 | 0 | 8 | south-west | 1.8 | 0 | −3 | 2–6 |
| `snow` | Snow | 1 | 1.5 | 0 | 4 | south-west | 1.6 | 0.4 | −3.5 | 2–6 |

- **Wind**: the valley's wind at 10 m. Toward the north-east is the Libeccio's south-westerly off
  the sea, which brings the rain; toward the south-west the dry Tramontana from the north-east. The
  breeze blows up the Lucido's valley while the sun is up and down it at night, along its axis from
  Equi Terme north-west to Gragnola (`DOWN_VALLEY`, 2.5 rad counter-clockwise from east).
- **Precipitation** is the valley floor's; `orographic` scales it with height. Overcast's 0.03 mm/h
  is a drizzle that slowly wets the roads ([The ground](#the-ground-wetness-snow-and-meltwater)).
- **Snow** is a cold front: steady precipitation under a −3.5 °C anomaly. Settled on 15 January at
  noon it brings the snow line down to 576 m; on 22 October the freezing level stays at 2081 m and
  on 15 July at 3509 m, above the map's highest ground (1799 m), so it falls as a cold rain
  everywhere.

### Changes and easing

The regime changes as a Markov chain, and the weather eases toward each new regime's targets over
game time, so a front builds on screen rather than snapping.

- **The next regime.** When a regime's time runs out (drawn evenly between its hours, in game time),
  the next is drawn from the month's odds (`SEASONS[month].odds`, `climate.ts`) times the weights of
  the regimes that may follow it (`next`). A fog regime is drawn a tenth as readily while the sun is
  up, as radiation fog forms in the night. A regime may follow itself, which keeps weather spells
  going.

  | From | May be followed by (weight) |
  |---|---|
  | `clear` | clear 3, fair 3, fog 1.5, windy 1 |
  | `fair` | clear 2, fair 3, cloudy 3, storm 1.5, windy 1, fog 0.5 |
  | `cloudy` | fair 2, cloudy 3, overcast 3, rain 1, storm 1 |
  | `overcast` | cloudy 2, overcast 3, rain 3, snow 2, fog 1 |
  | `fog` | clear 2, fair 2, cloudy 1, overcast 1, fog 2 |
  | `rain` | overcast 2, rain 4, storm 1, cloudy 1, snow 1, windy 1 |
  | `storm` | rain 2, cloudy 2, fair 1, overcast 1, storm 1 |
  | `windy` | clear 3, fair 2, windy 2, cloudy 1 |
  | `snow` | overcast 2, snow 3, windy 1, cloudy 1 |

- **Easing.** Every value eases toward the regime's target with a time constant in game time
  (`EASE`, `weather.ts`): cloud 30 min, precipitation 20 min, thunderstorm activity 15 min, wind
  (speed, direction the short way round, gusts) 20 min, fog 30 min, anomaly 2 h. At the normal clock
  30 game minutes are 30 real seconds. Precipitation and storms start only once the cloud passes 0.7
  (`RAINS_FROM`), so the rain waits for the sky to thicken.
- **A new game** starts clear and calm, at the clear regime's targets with no anomaly, on dry ground
  under the month's snow line, with no storm near and 90 game minutes before the first draw, so the
  first stretch of play (and the first frames of every scenario test) is calm.
- **Forcing.** `SetWeather { regime, settle? }` from the dev menu (`setWeather`, `weather.ts`)
  forces a regime: no draws while it is forced. With `settle` every value jumps to the regime's
  targets, the ground to the wetness it would settle at, and where it snows the snow line down to
  the freezing level. `regime: null` hands the weather back to chance; an unknown regime is dropped.

### Each month's odds, fog chance and starting snow line

`SEASONS` holds, for each month, the regime odds (fitted by the calibration below), the chance that
a clear, calm morning brings valley fog, and the snow line a new game starts with (design values):

| Month | Jan | Feb | Mar | Apr | May | Jun | Jul | Aug | Sep | Oct | Nov | Dec |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Valley-fog chance | 0.57 | 0.41 | 0.27 | 0.18 | 0.06 | 0.06 | 0.02 | 0.04 | 0.14 | 0.34 | 0.6 | 0.86 |
| Starting snow line (m) | 1300 | 1300 | 1500 | 1700 | none | none | none | none | none | none | 1700 | 1500 |

## Calibration

`climate.test.ts` runs the regime chain for 16 simulated years at 900 s steps (seed 1, about 1.4 s)
and checks every month against the climate on the valley floor (250 m):

- **Wet days** (at least 1 mm), within ±3: ISPRA SCIA's 1991–2020 normals on the valley floors
  either side of the map, the mean of Pontremoli depuratore (290 m, the Magra) and Gallicano (194 m,
  the Serchio).
- **Thunder days**, within ±1.5 a month and 40 ± 4 a year: 40 a year is a design value, the user's
  choice, as no licensed source counts thunder days here and the Aeronautica Militare's normals give
  none. The months share it as the Aeronautica Militare's share of observations with cumulonimbus at
  Sarzana-Luni (09–18 UTC, 1973–2000: winter 1.31 %, spring 3.52 %, summer 5.20 %, autumn 4.26 %),
  placed at January, April, July and October and straight between: a summer peak over land and a
  long autumn, the seasons Morgenstern et al. (2023) find over Italy.
- **Valley-fog mornings**, within ±2: design estimates between Sarzana-Luni's 5 and Pisa's 56 fog
  days a year (Aeronautica Militare, 1971–2000), most from October to February, when Regione
  Toscana's landscape plan notes the Val di Magra's frequent fog.
- **Relative sunshine** (sun hours over the day's length), within ±0.06: Pisa San Giusto
  (Aeronautica Militare, 1961–1990).

| Month | Wet days, target / model | Thunder days | Fog mornings | Sunshine |
|---|---|---|---|---|
| January | 9.3 / 9.0 | 1.22 / 0.62 | 6 / 5.9 | 0.37 / 0.374 |
| February | 8.65 / 8.2 | 1.91 / 1.94 | 4 / 5.0 | 0.41 / 0.411 |
| March | 8.25 / 10.9 | 2.60 / 2.63 | 3 / 2.8 | 0.42 / 0.404 |
| April | 10.15 / 10.6 | 3.28 / 2.75 | 2 / 2.1 | 0.48 / 0.478 |
| May | 8.85 / 9.4 | 3.81 / 3.75 | 1 / 0.4 | 0.53 / 0.504 |
| June | 6.65 / 7.1 | 4.33 / 3.88 | 1 / 0.8 | 0.57 / 0.571 |
| July | 4.75 / 5.1 | 4.85 / 5.00 | 0.5 / 0.4 | 0.67 / 0.677 |
| August | 5.15 / 4.8 | 4.56 / 4.25 | 1 / 0.8 | 0.64 / 0.650 |
| September | 7.95 / 8.0 | 4.27 / 4.19 | 3 / 2.8 | 0.59 / 0.596 |
| October | 10.65 / 10.9 | 3.97 / 4.06 | 6 / 5.9 | 0.52 / 0.497 |
| November | 12.25 / 12.3 | 3.06 / 2.63 | 7 / 6.5 | 0.39 / 0.381 |
| December | 10.9 / 9.7 | 2.14 / 2.31 | 7 / 7.4 | 0.34 / 0.337 |

The model gives 38.0 thunder days a year. The thinnest margin is March's wet days, 2.7 of the 3
allowed. The snow checks, with what the run gives:

- **Snowfall days** (at least 1 mm of water, about 1 cm of fresh snow) from November to April, held
  within half either way of Capozzi et al.'s (2025) central and southern Apennine stations, as the
  Apuan Alps are wetter and milder: 8.7 at 879 m (target 11.2 ± 1.9) and 27.5 at 1220 m (target 20.0
  ± 5.4, cap 30, the other thin margin).
- **Snow-cover days** a year: 45 at 1100 m (asserted 25–70; Capozzi et al. measure 35–60 at
  1000–1300 m) and 122 at 1750 m (asserted 90–170 around a design estimate of 120–150).
- **January at 1040 m**: snow on 0.55 of the wet days, held only within 0.2–0.6, as the January
  normal there (0.5 °C) sits beside the phase rule's half point; it is not fitted. March gives 0.04.
- **Never in summer**: no snow at 150 m from June to September, and no snowy day at 1040 m from May
  to October (asserted).

How the months share their time between the regimes in the same run:

| Regime | January | April | July | October | December |
|---|---|---|---|---|---|
| clear | 0.10 | 0.17 | 0.36 | 0.22 | 0.10 |
| fair | 0.15 | 0.29 | 0.34 | 0.26 | 0.12 |
| cloudy | 0.39 | 0.29 | 0.24 | 0.24 | 0.39 |
| overcast | 0.24 | 0.15 | 0.03 | 0.13 | 0.26 |
| fog | 0.04 | 0.004 | 0.001 | 0.02 | 0.04 |
| rain | 0.04 | 0.07 | 0.001 | 0.06 | 0.05 |
| storm | 0.002 | 0.009 | 0.02 | 0.01 | 0.008 |
| windy | 0.03 | 0.03 | 0.01 | 0.05 | 0.02 |
| snow | 0.008 | 0.002 | 0 | 0.001 | 0.01 |

## The climate sources record

Each source considered for the climate model, with what it gives and why it was taken or left,
following the licence rules in [the map standards](standards/map.md#data-sources-and-requests). The
README and both credit lines of `index.html` credit the accepted data sources.

| Source | Used for | Licence or terms | Verdict |
|---|---|---|---|
| ISPRA SCIA climate normals (<http://valori-climatici-normali.isprambiente.it/>) | temperature at Pontremoli depuratore and the warming between periods, Monte Cimone's maximum, the 11 gauges of the orographic line, the wet days at Pontremoli depuratore and Gallicano | CC BY 4.0 (<https://www.isprambiente.gov.it/it/note-legali>) | accepted, credited |
| Aeronautica Militare, *Atlante Climatico d'Italia* 1961–1990 and 1971–2000: Passo della Cisa, Monte Cimone, Sarzana-Luni, Pisa San Giusto (terms: <https://www.meteoam.it/it/condizioni-utilizzo>) | Cisa's temperature, Cimone's minimum, Sarzana-Luni's cumulonimbus shares (the thunder days' months), fog days at Sarzana-Luni and Pisa, Pisa's sunshine, the wind classes at Cisa and Sarzana-Luni | free use with a mandatory credit line: "Informazioni elaborate utilizzando, tra l'altro, dati e prodotti del Servizio Meteorologico dell'Aeronautica Militare pubblicati sul sito www.meteoam.it" | accepted by the user, credited verbatim. The sheets were read from web-archive copies: `clima.meteoam.it` times out, and meteoam.it no longer hosts the atlas |
| Jennings, Winchell, Livneh & Molotch (2018), *Nat. Commun.* 9:1148 (<https://doi.org/10.1038/s41467-018-03629-7>) | the rain–snow threshold of 1.0 °C | CC BY 4.0 | accepted, cited (a method) |
| Capozzi et al. (2025), *The Cryosphere* 19:565 (<https://tc.copernicus.org/articles/19/565/2025/>) | snowfall days and snow-cover days with height | CC BY 4.0 | accepted, cited (calibration targets) |
| Morgenstern, Stucke, Mayr, Zeileis & Simon (2023), *Weather Clim. Dynam.* 4:489 (<https://wcd.copernicus.org/articles/4/489/2023/>) | the thunderstorm seasons over Italy | CC BY 4.0 | accepted, cited |
| Felber, Stoeckli & Calanca (2017), *Int. J. Biometeorol.* 62:621 | the night's decay, b = 3.14 | CC BY 4.0 | accepted, cited (a method) |
| Parton & Logan (1981), *Agric. Meteorol.* 23:205 | the day's temperature curve | a published method | cited |
| Piccini et al. (1999), Apuan precipitation by station and height, in Piccini's guide to the Apuan Alps | background on the massif's rainfall | no licence (all rights reserved) | facts only: nothing of it ships; the orographic line comes from SCIA alone |
| Regione Toscana, landscape plan *Ambito 01 Lunigiana* | the Val di Magra's frequent fog | site content for personal use | facts only: the fog mornings' October–February skew |
| NOAA NCEI Global Surface Summary of the Day (GSOD) | thunder days, snow shares and the wind's growth with height were measured from it in research | no named licence; its non-US records are the Aeronautica Militare's stations through the WMO exchange, and NCEI has flagged non-US GSOD data for limits on commercial use | rejected by the user: none of its numbers ship |
| ERA5 through Open-Meteo | the prevailing wind direction | CC BY 4.0 | not used: against the stations it gave 0.72 relative sunshine in January (Pisa 0.37), about 142 wet days a year (about 100), no thunder or fog at all, and valley minima 2–3 °C too warm; the regimes' flows (Libeccio, Tramontana, the valley breeze) give the direction, so no Open-Meteo or Copernicus credit is needed |
| Servizio Idrologico Regionale Toscana (SIR) gauges | local rain gauges in the valley | CC BY-SA 4.0 | not used: share-alike; SCIA's normals, which take in SIR's stations, are cited instead |
| Giannecchini (2006), *NHESS* 6:357 | Apuan rainfall over 3000 mm a year | CC BY-NC-SA 2.5 | rejected: non-commercial |
| it.wikipedia station pages | an index to the SCIA and Aeronautica Militare tables | CC BY-SA 4.0 | not a source: they hold copy errors (Sarzana-Luni's 1971–2000 precipitation row repeats Pisa's), so every number was read from the primary source; La Spezia's table, whose source link is dead, was dropped |

The sun and moon are checked against JPL Horizons and the USNO API, reference values the tests hold;
the NOAA Solar Calculator is an algorithm, not data.

## The ground: wetness, snow and meltwater

The `Weather` resource keeps two ground values for the whole map, `wet` and `snowLine`, and
`groundAt` (`src/sim/sky/local.ts`) turns them into what a wheel or a foot meets at a point: how wet
and how snow-covered the ground is there, each 0 to 1.

- **Wetting.** Rain reaching the ground wets it with a time constant of 10 game minutes from 2 mm/h,
  proportionally slower in less (`WETTING`, `PRECIP_FULL`): settled rain on dry ground gives 0.63
  after 10 game minutes and 0.95 after 30. One value serves the whole map, because a regime's rain
  falls on all of it.
- **Drying.** The time constant runs from 6 game hours (cold, grey, calm) down to 2 (warm, sunny,
  windy): 6 h ÷ (1 + 0.08 × the valley's °C + the sun's share + 0.15 × the wind in m/s), the sun's
  share being (1 − cloud) × the sun's elevation over 30°, at most 1. After rain, a clear October
  noon leaves 0.61, 0.37 and 0.22 after one, two and three game hours (the fastest, 2 h); a clear
  January night 0.78, 0.61 and 0.48 (about 4 h). Nothing dries while 0.05 mm/h or more falls
  (`DRIZZLE`), less while it drizzles.
- **Drizzle.** Where wetting and drying balance the ground settles: overcast's 0.03 mm/h damps dry
  roads to 0.08 after a game hour and 0.27–0.30 after six, toward a balance of 0.37 (22 October,
  08:00) to 0.41 (15 January, noon).
- **The snow line** is the lowest ground with snow cover (`NO_SNOW`, 3000 m, when none lies). While
  more than drizzle falls and the freezing level lies under the line, snow settles from the map's
  top (1799 m) down toward the freezing level at 150 m per game hour for each mm/h, × `orographic`
  at the line (`SNOWING`). Otherwise it rises by a degree-day melt of 2.5 m per game hour for each
  °C above 0 at the line, twice that under rain (`MELTING`), and once above the map's top no snow is
  left. It never falls below the map's lowest ground less 50 m (97 m), so all the map can lie white.
  The rates are design values fitted to Capozzi et al.'s snow-cover days
  ([Calibration](#calibration)).
- **The ragged edge.** Snow covers ground above the line's edge, fading in over ±10 m of height
  (`FEATHER`). The edge wanders by two octaves of value noise, ±45 m over 80 m cells plus ±15 m over
  20 m cells (`EDGE`), locked to the world and the same every game. Its lattice hash uses only
  32-bit integer arithmetic, so the renderer's shader draws the same edge (within 2 mm on the GPU)
  and the white line on screen is where the grip drops.
- **Meltwater.** Below the edge, a band 100 m deep (`MELT_BAND`) runs wet with meltwater where the
  air at that height is above 0 °C, fully from 1 °C (`MELT_FULL`), wetter toward the snow. Snowmelt
  wets only that band, never the map's `wet` (the lead's call): sunny valley roads 1000 m under the
  snow stay dry. On a clear 15 January from a 1300 m snow line, the map's `wet` stays 0 all day; the
  band wets 8 % of the map's 21,776 road vertices from 11:00 (the line at 0.6 °C), the lowest at
  1162 m, while the line climbs to 1332 m by 18:00. In a frost the band stays dry.
- **Where it falls short.** One wetness and one snow line serve the whole map, so tunnels and
  bridges get wet and white too.

`conditionsAt(t, weather, x, y, z)` gathers it all for one point: the air's temperature, the rain
and the snow falling (mm/h of water, the valley's precipitation × `orographic(z)` split by
`snowShare`), the ground's wetness and snow cover, and the fog.

## Fog

`fogLayers` gives two layers over the map, the valley fog up to `valleyTop` at `valleyDensity` and
the cloud down to `cloudBase` at `cloudDensity`; `fogAt(z)` blends each in over 50 m of height.

- **Radiation fog** fills the valleys below 400 m on clear (cloud under 0.25, gone by 0.55), calm
  (wind under 2 m/s, gone by 3.5) mornings, on the month's share of days (`valleyFog`, above): it
  forms from 01:00, is thickest from 05:00 and burns off from 09:00 to 11:00. Which days bring it is
  a hash of the Rome calendar day, so a date always has the same chance. On 4 October 2026, clear
  and calm, it stands 273 m high at density 0.16 at 02:00, 400 m at 1 from 05:00 to 09:00, 0.5 at
  10:00, and is gone at 11:00.
- **The fog regime** is a low stratus: the valley fog reaches 250 + 450 × fog m, 655 m at its 0.9.
- **The cloud base**: 2650 m − 1500 × cloud + 250 × storm − 700 × the regime's mist, the mist being
  `smooth(0.3, 0.9, fog)`. Inside the cloud the fog reaches 0.6 of full thickness under a full
  cover, all of it only in the fog regime's mist. These design values keep most valley and village
  roads out of the cloud in rain and in a storm, and the crests (1700–1800 m) in it under any full
  cover. Settled on 15 January, over the map's 21,776 road vertices (more than 25 m into the cloud):

  | Regime | Cloud base (m) | Density | Roads in the cloud |
  |---|---|---|---|
  | clear | 2575 | 0 | 0 % |
  | fair | 2200 | 0 | 0 % |
  | cloudy | 1675 | 0.19 | 0.2 % |
  | overcast | 1225 | 0.60 | 13.0 % |
  | fog | 600 | 1.00 | 52.6 % |
  | rain | 1150 | 0.60 | 18.8 % |
  | storm | 1400 | 0.60 | 3.5 % |
  | windy | 2350 | 0 | 0 % |
  | snow | 1098 | 0.63 | 23.3 % |

## Wind

`Weather` holds the valley's wind at 10 m (`wind`, m/s), the way the air moves (`windAngle`, rad
counter-clockwise from east) and the gust factor (`gust`, peak over mean). `windAt(weather, z)`
gives the air's velocity at a height, stronger on exposed ground: ×1 at 250 m, rising in a straight
line to ×2.5 on the 1800 m crests, ×1.76 at 1040 m. That is a design value a little under the
Aeronautica Militare's own pair (*Atlante Climatico* 1971–2000, wind classes of 1–10, 11–20 and over
20 knots taken at 5.5, 15.5 and 25 knots): about 6.1 m/s at Passo della Cisa (1048 m) against
3.0 m/s at Sarzana-Luni on the coast, ×1.9–2.1 as the top class is taken at 22.5–30 knots. Text for
people (the dev menu) names where the wind blows from, the opposite of `windAngle`.

## Lightning and the storm cell

A thunderstorm is a cell drifting over the map that throws lightning around itself, in real time:
`stormStep` (`weather.ts`) runs every step whatever the clock's rate, so a stopped clock still
storms.

- **No storm** under an activity of 0.01: no lightning, and the cell is sent 100 km off, so the next
  storm starts upwind again.
- **The cell** starts 6 km upwind of the player, up to 1 km to either side, and drifts downwind at
  90 m per real second: it comes closer, passes overhead and moves away within about 2.2 real
  minutes (12 km), and a new cell starts upwind once it is 6 km past the player or 9 km off while
  the storm lasts (1.5–3 game hours, 90–180 real seconds at the normal clock).
- **Flashes** come at random, storm × 0.25 a real second (a draw each step). 40 % of them are ground
  strikes (`bolt`); the rest flash in the cloud and keep their place, on the map or off it. Flashes
  scatter around the cell (Gaussian, σ 2 km); a bolt drawn off the map is drawn again up to 4 times,
  then dropped, so bolts strike only the map and never its edge. With the cell within 4 km of the
  player, a quarter of the bolts strike in the strip the camera sees, up to 40 m to either side of
  the player and 60–600 m toward the camera, where a vertical bolt crosses the whole screen.
- **Measured**, a settled storm, 8 seeds × 3 real minutes at each spot: Gragnola 321 flashes, 105 of
  them bolts (33 %); Monzone 343 and 127 (37 %); Equi Terme 345 and 131 (38 %), so 0.22–0.24 flashes
  a real second once the bolts off the map are dropped. Near the map's edge more of the cloud
  flashes lie off the map: 78 % at Gragnola, 50 % at Monzone, 29 % at Equi.
- **The event.** Each flash is a `Lightning` event: where, whether it is a bolt, its `power`
  (0.3–1), a `seed` for the bolt's shape and the thunder, and the step. The renderer draws it
  ([What it looks like](#what-it-looks-like)) and the audio thunders it
  ([How it sounds](#how-it-sounds)). It needs a player: without one the cell stands still and
  nothing flashes.
- Every draw (regimes, the cell, lightning) comes from `WeatherRng`, the weather's own saved random
  stream, so the weather never changes traffic, pedestrians or parking.

## Grip

Wet ground and snow cover take grip from the tyres, in the saved simulation, and the handling's
`weatherGrip` knob scales how much. The tables are in [gameplay.md](gameplay.md#the-body).

- **Per wheel.** `VehiclePhysics` asks `groundAt` for the wet and the snow at each wheel's contact,
  with the air worked out once a step (`airAt`) for the meltwater. Each surface's grip goes from dry
  toward its wet grip by the wetness, then toward packed snow (peak 0.3) by the snow cover, the
  difference from dry × `weatherGrip` (`weathered`, `src/sim/tyres.ts`).
- **What it costs.** At 1 (Simulation) a wet road keeps 0.72 of its dry peak and packed snow 0.27: a
  Panda braking from 50 km/h stops in 10.8 m dry, 14.2 m wet and 33.2 m on snow. Balanced takes 0.6
  of the loss, Arcade 0.3, and 0 drives as on a dry day.
- **Steering.** The lock at speed shrinks with the grip the wheels have left, so a held key on snow
  does not ask the tyres for more than they hold; braking, the handbrake or more speed in a bend
  still slide the car. The user approved this.
- **Traffic** drives slower by the square root of the grip left and looks and keeps further ahead
  ([gameplay.md](gameplay.md#traffic-ai)). People on foot are not slowed.
- **`Skid`** carries `snow`, the snow cover at that wheel, so the renderer lays slush ruts and white
  spray on snow.

## The HUD and the dev menu

The HUD shows the time and the weather where the player stands; the dev-only debug menu sets them.
The layout and the store are in [architecture.md](architecture.md#hud).

- **The clock**: Rome's wall-clock time as a 24-hour "HH:MM", the minutes cut as a clock cuts them
  (`clockText`, `src/hud/clock.ts`), top centre, or under the score on screens 600 px wide or less.
- **The readout**: a word and the air's temperature where the player stands, "Rain · 9 °C"
  (`weatherText`): `conditionsAt` at the player's ground height, rounded to the whole degree, and
  the word from `describeWeather` (`src/sim/sky/readout.ts`), what a person standing there sees
  rather than the regime the weather moves toward. It takes the first that applies:
  1. Storm: storm activity 0.3 or more and 0.5 mm/h or more falling.
  2. Snow, Sleet or Rain, from 0.2 mm/h falling: Snow when 70 % of it or more is snow, Sleet over
     30 %, else Rain.
  3. Fog: fog 0.5 or more around the player.
  4. Drizzle (Snow when it is snow), from 0.02 mm/h.
  5. Windy: a valley wind of 7 m/s or more.
  6. The cover: Clear under 0.2, Fair under 0.5, Cloudy under 0.85, else Overcast.

  On `DEFAULT_START`'s 22 October a new game at the spawn reads "08:00" and "Clear · 9 °C" (8.5 °C).
  The words are English (`lang="en"`), and the readout is no live region, so screen readers are not
  told every minute.
- **The debug menu** (P, dev builds) has a Time and a Weather area above the handling. Time: the
  rate (Stopped, Normal at 1 min/s, ×10, ×60 game seconds a step), the time of day, the date, and
  sunrise and sunset buttons from `sunTimes`. Weather: Auto (left to chance) and one button per
  regime, "Settle now" (in Auto it settles the regime the weather is moving toward and leaves it to
  chance), and readouts of the sun, the moon, the regime, the air, the ground, the snow line, the
  wind and the sky. The time and the weather set there are not kept across loads (the handling knobs
  are). In dev, `gta.sky` is the same store, for scripts.

## What it looks like

The renderer reads the clock, the weather and the lightning each frame and draws them with the same
sim functions; how the sky host, the materials and the post pass fit in the frame is in
[architecture.md](architecture.md#rendering), the settled look it keeps in
[render.md](standards/render.md).

- **Light.** One key light, the sun, or the moon once the sun is under −4° (fully by −8°, × its lit
  fraction^1.5), so the number of lights and every shader stay the same (`src/render/sky/light.ts`).
  A clear sky with the sun 50.4° up gives exactly the game's settled daytime look; a lower sun is
  redder and weaker, and the sky's light follows the sun's elevation from noon through the golden
  hour, the blue hour and the night. Shadows are cast from at least 20° up (a lower light breaks a
  shadow's edge into dashes on walls), and the light's aim moves in 0.75° steps, every 3–4 real
  seconds, so shadow edges do not crawl.
- **Night** stays readable: the exposure adapts part of the way, from 1 to at most 4, and dark
  texels move toward a scotopic blue (from the sun 3° up to 9° under), while lamps, lit windows and
  what they light keep their colour.
- **Weather.** An overcast sky dims and greys the light and casts no shadows; rain greys and dims it
  further, a thunderstorm darkens it more and turns the lamps on. Clouds cast shadows straight down,
  locked to the world and drifting at 2.5 × the wind; the shaded share of the ground equals the
  cloud cover, so a cloudy sky keeps sunny gaps. At night the weather dims the sky's light only 0.15
  as much, as low cloud glows with the valley's lights.
- **Fog** is drawn in the post pass from `fogLayers`, at most 0.6 at the focus (the player and the
  road stay readable) up to 0.92 for ground 400 m deeper, and thinner around the player. From a
  slope the valley fog reads as a white sea; it is lit mostly by the sky, so it turns warm only with
  the sun low (blue/red 0.70 with the sun 6° up, 0.92 at 10.7°). Rain and snow add a haze.
- **The ground.** Snow lies above the sim's ragged edge on faces flatter than the bare-rock cliffs,
  in a clumpy, world-locked stipple, with roads keeping 0.6 of it. Wet ground darkens (up to 0.4 of
  its albedo, walls less), flat roads gather puddles (about 11 % of them fully wet) that mirror the
  sky, and rain rings the rivers. Wetness and meltwater follow `groundAt`. Trees sway by whole
  texels from 2 m/s of wind, at most 0.12 m.
- **Rain and snow** fall as 1-texel streaks and 1–2-texel flakes over the whole view, slanted by the
  wind: 0.6 streaks per m² of the view at 10 mm/h, growing as the rate^0.6, and 0.7 flakes at 1 mm/h
  of water, as the rate^0.5, up to 12,288 streaks and 16,384 flakes; rain falls at 8 m/s and snow at
  1 m/s.
- **Night lights.** The lamps come on as the light falls from 0.125 to 0.08 of the settled noon's,
  about ten minutes after sunset, and in storms and thick fog. A home's windows are half lit, by a
  hash per window (21,201 panes over the map); sheds, garages and barns keep their shutters closed,
  and the panes are not drawn by day, so the daytime look is unchanged. 492 street lamps hang as
  lanterns on house walls, as in the villages here, where no lamp data exists: along tertiary,
  unclassified, residential and service roads among at least 4 buildings within 40 m, every 28 m or
  more and at least 18 m apart, 4.5 m up (lower under low eaves, never under 3 m), between two
  windows. Traffic and the player's car light their lamps, parked cars stay dark; 4 headlight beams
  (the player's car and the 3 nearest traffic cars) and 8 lamp pools (the nearest street lamps)
  light the ground, fading over 0.35 s as they move between cars and lamps.
- **Lightning.** A bolt is a jagged, seeded channel with branches that flickers in 2–4 strokes
  30–120 ms apart. The scene flashes once per flash, a smooth pulse (a 50 ms rise, then a 0.25 s
  decay), fainter with distance and at 0.6 for a flash in the cloud; the strokes move it by ±5 % at
  most, and a new pulse needs 0.4 s since the last (2.5 a second, under WCAG 2.3.1's three). Under
  `prefers-reduced-motion` the bolt does not flicker and the flash is halved. At night a near flash
  lights the scene to about daylight for a quarter of a second.

## How it sounds

The audio director reads the clock, the weather at the ears and the lightning; the sounds and their
levels are in [audio.md](audio.md).

- **Rain** is a bed outside from 0.1 mm/h, louder as it falls harder; inside a car it is the bed
  through the cabin plus the drumming on the roof.
- **Thunder** waits until its sound reaches the ears, at 340.4 m/s: a crack and a boom near, a low
  rumble far. At most two roll at once.
- **Wind** blows as much harder as the weather's wind (tuned on 3 m/s), in its gusts.
- **Birds** sing by the sun, a dawn chorus before sunrise and a last round at dusk, and fall quiet
  in rain; the tawny owl calls once it is dark. **Crickets** sing where the air at the ears is 10 °C
  or warmer and dry.
- **Bells** strike the game clock's hours, hours only, from 07:00 to 21:00: silent from 22:00 to
  07:00, as Tuscany's parishes keep the night.
- **Snow** hushes the valley, and steps crunch on it.
- **The night** is quieter: the stillest background falls from 35 dB(A) by day to 28 at night.

## Tuning

Where each part of the weather is set:

| Where | What |
|---|---|
| `src/sim/sky/climate.ts` | `CLIMATE` (monthly normals with height), `SEASONS` (regime odds, valley-fog chance, starting snow line), `WARMEST`, `NIGHT_DECAY`, `rangeShare`, `snowShare`, `orographic` |
| `src/sim/sky/regimes.ts` | `REGIME_SPECS`: each regime's targets, duration and neighbours |
| `src/sim/sky/weather.ts` | `EASE`, `RAINS_FROM`, `FOG_BY_DAY`, `DOWN_VALLEY`; wetting and drying (`WETTING`, `PRECIP_FULL`, `DRYING`, `DRIZZLE`); the snow line (`SNOWING`, `MELTING`); the storm (`UPWIND`, `DRIFT`, `FLASHES`, `BOLTS`, `SCATTER`, `OVERHEAD`, `IN_VIEW`, `STRIP`, `REDRAWS`) |
| `src/sim/sky/local.ts` | the snow edge (`EDGE`, `FEATHER`), the meltwater band (`MELT_BAND`, `MELT_FULL`), the fog (`BASE`, `CLOUD_FOG`), the wind's growth with height (`WIND_UP`) |
| `src/sim/sky/readout.ts` | the readout's thresholds |
| `src/sim/tyres.ts`, `src/sim/handling.ts` | wet and snow grip (`WET`, `SNOW`), the `weatherGrip` knob and its presets |
| `src/render/sky/` | the look: `light.ts` (dimming, lamps, night), `post.ts` (fog, grades), `surface.ts` (snow, wet, clouds, sway), `precipitation.ts`, `lightning.ts`, `lamps.ts`, `night-lights.ts` |
| `src/audio/director/sky.ts` | how the time of day and the weather move the sounds |

## Tests

The simulation's weather tests run in about 1.4 s:

```sh
node --test src/sim/sky/*.test.ts src/sim/sky.test.ts
```

- `calendar.test.ts` and `astro.test.ts`: the calendar, Rome's summer time, and the sun and moon
  against JPL Horizons and USNO.
- `climate.test.ts`: the normals against the stations, the day's cycle, the phase rule and the
  16-year calibration.
- `weather.test.ts`: the requests, easing, wetting and drying, drizzle, the snow line and meltwater,
  fog, wind, the storm cell and lightning, and the readout.
- `mapfree.test.ts`: the modules the schema and the HUD import decode no map.
- `src/sim/sky.test.ts`: the clock and the weather in a runtime, requests applied before the first
  update, a forced storm's lightning, `WeatherRng` kept apart from `Rng`, and a longer braking
  distance in the rain.
- Elsewhere: `handling.test.ts` (wet and snow braking, the lock following grip), `walls.test.ts`
  (traffic on a wet road), `index.test.ts` (determinism and saves at rate 600 with a forced storm),
  the render's `src/render/sky/*.test.ts`, the audio's `director/weather.test.ts` and the HUD's
  `clock.test.ts`, `sky.test.ts`, `debug-sky.test.ts` and `title.test.ts`.

`pnpm check` runs them all.

## Known limits

What the model leaves out, or matches only roughly:

- **One wetness and one snow line** for the whole map: tunnels and bridges get wet and white too.
- **Snow mostly comes from the phase rule.** The snow regime holds about 1 % of winter's time; most
  mountain snow falls as rain turning to snow with height, so in Auto the "Snow" label seldom shows.
- **The valley floor hardly ever whitens**: in 16 simulated years (seeds 1–3) the snow line reached
  250 m in one or two spells of at most 5.5 game hours, never at noon, and lay at or under 500 m at
  noon on 1.0–1.4 days a year. March snow at 1040 m is rare (0.04 of its wet days).
- **Monthly precipitation** is matched only loosely (the regimes' intensities do not change by
  month); the annual total is right.
- **Thunder days** are a design value (40 a year): no licensed source counts them here. The model's
  38 a year sits inside its ±4.
- **Capozzi et al.'s stations** are the central and southern Apennines, not the Apuans, hence the
  wide band around their snowfall days.
- **Radiation fog** keys on the calendar day, so the same date always has the same chance.
- **Lightning needs a player**; without one the cell does not move and nothing flashes.
- **The readout's temperature** is at the ground under the player: on a bridge that is the ground
  below, a few metres off.
- **The readout's words are English**, beside the HUD's Italian score labels.
