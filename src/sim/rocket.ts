import * as THREE from 'three';
import type { LaunchOutcome, OrbitPathState, RocketParams } from '@/worlds/rocket/rocketTypes';

/**
 * Rocket Lab flight model as pure functions. The maths is moved verbatim
 * from RocketModel's frame loop so that warp can run several identical steps
 * per frame and tests can fly the model without rendering.
 */

export const TRAJECTORY_LIMIT = 2400;
export const ESCAPE_VELOCITY = 1.1;
export const MIN_ORBITAL_SPEED = 0.32;
export const ORBIT_ALTITUDE_THRESHOLD = 45;

export interface AscentState {
  px: number;
  py: number;
  vx: number;
  vy: number;
  /** Remaining fuel fraction, 0–1. */
  fuel: number;
  /** Simulated seconds since ignition. */
  elapsed: number;
  maxAltitude: number;
}

export interface AscentStep {
  next: AscentState;
  /** Fuel ran out during this step. */
  cutoff: boolean;
  /** Set when the flight ended in this step. */
  outcome: Exclude<LaunchOutcome, 'none'> | null;
  orbit: OrbitPathState | null;
}

export const normalizeVector = (x: number, y: number): [number, number] => {
  const length = Math.hypot(x, y) || 1;
  return [x / length, y / length];
};

export const buildOrbitPath = (
  px: number,
  py: number,
  vx: number,
  vy: number,
  planetRadius: number
): OrbitPathState | null => {
  const focus: [number, number] = [0, -planetRadius];
  const rx = px - focus[0];
  const ry = py - focus[1];
  const radius = Math.hypot(rx, ry);
  if (radius < planetRadius + 10) return null;

  const axisDirection = normalizeVector(rx, ry);
  const tangentSeed: [number, number] = [-axisDirection[1], axisDirection[0]];
  const tangentDot = vx * tangentSeed[0] + vy * tangentSeed[1];
  const tangentSign = tangentDot >= 0 ? 1 : -1;
  const perpendicularDirection: [number, number] = [tangentSeed[0] * tangentSign, tangentSeed[1] * tangentSign];

  const totalSpeed = Math.hypot(vx, vy);
  const tangentialSpeed = Math.abs(vx * perpendicularDirection[0] + vy * perpendicularDirection[1]);
  const radialSpeed = Math.abs(vx * axisDirection[0] + vy * axisDirection[1]);
  const speedRatio = THREE.MathUtils.clamp(tangentialSpeed / ESCAPE_VELOCITY, 0.45, 0.92);
  const eccentricity = THREE.MathUtils.clamp(
    0.62 - (speedRatio - 0.55) * 0.9 + (radialSpeed / Math.max(totalSpeed, 0.001)) * 0.28,
    0.16,
    0.72
  );
  const semiMajorAxis = radius / (1 - eccentricity);
  const semiMinorAxis = semiMajorAxis * Math.sqrt(1 - eccentricity * eccentricity);
  const center: [number, number] = [
    focus[0] - axisDirection[0] * semiMajorAxis * eccentricity,
    focus[1] - axisDirection[1] * semiMajorAxis * eccentricity,
  ];

  return {
    center,
    focus,
    semiMajorAxis,
    semiMinorAxis,
    eccentricity,
    axisDirection,
    perpendicularDirection,
    angle: 0,
    angularSpeed: THREE.MathUtils.clamp(tangentialSpeed / Math.max(radius, 1), 0.18, 0.52),
  };
};

/** Engine thrust environment: thinner, warmer air slightly reduces thrust. */
export const thrustEnvironmentFactor = (params: RocketParams) => {
  const pressureFactor = THREE.MathUtils.clamp(1.04 - (params.atmosphericPressure - 1) * 0.22, 0.78, 1.14);
  const temperatureFactor = THREE.MathUtils.clamp(1 - (params.ambientTemperature - 15) * 0.0024, 0.82, 1.08);
  return pressureFactor * temperatureFactor;
};

