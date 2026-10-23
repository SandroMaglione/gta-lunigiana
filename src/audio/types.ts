/**
 * The audio host's shared vocabulary. Three layers meet here:
 *
 * - `Heard`: what the world sounds like this frame, as plain data. The audio schedule reads it
 *   from the simulation (components, the `Impact`, `Skid`, `Honk` and `Lightning` events, the horn
 *   key, the game clock and the weather) and hands it to the `Audio` service once per animation
 *   frame.
 * - The director (pure TypeScript, tested in Node) turns `Heard` into sound requests: continuous
 *   voices it holds frame after frame (`Continuous`) and one-shots (`OneShot`), each with a
 *   `Placement` computed from acoustics (spreading, air absorption, occlusion, Doppler, cabin).
 * - The `Speaker` (Web Audio) plays those requests: it builds one `Voice` per held key from the
 *   `Voices` table and plays `Shots`, each behind an emitter that applies the placement.
 *
 * Every table keyed by a sound kind is `satisfies`-checked against these unions, so a new kind
 * fails to compile until it has a synth.
 *
 * @module audio/types
 */
import type { Surface } from "../sim/map/surface.ts"
import type { WeatherValue } from "../sim/schema.ts"
import type { VehicleModel } from "../sim/vehicles.ts"

export type { Surface }

/** What a vehicle hit, by how it sounds: masonry (rendered houses), stone (rubble stone, dry-stone walls,
 *  churches, ruins), sheet (metal-clad industrial walls), glass (greenhouses), rail (steel W-beam guard rail),
 *  rock (cliffs), earth (steep banks, every other drive wall and loose ground), tree (a trunk), road (the
 *  asphalt or paving it lands or rolls on). */
export type Material = "masonry" | "stone" | "sheet" | "glass" | "rail" | "rock" | "earth" | "tree" | "road"
/** Where a hit lands on a vehicle's body: its front, a side (the roof too), its rear, or under it (bottoming out after a jump). */
export type Zone = "front" | "side" | "rear" | "under"
/** One vehicle in a crash; `worn`: the barrier-equivalent speed (m/s) of the hardest earlier hit on this zone, so what broke then stays broken (none: intact). */
export interface Body { readonly model: VehicleModel; readonly zone: Zone; readonly worn?: number }

/** A vehicle's tyres sliding this frame: the most any wheel went past its grip (0…1), the fastest one slid (m/s), and the surface under the one furthest past. */
export interface Skidding { readonly amount: number; readonly slip: number; readonly surface: Surface }

/** A vehicle someone could hear: running (someone at the wheel) or moving (rolling over and bouncing too). Parked, still cars are left out. */
export interface HeardVehicle {
  /** Entity id: stable while the vehicle exists, the key of its voices. */
  readonly id: number
  readonly model: VehicleModel
  /** Pose (m, rad), the elevation of its centre of mass (m a.s.l.) and velocity (m/s), world frame. */
  readonly x: number
  readonly y: number
  readonly z: number
  readonly angle: number
  readonly vx: number
  readonly vy: number
  /** The engine's revs and load (0…1) as the sim's drivetrain turns them (`engineRevs`). */
  readonly rpm: number
  readonly load: number
  /** Its wheels are on the ground: not in the air, nor on its side or roof. */
  readonly wheelsDown: boolean
  /** Its body touches the ground (`hullDown`): down on its belly, side or roof, it grinds along it while it slides. */
  readonly hullDown: boolean
  /** Its tyres sliding, from the `Skid` events since the last frame; none when no wheel slid. */
  readonly skid?: Skidding
  /** Someone is at the wheel (AI traffic or the player), so the engine runs. */
  readonly running: boolean
  /** The player is at the wheel. */
  readonly mine: boolean
}

