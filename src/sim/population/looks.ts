/**
 * What the people out in the Lunigiana villages look like: a look for each age group drawn from the
 * real make-up of the place where there is data (sexes, origins and heights) and from estimates
 * where there is none (hair, hairdos, clothes). Pure: it draws only from the random stream it is
 * given, so the sim stays deterministic.
 *
 * @module population/looks
 */
import type { Random } from "@typeonce/ritmo-math"

import type { Age, Hairdo, Look, Outfit } from "../schema.ts"

/** Entries with how often each comes up (the weights need not sum to 1). */
type Table<A> = readonly [readonly [A, number], ...ReadonlyArray<readonly [A, number]>]
/** Colours (sRGB hex) drawn evenly. */
type Colours = readonly [number, ...ReadonlyArray<number>]

/** One entry of `table`, drawn by weight. */
const draw = <A>(random: Random.Random, table: Table<A>): A => (random.weighted(table, ([, weight]) => weight) ?? table[0])[0]
const pick = (random: Random.Random, colours: Colours): number => random.pick(colours) ?? colours[0]
/** A standard normal draw, approximated by three uniforms (Irwin–Hall): no transcendental maths, and never past ±3 sd. */
const normal = (random: Random.Random): number => (random.next() + random.next() + random.next() - 1.5) * 2

/** A person's age group and sex, which set the rest of their look. */
type Kind = "boy" | "girl" | "man" | "woman" | "elderMan" | "elderWoman"
const kindOf = (age: Age, female: boolean): Kind =>
  age === "kid" ? (female ? "girl" : "boy") : age === "adult" ? (female ? "woman" : "man") : female ? "elderWoman" : "elderMan"

/**
 * Share of girls and women in each age group: Fivizzano's residents on 1 January 2025 (ISTAT, via tuttitalia): 1,453 of its 2,656
 * over-65s are women (women outlive men), 48 % of those aged 15–64; girls at the birth ratio of 105 boys to 100 girls.
 */
export const FEMALE = { kid: 0.49, adult: 0.48, elder: 0.55 } as const satisfies Record<Age, number>

/** Share of elders among grown-ups: Fivizzano's over-65s among its over-15s (2,656 of 6,370; ISTAT, 1 January 2025). */
export const ELDERS = 0.42

/**
 * Share of people with darker skin: 3 % (estimate). Fivizzano's foreign residents are 6.2 % (428 of 6,907; ISTAT, 1 January 2025,
 * via tuttitalia), and 37 % of Massa-Carrara's are African (29 %, mostly Moroccan) or South Asian (Pakistani, Bangladeshi, Indian)
 * (ISTAT, 1 January 2024, via tuttitalia): 2.3 % of the residents, and somewhat more with those who took Italian citizenship. The
 * rest of the foreign residents are mostly Romanian and Albanian, in the local range.
 */
const DARKER = 0.03
/** Skin (sRGB): Italian tones, light to olive (estimate of their mix). */
const LOCAL_SKIN: Table<number> = [[0xf1c8a8, 15], [0xe7b896, 30], [0xd9a57f, 25], [0xc68e6a, 22], [0xb07a56, 8]]
/** Darker tones: North African (half, as Morocco and Egypt are half the African and South Asian residents), South Asian, West African. */
const DARKER_SKIN: Table<number> = [[0xa8704f, 50], [0x8a5a3c, 20], [0x6b4630, 20], [0x4a2f20, 10]]

const BLACK = 0x17161a, DARK_BROWN = 0x2b1d14, BROWN = 0x4a3222, LIGHT_BROWN = 0x6e4a2e, DARK_BLOND = 0x9c7a4a, BLOND = 0xd4a85e
const RED = 0x8a3b1c, SALT_PEPPER = 0x5f5a51, GREY = 0x8b8b88, WHITE = 0xcfccc0, CHESTNUT = 0x5a3424, AUBURN = 0x7a3424
/**
 * Hair colour (estimates): Italians mostly dark brown or black, some blond, rare red; kids fairer (hair darkens through
 * childhood); adults greying from their fifties (a third of the 15–64s are 55–64); elders grey or white, and many elder women dye
 * theirs chestnut or auburn. Darker-skinned people have black or dark brown hair until it greys.
 */
