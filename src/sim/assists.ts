/**
 * Driving assists that no real car has, for the handling's arcade end (off at the real handling):
 * a stability assist that keeps a car pointed where it is steered, and self-righting that rolls a
 * vehicle lying on its side or roof back onto its wheels. Each returns what to add this substep;
 * `integrate` (dynamics.ts) applies it with the tyres' and the body's forces.
 *
 * @module assists
 */
import { Ops } from "@typeonce/ritmo-math"

import type { Rig } from "./chassis.ts"

/** The assist's pull of the yaw rate toward the steered one, and of the sideways slide toward none, 1/s at full strength. */
const YAW_GAIN = 6
const SLIDE_GAIN = 4
/** Slower than this (m/s) there is nothing to steady. */
const STEADY_FROM = 2
/** The assist pushes sideways with at most this share of the vehicle's weight. */
const SLIDE_MOST = 1

/**
 * The stability assist's yaw torque (N·m) and sideways force (N, heading frame) on a body moving at
 * `vf` forward and `vl` to its left with yaw rate `spin`, its road wheels at `steer`: it turns the
 * yaw toward the one the steering asks for (v · tan(steer) / wheelbase, but no faster than the
 * tyres' grip can turn the path) and damps the rear axle's slide (a clean turn's centre of mass
 * moves sideways at spin × rear; only the rear axle's sideways speed is a slide), both scaled by
 * the rig's `stability`. Off in the air, while slow, and while the handbrake is held, so a
 * handbrake turn still swings the car round.
 */
export const steadying = (
  rig: Rig,
  vf: number,
  vl: number,
  spin: number,
  steer: number,
  wheelsDown: number,
  handbrake: boolean,
) => {
  if (rig.stability === 0 || handbrake || wheelsDown < 2 || Math.abs(vf) < STEADY_FROM)
    return { yaw: 0, side: 0 }
  const m = rig.spec.mass,
    most = SLIDE_MOST * m * 9.81,
    turning = (rig.spec.tyres.grip * 9.81) / Math.abs(vf)
  const wanted = Math.max(-turning, Math.min(turning, (vf * Ops.tan(steer)) / rig.wheelbase))
  return {
    yaw: rig.stability * rig.iz * (wanted - spin) * YAW_GAIN,
    side: Math.max(-most, Math.min(most, -rig.stability * m * (vl - spin * rig.rear) * SLIDE_GAIN)),
  }
}

/** Rolling back onto its wheels: the roll and pitch rates (rad/s) a righting vehicle turns at, and how fast it takes them up (1/s). */
const RIGHTING = 2.5
const RIGHTING_GAIN = 30
/** A vehicle moving faster than this (m/s) is still sliding or tumbling: it is left to land first (rolling over swings it a little). */
const RIGHTING_FROM = 3
/** It rights itself until its up axis is this close to vertical (cosine, ≈ 25°), so it does not hang at the edge of its wheels. */
const RIGHTED = 0.9
/** Within this many radians per rad/s of upright it turns slower, in proportion to the angle left. */
const SETTLING = 2
/** On its roof it hops at this speed (m/s), so the roof's edge does not dig in and hold it there. */
const HOP = 1.5

/**
 * Self-righting: a vehicle with the rig's `selfRighting` on, `down` on the ground but not on all its
 * wheels (its body resting, or only some wheels carrying it as it rolls up onto them), tilted more
 * than RIGHTED from upright (`up`, its up axis's height) and nearly stopped, has its roll and pitch
 * rates turned toward upright, and on its roof hops, so it rolls back onto its wheels within a
 * couple of seconds. Returns the new rates and vertical speed.
 */
export const righting = (
  rig: Rig,
  up: number,
  down: boolean,
  speed: number,
  roll: number,
  pitch: number,
  rates: { readonly rollRate: number; readonly pitchRate: number; readonly vz: number },
  h: number,
) => {
  if (rig.selfRighting === 0 || !down || up >= RIGHTED || speed > RIGHTING_FROM) return rates
  const take = Math.min(1, RIGHTING_GAIN * h)
  // Slower as it nears upright, so it settles onto its wheels rather than rock over them.
  const toward = (angle: number, rate: number) =>
    Math.abs(angle) < 0.05
      ? rate
      : rate + (-Math.sign(angle) * Math.min(RIGHTING, SETTLING * Math.abs(angle)) - rate) * take
  return {
    rollRate: toward(roll, rates.rollRate),
    pitchRate: toward(pitch, rates.pitchRate),
    vz: up < 0 ? rates.vz + (HOP - rates.vz) * take : rates.vz,
  }
}
