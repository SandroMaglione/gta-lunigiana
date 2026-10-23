/**
 * The player's vehicle handling, one store for every UI that sets it: the settings' preset and the
 * dev debug menu's knobs. It sets the game's knobs, keeps the choice in localStorage for the next
 * load, and tells each UI when the knobs change, so the other one shows the change.
 *
 * @module hud/handling
 */
import {
  clampKnob,
  DEFAULT_HANDLING,
  HANDLING_KEYS,
  HANDLING_PRESETS,
  type HandlingKey,
  type HandlingValue,
  PRESET_IDS,
  presetOf,
  type PresetId,
} from "../sim/handling.ts"

/**
 * The localStorage entry, as JSON: a preset's name while the knobs match it, so a later retune of
 * the preset reaches the player; else an object of the knobs off a new game's (`DEFAULT_HANDLING`).
 */
const STORED = "gta-lunigiana/handling"

/** Whether `name` names a preset (not merely a property every object has, like "toString"). */
const isPresetId = (name: string): name is PresetId =>
  (PRESET_IDS as ReadonlyArray<string>).includes(name)

/** The knobs in stored `text`, which is untrusted: anything not a preset's name or a JSON object is nothing, unknown keys and non-numbers are dropped, the rest kept in range (`clampKnob`). */
const parse = (text: string | null): HandlingValue | undefined => {
  let data: unknown
  try {
    data = JSON.parse(text ?? "null")
  } catch {
    return undefined
  }
  if (typeof data === "string") return isPresetId(data) ? HANDLING_PRESETS[data].values : undefined
  if (typeof data !== "object" || data === null) return undefined
  const values: Record<HandlingKey, number> = { ...DEFAULT_HANDLING }
  for (const key of HANDLING_KEYS) {
    const value: unknown = (data as Record<string, unknown>)[key]
    const valid = typeof value === "number" ? clampKnob(key, value) : undefined
    if (valid !== undefined) values[key] = valid
  }
  return values
}

/** What the store needs: the game's knobs to read and set, and where to keep the choice. */
export interface HandlingHost {
  readonly read: () => HandlingValue
  readonly set: (key: HandlingKey, value: number) => void
  readonly storage: Pick<Storage, "getItem" | "setItem">
}

/**
 * The store: the game's knobs (`read` once) with the stored choice set over them at once. The game
 * applies a set knob on its next step, and not at all while paused (the full map, the settings), so
 * the store keeps its own values rather than read the game's again: what it shows and stores is
 * always what the game will hold.
 */
export const makeHandlingStore = ({ read, set, storage }: HandlingHost) => {
  // Storage throws where the browser blocks it, or when it is full: then the choice lasts until a reload.
  const load = () => {
    try {
      return storage.getItem(STORED)
    } catch {
      return null
    }
  }
  const keep = (text: string) => {
    try {
      storage.setItem(STORED, text)
    } catch {}
  }
  const listeners: Array<() => void> = []
  let values = read()
  const apply = (next: HandlingValue) => {
    for (const key of HANDLING_KEYS) if (next[key] !== values[key]) set(key, next[key])
    values = next
  }
  apply(parse(load()) ?? values)
  /** Sets `next`, stores it and tells the listeners. */
  const put = (next: HandlingValue) => {
    apply(next)
    const moved = HANDLING_KEYS.filter((key) => values[key] !== DEFAULT_HANDLING[key])
    keep(
      JSON.stringify(
        presetOf(values) ?? Object.fromEntries(moved.map((key) => [key, values[key]])),
      ),
    )
    for (const listener of listeners) listener()
  }
  return {
    values: (): HandlingValue => values,
    /** The preset the knobs match, or undefined for a mix set by hand. */
    preset: (): PresetId | undefined => presetOf(values),
    /** Sets every knob to `preset`'s. */
    choose: (preset: PresetId): void => put(HANDLING_PRESETS[preset].values),
    /** Sets knob `key`, kept in range as the game keeps it; a value that is not a number is ignored. */
    change: (key: HandlingKey, value: number): void => {
      const valid = clampKnob(key, value)
      if (valid !== undefined) put({ ...values, [key]: valid })
    },
    /** Calls `listener` after every change, so an open UI shows it. */
    subscribe: (listener: () => void): void => void listeners.push(listener),
  }
}

/** The player's handling: its knobs, its preset, and the ways to change them. */
export type HandlingStore = ReturnType<typeof makeHandlingStore>
