/**
 * Who goes out together: a lone grown-up, two walking side by side, a parent or grandparent with one
 * or two kids, someone walking a dog on a lead, or two neighbours stopped in the street for a chat. The leader walks a route and the rest follow at a
 * place beside it (`Follows`), so kids are never out alone. Pure: it draws only from the random
 * stream it is given.
 *
 * @module population/parties
 */
import type { Random } from "@typeonce/ritmo-math"

import { randomAnimal } from "../fauna.ts"
import type { Age, AnimalValue, Look } from "../schema.ts"
import { ELDERS, kinOf, lookOf } from "./looks.ts"

/**
 * The kinds of party: a lone adult, a lone elder, two walking together, a grown-up with kids, a grown-up with a dog, two neighbours
 * standing in the street talking.
 */
const PARTIES = ["adult", "elder", "pair", "family", "dog", "neighbours"] as const
/** A kind of party. */
type PartyKind = (typeof PARTIES)[number]

/**
 * How often each kind of party comes out, TUNED so that the people out are Fivizzano's residents by age (ISTAT, 1 January 2025:
 * 7.7 % under 15, 53.8 % aged 15–64, 38.5 % over 65): kids come out only in families, so families are rarer than the kids' share
 * suggests. `population.test.ts` measures the mix: about 8 % kids, 54 % adults, 38 % elders.
 */
const PARTY_WEIGHTS = { adult: 0.34, elder: 0.25, pair: 0.13, family: 0.075, dog: 0.09, neighbours: 0.12 } as const satisfies Record<PartyKind, number>
/** Share of grandparents among the grown-ups out with kids (estimate: Italian grandparents often mind the kids while the parents work). */
const GRANDPARENT = 0.25
/**
 * Share of pairs whose second shares the leader's origin (estimate): most couples and friends out together are of one origin; the
 * rest are drawn on their own, as anyone else.
 */
const SAME_ORIGIN = 0.9
/** Share of families out with two kids rather than one (estimate). */
const TWO_KIDS = 0.4
/** How long two neighbours who stopped in the street talk before going their ways, s (estimate: a chat on the doorstep). */
const DOORSTEP = [30, 120] as const

/** Where each follower walks beside its leader, m: `side` to its right (mirrored at random), `back` behind it (see `Follows`). */
export const PLACES = { partner: { side: 0.7, back: 0 }, kid: { side: 0.5, back: 0.4 }, dog: { side: 0.5, back: 0.9 } } as const

/** One who follows the leader: a look, and its place beside the leader. */
export interface Follower<L> {
  readonly look: L
  readonly side: number
  readonly back: number
}
/**
 * A party: the leader's look, the people who follow it (a partner or kids), a dog on a lead, and a neighbour the leader stands
 * talking with for `seconds` (who follows nobody: when the chat ends each goes its own way).
 */
export interface Party {
  readonly leader: Look
  readonly people: ReadonlyArray<Follower<Look>>
  readonly dog?: Follower<AnimalValue>
  readonly neighbour?: { readonly look: Look; readonly seconds: number }
}

/** A random party of the kind drawn by `PARTY_WEIGHTS`. */
export const randomParty = (random: Random.Random): Party => {
  const kind = random.weighted(PARTIES, (k) => PARTY_WEIGHTS[k]) ?? "adult"
  const grownUp = (elders: number): Age => (random.next() < elders ? "elder" : "adult")
  const mirror = () => (random.next() < 0.5 ? 1 : -1)
  switch (kind) {
    case "adult":
    case "elder":
      return { leader: lookOf(random, kind), people: [] }
    case "pair": {
      const age = grownUp(ELDERS)
      const leader = lookOf(random, age)
      const kin = random.next() < SAME_ORIGIN ? { darker: kinOf(leader).darker } : undefined
      return { leader, people: [{ look: lookOf(random, age, kin), side: mirror() * PLACES.partner.side, back: PLACES.partner.back }] }
    }
    case "family": {
      const leader = lookOf(random, grownUp(GRANDPARENT))
      // Two kids walk one on each side; one walks on either.
      const sides = random.next() < TWO_KIDS ? [1, -1] : [mirror()]
      // Kids are of their parent's (or grandparent's) origin, and take after its hair.
      const kin = kinOf(leader)
      return { leader, people: sides.map((s) => ({ look: lookOf(random, "kid", kin), side: s * PLACES.kid.side, back: PLACES.kid.back })) }
    }
    case "dog":
      return { leader: lookOf(random, grownUp(ELDERS)), people: [], dog: { look: randomAnimal("dog", random), side: mirror() * PLACES.dog.side, back: PLACES.dog.back } }
    case "neighbours":
      return {
        leader: lookOf(random, grownUp(ELDERS)), people: [],
        neighbour: { look: lookOf(random, grownUp(ELDERS)), seconds: random.range(DOORSTEP[0], DOORSTEP[1]) }
      }
  }
}