/** A person on foot (the player too, unless in a car). */
export interface HeardPerson {
  readonly id: number
  readonly x: number
  readonly y: number
  readonly vx: number
  readonly vy: number
  readonly player: boolean
  /** A pedestrian running away (Pedestrian mood "flee"). */
  readonly fleeing: boolean
  /** Knocked down. */
  readonly down: boolean
}

/** Something that happened since the last frame, known only inside a simulation system. */
export type Happening =
  | {
    readonly kind: "impact"
    /** What the vehicle `car` hit: a wall, another vehicle (`other`), a person (`other`), or the ground (`face`). */
    readonly hit: "wall" | "car" | "person" | "ground"
    /** Where: the contact point (a wall, a vehicle or the ground), or the person. */
    readonly x: number
    readonly y: number
    /** Impact speed, m/s: the closing speed at contact, or the car's speed. */
    readonly speed: number
    /** Mass behind the hit, t: the vehicle's, or the reduced mass of two vehicles. */
    readonly mass: number
    readonly car: number
    readonly other?: number
    /** The face of the body that struck the ground (hit "ground"). */
    readonly face?: "under" | "roof" | "side" | "front" | "rear"
    /** The vehicle `car`'s model and the zone of it the hit landed on; `otherBody`, the vehicle `other`'s (hit "car"). */
    readonly body: Body
    readonly otherBody?: Body
  }
  | {
    /** An AI driver held up for a while sounds the horn. */
    readonly kind: "honk"
    readonly car: number
    readonly model: VehicleModel
    readonly x: number
    readonly y: number
  }
  | {
    /** Lightning (the sim's `Lightning`): a bolt to the ground at (x, y) when `bolt`, else a flash in the cloud above it; `power` 0…1; `seed` shapes its thunder. */
    readonly kind: "lightning"
    readonly x: number
    readonly y: number
    readonly bolt: boolean
    readonly power: number
    readonly seed: number
  }

/** The ears: the player, on foot or in `car`. */
interface HeardListener {
  readonly x: number
  readonly y: number
  readonly vx: number
  readonly vy: number
  /** The vehicle the player sits in. */
  readonly car: number | undefined
  /** Net quarter turns of the view to the left of its home seat (the sim's `View`): the screen, and the stereo image, turn with it. */
  readonly turns: number
}

/** The game's clock and sun this frame (the sim's `GameClock`). */
export interface HeardSky {
  /** Game time, Unix UTC seconds: what the weather at the ears is worked out for. */
  readonly seconds: number
  /** The Rome calendar day (days since 1 January 1970 there) and the time of day there: the bells ring by them. */
  readonly day: number
  readonly hour: number
  readonly minute: number
  /** The sun's elevation over the map, degrees (negative below the horizon). */
  readonly sun: number
}

/** One frame of the world, as the audio schedule reads it. */
export interface Heard {
  readonly listener: HeardListener
  readonly vehicles: ReadonlyArray<HeardVehicle>
  readonly people: ReadonlyArray<HeardPerson>
  readonly happenings: ReadonlyArray<Happening>
  /** The player holds the horn key (it sounds only from the driver's seat). */
  readonly horn: boolean
  readonly sky: HeardSky
  /** The weather over the map (a copy of the sim's `Weather`): the director works out what it is at the ears. */
  readonly weather: WeatherValue
}

/** Where a sound reaches the listener from, after everything between them. */
export interface Placement {
  /** Linear gain at the listener (spreading, occlusion, cabin, mix); 0 is silent. */
  readonly gain: number
  /** Stereo position: −1 screen-left … 1 screen-right. */
  readonly pan: number
  /** Lowpass cutoff, Hz: air absorption, diffraction and the cabin combined. */
  readonly cutoff: number
  /** Doppler shift, cents. */
  readonly cents: number
  /** Reverb send, linear (0 dry). */
  readonly wet: number
}

/**
 * Continuous sounds: the director holds a key with fresh params every frame; the speaker keeps
 * one live voice per key and fades it out on the first frame it is not held.
 */
