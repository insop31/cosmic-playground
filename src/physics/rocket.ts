// Pure 2D flight model for the Rocket Lab. The live flight (RocketModel) and the
// trajectory preview both step this same model with the same fixed time step, so the
// preview is an exact prediction of the flight up to the point an outcome is decided.
import type { LaunchOutcome, OrbitPathState, RocketParams } from '../components/rocket/rocketTypes';

export const FLIGHT_DT = 1 / 60;              // Fixed flight step (s)
export const PREVIEW_DURATION = 60;           // Seconds of flight the preview predicts

// Scene-scale tuning shared by flight and preview.
const GRAVITY_SCALE = 0.01;
const DRAG_SCALE = 0.003;
const WIND_SCALE = 0.0011;
const ATMOSPHERE_FALLOFF = 0.015;             // Air density falls to zero at altitude ≈ 67

// Outcomes are judged once the rocket is above this altitude (the top weather layers).
export const ORBIT_ALTITUDE_THRESHOLD = 45;
// An orbit only counts if its lowest point stays above the dense lower atmosphere.
export const MIN_PERIAPSIS_ALTITUDE = 20;
export const SUBORBITAL_ALTITUDE = 25;
// The drawn orbit plays back faster than real time so a full lap takes seconds, not minutes.
export const ORBIT_TIME_COMPRESSION = 10;

// Staging: stage 1 holds this share of the propellant; at its burnout the empty stage-1
// structure (this share of the dry mass) is dropped and stage 2 burns the rest.
export const STAGE_ONE_FUEL_FRACTION = 0.6;
export const STAGE_ONE_DRY_FRACTION = 0.4;

// Aerodynamic heating: rate ∝ air density · speed³, scaled up by the thermal-load setting.
// Burn-up happens when accumulated heat reaches the heat-shield limit (1.0).
export const HEATING_COEFFICIENT = 5e-4;
export const HEAT_SHIELD_LIMIT = 1;

export interface FlightState {
  px: number;
  py: number;
  vx: number;
  vy: number;
  /** Remaining propellant as a fraction of the initial load (0–1). */
  fuel: number;
  elapsed: number;
  /** Accumulated heating as a fraction of the heat-shield limit. */
  heat: number;
  stageSeparated: boolean;
  liftedOff: boolean;
  maxAltitude: number;
}

export type FlightEvent = 'stage-separation' | 'burnout';

export interface FlightVerdict {
  outcome: Exclude<LaunchOutcome, 'none'>;
  reason: string;
  orbit: OrbitPathState | null;
}

export interface FlightStepResult {
  state: FlightState;
  events: FlightEvent[];
  verdict: FlightVerdict | null;
}

export const initialFlightState = (): FlightState => ({
  px: 0,
  py: 0,
  vx: 0,
  vy: 0,
  fuel: 1,
  elapsed: 0,
  heat: 0,
  stageSeparated: false,
  liftedOff: false,
  maxAltitude: 0,
});

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const dryMassNow = (params: RocketParams, state: FlightState) =>
  (state.stageSeparated ? params.dryMass * (1 - STAGE_ONE_DRY_FRACTION) : params.dryMass);

export const vehicleMass = (params: RocketParams, state: FlightState) =>
  dryMassNow(params, state) + state.fuel * params.fuelMass;

/** Engine efficiency from launch-day pressure and temperature. */
export const thrustEnvironmentFactor = (params: RocketParams) => {
  const pressureFactor = clamp(1.04 - (params.atmosphericPressure - 1) * 0.22, 0.78, 1.14);
  const temperatureFactor = clamp(1 - (params.ambientTemperature - 15) * 0.0024, 0.82, 1.08);
  return pressureFactor * temperatureFactor;
};

export const atmosphereFactor = (params: RocketParams, altitude: number) =>
  Math.max(0, 1 - altitude * ATMOSPHERE_FALLOFF) * params.atmosphericDensity;

/** Thrust-to-weight ratio at ignition; below 1 the rocket cannot leave the pad. */
export const liftoffThrustToWeight = (params: RocketParams) => {
  const mass = params.dryMass + params.fuelMass;
  return (params.thrustForce * thrustEnvironmentFactor(params)) / mass / (params.gravity * GRAVITY_SCALE);
};

