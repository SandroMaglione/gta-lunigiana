/**
 * The Web Audio `Speaker`: it builds a voice from the `Voices` table for every key the director
 * holds, plays `Shots` as they come, each behind its own emitter, and fades out what the director
 * stopped holding. The AudioContext starts on the first user gesture (autoplay policy), suspends
 * while the game is paused or the tab is hidden, and stays inert until then: every call before it
 * exists is a no-op. A synth that throws is muted for the session, never the game loop.
 *
 * @module audio/speaker
 */
import { makeKit } from "./buffers.ts"
import { makeEmitter, type Emitter } from "./emitter.ts"
import { makeMixer, SILENCE_DB, type Mixer } from "./mixer.ts"
import type {
  Continuous,
  Kit,
  OneShot,
  Placement,
  Shot,
  Shots,
  Speaker,
  Voice,
  VoiceFactory,
  Voices,
} from "./types.ts"

/** At most this many one-shots play (or wait to) at once. */
const MAX_SHOTS = 32

/**
 * The one-shot cap: below `cap` playing, a new sound of `gain` just plays (undefined); at the cap
 * it is dropped unless louder than the quietest playing one, which it replaces.
 */
export const crowded = <T extends { readonly gain: number }>(
  playing: ReadonlyArray<T>,
  gain: number,
  cap = MAX_SHOTS,
): T | "drop" | undefined => {
  if (playing.length < cap) return undefined
  let quietest = playing[0]!
  for (const shot of playing) if (shot.gain < quietest.gain) quietest = shot
  return gain > quietest.gain ? quietest : "drop"
}

/** Gestures that may start audio. Esc and touch pointerdowns are not user activation; the check below skips them. */
const GESTURES = ["keydown", "pointerdown", "touchend"] as const

interface Live {
  readonly ctx: AudioContext
  readonly kit: Kit
  readonly mixer: Mixer
}

interface Held {
  readonly kind: Continuous["kind"]
  readonly voice: Voice<Continuous>
  readonly emitter: Emitter
  /** Held since the last flush. */
  held: boolean
}

interface Playing {
  readonly gain: number
  readonly end: number
  readonly emitter: Emitter
}