const KIDS_HAIR: Table<number> = [[BLACK, 8], [DARK_BROWN, 30], [BROWN, 28], [LIGHT_BROWN, 14], [DARK_BLOND, 10], [BLOND, 8], [RED, 2]]
const HAIR = {
  boy: KIDS_HAIR,
  girl: KIDS_HAIR,
  man: [[BLACK, 13], [DARK_BROWN, 35], [BROWN, 22], [LIGHT_BROWN, 7], [DARK_BLOND, 5], [BLOND, 4], [RED, 2], [SALT_PEPPER, 9], [GREY, 3]],
  woman: [[BLACK, 13], [DARK_BROWN, 35], [BROWN, 24], [LIGHT_BROWN, 8], [DARK_BLOND, 6], [BLOND, 5], [RED, 2], [SALT_PEPPER, 5], [CHESTNUT, 2]],
  elderMan: [[SALT_PEPPER, 25], [GREY, 40], [WHITE, 35]],
  elderWoman: [[GREY, 25], [WHITE, 25], [SALT_PEPPER, 10], [CHESTNUT, 20], [AUBURN, 15], [DARK_BROWN, 5]]
} as const satisfies Record<Kind, Table<number>>
const DARKER_HAIR: Table<number> = [[BLACK, 70], [DARK_BROWN, 30]]
/** Natural hair shades, darkest first: a kid's is its parent's or the next fairer one (hair darkens through childhood). */
const SHADES: ReadonlyArray<number> = [BLACK, DARK_BROWN, BROWN, LIGHT_BROWN, DARK_BLOND, BLOND]
/**
 * Share of kids whose hair is a shade fairer than their parent's (estimate): at 0.4 the kids of the adults' natural shades come
 * out about as fair as `KIDS_HAIR`.
 */
const FAIRER = 0.4

/**
 * Hairdos: men short, bald for 12 % of adults and 40 % of elders (a bald crown, Hamilton–Norwood V and up), a flat cap (the
 * coppola) on 30 % of elder men; women long 45 %, a bun 25 %, short 30 %, elder women mostly short (set or permed) or in a bun;
 * girls long or tied up. Estimates.
 */
const HAIRDO = {
  boy: [["short", 1]],
  girl: [["long", 55], ["bun", 30], ["short", 15]],
  man: [["short", 88], ["bald", 12]],
  woman: [["long", 45], ["bun", 25], ["short", 30]],
  elderMan: [["short", 30], ["bald", 40], ["cap", 30]],
  elderWoman: [["short", 45], ["bun", 40], ["long", 15]]
} as const satisfies Record<Kind, Table<Hairdo>>

/** What they wear below the shirt (estimates): men trousers 85 %, shorts 15 %, elder men always trousers; women trousers 45 %, a skirt 30 %, a dress 25 %, elder women mostly a skirt or dress; kids more shorts. */
const OUTFIT = {
  boy: [["trousers", 55], ["shorts", 45]],
  girl: [["trousers", 30], ["shorts", 20], ["skirt", 25], ["dress", 25]],
  man: [["trousers", 85], ["shorts", 15]],
  woman: [["trousers", 45], ["skirt", 30], ["dress", 25]],
  elderMan: [["trousers", 1]],
  elderWoman: [["trousers", 20], ["skirt", 45], ["dress", 35]]
} as const satisfies Record<Kind, Table<Outfit>>

/** A wardrobe (sRGB): shirts, trousers and shorts, skirts, dresses. */
interface Wardrobe {
  readonly shirts: Colours
  readonly pants: Colours
  readonly skirts: Colours
  readonly dresses: Colours
}
/** Clothes by age group: grown-ups in the Monzone street palette, kids in brighter colours, elders in muted ones (greys, browns, navy, beige, burgundy). */
const CLOTHES = {
  kid: {
    shirts: [0xd23a2e, 0xf0c93c, 0x6f93c4, 0x4f9a52, 0xe8873a, 0xe58fb0, 0xf2efe6, 0x1d2b4f, 0x8db4b0],
    pants: [0x3b5578, 0x1d2b4f, 0x4b4d50, 0x8f7a58, 0x6e4a2e],
    skirts: [0x1d2b4f, 0xb8312b, 0xe58fb0, 0x3b5578, 0x4b4d50],
    dresses: [0xe58fb0, 0x6f93c4, 0xf0c93c, 0xd23a2e, 0xf2efe6, 0x8db4b0]
  },
  adult: {
    shirts: [0xb8312b, 0x3d6155, 0xf2efe6, 0xf0c93c, 0xd4a85e, 0x1d2b4f, 0xd8a18c, 0x8b8170, 0x8db4b0, 0xb0664b, 0x26241f, 0x6f93c4, 0x9a9a98],
    pants: [0x1d2b4f, 0x3b5578, 0x4a3222, 0x4b4d50, 0x5f5a51, 0x8f7a58, 0x17161a, 0xcfccc0],
    skirts: [0x1d2b4f, 0x17161a, 0x4b4d50, 0x4a3222, 0x6b2a2e, 0x5d5f45, 0xc7b89a, 0x3b5578],
    dresses: [0xb8312b, 0x1d2b4f, 0x3d6155, 0xd8a18c, 0x6f93c4, 0xf0c93c, 0xf2efe6, 0x26241f, 0x8db4b0]
  },
  elder: {
    shirts: [0xe8e2d2, 0x1d2b4f, 0x8b8170, 0x6e6c68, 0x5a4636, 0x5d5f45, 0x6b2a2e, 0xc7b89a, 0x26241f, 0x9a9a98],
    pants: [0x4b4d50, 0x4a3222, 0x1d2b4f, 0x17161a, 0x5f5a51, 0x8f7a58],
    skirts: [0x1d2b4f, 0x17161a, 0x4b4d50, 0x4a3222, 0x6b2a2e, 0x5f5a51],
    dresses: [0x1d2b4f, 0x26241f, 0x6e6c68, 0x5a4636, 0x6b2a2e, 0xc7b89a, 0x5d5f45]
  }
} as const satisfies Record<Age, Wardrobe>