/** Thrust-to-weight ratio on the pad: above 1 the vehicle can lift off. */
export const liftoffTwr = (params: RocketParams) =>
  (params.thrustForce * thrustEnvironmentFactor(params)) / ((params.dryMass + params.fuelMass) * params.gravity * 0.01);

/** Air density factor at altitude py: falls off linearly to zero at py ≈ 67. */
export const atmosphereFactorAt = (py: number, params: RocketParams) =>
  Math.max(0, 1 - py * 0.015) * params.atmosphericDensity;

/** Forces on the vehicle as accelerations (scene units/s²), for visualising. */
export const ascentForces = (s: AscentState, params: RocketParams, launching: boolean) => {
  const effectiveLaunchAngle = params.launchAngle + params.padTilt;
  const angleRad = (effectiveLaunchAngle * Math.PI) / 180;
  const burning = launching && s.fuel > 0;
  const currentMass = params.dryMass + s.fuel * params.fuelMass;
  const thrustAcc = burning ? (params.thrustForce * thrustEnvironmentFactor(params)) / currentMass : 0;
  const speed = Math.hypot(s.vx, s.vy);
  const atmosphereFactor = atmosphereFactorAt(s.py, params);
  const shearWave = Math.sin(s.elapsed * 0.9 + s.py * 0.35) * params.windShear;
  const wind = params.crosswind * (1 + shearWave) * atmosphereFactor;
  const thermalPenalty = 1 + params.thermalLoad * Math.max(0, speed - 0.3) * atmosphereFactor * 1.8;
  const drag = 0.5 * params.dragCoefficient * atmosphereFactor * speed * speed * 0.003 * thermalPenalty;
  return {
    thrust: [Math.sin(angleRad) * thrustAcc, Math.cos(angleRad) * thrustAcc] as [number, number],
    gravity: [0, -params.gravity * 0.01] as [number, number],
    drag: speed > 0.001 ? [(-s.vx / speed) * drag, (-s.vy / speed) * drag] as [number, number] : [0, 0] as [number, number],
    // Sideways push of wind on the airframe. (This model has no wing lift.)
    wind: [wind * 0.0011, 0] as [number, number],
    /** Dynamic pressure proxy q = ½ρv² (scene units). */
    dynamicPressure: 0.5 * atmosphereFactor * speed * speed,
    thermalPenalty,
  };
};

