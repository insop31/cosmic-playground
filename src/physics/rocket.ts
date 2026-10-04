// Pure 2D flight model for the Rocket Lab. The live flight (RocketModel) and the
// trajectory preview step this same model with the same fixed time step, so the preview is
// an exact prediction of the flight (weather hazards aside, which are random by nature).
//
// Coordinates: the launch pad is at (0, 0); the planet's centre is at (0, −R). "Up" is the
// local vertical (away from the centre) and "downrange" is the direction of travel along
// the surface. Units are scene units; thrust in kN divided by mass in kg gives scene
// accelerations after THRUST_SCALE.
import type {
  FlightEventKind,
  FlightEventRecord,
  LaunchOutcome,
  OrbitPathState,
  RocketParams,
} from '@/worlds/rocket/rocketTypes';

export const FLIGHT_DT = 1 / 60;              // Fixed flight step (s)
export const PREVIEW_DURATION = 90;           // Seconds of flight the preview predicts

// ── Scene-scale tuning shared by flight and preview ──────────────────────────
const GRAVITY_SCALE = 0.01;                   // m/s² slider → scene units/s²
export const THRUST_SCALE = 0.4;              // kN/kg → scene units/s²
const FRONTAL_AREA = 0.3;                     // nose-on reference area
const SIDE_AREA = 3.0;                        // side-on area (a rocket is long and thin)
const SIDE_DRAG_COEFFICIENT = 1.0;            // a cylinder broadside to the flow
export const SCALE_HEIGHT = 6;                // air thins by a factor e every 6 units
// Wind is exaggerated so a crosswind visibly pushes the rocket off course.
const WIND_SCALE = 0.04;                      // m/s slider → scene units/s
const WIND_SCALE_HEIGHT = 12;
const VACUUM_THRUST_FACTOR = 1.15;            // engines push harder without air pressure
const STAGE_TWO_ISP_GAIN = 1.08;              // upper-stage engines are tuned for vacuum
export const STAGE_ONE_DRY_FRACTION = 0.5;    // share of the dry mass dropped with stage 1
export const STAGE_GAP = 0.5;                 // minimum coast between stage 1 cutoff and stage 2 ignition
const MAX_COAST_TO_APOAPSIS = 90;             // stage 2 waits at most this long for apoapsis
const TURN_START_ALTITUDE = 0.6;              // vertical climb before pitching over
const PITCH_KICK_DURATION = 2;                // seconds to tip over to the chosen angle
const UPPER_STAGE_MAX_PITCH = (80 * Math.PI) / 180; // stage 2 never points below 10° above the horizon
const G0 = 9.80665;

// ── Outcomes ─────────────────────────────────────────────────────────────────
export const ORBIT_ALTITUDE_THRESHOLD = 45;   // reference altitude for the orbit-speed readout
export const MIN_PERIAPSIS_ALTITUDE = 18;     // an orbit must stay above the thick air (<5% density)
export const ESCAPE_JUDGE_ALTITUDE = 25;      // escape is judged once clear of the dense air
export const SUBORBITAL_ALTITUDE = 25;
export const ORBIT_TIME_COMPRESSION = 10;     // orbits play back 10× faster than real time

// Aerodynamic heating (Sutton–Graves): rate ∝ √ρ · v³, raised by the thermal-load setting.
export const HEATING_COEFFICIENT = 0.01;
export const HEAT_SHIELD_LIMIT = 1;

// ── Weather hazards ──────────────────────────────────────────────────────────
export const LIGHTNING_ALTITUDE = 15;         // storm clouds reach this high
export const LIGHTNING_RATE = 0.06;           // strikes per second while inside them
export const COLD_SEAL_THRESHOLD = -20;       // °C; colder than this, seals can fail
const SEAL_FAILURE_THRUST = 0.6;              // thrust left after an O-ring leak

export interface FlightEnvironment {
  /** Lightning can strike while climbing through storm clouds. */
  lightning: boolean;
  /** Seed for this launch's random hazards; the same seed replays the same flight. */
  seed: number;
}

export const CALM_ENVIRONMENT: FlightEnvironment = { lightning: false, seed: 1 };

