/**
 * What stands between the listener and each source, cached per source key: the path difference
 * over buildings and ridges (`pathDifference`) and the forest on the way (`forestAlong`). A new
 * key is measured at once; a known one keeps its value until `refresh` re-measures it (at most
 * every 150 ms, at most 12 a frame, oldest first, and only if it was asked for since), so a crowd
 * of sources costs a bounded slice of each frame. Keys nobody asked for in 2 s are forgotten.
 *
 * @module audio/director/occluder
 */
import { pathDifference, type Point3 } from "../occlusion.ts"
import { forestAlong } from "../places.ts"

/** The obstacles on one path: Maekawa path difference, m, and metres of forest. */
export interface Between {
  readonly delta: number
  readonly forest: number
}

/** A key is re-measured this often at most (s), this many a frame, and forgotten this long after its last ask (s). */
const REFRESH = 0.15,
  PER_FRAME = 12,
  FORGET = 2

interface Entry {
  between: Between
  measured: number
  asked: number
  from: Point3
  to: Point3
}

const measure = (from: Point3, to: Point3): Between => ({
  delta: pathDifference(from, to),
  forest: forestAlong(from.x, from.y, to.x, to.y),
})

/** A fresh cache. */
export const makeOccluder = () => {
  const entries = new Map<string, Entry>()
  return {
    /** The obstacles from `from` to `to` for source `key` at time `now`: measured now if the key is new, else as last measured. */
    between: (key: string, from: Point3, to: Point3, now: number): Between => {
      const entry = entries.get(key)
      if (entry === undefined) {
        const between = measure(from, to)
        entries.set(key, { between, measured: now, asked: now, from, to })
        return between
      }
      entry.asked = now
      entry.from = from
      entry.to = to
      return entry.between
    },
    /** Once a frame: re-measures the stalest keys asked for since (with the endpoints last asked for) and forgets the abandoned ones. */
    refresh: (now: number): void => {
      const stale: Array<Entry> = []
      for (const [key, entry] of entries) {
        if (now - entry.asked > FORGET) entries.delete(key)
        // A one-off (a bell stroke, a bird) is not measured again for nobody.
        else if (entry.asked > entry.measured && now - entry.measured >= REFRESH) stale.push(entry)
      }
      stale.sort((a, b) => a.measured - b.measured)
      for (const entry of stale.slice(0, PER_FRAME)) {
        entry.between = measure(entry.from, entry.to)
        entry.measured = now
      }
    },
  }
}

/** A cache of path obstacles. */
export type Occluder = ReturnType<typeof makeOccluder>
