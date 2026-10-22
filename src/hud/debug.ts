/**
 * The debug menu, in dev builds only (main.ts imports it inside its `import.meta.env.DEV` block):
 * a panel that sets the vehicle handling knobs live, for every vehicle at once, and keeps the
 * changed ones in localStorage for the next load. P or the Debug button beside the Ritmo
 * monitor's opens and closes it, Esc closes it. Every name, range and text it shows comes from
 * `HANDLING` (src/sim/handling.ts).
 *
 * @module hud/debug
 */
import { clampKnob, DEFAULT_HANDLING, HANDLING, HANDLING_KEYS, type HandlingKey, type HandlingValue, type Knob } from "../sim/handling.ts"

/** Knob values by name, some knobs only: what the menu stores. */
type Knobs = Partial<Record<HandlingKey, number>>

/** The localStorage entry: a JSON object of the knobs changed from a new game's (`DEFAULT_HANDLING`). */
const STORED = "gta-lunigiana/handling"
const TITLE = "Debug: vehicle handling"

/** A knob's value as the menu shows it: a scale "×1.25", a share "0.60", a switch "On" or "Off". */
export const formatKnob = (key: HandlingKey, value: number): string => {
  const { kind } = HANDLING[key]
  if (kind === "switch") return value === 1 ? "On" : "Off"
  return kind === "scale" ? `×${value.toFixed(2)}` : value.toFixed(2)
}

/** `keys` in the menu's sections, one per `group`: the sections in the order their first knob comes, each with its knobs in that order. */
export const sections = (keys: ReadonlyArray<HandlingKey> = HANDLING_KEYS): ReadonlyArray<[group: string, keys: ReadonlyArray<HandlingKey>]> =>
  [...Map.groupBy(keys, (key) => HANDLING[key].group)]

/** The knobs in stored `text`, which is untrusted: anything not JSON is nothing, unknown keys and non-numbers are dropped, the rest kept in range (`clampKnob`). */
export const parseStored = (text: string | null): Knobs => {
  let data: unknown
  try {
    data = JSON.parse(text ?? "null")
  } catch {
    return {}
  }
  const knobs: Knobs = {}
  for (const key of HANDLING_KEYS) {
    const value: unknown = Object(data)[key]
    const valid = typeof value === "number" ? clampKnob(key, value) : undefined
    if (valid !== undefined) knobs[key] = valid
  }
  return knobs
}

/**
 * Whether `event` toggles the menu: the key that types P (on any Latin layout, AZERTY too), or the
 * key in P's place on layouts that type no ASCII character there (Cyrillic, Greek). Repeats and
 * Ctrl, Cmd or Alt chords are not.
 */
export const isDebugKey = (event: Pick<KeyboardEvent, "key" | "code" | "repeat" | "ctrlKey" | "metaKey" | "altKey">): boolean => {
  if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return false
  const key = event.key.toLowerCase()
  return key === "p" || (event.code === "KeyP" && !/^[ -~]$/.test(key))
}

/**
 * The menu's knobs: the game's (`read` once) with the `stored` ones set over them, then each change set and remembered. The game
 * applies a change on its next step, and not at all while paused (the full map), so the menu keeps its own values rather than read
 * the game's again: what it shows and stores is always what the game will hold. `change` returns what to store: the knobs off their
 * new-game values as JSON, or undefined when none is.
 */
export const knobModel = (read: () => HandlingValue, stored: Knobs, set: (key: HandlingKey, value: number) => void) => {
  for (const key of HANDLING_KEYS) {
    const value = stored[key]
    if (value !== undefined) set(key, value)
  }
  let values: HandlingValue = { ...read(), ...stored }
  return {
    values: (): HandlingValue => values,
    change: (key: HandlingKey, value: number): string | undefined => {
      values = { ...values, [key]: value }
      set(key, value)
      const moved = HANDLING_KEYS.filter((name) => values[name] !== DEFAULT_HANDLING[name])
      return moved.length === 0 ? undefined : JSON.stringify(Object.fromEntries(moved.map((name) => [name, values[name]])))
    }
  }
}

/** What the menu needs: the page, where to keep the changed knobs, and the game's knobs to read and set. */
export interface DebugMenuHost {
  readonly window: Window
  readonly storage: Pick<Storage, "getItem" | "setItem" | "removeItem">
  readonly read: () => HandlingValue
  readonly set: (key: HandlingKey, value: number) => void
}

// The Debug button sits right of the monitor's (`.btm-toggle`, bottom left), anchored to it; until
// the monitor is on the page, or where anchor positioning is missing, it takes the fallbacks.
const STYLE = `
.btm-toggle { anchor-name: --ritmo-monitor; }
.debug-toggle { position: fixed; z-index: 2147483000; left: 200px; left: calc(anchor(--ritmo-monitor right, 4px) + 8px); bottom: 12px; bottom: anchor(--ritmo-monitor bottom, 12px); padding: 2px 8px; font: inherit; font-size: 11px; color: var(--shadow); background: var(--accent); border: 2px solid var(--shadow); cursor: pointer; }
.debug { position: fixed; z-index: 2147483000; top: 16px; right: 16px; bottom: 120px; box-sizing: border-box; width: min(360px, calc(100vw - 32px)); overflow-y: auto; padding: 12px 16px; color: var(--ink); background: rgb(23 22 26 / 0.9); border: 2px solid var(--accent); text-shadow: 2px 2px 0 var(--shadow); }
.debug[hidden] { display: none; }
.debug h2, .debug h3 { margin: 0; color: var(--accent); text-transform: uppercase; letter-spacing: 0.06em; }
.debug h2 { font-size: 16px; }
.debug h3 { margin-top: 16px; font-size: 13px; }
.debug p { margin: 0; font-size: 11px; opacity: 0.85; }
.debug-knob { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 2px 12px; margin-top: 8px; }
.debug-knob output { color: var(--accent); }
.debug-knob p { grid-column: 1 / -1; }
.debug input { margin: 0; accent-color: var(--accent); }
.debug input[type="checkbox"] { justify-self: start; }
.debug button { padding: 0 8px; font: inherit; font-size: 12px; color: var(--shadow); background: var(--accent); border: 2px solid var(--shadow); text-shadow: none; cursor: pointer; }
.debug button[hidden] { display: none; }
.debug .debug-reset-all { margin-top: 16px; }
.debug :focus-visible, .debug-toggle:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
`

