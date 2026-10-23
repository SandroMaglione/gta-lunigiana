/**
 * The debug menu's Handling area: the vehicle handling presets and knobs, set live for every vehicle
 * at once through the store the settings share (`hud/handling.ts`), so each shows what the other
 * sets. Every name, range and text it shows comes from `HANDLING` and `HANDLING_PRESETS`
 * (src/sim/handling.ts).
 *
 * @module hud/debug-handling
 */
import { DEFAULT_HANDLING, HANDLING, HANDLING_KEYS, HANDLING_PRESETS, type HandlingKey, type Knob, PRESET_IDS } from "../sim/handling.ts"
import type { Area, Make } from "./debug.ts"
import type { HandlingStore } from "./handling.ts"

/** A knob's value as the menu shows it: a scale "×1.25", a share "0.60", a switch "On" or "Off". */
export const formatKnob = (key: HandlingKey, value: number): string => {
  const { kind } = HANDLING[key]
  if (kind === "switch") return value === 1 ? "On" : "Off"
  return kind === "scale" ? `×${value.toFixed(2)}` : value.toFixed(2)
}

/** `keys` in the menu's sections, one per `group`: the sections in the order their first knob comes, each with its knobs in that order. */
export const sections = (keys: ReadonlyArray<HandlingKey> = HANDLING_KEYS): ReadonlyArray<[group: string, keys: ReadonlyArray<HandlingKey>]> =>
  [...Map.groupBy(keys, (key) => HANDLING[key].group)]

/**
 * The Handling area: a preset or a knob changed goes to `store` at once, and the area shows every
 * change the store makes, the settings' included; "Reset" and "Reset all" set knobs back to a new
 * game's values.
 */
export const handlingArea = (make: Make, store: HandlingStore): Area => {
  const nodes: Array<Node> = [make("p", { textContent: "Every change applies to every vehicle at once, traffic included." })]
  const presets = PRESET_IDS.map((id) => {
    const button = make("button", { type: "button", textContent: HANDLING_PRESETS[id].label, title: HANDLING_PRESETS[id].description })
    button.addEventListener("click", () => store.choose(id))
    return { id, button }
  })
  // A mix of knobs set here is no preset: none pressed, and the row says so.
  const custom = make("span", { className: "debug-custom", textContent: "Custom" })
  nodes.push(make("h4", { textContent: "Presets" }), make("div", { className: "debug-choices" }, ...presets.map(({ button }) => button), custom))
  const controls = new Map<HandlingKey, { readonly input: HTMLInputElement; readonly shown: HTMLOutputElement; readonly reset: HTMLButtonElement }>()
  const show = (key: HandlingKey) => {
    const { input, shown, reset } = controls.get(key)!, value = store.values()[key]
    if (input.type === "checkbox") input.checked = value === 1
    else {
      input.value = String(value)
      input.ariaValueText = formatKnob(key, value)
    }
    shown.value = formatKnob(key, value)
    reset.hidden = value === DEFAULT_HANDLING[key]
  }
  for (const [group, keys] of sections()) {
    nodes.push(make("h4", { textContent: group }))
    for (const key of keys) {
      const knob: Knob = HANDLING[key], id = `debug-${key}`
      const input = make("input", knob.kind === "switch"
        ? { id, type: "checkbox" }
        : { id, type: "range", min: String(knob.min), max: String(knob.max), step: String(knob.step) })
      const shown = make("output"), about = make("p", { id: `${id}-about`, textContent: knob.description })
      const reset = make("button", { type: "button", textContent: "Reset", ariaLabel: `Reset ${knob.label}` })
      input.setAttribute("aria-describedby", about.id)
      input.addEventListener("input", () => store.change(key, knob.kind === "switch" ? Number(input.checked) : Number(input.value)))
      reset.addEventListener("click", () => {
        store.change(key, DEFAULT_HANDLING[key])
        input.focus() // the button hides itself
      })
      controls.set(key, { input, shown, reset })
      nodes.push(make("div", { className: "debug-knob" }, make("label", { htmlFor: id, textContent: knob.label }), shown, input, reset, about))
    }
  }
  const resetAll = make("button", { type: "button", className: "debug-reset-all", textContent: "Reset all" })
  resetAll.addEventListener("click", () => {
    for (const key of HANDLING_KEYS) store.change(key, DEFAULT_HANDLING[key])
  })
  nodes.push(resetAll)
  const showAll = () => {
    const preset = store.preset()
    for (const { id, button } of presets) button.ariaPressed = String(id === preset)
    custom.hidden = preset !== undefined
    for (const key of HANDLING_KEYS) show(key)
  }
  store.subscribe(showAll)
  showAll()
  return { title: "Handling", nodes, first: presets[0]!.button }
}
