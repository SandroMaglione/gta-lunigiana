/**
 * The title card (markup in index.html) as the loading screen: a line that the game is in early
 * development, a bar and the name of the step running while the map downloads and the game
 * builds, an error with a retry if that fails, and "Press any key" ("Tap to play" in mobile mode)
 * once the first frame is drawn.
 * It imports nothing, so `boot.ts` can show it before the game modules (and the map they read)
 * load. Also holds the DOM lookup the HUD shares.
 *
 * @module hud/title
 */

/** The element with `id`; throws when index.html lacks it. */
export const element = (document: Document, id: string): HTMLElement => {
  const found = document.getElementById(id)
  if (found === null) throw new Error(`index.html lacks #${id}`)
  return found
}

/**
 * Resolves after the browser has had a chance to paint the card (and to deliver input queued
 * behind the last step): after the next animation frame. A background tab has no frames and slows
 * timers to about one a second, so there it resolves on a message, at once; 100 ms covers a tab
 * hidden while waiting for its frame.
 */
const paint = (): Promise<void> =>
  new Promise((done) => {
    if (document.hidden) {
      const channel = new MessageChannel()
      channel.port1.onmessage = () => done()
      channel.port2.postMessage(undefined)
      return
    }
    requestAnimationFrame(() => setTimeout(done))
    setTimeout(done, 100)
  })

const set = (node: HTMLElement, text: string) => {
  if (node.textContent !== text) node.textContent = text
}

/**
 * Names the running step (a live region: screen readers hear each new step) and moves the bar to
 * `done` (0..1). `detail` (bytes so far) sits outside the live region, so per-chunk updates stay quiet.
 */
export const loading = (document: Document, step: string, done: number, detail = ""): void => {
  set(element(document, "title-step"), step)
  set(element(document, "title-detail"), detail)
  const bar = element(document, "title-bar") as HTMLProgressElement
  bar.value = done
}

/** `loading` a new step, then `paint`: call before each long piece of start-up work. */
export const step = async (document: Document, name: string, done: number): Promise<void> => {
  loading(document, name, done)
  await paint()
}

/** Keeps the failed step on the card, announces the error and offers a reload (a failed module import stays failed until one). */
export const loadFailed = (document: Document, error: unknown): void => {
  console.error("start-up failed", error)
  const message = element(document, "title-error"),
    retry = element(document, "title-retry")
  message.textContent = `Failed to start: ${error instanceof Error ? error.message : String(error)}`
  message.hidden = retry.hidden = false
  retry.addEventListener("click", () => document.location.reload(), { once: true })
  // The game's keyboard (made late in start-up) cancels Enter and Space at the window: keep them on the button.
  retry.addEventListener("keydown", (event) => event.stopPropagation())
  retry.focus()
}

/**
 * Swaps the bar for "Press any key" ("Tap to play" in mobile mode) and hides the card on the first
 * key press, or click or tap on it, after that. On the click, not the press: hidden on the press,
 * the card would let the tap's click land on whatever lies under it (the minimap opens the map).
 */
export const titleReady = (window: Window): void => {
  const document = window.document,
    title = element(document, "title")
  element(document, "title-load").hidden = true
  element(document, "title-go").hidden = false
  const dismiss = () => {
    title.hidden = true
    window.removeEventListener("keydown", dismiss)
    title.removeEventListener("click", dismiss)
  }
  window.addEventListener("keydown", dismiss)
  title.addEventListener("click", dismiss)
}
