/**
 * Each animal species' body and gait (the collision circle, the mass, how fast it walks and runs, how far it strays from
 * home, the impact speed that kills it half the time) and its coats: the colours an animal of the species is born with.
 *
 * @module fauna
 */
import type { Random } from "@typeonce/ritmo-math"

import type { AnimalValue, Species } from "./schema.ts"

/** A species' body and gait. */
interface Fauna {
  /** Collision circle radius, m. */
  readonly radius: number
  /** Body mass, kg. */
  readonly mass: number
  /** Walking and running speeds, m/s. */
  readonly walk: number
  readonly run: number
  /** How far from its home (hx, hy) it wanders, m. */
  readonly home: number
  /** Impact speed (m/s) at which a vehicle kills it half the time. */
  readonly lethal: number
}

/**
 * Every species' body and gait. Radii fit the drawn bodies (dog ≈ 0.8 m long, cat 0.45, cow 2.3, pig 1.2). Masses: a
 * medium mixed-breed dog; a domestic cat (3.5–4.5 kg); a Bruna Alpina cow (600–650 kg; the local Pontremolese is
 * 450 kg, ARAER breed sheet); a free-range pig at Italian heavy-pig weight (estimate). Walks: a cow led between pasture
 * and milking parlour 0.92 m/s (55 m/min, Massey University grazing studies; 0–0.63 m/s while foraging); the others
 * estimates. Runs, home ranges and the lethal speeds are TUNED.
 */
export const FAUNA = {
  dog: { radius: 0.3, mass: 25, walk: 1.2, run: 7, home: 20, lethal: 9 },
  cat: { radius: 0.15, mass: 4.5, walk: 0.7, run: 7, home: 12, lethal: 7 },
  cow: { radius: 0.75, mass: 600, walk: 0.9, run: 4, home: 35, lethal: 22 },
  pig: { radius: 0.4, mass: 120, walk: 0.6, run: 4.5, home: 8, lethal: 13 },
} as const satisfies Record<Species, Fauna>

/** A coat: its main colour, its markings' colour (the coat again on a plain coat), and how often it is seen. */
interface Coat {
  readonly coat: number
  readonly patch: number
  readonly weight: number
}

/**
 * Each species' coats (sRGB hex) and their shares, estimates unless noted. Cows: Tuscany's herds are mostly crossbred,
 * Limousine and Chianina beef cows (Univ. of Florence survey of Tuscan cow-calf farms) beside Bruna Alpina and Frisona
 * dairy cows; the Pontremolese, Lunigiana's own breed, is dark wheaten ("fromentino carico") and nearly gone (35 head
 * in 2022, ARAER breed sheet), so it is rare.
 */
const COATS = {
  dog: [
    { coat: 0x1c1a19, patch: 0x1c1a19, weight: 0.2 }, // black
    { coat: 0x5a3a22, patch: 0x5a3a22, weight: 0.15 }, // brown
    { coat: 0xc49a6c, patch: 0xc49a6c, weight: 0.2 }, // tan
    { coat: 0xeee8dc, patch: 0xeee8dc, weight: 0.1 }, // white (a Maremma sheepdog)
    { coat: 0xc49a6c, patch: 0xeee8dc, weight: 0.15 }, // the farm mongrels: tan, black or brown with white
    { coat: 0x1c1a19, patch: 0xeee8dc, weight: 0.12 },
    { coat: 0x5a3a22, patch: 0xeee8dc, weight: 0.08 },
  ],
  cat: [
    { coat: 0x8a857c, patch: 0x4e4a45, weight: 0.35 }, // grey tabby, the commonest street cat: the patch is its stripes
    { coat: 0x1a1918, patch: 0x1a1918, weight: 0.15 }, // black
    { coat: 0x1a1918, patch: 0xf0ebe0, weight: 0.15 }, // black and white
    { coat: 0xd98a3d, patch: 0xa8602a, weight: 0.15 }, // orange, a ginger tabby's darker stripes
    { coat: 0xf0ebe0, patch: 0xf0ebe0, weight: 0.08 }, // white
    { coat: 0xf0ebe0, patch: 0xd98a3d, weight: 0.12 }, // calico: white with orange patches (one patch colour: its black is left out)
  ],
  cow: [
    { coat: 0x8a6a4e, patch: 0xd8c6a8, weight: 0.3 }, // crossbred: brown with a pale belly and face
    { coat: 0xb8682e, patch: 0xb8682e, weight: 0.25 }, // Limousine, red-gold
    { coat: 0xe6e0d4, patch: 0xe6e0d4, weight: 0.12 }, // Chianina, white
    { coat: 0x7a6e64, patch: 0x7a6e64, weight: 0.15 }, // Bruna Alpina, grey-brown
    { coat: 0xf2f0ea, patch: 0x1c1c1c, weight: 0.15 }, // Frisona, black patches on white
    { coat: 0xb88a52, patch: 0xb88a52, weight: 0.03 }, // Pontremolese, dark wheaten
  ],
  pig: [
    { coat: 0xe8b4a0, patch: 0xe8b4a0, weight: 0.7 }, // pink, Large White crosses
    { coat: 0x2b2624, patch: 0x2b2624, weight: 0.1 }, // black
    { coat: 0x2b2624, patch: 0xefe6dc, weight: 0.2 }, // Cinta Senese: black with a white belt
  ],
} as const satisfies Record<Species, ReadonlyArray<Coat>>

/** An animal's size: its species' usual size times a factor in this range (estimate). */
export const SIZE = [0.85, 1.15] as const

/** A random animal of `species`: a coat by its share, a size within ±15 % of the usual. */
export const randomAnimal = (species: Species, random: Random.Random): AnimalValue => {
  const coats: ReadonlyArray<Coat> = COATS[species]
  const { coat, patch } = random.weighted(coats, (c) => c.weight) ?? coats[0]!
  return { species, coat, patch, size: random.range(SIZE[0], SIZE[1]) }
}
