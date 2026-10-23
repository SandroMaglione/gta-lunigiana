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
} as const satisfies Record<string, number>

/** `#rrggbb` CSS string of a palette (or any sRGB hex) colour. */
export const css = (hex: number): string => `#${hex.toString(16).padStart(6, "0")}`