export interface FlightState {
  px: number;
  py: number;
  vx: number;
  vy: number;
  fuel1: number;                 // kg left in stage 1 (all the fuel without staging)
  fuel2: number;                 // kg left in stage 2
  stage: 1 | 2 | 0;              // burning stage; 0 once every engine has stopped
  stageGap: number;              // seconds left of the minimum coast after separation
  coastTime: number;             // seconds stage 2 has waited for apoapsis
  stage2Lit: boolean;
  stageSeparated: boolean;
  elapsed: number;
  heat: number;                  // accumulated heating ÷ heat-shield limit
  q: number;                     // current dynamic pressure ½ρv²
  maxQ: number;
  maxQLogged: boolean;
  attitude: number;              // radians from local vertical, + downrange
  pitchStart: number;            // time the pitch-over began (−1 before)
  gravityTurn: boolean;          // following the velocity vector
  liftedOff: boolean;
  maxAltitude: number;
  engineFactor: number;          // 1, or less after a seal failure
  engineOut: boolean;            // lightning shut the engines down
  sealFailAt: number;            // scheduled seal failure time (−1 none)
  rng: number;                   // random state for hazards
  events: FlightEventRecord[];
}

export interface FlightVerdict {
  outcome: Exclude<LaunchOutcome, 'none'>;
  reason: string;
  orbit: OrbitPathState | null;
}

