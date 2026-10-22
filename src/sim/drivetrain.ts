/**
 * Engine and gearbox: the full-load torque curve of each engine, the automatic gearbox that picks
 * a gear from road speed and pedal, the clutch that slips at a launch, and the revs and load that
 * result. The physics turns them into drive force at the wheels; the audio host plays the same revs
 * and load (`engineRevs`), so what is heard is what pushes the car.
 *
 * @module drivetrain
 */
import { type ChassisValue, STEP } from "./schema.ts"
import type { EngineSpec, VehicleSpec } from "./vehicles.ts"

/** Share of the engine's torque that reaches the wheels. */
const EFFICIENCY = 0.9
/** Engine braking with the pedal up, as a share of peak torque at the redline (less at low revs). */
const ENGINE_BRAKE = 0.15
/** Below this road speed (m/s) a vehicle counts as standing. */
const STILL = 0.3
/** Throttle against the motion faster than this (m/s) is the brake pedal; slower, it drives the other way. */
export const BRAKING = 0.5
/** Shift points as shares of the redline, pedal up to full pedal. */
const UP = [0.5, 0.92] as const
const DOWN = [0.24, 0.42] as const
/** rpm per rad/s. */
const RPM = 60 / (2 * Math.PI)

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/**
 * Full-load torque at `rpm`, N·m: from 60 % of peak at idle up to the peak at `torqueRpm`, flat
 * while the power stays under its peak (a turbo's plateau), then constant power to `powerRpm`,
 * falling to 80 % of that at the redline. Nothing past the redline: the limiter cuts the fuel.
 */
export const fullTorque = (engine: EngineSpec, rpm: number): number => {
  if (rpm >= engine.redline) return 0
  const peak = engine.torque, power = engine.power * 1000
  const plateau = Math.min(engine.powerRpm, (power / peak) * RPM)
  if (rpm <= engine.torqueRpm) return peak * lerp(0.6, 1, Math.max(0, (rpm - engine.idle) / (engine.torqueRpm - engine.idle)))
  if (rpm <= plateau) return peak
  const atPower = (power / engine.powerRpm) * RPM
  if (rpm <= engine.powerRpm) return (power / rpm) * RPM
  return atPower * lerp(1, 0.8, (rpm - engine.powerRpm) / (engine.redline - engine.powerRpm))
}

/** Engine braking torque at `rpm` with the pedal up, N·m (negative). */
const dragTorque = (engine: EngineSpec, rpm: number): number =>
  -ENGINE_BRAKE * engine.torque * (0.2 + 0.8 * Math.max(0, (rpm - engine.idle) / (engine.redline - engine.idle)))

/** Overall ratio (gearbox × final drive) of `gear` (−1: reverse). */
const overall = (spec: VehicleSpec, gear: number): number =>
  (gear < 0 ? spec.gearbox.reverse : spec.gearbox.ratios[Math.min(gear, spec.gearbox.ratios.length - 1)]!) * spec.gearbox.final

/** Engine rpm the wheels turn it at in `gear` at road `speed` (m/s, either sign). */
const wheelRpm = (spec: VehicleSpec, gear: number, speed: number): number => (Math.abs(speed) / spec.wheelRadius) * overall(spec, gear) * RPM

/** The pedal the way `gear` drives, 0…1 (throttle against it is the brake, not the engine's). */
const pedalOf = (gear: number, throttle: number): number => Math.min(1, Math.max(0, gear < 0 ? -throttle : throttle))

/** The gear a vehicle already rolling at `speed` would hold under full pedal: the highest whose revs stay over the full-pedal downshift point. */
export const gearFor = (spec: VehicleSpec, speed: number): number => {
  if (speed < -STILL) return -1
  const top = spec.gearbox.ratios.length - 1
  let gear = 0
  while (gear < top && wheelRpm(spec, gear + 1, speed) >= DOWN[1] * spec.engine.redline) gear++
  return gear
}