export type Continuous =
  /** Revs `rpm` and `load` 0…1; `inside`: heard from the driver's seat; `variant` 0…1: which of its model's engines (0.5 the nominal one). */
  | { readonly kind: "engine"; readonly model: VehicleModel; readonly rpm: number; readonly load: number; readonly inside: boolean; readonly variant: number }
  /** Rolling noise, squeal or gravel crunch: `speed` m/s over the ground, `skid` 0…1 past the tyres' grip, sliding at `slip` m/s. */
  | { readonly kind: "tyres"; readonly speed: number; readonly skid: number; readonly slip: number; readonly surface: Surface; readonly heavy: boolean }
  /** Grinding along a wall at `speed` m/s, on `material`. */
  | { readonly kind: "scrape"; readonly speed: number; readonly material: Material }
  /** A held horn. */
  | { readonly kind: "horn"; readonly model: VehicleModel }
  /** The Carabinieri two-tone siren. */
  | { readonly kind: "siren" }
  /** The truck's reversing beeper. */
  | { readonly kind: "beeper" }
  /** Running water: `flow` 0 (trickle) … 1 (the Lucido in spate); `body` sets the texture. */
  | { readonly kind: "water"; readonly body: "fountain" | "stream" | "river"; readonly flow: number }
  /** Wind at the listener: `strength` 0…1 (altitude, exposure, weather), `forest` 0…1 (leaves in it), `gusts` 0…1 (a steady breeze … squalls: deeper and quicker gusts; `VALLEY_GUSTS` the valley's usual). */
  | { readonly kind: "wind"; readonly strength: number; readonly forest: number; readonly gusts: number }
  /** Tree crickets in the grass around the listener: `density` 0…1; they chirp faster in warmer air (`celsius`). */
  | { readonly kind: "crickets"; readonly density: number; readonly celsius: number }
  /** Rain falling around the listener: `rate` mm/h, on the shares of the ground that are `forest` (leaves), `built` (roofs, paving) and `water` (a river, puddles), 0…1 each. */
  | { readonly kind: "rain"; readonly rate: number; readonly forest: number; readonly built: number; readonly water: number }
  /** Rain drumming on the roof and windscreen of the car the listener sits in: `rate` mm/h. */
  | { readonly kind: "roof"; readonly rate: number }

/** One-shot sounds: played once, at a placement, possibly delayed (sound travelling, echoes). */
export type OneShot =
  /** A vehicle hitting something: closing `speed` m/s, `mass` t (the car's, or the reduced mass of two), the `body` (the Impact's
   *  `car`: query order, not necessarily the striker), what it met (a wall's material, the ground's, or
   *  another vehicle), the `surface` debris lands on. */
  | { readonly kind: "crash"; readonly speed: number; readonly mass: number; readonly body: Body;
      readonly against: { readonly kind: "wall"; readonly material: Material } | { readonly kind: "car"; readonly body: Body };
      readonly surface: Surface }
  /** A body hit by a vehicle. */
  | { readonly kind: "thud"; readonly speed: number }
  /** The suspension bottoming out over a hump or a light landing, at `speed` m/s into its bump stops; `heavy`: the truck. */
  | { readonly kind: "clunk"; readonly speed: number; readonly heavy: boolean }
  | { readonly kind: "door"; readonly model: VehicleModel; readonly open: boolean }
  /** Starter motor until the engine catches. */
  | { readonly kind: "ignition"; readonly model: VehicleModel }
  /** A short AI honk. */
  | { readonly kind: "honk"; readonly model: VehicleModel }
  /** A footstep on `surface`, or crunching the snow that lies on it (`snow`). */
  | { readonly kind: "step"; readonly surface: Surface; readonly run: boolean; readonly snow: boolean }
  /** Human cues; `voice` 0…1 picks the speaker (pitch, sex) so one person keeps one voice. */
  | { readonly kind: "scream"; readonly voice: number }
  | { readonly kind: "shout"; readonly voice: number }
  | { readonly kind: "groan"; readonly voice: number }
  /** One stroke of a church bell with prime partial `pitch` Hz. */
  | { readonly kind: "bell"; readonly pitch: number }
  /** A songbird by day; the tawny owl (`owl`) at night. */
  | { readonly kind: "bird"; readonly species: "robin" | "tit" | "blackbird" | "chaffinch" | "owl" }
  | { readonly kind: "bark"; readonly big: boolean }
  /**
   * The thunder of a lightning flash `distance` m away horizontally (to the strike point of a `bolt`, to the point under an
   * in-cloud flash; not the slant range), heard with the ears `ears` m above the ground under the flash (1.6 on level ground,
   * hundreds on a ridge over a valley's strike, under 0 below one): a crack and a boom near, a low rumble far; `seed` (the
   * flash's) draws its channel.
   */
  | { readonly kind: "thunder"; readonly distance: number; readonly ears: number; readonly bolt: boolean; readonly seed: number }

