/**
 * The Monzone palette (sRGB hex), hand-tuned from photo medians of the village
 * (.research/monzone-reference.md §2). Every colour the renderer and HUD draw
 * comes from here.
 *
 * @module render/palette
 */
export const PALETTE = {
  outline: 0x17161a,
  cobbleDark: 0x363b38,
  stoneDark: 0x5f5a51,
  stoneMid: 0x8b8170,
  stoneLight: 0xb3a78f,
  limestone: 0xcfccc0,
  marbleWhite: 0xf2efe6,
  plasterGrey: 0xbdbbb6,
  plasterCream: 0xe3d3ad,
  plasterOchre: 0xd4a85e,
  plasterPink: 0xd8a18c,
  roofTileLight: 0xd98f6c,
  roofTile: 0xb0664b,
  woodBrown: 0x4a3222,
  shutterGreen: 0x3d6155,
  grassDry: 0xb4b06a,
  grass: 0x7d9447,
  forestLight: 0x62783f,
  forest: 0x47592f,
  forestDark: 0x2c3d22,
  conifer: 0x1b2c24,
  dirtTrack: 0x8f7a58,
  waterShallow: 0x8db4b0,
  waterDeep: 0x3f6d63,
  asphalt: 0x4b4d50,
  asphaltWorn: 0x74746f,
  carabinieriBlue: 0x1d2b4f,
  signalRed: 0xb8312b,
  signYellow: 0xf0c93c,
  flameOrange: 0xe8762c,
  // Night and weather (render/sky): window glass by day, lit windows, lanterns and their light, headlight beams, rain, snow, lightning.
  windowGlass: 0x323a46,
  windowLit: 0xffc56e,
  windowAmber: 0xf09a4c,
  lanternIron: 0x26241f,
  lampLight: 0xffcf8a,
  headlight: 0xfff1d0,
  rain: 0xb4c2d2,
  snowFlake: 0xf4f6fa,
  bolt: 0xe4e9ff,
  // Sky light (render/sky/light): the sun at 50° (its hue then follows the air mass), the moon, the hemisphere's sky and
  // ground by the sun's elevation (noon ≥ 30°, low sun, golden hour, sunset, blue hour, nautical twilight, night), the grey
  // of an overcast sky, a lightning flash, fog (its albedo, ≈ 0.83 linear: a thick fog reflects most light), slush ruts in snow.
  sun: 0xfff0d8,
  moonlight: 0x9fb4e0,
  skyNoon: 0xdbe8f5,
  groundNoon: 0x9a8a68,
  skyLow: 0xd8dce6,
  groundLow: 0x93795a,
  skyGolden: 0xdcbcaa,
  groundGolden: 0x8a6646,
  skySunset: 0xb49aa6,
  groundSunset: 0x684a40,
  skyBlueHour: 0x5e70a8,
  groundBlueHour: 0x2e3040,
  skyNautical: 0x4a5a8c,
  groundNautical: 0x22222e,
  skyNight: 0x46557f,
  groundNight: 0x1e1e28,
  skyOvercast: 0xa4aab2,
  flash: 0xdfe6ff,
  fog: 0xe8ebee,
  snowRut: 0x4a4640,
  // Snow lying on the ground, roofs and canopies (render/sky/surface): off-white, ≈ 0.72 linear, so a sunlit slope keeps its facets.
  snow: 0xdcdfe6,
} as const satisfies Record<string, number>

/** `#rrggbb` CSS string of a palette (or any sRGB hex) colour. */
export const css = (hex: number): string => `#${hex.toString(16).padStart(6, "0")}`
