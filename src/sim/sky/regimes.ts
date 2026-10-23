/**
 * The weather's closed set of regimes and what each is like: the targets the `Weather` resource eases
 * toward under it, how long it lasts and what may follow it, with a name and a description for the
 * menus. Imports no data, so the schema, the HUD and the audio lab read it without decoding the map.
 *
 * @module regimes
 */

/** The weather regimes, in menu order. */
export const REGIMES = ["clear", "fair", "cloudy", "overcast", "fog", "rain", "storm", "windy", "snow"] as const
/** A weather regime. */
export type Regime = (typeof REGIMES)[number]

/** Where a regime's wind blows: the air moving toward the north-east (a south-westerly, the Libeccio), toward the south-west (the Tramontana), or the valley breeze. */
type Flow = "northeast" | "southwest" | "breeze"

/** One regime: its name and what it is like in the menus, the targets its weather eases toward, how long it lasts and what may follow it. */
export interface RegimeSpec {
  readonly label: string
  readonly description: string
  /** Sky cover, 0…1. */
  readonly cloud: number
  /** Precipitation on the valley floor (250 m), mm/h liquid-equivalent: it starts once the cloud cover passes 0.7. */
  readonly precip: number
  /** Thunderstorm activity, 0…1: how often lightning strikes. */
  readonly storm: number
  /** Wind on the valley floor at 10 m, m/s, where it blows, and its gust factor (peak over mean). */
  readonly wind: number
  readonly flow: Flow
  readonly gust: number
  /** Mist and low cloud, 0…1. */
  readonly fog: number
  /** The air mass's departure from the month's normal temperature, °C. */
  readonly anomaly: number
  /** How long it lasts, game hours: drawn evenly between the two. */
  readonly hours: readonly [number, number]
  /** The regimes that may follow it, and how readily (times the month's odds). */
  readonly next: Partial<Readonly<Record<Regime, number>>>
}

/** Every regime. Wind directions follow the region's flows (Libeccio rain off the sea, the dry Tramontana); the targets are design values calibrated in climate.test.ts. */
export const REGIME_SPECS = {
  clear: {
    label: "Clear", description: "A clear sky and a light breeze, up the valley by day and down it at night: hot afternoons, cold nights, and valley fog on calm autumn and winter mornings.",
    cloud: 0.05, precip: 0, storm: 0, wind: 1.5, flow: "breeze", gust: 1.4, fog: 0, anomaly: 0.5, hours: [3, 6],
    next: { clear: 3, fair: 3, fog: 1.5, windy: 1 }
  },
  fair: {
    label: "Fair", description: "Sunshine between scattered fair-weather clouds and a gentle breeze; in summer the clouds can tower into a thunderstorm.",
    cloud: 0.3, precip: 0, storm: 0, wind: 2.5, flow: "breeze", gust: 1.5, fog: 0, anomaly: 0.3, hours: [2, 5],
    next: { clear: 2, fair: 3, cloudy: 3, storm: 1.5, windy: 1, fog: 0.5 }
  },
  cloudy: {
    label: "Cloudy", description: "Mostly cloudy with sunny spells and a south-westerly breeze off the sea; it can thicken toward rain.",
    cloud: 0.65, precip: 0, storm: 0, wind: 3, flow: "northeast", gust: 1.5, fog: 0, anomaly: 0, hours: [2, 5],
    next: { fair: 2, cloudy: 3, overcast: 3, rain: 1, storm: 1 }
  },
  overcast: {
    label: "Overcast", description: "A grey, low sky that hides the ridges, with spells of light drizzle that slowly wet the roads.",
    cloud: 0.95, precip: 0.03, storm: 0, wind: 2.5, flow: "northeast", gust: 1.4, fog: 0.15, anomaly: 0, hours: [2, 6],
    next: { cloudy: 2, overcast: 3, rain: 3, snow: 2, fog: 1 }
  },
  fog: {
    label: "Fog", description: "Calm, damp air under a low stratus: thick fog in the valleys and cloud on the ridges, until it lifts.",
    cloud: 0.9, precip: 0, storm: 0, wind: 0.6, flow: "breeze", gust: 1.3, fog: 0.9, anomaly: -0.5, hours: [1.5, 4],
    next: { clear: 2, fair: 2, cloudy: 1, overcast: 1, fog: 2 }
  },
  rain: {
    label: "Rain", description: "Steady frontal rain on a mild south-westerly (Libeccio) wind, heavier on the mountains; the roads get wet and slippery.",
    cloud: 1, precip: 3, storm: 0, wind: 5, flow: "northeast", gust: 1.7, fog: 0.3, anomaly: 1, hours: [2, 6],
    next: { overcast: 2, rain: 4, storm: 1, cloudy: 1, snow: 1, windy: 1 }
  },
  storm: {
    label: "Thunderstorm", description: "A thunderstorm cell drifting over the valley: downpours, gusts and lightning, coming closer, passing overhead and moving away.",
    cloud: 1, precip: 5, storm: 1, wind: 6, flow: "northeast", gust: 2.3, fog: 0.2, anomaly: -1, hours: [1.5, 3],
    next: { rain: 2, cloudy: 2, fair: 1, overcast: 1, storm: 1 }
  },
  windy: {
    label: "Tramontana", description: "A dry, gusty north-easterly (Tramontana) with a clear, sharp sky and cold air.",
    cloud: 0.2, precip: 0, storm: 0, wind: 8, flow: "southwest", gust: 1.8, fog: 0, anomaly: -3, hours: [2, 6],
    next: { clear: 3, fair: 2, windy: 2, cloudy: 1 }
  },
  snow: {
    label: "Snow", description: "A cold front: steady precipitation in cold north-easterly air, snow on the ridges and the upper slopes while the valleys get sleet or rain; in summer only a cold rain.",
    cloud: 1, precip: 1.5, storm: 0, wind: 4, flow: "southwest", gust: 1.6, fog: 0.4, anomaly: -3.5, hours: [2, 6],
    next: { overcast: 2, snow: 3, windy: 1, cloudy: 1 }
  }
} as const satisfies Record<Regime, RegimeSpec>

/** Whether `value` names a regime. */
export const isRegime = (value: unknown): value is Regime => typeof value === "string" && (REGIMES as ReadonlyArray<string>).includes(value)
