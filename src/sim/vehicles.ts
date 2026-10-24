/**
 * The closed set of vehicle models and what each one is: body, mass, wheels, tyres, brakes, engine
 * and gearbox. Handling is not tuned here: top speed, acceleration, braking, cornering grip and the
 * speed at which a vehicle tips over all follow from these numbers in the drive physics
 * (`systems/physics.ts`). Render code keeps its own `satisfies Record<VehicleModel, ...>` mesh
 * table and the audio its trims, so a new model fails to compile until it has stats, a mesh and a
 * sound.
 *
 * Sources: Fiat Panda III 1.2 FIRE 69 CV and Alfa Romeo Giulia 2.0 Turbo 200 CV data sheets, the
 * Piaggio Ape 50 (1.8 kW two-stroke, 37–45 km/h), and an Iveco Trakker 6x4 tipper (Cursor 13,
 * 2100 Nm) laden with a marble block. Gear ratios are representative, set so each engine reaches
 * its published top speed; wheel positions, wheel sizes and roof heights match the meshes in
 * `src/render/actors.ts` (the drawn underbodies sit 0.1–0.2 m above `clearance`).
 */
export const VEHICLE_MODELS = ["panda", "ape", "truck", "carabinieri"] as const
export type VehicleModel = (typeof VEHICLE_MODELS)[number]

/** A wheel's contact point at rest, from the centre of mass (forward and left, m), and what it does. */
export interface WheelSpec {
  readonly x: number
  readonly y: number
  readonly steered: boolean
  readonly driven: boolean
}

/** A piston engine: what it burns, how it is built, and its full-load torque curve. */
export interface EngineSpec {
  readonly fuel: "petrol" | "diesel"
  /** Two-stroke or four-stroke cycle. */
  readonly strokes: 2 | 4
  readonly cylinders: number
  /** Swept volume, cm³. */
  readonly displacement: number
  readonly aspiration: "natural" | "turbo"
  /** Peak torque (N·m) from `torqueRpm`, peak power (kW) at `powerRpm`. */
  readonly torque: number
  readonly torqueRpm: number
  readonly power: number
  readonly powerRpm: number
  readonly idle: number
  readonly redline: number
}

/** An automatic (or automated) gearbox: forward ratios lowest first, reverse, final drive. */
export interface GearboxSpec {
  readonly ratios: ReadonlyArray<number>
  readonly reverse: number
  readonly final: number
  /** Seconds a shift cuts the drive. */
  readonly shift: number
  /** Engine rpm the clutch slips at in first gear under full pedal (a launch). */
  readonly launch: number
}

/** One model's body, mass, wheels, tyres, brakes, engine, gearbox, drag and suspension: everything its handling follows from. */
export interface VehicleSpec {
  readonly label: string
  /** Body length and width in metres (collision is a row of circles along the length). */
  readonly length: number
  readonly width: number
  /** Roof height and underbody clearance above the ground at rest, m (where the body touches down when it lands or rolls). */
  readonly height: number
  readonly clearance: number
  /** Kerb mass with a driver (and the truck's marble), kg. */
  readonly mass: number
  /** Height of the centre of mass above the ground at rest, m. */
  readonly cg: number
  readonly wheels: ReadonlyArray<WheelSpec>
  readonly wheelRadius: number
  /** Tyre grip as a share of the surface's (truck and Ape tyres grip less than a car's), and the slip angle of peak cornering force, rad. */
  readonly tyres: { readonly grip: number; readonly slip: number }
  /** Turning radius of the centre of mass at full lock and walking pace, m (sets the steering lock). */
  readonly turnRadius: number
  /** Full-pedal braking as a deceleration (m/s²) if the tyres allow it, the front axle's share, and whether ABS keeps the wheels from locking. */
  readonly brakes: { readonly decel: number; readonly front: number; readonly abs: boolean }
  /** Traction control: the driven wheels never spin. */
  readonly traction: boolean
  readonly engine: EngineSpec
  readonly gearbox: GearboxSpec
  /** Drag coefficient × frontal area, m². */
  readonly drag: number
  /** Road-speed limiter, m/s (trucks are held to 90 km/h). */
  readonly limiter?: number
  /**
   * Height of the engine's air intake above the ground at rest, m (estimates from each model's layout): water over it stalls the
   * engine. The Panda and the Giulia breathe behind the grille, the Ape under its seat, the truck through a stack behind the cab.
   */
  readonly intake: number
  /**
   * Suspension: natural frequency of the body on its springs (Hz), damping ratio, and the front and
   * rear anti-roll bars' stiffness as a share of the springs' (a stiffer front bar makes the car
   * understeer at the limit instead of spinning).
   */
  readonly ride: {
    readonly hz: number
    readonly damping: number
    readonly antiRoll: readonly [front: number, rear: number]
  }
}

const wheel = (x: number, y: number, steered: boolean, driven: boolean): WheelSpec => ({
  x,
  y,
  steered,
  driven,
})