/** One powered or coasting step (explicit Euler), including outcome detection. */
export const stepAscent = (s: AscentState, params: RocketParams, launching: boolean, dt: number): AscentStep => {
  const effectiveLaunchAngle = params.launchAngle + params.padTilt;
  const angleRad = (effectiveLaunchAngle * Math.PI) / 180;
  let { vx, vy, px, py, fuel } = s;
  let cutoff = false;

  if (fuel > 0 && launching) {
    const currentMass = params.dryMass + fuel * params.fuelMass;
    const thrustAcc = (params.thrustForce * thrustEnvironmentFactor(params)) / currentMass;
    vx += Math.sin(angleRad) * thrustAcc * dt;
    vy += Math.cos(angleRad) * thrustAcc * dt;
    fuel -= dt / params.burnDuration;

    if (fuel <= 0) {
      fuel = 0;
      cutoff = true;
    }
  }

  // Gravity
  vy -= params.gravity * dt * 0.01;

  // Drag
  const speed = Math.sqrt(vx * vx + vy * vy);
  const atmosphereFactor = atmosphereFactorAt(py, params);
  const shearWave = Math.sin((s.elapsed + dt) * 0.9 + py * 0.35) * params.windShear;
  const wind = params.crosswind * (1 + shearWave) * atmosphereFactor;
  vx += wind * dt * 0.0011;

  const thermalPenalty = 1 + params.thermalLoad * Math.max(0, speed - 0.3) * atmosphereFactor * 1.8;
  const dragForce = 0.5 * params.dragCoefficient * atmosphereFactor * speed * speed * 0.003 * thermalPenalty;
  if (speed > 0.001) {
    vx -= (vx / speed) * dragForce * dt;
    vy -= (vy / speed) * dragForce * dt;
  }

  px += vx * dt;
  py += vy * dt;

  // Check crash
  if (py < 0 && (vx !== 0 || vy !== 0)) {
    return {
      next: { ...s, px, py: 0, vx, vy, fuel },
      cutoff,
      outcome: s.maxAltitude > 25 ? 'suborbital' : 'crashed',
      orbit: null,
    };
  }

  // Escape / orbit detection
  if (py > ORBIT_ALTITUDE_THRESHOLD) {
    const totalSpeed = Math.sqrt(vx * vx + vy * vy);
    const focusY = -params.planetRadius;
    const [radialX, radialY] = normalizeVector(px, py - focusY);
    const tangentialX = -radialY;
    const tangentialY = radialX;
    const tangentialSpeed = Math.abs(vx * tangentialX + vy * tangentialY);
    const tangentialRatio = tangentialSpeed / Math.max(totalSpeed, 0.001);

    if (tangentialRatio > 0.64 && tangentialSpeed > MIN_ORBITAL_SPEED && totalSpeed <= ESCAPE_VELOCITY) {
      const orbit = buildOrbitPath(px, py, vx, vy, params.planetRadius);
      if (orbit) {
        return { next: { ...s, px, py, vx, vy, fuel }, cutoff, outcome: 'orbiting', orbit };
      }
    }

    if (totalSpeed > ESCAPE_VELOCITY) {
      return { next: { ...s, px, py, vx, vy, fuel }, cutoff, outcome: 'escape', orbit: null };
    }
  }

  return {
    next: { px, py, vx, vy, fuel, elapsed: s.elapsed + dt, maxAltitude: Math.max(s.maxAltitude, py) },
    cutoff,
    outcome: null,
    orbit: null,
  };
};

/** Advances a stable orbit along its ellipse. */
export const stepOrbit = (s: AscentState, orbit: OrbitPathState, dt: number) => {
  const [axisX, axisY] = orbit.axisDirection;
  const [perpX, perpY] = orbit.perpendicularDirection;
  const relFocusX = s.px - orbit.focus[0];
  const relFocusY = s.py - orbit.focus[1];
  const focusRadius = Math.max(Math.hypot(relFocusX, relFocusY), 1);
  const orbitalRate = orbit.angularSpeed * THREE.MathUtils.clamp(orbit.semiMajorAxis / focusRadius, 0.75, 1.8);
  const nextAngle = orbit.angle + dt * orbitalRate;
  const cosTheta = Math.cos(nextAngle);
  const sinTheta = Math.sin(nextAngle);

  const px = orbit.center[0] + axisX * orbit.semiMajorAxis * cosTheta + perpX * orbit.semiMinorAxis * sinTheta;
  const py = orbit.center[1] + axisY * orbit.semiMajorAxis * cosTheta + perpY * orbit.semiMinorAxis * sinTheta;
  const vx = (-axisX * orbit.semiMajorAxis * sinTheta + perpX * orbit.semiMinorAxis * cosTheta) * orbitalRate;
  const vy = (-axisY * orbit.semiMajorAxis * sinTheta + perpY * orbit.semiMinorAxis * cosTheta) * orbitalRate;

  return {
    next: { ...s, px, py, vx, vy, elapsed: s.elapsed + dt, maxAltitude: Math.max(s.maxAltitude, py) },
    orbit: { ...orbit, angle: nextAngle },
  };
};

/** After escape the vehicle coasts in a straight line out of the scene. */
export const stepEscape = (s: AscentState, dt: number): AscentState => {
  const px = s.px + s.vx * dt;
  const py = s.py + s.vy * dt;
  return { ...s, px, py, maxAltitude: Math.max(s.maxAltitude, py) };
};