/**
 * Standing height, m: mean and standard deviation. Grown-ups between the young (NCD-RisC 2016: Italians born in 1996, 177.8 cm men,
 * 164.5 cm women) and the middle-aged (the CUORE survey of 2018–19, ages 35–74: 173.2 ± 6.8 cm men, 159.0 ± 6.2 cm women;
 * Donfrancesco et al. 2022, PLoS ONE). Elders 5 cm shorter (estimate: born in the 1940s–50s, when Italians were shorter, and
 * shrinking with age).
 */
const HEIGHT = { man: [1.75, 0.068], woman: [1.62, 0.062], elderMan: [1.7, 0.065], elderWoman: [1.57, 0.06] } as const
/** Kids are about 4 to 11 years old: 1.00–1.45 m (WHO growth reference medians: about 1.03 m at 4, 1.44 m at 11). */
const KID_HEIGHT = [1, 1.45] as const
/** Each group's mean standing height, men then women, m: the means `lookOf` draws from (kids' heights are drawn evenly). */
export const MEAN_HEIGHT = {
  kid: [(KID_HEIGHT[0] + KID_HEIGHT[1]) / 2, (KID_HEIGHT[0] + KID_HEIGHT[1]) / 2],
  adult: [HEIGHT.man[0], HEIGHT.woman[0]],
  elder: [HEIGHT.elderMan[0], HEIGHT.elderWoman[0]]
} as const satisfies Record<Age, readonly [number, number]>

/** What a grown-up passes on to the people it goes out with: its origin (darker skin or not) and, to its kids, its natural hair. */
export interface Kin {
  readonly darker: boolean
  /** Its hair, while a natural colour (one of `SHADES`, or red), not greyed or dyed. */
  readonly hair?: number
}
const darkerTones: ReadonlySet<number> = new Set(DARKER_SKIN.map(([skin]) => skin))
/** What `look` passes on to its partner and kids. */
export const kinOf = (look: Look): Kin => ({ darker: darkerTones.has(look.skin), hair: SHADES.includes(look.hair) || look.hair === RED ? look.hair : undefined })

/** A kid's hair by a parent's natural `shade`: the same, or one shade fairer; red stays red. */
const kidsHairBy = (random: Random.Random, shade: number): number => {
  const k = SHADES.indexOf(shade)
  return k >= 0 && random.next() < FAIRER ? SHADES[Math.min(SHADES.length - 1, k + 1)]! : shade
}

/** A random person of `age`: sex, skin, hair, hairdo, clothes and height; of `kin`'s origin, and for a kid of its hair, when given. */
export const lookOf = (random: Random.Random, age: Age, kin?: Kin): Look => {
  const female = random.next() < FEMALE[age]
  const kind = kindOf(age, female)
  const darker = kin?.darker ?? random.next() < DARKER
  const skin = draw(random, darker ? DARKER_SKIN : LOCAL_SKIN)
  const shade = age === "kid" ? kin?.hair : undefined
  const hair = shade !== undefined ? kidsHairBy(random, shade) : draw(random, darker && age !== "elder" ? DARKER_HAIR : HAIR[kind])
  const hairdo = draw(random, HAIRDO[kind])
  const outfit = draw(random, OUTFIT[kind])
  const clothes = CLOTHES[age]
  const shirt = pick(random, outfit === "dress" ? clothes.dresses : clothes.shirts)
  // A dress is the skirt in the shirt's colour.
  const pants = outfit === "dress" ? shirt : pick(random, outfit === "skirt" ? clothes.skirts : clothes.pants)
  const height = kind === "boy" || kind === "girl" ? random.range(...KID_HEIGHT) : HEIGHT[kind][0] + HEIGHT[kind][1] * normal(random)
  return { skin, hair, shirt, pants, age, female, outfit, hairdo, height }
}