const normalize = (x: number, y: number): [number, number] => {
  const length = Math.hypot(x, y) || 1;
  return [x / length, y / length];
};

/**
 * Gravitational parameter μ = g₀·R² of the planet in scene units, from surface gravity and
 * radius. Orbit and escape are judged against this, so both sliders matter.
 */
export const gravitationalParameter = (params: RocketParams) =>
  params.gravity * GRAVITY_SCALE * params.planetRadius * params.planetRadius;

/** Escape speed √(2μ/r) at the given altitude above the surface. */
export const escapeSpeedAt = (params: RocketParams, altitude: number) =>
  Math.sqrt((2 * gravitationalParameter(params)) / (params.planetRadius + Math.max(altitude, 0)));

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
  const mu = gravitationalParameter(params);
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

/**
 * The bound orbit through the rocket's current position and velocity, in the form the
 * scene draws and follows: ellipse centre, axes, and the current eccentric anomaly.
 */
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
  // Major axis points at periapsis; for a near-circular orbit use the current radial direction.
  const axisDirection: [number, number] = e > 1e-6
    ? [elements.eccentricityVector[0] / e, elements.eccentricityVector[1] / e]
    : normalize(state.px - focus[0], state.py - focus[1]);
  // Perpendicular chosen so the eccentric anomaly increases in the direction of travel.
  const travel = elements.angularMomentum >= 0 ? 1 : -1;
  const perpendicularDirection: [number, number] = [-axisDirection[1] * travel, axisDirection[0] * travel];
  const center: [number, number] = [focus[0] - axisDirection[0] * a * e, focus[1] - axisDirection[1] * a * e];

  // Current eccentric anomaly from the rocket's position in the ellipse frame.
  const dx = state.px - center[0];
  const dy = state.py - center[1];
  const along = dx * axisDirection[0] + dy * axisDirection[1];
  const across = dx * perpendicularDirection[0] + dy * perpendicularDirection[1];
  const angle = Math.atan2(across / b, along / a);

  const meanMotion = Math.sqrt(gravitationalParameter(params) / (a * a * a));

  return {
    center,
    focus,
    semiMajorAxis: a,
    semiMinorAxis: b,
    eccentricity: e,
    axisDirection,
    perpendicularDirection,
    angle,
    angularSpeed: meanMotion * ORBIT_TIME_COMPRESSION,
  };
};

/** Decide whether the flight has ended, and why. Returns null while the flight continues. */
export const evaluateOutcome = (params: RocketParams, state: FlightState): FlightVerdict | null => {
  if (state.heat >= HEAT_SHIELD_LIMIT) {
    return {
      outcome: 'burnup',
      reason: 'The heat shield overloaded. The rocket flew too fast through dense air; climb more steeply or reduce thrust low in the atmosphere.',
      orbit: null,
    };
  }

  if (!state.liftedOff) {
    if (state.fuel <= 0) {
      return {
        outcome: 'crashed',
        reason: `The rocket never left the pad: thrust was only ${liftoffThrustToWeight(params).toFixed(2)}× its weight. It needs more than 1×.`,
        orbit: null,
      };
    }
    return null;
  }

  if (state.py < 0) {
    if (state.maxAltitude > SUBORBITAL_ALTITUDE) {
      return {
        outcome: 'suborbital',
        reason: `Reached altitude ${state.maxAltitude.toFixed(1)} but fell back: not enough sideways speed to stay up. Try a larger launch angle or a longer burn.`,
        orbit: null,
      };
    }
    return {
      outcome: 'crashed',
      reason: `Peaked at altitude ${state.maxAltitude.toFixed(1)} and fell back before reaching space. It needs more thrust, more fuel or less mass.`,
      orbit: null,
    };
  }

  if (state.py > ORBIT_ALTITUDE_THRESHOLD) {
    const elements = orbitalElements(params, state);
    const speed = Math.hypot(state.vx, state.vy);
    if (elements.energy >= 0) {
      return {
        outcome: 'escape',
        reason: `Speed ${speed.toFixed(2)} passed the escape speed here (${escapeSpeedAt(params, state.py).toFixed(2)}), so gravity can no longer pull the rocket back.`,
        orbit: null,
      };
    }
    const periapsisAltitude = elements.periapsisRadius - params.planetRadius;
    if (periapsisAltitude >= MIN_PERIAPSIS_ALTITUDE) {
      const orbit = buildOrbitPath(params, state);
      if (orbit) {
        return {
          outcome: 'orbiting',
          reason: `Sideways speed is enough to keep falling around the planet: the lowest point of the orbit is at altitude ${periapsisAltitude.toFixed(1)}, above the thick air.`,
          orbit,
        };
      }
    }
  }

  return null;
};

