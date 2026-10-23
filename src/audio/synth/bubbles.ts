/**
 * Water as bubbles (van den Doel 2005, "Physically-based Models for Liquid Sounds"): each bubble
 * rings once at its Minnaert frequency 3/r, damped by viscosity and heat, and the few bursting at
 * the surface chirp upwards. A population of them, sized by a power law and arriving as a Poisson
 * process, is the texture of a fountain, a stream or the Lucido's rapids. Pure, so Node tests it;
 * the water voice loops it.
 *
 * @module audio/synth/bubbles
 */

/** A bubble population; radii in metres. */
export interface Bubbles {
  /** Bubbles per second: up to 1000 a trickle, 10 000 dense, 100 000 a waterfall. */
  readonly rate: number
  readonly rMin: number
  readonly rMax: number
  /** Size law: the count per log-radius falls as r^−gamma (0–3 sounds like a stream, above 5 like rain). */
  readonly gamma: number
  /** Pitch rise of the bubbles bursting at the surface: about 0.1 for drops, 0.5–1 for big bubbles. */
  readonly xi: number
}

/** Minnaert resonance of a bubble of radius `r` m, Hz. */
export const minnaert = (r: number): number => 3 / r

/** Decay rate of a ringing bubble of radius `r` m, 1/s: viscous plus thermal damping (valid above 0.15 mm). */
const damping = (r: number): number => 0.13 / r + 0.0072 * r ** -1.5

/** `seconds` of `bubbles` at `sampleRate`, RMS 0.2; bubbles ringing past the end wrap to the start, so it loops seamlessly. */
export const bubbleTexture = (
  sampleRate: number,
  seconds: number,
  bubbles: Bubbles,
  random: () => number = Math.random,
): Float32Array<ArrayBuffer> => {
  const { rate, rMin, rMax, gamma, xi } = bubbles
  const n = Math.floor(sampleRate * seconds),
    out = new Float32Array(n)
  const a0 = rMin ** -gamma,
    a1 = rMax ** -gamma
  for (let t = 0; t < seconds; t += -Math.log(1 - random()) / rate) {
    // Inverse-CDF radius: log-uniform for gamma 0, else r^−gamma per log-radius.
    const r =
      gamma === 0 ? rMin * (rMax / rMin) ** random() : (a0 - random() * (a0 - a1)) ** (-1 / gamma)
    const f0 = minnaert(r)
    if (f0 > 0.45 * sampleRate) continue
    // Depth factor D = rnd^10 (most bubbles faint), amplitude D·(r/rMax)^1.5; only D > 0.9 rises in pitch.
    const d = damping(r),
      depth = random() ** 10,
      rise = depth > 0.9 ? xi * d : 0
    const len = Math.min(n, Math.ceil((5 / d) * sampleRate))
    const w = (2 * Math.PI * f0) / sampleRate,
      decay = Math.exp(-d / sampleRate)
    let amp = depth * (r / rMax) ** 1.5,
      i = Math.floor(t * sampleRate)
    if (rise === 0) {
      // A steady damped sine by its two-term recurrence: no sin() per sample.
      const c = 2 * decay * Math.cos(w),
        k2 = decay * decay
      let prev = 0,
        cur = amp * Math.sin(w)
      for (let j = 0; j < len; j++, i = i + 1 === n ? 0 : i + 1) {
        out[i]! += cur
        const next = c * cur - k2 * prev
        prev = cur
        cur = next
      }
    } else {
      let phase = 0
      for (let j = 0; j < len; j++, i = i + 1 === n ? 0 : i + 1) {
        phase += w * (1 + (rise * j) / sampleRate)
        out[i]! += amp * Math.sin(phase)
        amp *= decay
      }
    }
  }
  let energy = 0
  for (const v of out) energy += v * v
  const gain = energy > 0 ? 0.2 / Math.sqrt(energy / n) : 0
  for (let i = 0; i < n; i++) out[i]! *= gain
  return out
}
