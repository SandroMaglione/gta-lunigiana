/**
 * Test kit for the sky effects' tests: a calm, clear noon frame each test varies.
 *
 * @module render/sky/testing
 */
import type { SkyFrame } from "./frame.ts"

/** A calm clear noon at sim second 0: no night, lamps off, full daylight, no flash, wind, rain or snow. */
export const NOON: SkyFrame = {
  now: 0,
  night: 0,
  lamps: 0,
  ambient: 1,
  flash: 0,
  wind: { x: 0, y: 0 },
  rain: 0,
  snow: 0,
}