/**
 * The automatic gearbox, one step: up when the revs pass 50–92 % of the redline (more pedal, later),
 * down when they fall under 24–42 % and the lower gear would not be over 90 % of the upshift
 * point (so it never hunts). Reverse when the throttle pulls backwards (not braking: slower than
 * BRAKING forwards) or the car coasts backwards; first gear again when it pulls forwards, which
 * also stops a car rolling back. A shift takes the gearbox's `shift` seconds, during which the
 * drive is cut and no other shift starts.
 */
export const shiftGear = (spec: VehicleSpec, chassis: Pick<ChassisValue, "gear" | "shiftUntil">, speed: number, throttle: number, step: number) => {
  const top = spec.gearbox.ratios.length - 1
  let gear = chassis.gear
  if ((throttle < 0 && speed < BRAKING) || (throttle === 0 && speed < -STILL)) gear = -1
  else if (gear < 0) gear = (throttle > 0 && speed > -BRAKING) || (throttle === 0 && speed > STILL) ? 0 : gear
  else if (step >= chassis.shiftUntil) {
    const pedal = pedalOf(gear, throttle)
    const up = lerp(UP[0], UP[1], pedal) * spec.engine.redline, down = lerp(DOWN[0], DOWN[1], pedal) * spec.engine.redline
    if (gear < top && wheelRpm(spec, gear, speed) > up) gear++
    else if (gear > 0 && wheelRpm(spec, gear, speed) < down && wheelRpm(spec, gear - 1, speed) < up * 0.9) gear--
  }
  const changed = gear !== chassis.gear && gear >= 0 && chassis.gear >= 0
  return { gear, shiftUntil: changed ? step + Math.max(1, Math.round(spec.gearbox.shift / STEP.dt)) : chassis.shiftUntil }
}

/** What the engine does: rpm, load 0…1 (the pedal's share of full torque; 0 while shifting, braking or on the limiter). */
interface Revs {
  readonly rpm: number
  readonly load: number
}

/**
 * The engine's revs and load at road `speed` and `throttle` in the chassis's gear: the wheels set
 * the revs, except in first gear and reverse where the clutch slips up to idle plus the pedal's
 * share of the launch revs; never under idle or over the redline.
 */
export const engineRevs = (spec: VehicleSpec, chassis: Pick<ChassisValue, "gear" | "shiftUntil">, speed: number, throttle: number, step: number): Revs => {
  const pedal = pedalOf(chassis.gear, throttle), { idle, redline } = spec.engine
  const clutch = chassis.gear <= 0 ? idle + pedal * (spec.gearbox.launch - idle) : idle
  const rpm = Math.min(redline, Math.max(wheelRpm(spec, chassis.gear, speed), clutch))
  const limited = spec.limiter !== undefined && Math.abs(speed) >= spec.limiter
  return { rpm, load: step < chassis.shiftUntil || limited ? 0 : pedal }
}

/**
 * Drive force at the road from the engine (N, + forward): full-load torque × pedal through the
 * gears the way the gear drives, or engine braking against the motion with the pedal up (none with
 * the clutch open, standing or crawling in first).
 */
export const driveForce = (spec: VehicleSpec, chassis: Pick<ChassisValue, "gear" | "shiftUntil">, speed: number, throttle: number, step: number): number => {
  const { rpm, load } = engineRevs(spec, chassis, speed, throttle, step)
  const ratio = (overall(spec, chassis.gear) * EFFICIENCY) / spec.wheelRadius
  if (load > 0) return (chassis.gear < 0 ? -1 : 1) * load * fullTorque(spec.engine, rpm) * ratio
  if (pedalOf(chassis.gear, throttle) > 0 || step < chassis.shiftUntil || wheelRpm(spec, chassis.gear, speed) < spec.engine.idle) return 0
  return Math.sign(speed) * dragTorque(spec.engine, rpm) * ratio
}