/** Advance the flight by one fixed step. */
export const stepFlight = (params: RocketParams, prev: FlightState, dt: number = FLIGHT_DT): FlightStepResult => {
  const s: FlightState = { ...prev };
  const events: FlightEvent[] = [];
  const angleRad = ((params.launchAngle + params.padTilt) * Math.PI) / 180;

  // Thrust
  if (s.fuel > 0) {
    const thrustAcc = (params.thrustForce * thrustEnvironmentFactor(params)) / vehicleMass(params, s);
    s.vx += Math.sin(angleRad) * thrustAcc * dt;
    s.vy += Math.cos(angleRad) * thrustAcc * dt;
    s.fuel -= dt / params.burnDuration;

    if (params.stageSeparation && !s.stageSeparated && s.fuel <= 1 - STAGE_ONE_FUEL_FRACTION) {
      s.stageSeparated = true;
      events.push('stage-separation');
    }
    if (s.fuel <= 0) {
      s.fuel = 0;
      events.push('burnout');
    }
  }

  // Gravity
  s.vy -= params.gravity * dt * GRAVITY_SCALE;

  // Wind, drag and heating
  const speed = Math.hypot(s.vx, s.vy);
  const airFactor = atmosphereFactor(params, s.py);
  const shearWave = Math.sin((s.elapsed + dt) * 0.9 + s.py * 0.35) * params.windShear;
  const wind = params.crosswind * (1 + shearWave) * airFactor;
  if (s.liftedOff) s.vx += wind * dt * WIND_SCALE;

  const thermalPenalty = 1 + params.thermalLoad * Math.max(0, speed - 0.3) * airFactor * 1.8;
  const dragForce = 0.5 * params.dragCoefficient * airFactor * speed * speed * DRAG_SCALE * thermalPenalty;
  if (speed > 0.001) {
    s.vx -= (s.vx / speed) * dragForce * dt;
    s.vy -= (s.vy / speed) * dragForce * dt;
  }
  s.heat += HEATING_COEFFICIENT * airFactor * speed ** 3 * (1 + 2 * params.thermalLoad) * dt;

  // Motion
  s.px += s.vx * dt;
  s.py += s.vy * dt;
  s.elapsed += dt;

  // The pad holds the rocket until thrust exceeds its weight.
  if (!s.liftedOff) {
    if (s.py > 0) {
      s.liftedOff = true;
    } else {
      s.px = 0;
      s.py = 0;
      s.vx = 0;
      s.vy = 0;
    }
  }
  s.maxAltitude = Math.max(s.maxAltitude, s.py);

  return { state: s, events, verdict: evaluateOutcome(params, s) };
};

export interface FlightPrediction {
  points: [number, number][];
  verdict: FlightVerdict | null;
}

/**
 * Predicted path for the current settings, using the same model and step as the flight.
 * Stops where the flight would end or when the flight would switch to its orbit path.
 */
export const predictFlight = (params: RocketParams, duration = PREVIEW_DURATION, sampleEvery = 3): FlightPrediction => {
  const points: [number, number][] = [[0, 0]];
  let state = initialFlightState();
  const steps = Math.round(duration / FLIGHT_DT);
  for (let i = 1; i <= steps; i++) {
    const result = stepFlight(params, state, FLIGHT_DT);
    state = result.state;
    if (result.verdict) {
      points.push([state.px, Math.max(state.py, 0)]);
      return { points, verdict: result.verdict };
    }
    if (i % sampleEvery === 0) points.push([state.px, Math.max(state.py, 0)]);
  }
  return { points, verdict: null };
};