export interface FlightStepResult {
  state: FlightState;
  events: FlightEventRecord[];
  verdict: FlightVerdict | null;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** mulberry32: small, fast, seedable. Returns [random in 0–1, next state]. */
const nextRandom = (state: number): [number, number] => {
  let t = (state + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, (state + 0x6d2b79f5) | 0];
};

const stageFuel = (params: RocketParams) => {
  if (!params.stageSeparation) return [params.fuelMass, 0];
  const share = clamp(params.stage2FuelShare, 0.05, 0.95);
  return [params.fuelMass * (1 - share), params.fuelMass * share];
};

export const initialFlightState = (params: RocketParams, env: FlightEnvironment = CALM_ENVIRONMENT): FlightState => {
  const [fuel1, fuel2] = stageFuel(params);
  return {
    px: 0,
    py: 0,
    vx: 0,
    vy: 0,
    fuel1,
    fuel2,
    stage: 1,
    stageGap: 0,
    coastTime: 0,
    stage2Lit: false,
    stageSeparated: false,
    elapsed: 0,
    heat: 0,
    q: 0,
    maxQ: 0,
    maxQLogged: false,
    attitude: (params.padTilt * Math.PI) / 180,
    pitchStart: -1,
    gravityTurn: false,
    liftedOff: false,
    maxAltitude: 0,
    engineFactor: 1,
    engineOut: false,
    sealFailAt: -2,
    rng: env.seed | 0,
    events: [],
  };
};

// ── Planet and atmosphere ────────────────────────────────────────────────────

/** Gravitational parameter μ = g₀·R² from surface gravity and radius. */
export const gravitationalParameter = (params: RocketParams) =>
  params.gravity * GRAVITY_SCALE * params.planetRadius * params.planetRadius;

export const radiusOf = (params: RocketParams, s: Pick<FlightState, 'px' | 'py'>) =>
  Math.hypot(s.px, s.py + params.planetRadius);

export const altitudeOf = (params: RocketParams, s: Pick<FlightState, 'px' | 'py'>) =>
  radiusOf(params, s) - params.planetRadius;

/** Escape speed √(2μ/r) at the given altitude. */
export const escapeSpeedAt = (params: RocketParams, altitude: number) =>
  Math.sqrt((2 * gravitationalParameter(params)) / (params.planetRadius + Math.max(altitude, 0)));

/** Circular orbit speed √(μ/r) at the given altitude. */
export const orbitalSpeedAt = (params: RocketParams, altitude: number) =>
  Math.sqrt(gravitationalParameter(params) / (params.planetRadius + Math.max(altitude, 0)));

/** Sea-level air density from the density slider, pressure and temperature (ρ ∝ p/T). */
export const surfaceDensity = (params: RocketParams) =>
  Math.max(0, params.atmosphericDensity * params.atmosphericPressure * (288 / (273 + clamp(params.ambientTemperature, -80, 80))));

export const airDensity = (params: RocketParams, altitude: number) =>
  surfaceDensity(params) * Math.exp(-Math.max(altitude, 0) / SCALE_HEIGHT);

/** Engine efficiency at launch-day temperature. */
const temperatureFactor = (params: RocketParams) => clamp(1 - (params.ambientTemperature - 15) * 0.0024, 0.82, 1.08);

/** Sea-level thrust share from launch-day pressure; vacuum thrust is higher still. */
const seaLevelFactor = (params: RocketParams) => clamp(1.04 - (params.atmosphericPressure - 1) * 0.22, 0.78, 1.14);

/** Thrust multiplier at altitude: blends from sea-level to vacuum as the air thins. */
export const thrustFactorAt = (params: RocketParams, altitude: number) => {
  const rho0 = surfaceDensity(params);
  const thin = rho0 > 0 ? 1 - airDensity(params, altitude) / rho0 : 1;
  return temperatureFactor(params) * (seaLevelFactor(params) + (VACUUM_THRUST_FACTOR - seaLevelFactor(params)) * thin);
};

/** Stage-1 propellant flow (kg/s): the burn-duration slider spreads the fuel over that time. */
const stageOneFlow = (params: RocketParams) => params.fuelMass / Math.max(params.burnDuration, 0.1);

/** Exhaust speed (scene units/s) in vacuum for each stage. */
const exhaustSpeeds = (params: RocketParams) => {
  const ve1 = (params.thrustForce * THRUST_SCALE * VACUUM_THRUST_FACTOR) / stageOneFlow(params);
  return [ve1, ve1 * STAGE_TWO_ISP_GAIN];
};

const stageTwoFlow = (params: RocketParams) =>
  (params.stage2Thrust * THRUST_SCALE * VACUUM_THRUST_FACTOR) / exhaustSpeeds(params)[1];

const dryMassNow = (params: RocketParams, s: FlightState) =>
  params.dryMass * (s.stageSeparated ? 1 - STAGE_ONE_DRY_FRACTION : 1);

export const vehicleMass = (params: RocketParams, s: FlightState) => dryMassNow(params, s) + s.fuel1 + s.fuel2;

export interface VehicleSummary {
  /** Thrust ÷ weight at ignition; below 1 the rocket cannot leave the pad. */
  liftoffThrustToWeight: number;
  /** Sea-level specific impulse in seconds (exhaust speed ÷ g₀). */
  ispSeaLevel: number;
  /** Ideal velocity change from the rocket equation, Δv = vₑ·ln(m₀/m_f), summed over stages. */
  deltaV: number;
  burnTimes: number[];
  /** Speed for a circular orbit at the judging altitude. */
  orbitSpeed: number;
  /** Escape speed from the surface. */
  escapeSpeed: number;
}

export const vehicleSummary = (params: RocketParams): VehicleSummary => {
  const [fuel1, fuel2] = stageFuel(params);
  const [ve1, ve2] = exhaustSpeeds(params);
  const m0 = params.dryMass + params.fuelMass;
  let deltaV = ve1 * Math.log(m0 / (m0 - fuel1));
  const burnTimes = [fuel1 / stageOneFlow(params)];
  if (params.stageSeparation && fuel2 > 0) {
    const m2 = params.dryMass * (1 - STAGE_ONE_DRY_FRACTION) + fuel2;
    deltaV += ve2 * Math.log(m2 / (m2 - fuel2));
    burnTimes.push(fuel2 / stageTwoFlow(params));
  }
  const flow = stageOneFlow(params);
  return {
    liftoffThrustToWeight: (params.thrustForce * THRUST_SCALE * thrustFactorAt(params, 0)) / m0 / (params.gravity * GRAVITY_SCALE || 1e-9),
    ispSeaLevel: (params.thrustForce * 1000 * seaLevelFactor(params) * temperatureFactor(params)) / flow / G0,
    deltaV,
    burnTimes,
    orbitSpeed: orbitalSpeedAt(params, ORBIT_ALTITUDE_THRESHOLD),
    escapeSpeed: escapeSpeedAt(params, 0),
  };
};

// ── Orbits ───────────────────────────────────────────────────────────────────

export interface OrbitalElements {
  /** Specific orbital energy ε = v²/2 − μ/r (negative = bound). */
  energy: number;
  semiMajorAxis: number;
  eccentricity: number;
  /** Eccentricity vector, pointing from the planet centre towards periapsis. */
  eccentricityVector: [number, number];
  periapsisRadius: number;
  /** Angular momentum h = r × v (sign gives the direction of travel). */
  angularMomentum: number;
}

/** Two-body orbital elements of the rocket relative to the planet centre at (0, −R). */
export const orbitalElements = (params: RocketParams, state: Pick<FlightState, 'px' | 'py' | 'vx' | 'vy'>): OrbitalElements => {
  const mu = Math.max(gravitationalParameter(params), 1e-12);
  const rx = state.px;
  const ry = state.py + params.planetRadius;
  const r = Math.max(Math.hypot(rx, ry), 1e-6);
  const v2 = state.vx * state.vx + state.vy * state.vy;
  const energy = v2 / 2 - mu / r;
  const angularMomentum = rx * state.vy - ry * state.vx;
  const rDotV = rx * state.vx + ry * state.vy;
  const ex = ((v2 - mu / r) * rx - rDotV * state.vx) / mu;
  const ey = ((v2 - mu / r) * ry - rDotV * state.vy) / mu;
  const eccentricity = Math.hypot(ex, ey);
  const semiMajorAxis = energy < 0 ? -mu / (2 * energy) : Infinity;
  const periapsisRadius = (angularMomentum * angularMomentum) / mu / (1 + eccentricity);
  return { energy, semiMajorAxis, eccentricity, eccentricityVector: [ex, ey], periapsisRadius, angularMomentum };
};

const normalize = (x: number, y: number): [number, number] => {
  const length = Math.hypot(x, y) || 1;
  return [x / length, y / length];
};

/** The bound orbit through the rocket's position and velocity, as the scene draws it. */
export const buildOrbitPath = (
  params: RocketParams,
  state: Pick<FlightState, 'px' | 'py' | 'vx' | 'vy'>,
): OrbitPathState | null => {
  const elements = orbitalElements(params, state);
  if (elements.energy >= 0 || elements.eccentricity >= 1) return null;
  const focus: [number, number] = [0, -params.planetRadius];
  const a = elements.semiMajorAxis;
  const e = elements.eccentricity;
  const b = a * Math.sqrt(1 - e * e);
  const axisDirection: [number, number] = e > 1e-6
    ? [elements.eccentricityVector[0] / e, elements.eccentricityVector[1] / e]
    : normalize(state.px - focus[0], state.py - focus[1]);
  const travel = elements.angularMomentum >= 0 ? 1 : -1;
  const perpendicularDirection: [number, number] = [-axisDirection[1] * travel, axisDirection[0] * travel];
  const center: [number, number] = [focus[0] - axisDirection[0] * a * e, focus[1] - axisDirection[1] * a * e];
  const dx = state.px - center[0];
  const dy = state.py - center[1];
  const along = dx * axisDirection[0] + dy * axisDirection[1];
  const across = dx * perpendicularDirection[0] + dy * perpendicularDirection[1];
  return {
    center,
    focus,
    semiMajorAxis: a,
    semiMinorAxis: b,
    eccentricity: e,
    axisDirection,
    perpendicularDirection,
    angle: Math.atan2(across / b, along / a),
    angularSpeed: Math.sqrt(gravitationalParameter(params) / (a * a * a)),
  };
};

// ── Outcomes ─────────────────────────────────────────────────────────────────

const enginesDone = (s: FlightState) => s.stage === 0 || s.engineOut;

const hazardNote = (s: FlightState) => {
  if (s.events.some((e) => e.kind === 'lightning')) return ' A lightning strike had shut down the engines.';
  if (s.events.some((e) => e.kind === 'seal-failure')) return ' A frozen seal leaked and cut the thrust.';
  return '';
};

/** Decide whether the flight has ended, and why. Returns null while the flight continues. */
export const evaluateOutcome = (params: RocketParams, state: FlightState): FlightVerdict | null => {
  if (state.heat >= HEAT_SHIELD_LIMIT) {
    return {
      outcome: 'burnup',
      reason: 'The heat shield overloaded: the rocket flew too fast through dense air. Pitch over later or lower the thrust so it climbs out of the thick air before speeding up.',
      orbit: null,
    };
  }

  if (!state.liftedOff) {
    if (enginesDone(state)) {
      return {
        outcome: 'crashed',
        reason: `The rocket never left the pad: thrust was only ${vehicleSummary(params).liftoffThrustToWeight.toFixed(2)}× its weight. It needs more than 1×.`,
        orbit: null,
      };
    }
    return null;
  }

  const altitude = altitudeOf(params, state);
  if (altitude < 0) {
    if (state.maxAltitude > SUBORBITAL_ALTITUDE) {
      return {
        outcome: 'suborbital',
        reason: `Reached altitude ${state.maxAltitude.toFixed(1)} but fell back: not enough sideways speed to keep missing the ground. A larger pitch-over angle builds more.${hazardNote(state)}`,
        orbit: null,
      };
    }
    return {
      outcome: 'crashed',
      reason: `Peaked at altitude ${state.maxAltitude.toFixed(1)} and fell back before reaching space. It needs more thrust, more fuel or less mass.${hazardNote(state)}`,
      orbit: null,
    };
  }

  const elements = orbitalElements(params, state);
  const periapsisAltitude = elements.periapsisRadius - params.planetRadius;
  const descending = state.vx * state.px + state.vy * (state.py + params.planetRadius) < 0;

  // Engines off, bound, and the path dips back into the thick air: it is coming back down.
  // That is certain as soon as the rocket is clear of the dense air (or already falling),
  // and the peak follows from the orbit: apoapsis = a(1 + e) − R.
  const apoapsisAltitude = elements.energy < 0 ? elements.semiMajorAxis * (1 + elements.eccentricity) - params.planetRadius : Infinity;
  const peak = Math.max(state.maxAltitude, apoapsisAltitude);
  if (enginesDone(state) && elements.energy < 0 && (descending || altitude > ESCAPE_JUDGE_ALTITUDE)
    && periapsisAltitude < MIN_PERIAPSIS_ALTITUDE && peak > SUBORBITAL_ALTITUDE) {
    const singleBurnHint = params.stageSeparation
      ? ' The upper stage did not add enough sideways speed at the top.'
      : ' A single burn from the ground can never reach orbit: the lowest point of the path is no higher than where the engines stopped. Turn on stage separation so stage 2 burns at the top of the climb.';
    return {
      outcome: 'suborbital',
      reason: `${descending ? 'Reached' : 'Will reach'} altitude ${peak.toFixed(1)} and then fall back: the path dips into the thick air.${singleBurnHint}${hazardNote(state)}`,
      orbit: null,
    };
  }

  if (elements.energy >= 0 && altitude > ESCAPE_JUDGE_ALTITUDE) {
    return {
      outcome: 'escape',
      reason: `Speed ${Math.hypot(state.vx, state.vy).toFixed(2)} passed the escape speed here (${escapeSpeedAt(params, altitude).toFixed(2)}), so gravity can no longer pull the rocket back.`,
      orbit: null,
    };
  }

  // Once the engines stop, the path is fixed: if its lowest point clears the thick air,
  // the rocket will keep falling around the planet for good.
  if (enginesDone(state) && elements.energy < 0 && periapsisAltitude >= MIN_PERIAPSIS_ALTITUDE) {
    const orbit = buildOrbitPath(params, state);
    if (orbit) {
      return {
        outcome: 'orbiting',
        reason: `Sideways speed is enough to keep falling around the planet: the lowest point of the orbit is at altitude ${periapsisAltitude.toFixed(1)}, above the thick air.`,
        orbit,
      };
    }
  }

  return null;
};

// ── Stepping ─────────────────────────────────────────────────────────────────

interface StepOptions {
  /** Hazards for this launch; omit for a calm, deterministic flight (the preview). */
  env?: FlightEnvironment;
  /** After an orbit or escape verdict the flight coasts without air or engines. */
  coastOnly?: boolean;
}

const logEvent = (s: FlightState, events: FlightEventRecord[], kind: FlightEventKind, message: string, altitude: number) => {
  const record = { time: s.elapsed, altitude, kind, message };
  s.events = [...s.events, record];
  events.push(record);
};

/** Unit vectors at the rocket: local up, downrange tangent, and the rocket's axis. */
const frame = (params: RocketParams, s: FlightState) => {
  const rx = s.px;
  const ry = s.py + params.planetRadius;
  const r = Math.max(Math.hypot(rx, ry), 1e-6);
  const upX = rx / r;
  const upY = ry / r;
  const downX = upY;          // downrange tangent: up rotated clockwise
  const downY = -upX;
  const bx = Math.cos(s.attitude) * upX + Math.sin(s.attitude) * downX;
  const by = Math.cos(s.attitude) * upY + Math.sin(s.attitude) * downY;
  return { r, upX, upY, downX, downY, bx, by };
};

/** Speed of the wind at the rocket (along the downrange tangent). */
const windSpeedAt = (params: RocketParams, s: FlightState, altitude: number) => {
  if (!s.liftedOff) return 0;
  const shear = Math.sin(s.elapsed * 0.9 + altitude * 0.35) * params.windShear;
  return params.crosswind * WIND_SCALE * (1 + shear) * Math.exp(-Math.max(altitude, 0) / WIND_SCALE_HEIGHT);
};

/** Drag relative to air moving at `wind` along the tangent, nose-on and side-on. */
const aeroAcceleration = (params: RocketParams, s: FlightState, f: ReturnType<typeof frame>, rho: number, wind: number) => {
  const relX = s.vx - wind * f.downX;
  const relY = s.vy - wind * f.downY;
  const relSpeed = Math.hypot(relX, relY);
  const mass = vehicleMass(params, s);
  const axial = relX * f.bx + relY * f.by;
  const sideX = relX - axial * f.bx;
  const sideY = relY - axial * f.by;
  const sideSpeed = Math.hypot(sideX, sideY);
  const thermalPenalty = 1 + params.thermalLoad * Math.max(0, relSpeed - 0.3) * rho * 1.8;
  const axialDrag = (0.5 * rho * Math.abs(axial) * params.dragCoefficient * FRONTAL_AREA * thermalPenalty) / mass;
  const sideDrag = (0.5 * rho * sideSpeed * SIDE_DRAG_COEFFICIENT * SIDE_AREA) / mass;
  return {
    ax: -(axialDrag * axial * f.bx + sideDrag * sideX),
    ay: -(axialDrag * axial * f.by + sideDrag * sideY),
    relSpeed,
  };
};

/** Accelerations (ax, ay) at a state; also returns q and the heating rate. */
const forces = (params: RocketParams, s: FlightState, thrustAcc: number, coastOnly: boolean) => {
  const f = frame(params, s);
  const mu = gravitationalParameter(params);
  let ax = -(mu / (f.r * f.r)) * f.upX + f.bx * thrustAcc;
  let ay = -(mu / (f.r * f.r)) * f.upY + f.by * thrustAcc;

  if (coastOnly) return { ax, ay, q: 0, heating: 0 };

  const altitude = f.r - params.planetRadius;
  const rho = airDensity(params, altitude);
  const aero = aeroAcceleration(params, s, f, rho, windSpeedAt(params, s, altitude));
  ax += aero.ax;
  ay += aero.ay;

  return {
    ax,
    ay,
    q: 0.5 * rho * aero.relSpeed * aero.relSpeed,
    heating: HEATING_COEFFICIENT * Math.sqrt(rho) * aero.relSpeed ** 3 * (1 + 2 * params.thermalLoad),
  };
};

/** Thrust acceleration the engines give in this state (0 when none is burning). */
export const thrustAccelerationNow = (params: RocketParams, s: FlightState) => {
  if (s.engineOut) return 0;
  if (s.stage === 1 && s.fuel1 > 0) {
    return (params.thrustForce * THRUST_SCALE * thrustFactorAt(params, altitudeOf(params, s)) * s.engineFactor) / vehicleMass(params, s);
  }
  if (s.stage === 2 && s.stage2Lit && s.fuel2 > 0) {
    return (params.stage2Thrust * THRUST_SCALE * VACUUM_THRUST_FACTOR * temperatureFactor(params) * s.engineFactor) / vehicleMass(params, s);
  }
  return 0;
};

export interface ForceBreakdown {
  /** Accelerations in world space (scene units/s²). */
  gravity: [number, number];
  thrust: [number, number];
  /** Air resistance in still air. */
  drag: [number, number];
  /** The extra push of the moving air (drag with wind minus drag without). */
  wind: [number, number];
}

/** The forces on the vehicle right now, split up for drawing them as arrows. */
export const forceBreakdown = (params: RocketParams, s: FlightState): ForceBreakdown => {
  const f = frame(params, s);
  const mu = gravitationalParameter(params);
  const thrustAcc = thrustAccelerationNow(params, s);
  const altitude = f.r - params.planetRadius;
  const rho = airDensity(params, altitude);
  const still = aeroAcceleration(params, s, f, rho, 0);
  const windy = aeroAcceleration(params, s, f, rho, windSpeedAt(params, s, altitude));
  return {
    gravity: [-(mu / (f.r * f.r)) * f.upX, -(mu / (f.r * f.r)) * f.upY],
    thrust: [f.bx * thrustAcc, f.by * thrustAcc],
    drag: [still.ax, still.ay],
    wind: [windy.ax - still.ax, windy.ay - still.ay],
  };
};

/** Advance the flight by one fixed step. */
export const stepFlight = (
  params: RocketParams,
  prev: FlightState,
  dt: number = FLIGHT_DT,
  options: StepOptions = {},
): FlightStepResult => {
  const s: FlightState = { ...prev };
  const events: FlightEventRecord[] = [];
  const coastOnly = options.coastOnly ?? false;
  const env = options.env;
  const altitude0 = altitudeOf(params, s);

  // ── Weather hazards (only in the real flight) ──
  if (env && !coastOnly) {
    if (s.sealFailAt === -2) {
      // Decided once at ignition: how likely cold seals are to leak today.
      const chance = clamp((COLD_SEAL_THRESHOLD - params.ambientTemperature) / 40, 0, 0.6);
      let roll: number;
      [roll, s.rng] = nextRandom(s.rng);
      if (roll < chance) {
        let when: number;
        [when, s.rng] = nextRandom(s.rng);
        s.sealFailAt = 1 + when * 4;
      } else {
        s.sealFailAt = -1;
      }
    }
    if (s.sealFailAt >= 0 && s.elapsed >= s.sealFailAt && s.engineFactor === 1 && !enginesDone(s)) {
      s.engineFactor = SEAL_FAILURE_THRUST;
      logEvent(s, events, 'seal-failure', `Frozen seal leaked at ${s.elapsed.toFixed(1)} s: thrust fell to ${SEAL_FAILURE_THRUST * 100}%.`, altitude0);
    }
    if (env.lightning && s.liftedOff && !enginesDone(s) && altitude0 < LIGHTNING_ALTITUDE) {
      let roll: number;
      [roll, s.rng] = nextRandom(s.rng);
      if (roll < 1 - Math.exp(-LIGHTNING_RATE * dt)) {
        s.engineOut = true;
        logEvent(s, events, 'lightning', `Lightning struck at altitude ${altitude0.toFixed(1)} and shut down the engines.`, altitude0);
      }
    }
  }

  // ── Engines and fuel ──
  let thrustAcc = 0;
  if (!coastOnly && !s.engineOut) {
    if (s.stage === 1 && s.fuel1 > 0) {
      const flow = stageOneFlow(params);
      thrustAcc = thrustAccelerationNow(params, s);
      s.fuel1 = Math.max(0, s.fuel1 - flow * dt);
      if (s.fuel1 === 0) {
        if (params.stageSeparation && s.fuel2 > 0) {
          s.stageSeparated = true;
          s.stageGap = STAGE_GAP;
          s.stage = 2;
          logEvent(s, events, 'stage-separation', `Stage 1 dropped at altitude ${altitude0.toFixed(1)}: ${(params.dryMass * STAGE_ONE_DRY_FRACTION).toFixed(0)} kg less to push.`, altitude0);
        } else {
          s.stage = 0;
          logEvent(s, events, 'burnout', `Engines cut off at altitude ${altitude0.toFixed(1)}, speed ${Math.hypot(s.vx, s.vy).toFixed(2)}.`, altitude0);
        }
      }
    } else if (s.stage === 2) {
      // Stage 2 coasts to the top of the climb (apoapsis) and burns there, like a real
      // upper stage: thrust at the highest point raises the lowest point of the orbit.
      if (s.stageGap > 0) {
        s.stageGap = Math.max(0, s.stageGap - dt);
      } else if (!s.stage2Lit) {
        s.coastTime += dt;
        const climbing = s.vx * s.px + s.vy * (s.py + params.planetRadius) > 0;
        if (!climbing || s.coastTime >= MAX_COAST_TO_APOAPSIS) {
          s.stage2Lit = true;
          logEvent(s, events, 'stage-ignition', `Stage 2 lit at the top of the climb, altitude ${altitude0.toFixed(1)}.`, altitude0);
        }
      }
      if (s.stage2Lit && s.fuel2 > 0) {
        thrustAcc = thrustAccelerationNow(params, s);
        s.fuel2 = Math.max(0, s.fuel2 - stageTwoFlow(params) * dt);
        if (s.fuel2 === 0) {
          s.stage = 0;
          logEvent(s, events, 'burnout', `Stage 2 cut off at altitude ${altitude0.toFixed(1)}, speed ${Math.hypot(s.vx, s.vy).toFixed(2)}.`, altitude0);
        }
      }
    }
  }

  // ── Guidance: vertical climb, pitch-over, then a gravity turn ──
  const rx = s.px;
  const ry = s.py + params.planetRadius;
  const r = Math.max(Math.hypot(rx, ry), 1e-6);
  const speed = Math.hypot(s.vx, s.vy);
  const velocityAngle = speed > 1e-6
    ? Math.atan2(s.vx * (ry / r) - s.vy * (rx / r), s.vx * (rx / r) + s.vy * (ry / r))
    : s.attitude;
  const kickAngle = ((params.launchAngle + params.padTilt) * Math.PI) / 180;
  if (!coastOnly) {
    if (s.pitchStart < 0) {
      if (s.liftedOff && altitude0 >= TURN_START_ALTITUDE) {
        s.pitchStart = s.elapsed;
        if (params.launchAngle > 0) logEvent(s, events, 'pitch-over', `Pitched over by ${params.launchAngle}° at altitude ${altitude0.toFixed(1)}.`, altitude0);
      }
    } else if (!s.gravityTurn) {
      const progress = clamp((s.elapsed - s.pitchStart) / PITCH_KICK_DURATION, 0, 1);
      const padAngle = (params.padTilt * Math.PI) / 180;
      s.attitude = padAngle + (kickAngle - padAngle) * progress;
      // Hold the pitched attitude until the path has bent over to match it.
      if (progress >= 1 && Math.abs(velocityAngle) >= Math.abs(kickAngle) - 0.01) s.gravityTurn = true;
    } else {
      s.attitude = velocityAngle;
    }
  }
  if (thrustAcc === 0 && s.liftedOff) {
    s.attitude = velocityAngle; // unpowered: weathervanes into the airflow
  } else if (s.stage === 2 && s.stage2Lit && !coastOnly) {
    // Upper-stage guidance: burn prograde to build sideways speed, but keep the nose a
    // little above the horizon so the burn also holds the rocket up.
    s.attitude = Math.max(-UPPER_STAGE_MAX_PITCH, Math.min(velocityAngle, UPPER_STAGE_MAX_PITCH));
  }

  // ── Integrate (kick-drift-kick) ──
  const f0 = forces(params, s, thrustAcc, coastOnly);
  const halfVx = s.vx + f0.ax * dt * 0.5;
  const halfVy = s.vy + f0.ay * dt * 0.5;
  s.px += halfVx * dt;
  s.py += halfVy * dt;
  s.vx = halfVx;
  s.vy = halfVy;
  const f1 = forces(params, s, thrustAcc, coastOnly);
  s.vx += f1.ax * dt * 0.5;
  s.vy += f1.ay * dt * 0.5;
  s.elapsed += dt;
  s.q = f1.q;
  s.heat += f1.heating * dt;

  // The pad holds the rocket until thrust exceeds its weight.
  if (!s.liftedOff) {
    if (s.py > 0) {
      s.liftedOff = true;
      logEvent(s, events, 'liftoff', 'Liftoff.', 0);
    } else {
      s.px = 0;
      s.py = 0;
      s.vx = 0;
      s.vy = 0;
    }
  }

  const altitude = altitudeOf(params, s);
  s.maxAltitude = Math.max(s.maxAltitude, altitude);
  if (s.q > s.maxQ) {
    s.maxQ = s.q;
  } else if (!s.maxQLogged && s.maxQ > 0 && s.q < s.maxQ * 0.9) {
    s.maxQLogged = true;
    logEvent(s, events, 'max-q', `Max-Q passed: peak dynamic pressure ${s.maxQ.toFixed(2)} before altitude ${altitude.toFixed(1)}.`, altitude);
  }

  return { state: s, events, verdict: coastOnly ? null : evaluateOutcome(params, s) };
};

export interface FlightPrediction {
  points: [number, number][];
  verdict: FlightVerdict | null;
}

/**
 * Predicted path for the current settings, using the same model and step as the flight
 * (with calm weather). Stops where the flight would end or reach its verdict.
 */
export const predictFlight = (params: RocketParams, duration = PREVIEW_DURATION, sampleEvery = 3): FlightPrediction => {
  const points: [number, number][] = [[0, 0]];
  let state = initialFlightState(params);
  const steps = Math.round(duration / FLIGHT_DT);
  for (let i = 1; i <= steps; i++) {
    const result = stepFlight(params, state, FLIGHT_DT);
    state = result.state;
    if (result.verdict) {
      points.push([state.px, state.py]);
      return { points, verdict: result.verdict };
    }
    if (i % sampleEvery === 0) points.push([state.px, state.py]);
  }
  return { points, verdict: null };
};