/** Every model's spec. */
export const VEHICLES = {
  panda: {
    label: "Fiat Panda",
    length: 3.7,
    width: 1.65,
    height: 1.68,
    clearance: 0.2,
    mass: 1015,
    cg: 0.56,
    // Front-wheel drive, 57 % on the front axle.
    wheels: [
      wheel(1, 0.725, true, true),
      wheel(1, -0.725, true, true),
      wheel(-1.3, 0.725, false, false),
      wheel(-1.3, -0.725, false, false),
    ],
    wheelRadius: 0.3,
    tyres: { grip: 1, slip: 0.13 },
    turnRadius: 2.5,
    brakes: { decel: 10, front: 0.7, abs: true },
    traction: false,
    engine: {
      fuel: "petrol",
      strokes: 4,
      cylinders: 4,
      displacement: 1242,
      aspiration: "natural",
      torque: 102,
      torqueRpm: 3000,
      power: 51,
      powerRpm: 5500,
      idle: 800,
      redline: 6200,
    },
    gearbox: {
      ratios: [3.909, 2.238, 1.52, 1.156, 0.946],
      reverse: 3.909,
      final: 4.071,
      shift: 0.35,
      launch: 1800,
    },
    drag: 0.69,
    intake: 0.6,
    ride: { hz: 1.5, damping: 0.35, antiRoll: [0.6, 0.2] },
  },
  ape: {
    label: "Piaggio Ape",
    length: 2.9,
    width: 1.4,
    height: 1.4,
    clearance: 0.2,
    mass: 385,
    cg: 0.62,
    // One wheel in front, the rear axle driven; 40 % on the front wheel.
    wheels: [
      wheel(1.05, 0, true, false),
      wheel(-0.7, 0.6, false, true),
      wheel(-0.7, -0.6, false, true),
    ],
    wheelRadius: 0.25,
    tyres: { grip: 0.85, slip: 0.15 },
    turnRadius: 2.15,
    brakes: { decel: 6.5, front: 0.5, abs: false },
    traction: false,
    engine: {
      fuel: "petrol",
      strokes: 2,
      cylinders: 1,
      displacement: 50,
      aspiration: "natural",
      torque: 3.4,
      torqueRpm: 4500,
      power: 1.8,
      powerRpm: 5750,
      idle: 1600,
      redline: 6800,
    },
    gearbox: { ratios: [5.8, 3.3, 2, 1.25], reverse: 5.8, final: 10.8, shift: 0.4, launch: 4500 },
    drag: 1.15,
    intake: 0.45,
    ride: { hz: 2, damping: 0.25, antiRoll: [0, 0.8] },
  },
  truck: {
    label: "Camion del marmo",
    length: 7.6,
    width: 2.45,
    height: 2.65,
    clearance: 0.4,
    mass: 26000,
    cg: 1.7,
    // Cab-over front axle, the driven rear tandem as one axle midway between its two; 40 % on the front.
    wheels: [
      wheel(2.8, 1.075, true, false),
      wheel(2.8, -1.075, true, false),
      wheel(-1.85, 1.075, false, true),
      wheel(-1.85, -1.075, false, true),
    ],
    wheelRadius: 0.5,
    tyres: { grip: 0.8, slip: 0.12 },
    turnRadius: 4.6,
    brakes: { decel: 6.5, front: 0.35, abs: true },
    traction: true,
    engine: {
      fuel: "diesel",
      strokes: 4,
      cylinders: 6,
      displacement: 12880,
      aspiration: "turbo",
      torque: 2100,
      torqueRpm: 1000,
      power: 302,
      powerRpm: 1900,
      idle: 600,
      redline: 2300,
    },
    gearbox: {
      ratios: [15.86, 12.33, 9.57, 7.44, 5.87, 4.57, 3.47, 2.7, 2.1, 1.63, 1.29, 1],
      reverse: 14.5,
      final: 3.77,
      shift: 0.5,
      launch: 1000,
    },
    drag: 6,
    limiter: 25,
    intake: 2.4,
    ride: { hz: 1.8, damping: 0.3, antiRoll: [0.6, 0.6] },
  },
  carabinieri: {
    label: "Alfa Romeo Giulia dei Carabinieri",
    length: 4.6,
    width: 1.85,
    height: 1.55,
    clearance: 0.15,
    mass: 1580,
    cg: 0.5,
    // Rear-wheel drive, 50:50.
    wheels: [
      wheel(1.41, 0.825, true, false),
      wheel(1.41, -0.825, true, false),
      wheel(-1.41, 0.825, false, true),
      wheel(-1.41, -0.825, false, true),
    ],
    wheelRadius: 0.33,
    tyres: { grip: 1.05, slip: 0.12 },
    turnRadius: 2.75,
    brakes: { decel: 11, front: 0.65, abs: true },
    traction: true,
    engine: {
      fuel: "petrol",
      strokes: 4,
      cylinders: 4,
      displacement: 1995,
      aspiration: "turbo",
      torque: 330,
      torqueRpm: 1750,
      power: 147,
      powerRpm: 4500,
      idle: 750,
      redline: 6000,
    },
    gearbox: {
      ratios: [5, 3.2, 2.14, 1.72, 1.31, 1, 0.82, 0.64],
      reverse: 3.46,
      final: 3.27,
      shift: 0.12,
      launch: 1800,
    },
    drag: 0.68,
    intake: 0.55,
    ride: { hz: 1.6, damping: 0.35, antiRoll: [0.8, 0.3] },
  },
} as const satisfies Record<VehicleModel, VehicleSpec>

/** Civilian paint colours (sRGB hex), picked with the world's Rng. */
export const CAR_COLORS = [
  0xb8312b, 0xf2efe6, 0x3d6155, 0x1d2b4f, 0xd4a85e, 0x74746f, 0x4a3222, 0x8db4b0,
] as const