/**
 * Mounts the menu, closed, and its button, and sets the knobs stored by an earlier load. Each change
 * is `set` at once and stored; "Reset" and "Reset all" set knobs back to a new game's values and clear the store.
 */
export const mountDebugMenu = ({ window, storage, read, set }: DebugMenuHost): void => {
  const document = window.document
  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, props: NoInfer<Partial<HTMLElementTagNameMap[K]>> = {}, ...children: Array<Node | string>): HTMLElementTagNameMap[K] => {
    const node = Object.assign(document.createElement(tag), props)
    node.append(...children)
    return node
  }
  const knobs = knobModel(read, parseStored(storage.getItem(STORED)), set)

  const panel = make("section", { id: "debug-menu", className: "debug", role: "dialog", ariaLabel: TITLE, hidden: true },
    make("h2", { textContent: TITLE }),
    make("p", { textContent: "Dev builds only. Every change applies to every vehicle at once, traffic included." }))
  const controls = new Map<HandlingKey, { readonly input: HTMLInputElement; readonly shown: HTMLOutputElement; readonly reset: HTMLButtonElement }>()
  const show = (key: HandlingKey) => {
    const { input, shown, reset } = controls.get(key)!, value = knobs.values()[key]
    if (input.type === "checkbox") input.checked = value === 1
    else {
      input.value = String(value)
      input.ariaValueText = formatKnob(key, value)
    }
    shown.value = formatKnob(key, value)
    reset.hidden = value === DEFAULT_HANDLING[key]
  }
  const change = (key: HandlingKey, value: number) => {
    const keep = knobs.change(key, value)
    if (keep === undefined) storage.removeItem(STORED)
    else storage.setItem(STORED, keep)
    show(key)
  }
  for (const [group, keys] of sections()) {
    const section = make("section", {}, make("h3", { textContent: group }))
    for (const key of keys) {
      const knob: Knob = HANDLING[key], id = `debug-${key}`
      const input = make("input", knob.kind === "switch"
        ? { id, type: "checkbox" }
        : { id, type: "range", min: String(knob.min), max: String(knob.max), step: String(knob.step) })
      const shown = make("output"), about = make("p", { id: `${id}-about`, textContent: knob.description })
      const reset = make("button", { type: "button", textContent: "Reset", ariaLabel: `Reset ${knob.label}` })
      input.setAttribute("aria-describedby", about.id)
      input.addEventListener("input", () => change(key, knob.kind === "switch" ? Number(input.checked) : Number(input.value)))
      reset.addEventListener("click", () => {
        change(key, DEFAULT_HANDLING[key])
        input.focus() // the button hides itself
      })
      controls.set(key, { input, shown, reset })
      section.append(make("div", { className: "debug-knob" }, make("label", { htmlFor: id, textContent: knob.label }), shown, input, reset, about))
    }
    panel.append(section)
  }
  const resetAll = make("button", { type: "button", className: "debug-reset-all", textContent: "Reset all" })
  resetAll.addEventListener("click", () => {
    for (const key of HANDLING_KEYS) change(key, DEFAULT_HANDLING[key])
  })
  panel.append(resetAll)
  const toggle = make("button", { type: "button", className: "debug-toggle", textContent: "Debug (P)", title: TITLE, ariaExpanded: "false" })
  toggle.setAttribute("aria-controls", panel.id)

  let returnTo: Element | null = null
  const open = () => {
    for (const key of HANDLING_KEYS) show(key)
    returnTo = document.activeElement
    panel.hidden = false
    toggle.ariaExpanded = "true"
    panel.querySelector("input")?.focus()
  }
  const close = () => {
    // Focus goes back only from inside the menu: one the player moved elsewhere stays there.
    const inside = panel.contains(document.activeElement)
    panel.hidden = true
    toggle.ariaExpanded = "false"
    if (inside && returnTo instanceof HTMLElement) returnTo.focus()
  }
  const flip = () => (panel.hidden ? open() : close())
  toggle.addEventListener("click", flip)
  window.addEventListener("keydown", (event) => {
    if (isDebugKey(event)) flip()
    else if (event.key === "Escape" && !panel.hidden) close()
  })
  // The game's keyboard listens on the window: a key pressed in the menu stops here, so it neither
  // drives nor walks (nor moves the map or the monitor). Keyups go on: one of a key held as focus
  // came in releases it, and the keyboard ignores the keyup of a key it never saw go down.
  panel.addEventListener("keydown", (event) => {
    event.stopPropagation()
    if (isDebugKey(event) || event.key === "Escape") close()
  })
  document.head.append(make("style", { textContent: STYLE }))
  document.body.append(panel, toggle)
}