/** The speaker for `host`'s page, playing `voices` and `shots`; `pause` it while the game is paused. */
export const makeSpeaker = (
  host: Window,
  voices: Voices,
  shots: Shots,
): Speaker & {
  /** Suspends the context while `paused` (idempotent; call every frame). */
  readonly pause: (paused: boolean) => void
  /** The output's RMS level, dBFS. */
  readonly level: () => number
  /** The context, once a gesture has started it. */
  readonly context: () => AudioContext | undefined
} => {
  let live: Live | undefined
  let paused = false
  const holding = new Map<string, Held>()
  let playing: Array<Playing> = []
  const broken = new Set<string>()

  const fail = (kind: string, error: unknown) => {
    if (broken.has(kind)) return
    broken.add(kind)
    console.error(`audio: the ${kind} synth failed and is muted`, error)
  }
  const wanted = () => !paused && !host.document.hidden
  // Asks for the wanted state on every change, not only when `state` differs: a suspend still in flight reads "running".
  const apply = () => {
    if (live === undefined) return
    void (wanted() ? live.ctx.resume() : live.ctx.suspend())
  }

  const start = (): Live => {
    const ctx = new AudioContext()
    try {
      const kit = makeKit(ctx),
        mixer = makeMixer(ctx)
      // Each in its own task, so building the offline graphs never stalls the gesture's frame; a throw inside
      // `prepare` rejects like a failed render.
      for (const [kind, shot] of Object.entries(shots)) {
        host.setTimeout(
          () =>
            void Promise.resolve()
              .then(() => shot.prepare?.(ctx, kit))
              .catch((error: unknown) => fail(kind, error)),
          0,
        )
      }
      return { ctx, kit, mixer }
    } catch (error) {
      // A context left running would hold the audio device for the rest of the session.
      void ctx.close()
      throw error
    }
  }
  const unlock = (event: Event) => {
    // Creating or resuming without user activation fails and makes Chrome warn; older browsers lack the flag.
    // oxlint-disable-next-line typescript/no-unnecessary-boolean-literal-compare -- userActivation is undefined there, despite the DOM types
    if (!event.isTrusted || host.navigator.userActivation?.isActive === false) return
    if (live === undefined) {
      try {
        live = start()
      } catch (error) {
        for (const type of GESTURES) host.removeEventListener(type, unlock)
        console.error("audio: cannot start", error)
        return
      }
      apply()
    } else if (wanted() && live.ctx.state !== "running") void live.ctx.resume() // Safari's "interrupted", Firefox's blocked start
  }
  for (const type of GESTURES) host.addEventListener(type, unlock)
  host.document.addEventListener("visibilitychange", apply)

  const voice = (
    { ctx, kit, mixer }: Live,
    kind: Continuous["kind"],
    at: Placement,
    now: number,
  ): Held => {
    // Silent at first: the first `place` fades the voice in instead of clicking.
    const emitter = makeEmitter(ctx, mixer, { ...at, gain: 0 })
    try {
      const factory = voices[kind] as VoiceFactory<Continuous>
      return {
        kind,
        voice: factory({ ctx, out: emitter.input, cents: emitter.cents, kit }),
        emitter,
        held: true,
      }
    } catch (error) {
      emitter.free(now)
      throw error
    }
  }
  const end = (entry: Held, now: number) => {
    try {
      entry.voice.stop(now)
    } catch (error) {
      fail(entry.kind, error)
    }
    entry.emitter.release(now)
  }

  return {
    now: () => live?.ctx.currentTime ?? 0,
    hold: (key, sound, at) => {
      if (live === undefined || broken.has(sound.kind)) return
      const now = live.ctx.currentTime
      let entry = holding.get(key)
      if (entry !== undefined && entry.kind !== sound.kind) {
        end(entry, now)
        holding.delete(key)
        entry = undefined
      }
      try {
        if (entry === undefined) {
          entry = voice(live, sound.kind, at, now)
          holding.set(key, entry)
        }
        entry.held = true
        entry.emitter.place(at, now)
        entry.voice.update(sound, now)
      } catch (error) {
        fail(sound.kind, error)
        // The next flush stops it.
        if (entry !== undefined) entry.held = false
      }
    },
    play: (sound, at, delay) => {
      if (live === undefined || broken.has(sound.kind)) return
      const { ctx, kit, mixer } = live,
        now = ctx.currentTime
      playing = playing.filter((shot) => shot.end > now)
      const victim = crowded(playing, at.gain)
      if (victim === "drop") return
      if (victim !== undefined) {
        victim.emitter.release(now)
        playing = playing.filter((shot) => shot !== victim)
      }
      let emitter: Emitter | undefined
      try {
        // Inside the try: a non-finite placement throws here, and must not reach the game loop.
        emitter = makeEmitter(ctx, mixer, at)
        const shot = shots[sound.kind] as Shot<OneShot>
        const end = shot.play({ ctx, out: emitter.input, kit }, sound, now + Math.max(0, delay))
        emitter.free(end + 0.1)
        playing.push({ gain: at.gain, end, emitter })
      } catch (error) {
        emitter?.free(now)
        fail(sound.kind, error)
      }
    },
    flush: () => {
      if (live === undefined) return
      const now = live.ctx.currentTime
      for (const [key, entry] of holding) {
        if (entry.held) entry.held = false
        else {
          end(entry, now)
          holding.delete(key)
        }
      }
    },
    pause: (next) => {
      if (next === paused) return
      paused = next
      apply()
    },
    level: () => live?.mixer.level() ?? SILENCE_DB,
    context: () => live?.ctx,
  }
}