/** Noise and control buffers made once per context and shared by every voice. */
export interface Kit {
  readonly white: AudioBuffer
  readonly pink: AudioBuffer
  readonly brown: AudioBuffer
  /** Sparse noise grains (gravel, leaves). */
  readonly crackle: AudioBuffer
  /** Slow −1…1 control signal at 8 kHz (gusts, surges). */
  readonly gust: AudioBuffer
}

/** A live continuous sound. Output peaks near 0.5 at the loudest params it is meant for. */
export interface Voice<P> {
  /** This frame's params; smooth every change with `setTargetAtTime`. */
  readonly update: (params: P, now: number) => void
  /** Fades out from `now` and frees its nodes. */
  readonly stop: (now: number) => void
}

/** What a voice or shot plays through: its emitter's input (`out`) and the emitter's Doppler signal (`cents`, connect it to detunes). */
export interface VoiceIo {
  readonly ctx: BaseAudioContext
  readonly out: AudioNode
  readonly cents: AudioNode
  readonly kit: Kit
}

/** What a one-shot plays through: a voice's io without the Doppler signal (a shot's emitter is placed once). */
export type ShotIo = Omit<VoiceIo, "cents">

/** Builds a voice's nodes (once per held key); the first `update` follows immediately. */
export type VoiceFactory<P> = (io: VoiceIo) => Voice<P>

/** A one-shot sound. */
export interface Shot<P> {
  /** Renders buffers ahead (OfflineAudioContext), once per context; a play before it resolves may be silent. */
  readonly prepare?: (ctx: BaseAudioContext, kit: Kit) => Promise<void>
  /** Schedules the sound at context time `when` into `io.out`; returns the context time it ends. */
  readonly play: (io: ShotIo, params: P, when: number) => number
}

/** A synth for every continuous kind. */
export type Voices = { readonly [K in Continuous["kind"]]: VoiceFactory<Extract<Continuous, { readonly kind: K }>> }
/** A synth for every one-shot kind. */
export type Shots = { readonly [K in OneShot["kind"]]: Shot<Extract<OneShot, { readonly kind: K }>> }

/** What the director plays through. The Web Audio implementation is `makeSpeaker`; tests record calls. */
export interface Speaker {
  /** Context time in seconds: the clock one-shots are scheduled on. */
  readonly now: () => number
  /** Keeps continuous voice `key` playing with `sound`'s params at `at`. */
  readonly hold: (key: string, sound: Continuous, at: Placement) => void
  /** Plays `sound` `delay` seconds from now. */
  readonly play: (sound: OneShot, at: Placement, delay: number) => void
  /** Fades out what is left of every play of `sound` (the same params object): its echoes too. */
  readonly stop: (sound: OneShot) => void
  /** Ends the frame: every voice not held since the last flush fades out. */
  readonly flush: () => void
}
