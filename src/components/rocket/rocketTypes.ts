export interface RocketParams {
  launchAngle: number;       // degrees from vertical (0 = straight up)
  thrustForce: number;       // kN
  fuelMass: number;          // kg
  dryMass: number;           // kg
  burnDuration: number;      // seconds
  dragCoefficient: number;   // 0-1
  gravity: number;           // m/s²
  planetRadius: number;      // km (visual)
  atmosphericDensity: number; // 0-1 scale
  stageSeparation: boolean;
}

export const DEFAULT_PARAMS: RocketParams = {
  launchAngle: 5,
  thrustForce: 35,
  fuelMass: 80,
  dryMass: 20,
  burnDuration: 12,
  dragCoefficient: 0.3,
  gravity: 9.8,
  planetRadius: 50,
  atmosphericDensity: 0.5,
  stageSeparation: false,
};

export type LaunchOutcome = 'none' | 'orbiting' | 'suborbital' | 'escape' | 'crashed' | 'burnup';

export interface OrbitPathState {
  center: [number, number];
  focus: [number, number];
  semiMajorAxis: number;
  semiMinorAxis: number;
  eccentricity: number;
  axisDirection: [number, number];
  perpendicularDirection: [number, number];
  angle: number;
  angularSpeed: number;
}

export interface RocketState {
  position: [number, number, number];
  velocity: [number, number];
  fuel: number;
  altitude: number;
  phase: 'idle' | 'launching' | 'coasting' | 'outcome';
  outcome: LaunchOutcome;
  elapsed: number;
  maxAltitude: number;
  trajectory: [number, number][];
  orbit: OrbitPathState | null;
}

export const INITIAL_STATE: RocketState = {
  position: [0, 0, 0],
  velocity: [0, 0],
  fuel: 1,
  altitude: 0,
  phase: 'idle',
  outcome: 'none',
  elapsed: 0,
  maxAltitude: 0,
  trajectory: [],
  orbit: null,
};

// Compute predicted trajectory arc for preview
export function computeTrajectoryPreview(params: RocketParams): [number, number][] {
  const points: [number, number][] = [];
  const dt = 0.1;
  const angleRad = (params.launchAngle * Math.PI) / 180;
  let vx = Math.sin(angleRad) * 0;
  let vy = 0;
  let x = 0;
  let y = 0;
  let fuel = params.fuelMass;
  const totalMass = params.fuelMass + params.dryMass;
  const burnRate = params.fuelMass / params.burnDuration;

  for (let t = 0; t < 60; t += dt) {
    const currentMass = params.dryMass + Math.max(fuel, 0);
    const massRatio = currentMass / totalMass;

    if (fuel > 0) {
      const thrustAcc = params.thrustForce / massRatio;
      vx += Math.sin(angleRad) * thrustAcc * dt * 0.01;
      vy += Math.cos(angleRad) * thrustAcc * dt * 0.01;
      fuel -= burnRate * dt;
    }

    vy -= params.gravity * dt * 0.01;

    const speed = Math.sqrt(vx * vx + vy * vy);
    const dragForce = 0.5 * params.dragCoefficient * params.atmosphericDensity * speed * speed * 0.001;
    if (speed > 0) {
      vx -= (vx / speed) * dragForce * dt;
      vy -= (vy / speed) * dragForce * dt;
    }

    x += vx * dt;
    y += vy * dt;

    if (y < 0 && t > 1) break;
    points.push([x, Math.max(y, 0)]);
  }

  return points;
}
