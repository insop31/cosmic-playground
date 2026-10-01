import { predictFlight } from '../../physics/rocket';

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
  crosswind: number;         // m/s lateral wind baseline
  windShear: number;         // 0-1 altitude/time wind variance
  thermalLoad: number;       // 0-1 extra drag/heating penalty
  ambientTemperature: number; // °C ambient temperature at launch
  atmosphericPressure: number; // 0.6-1.4 relative pressure
  padTilt: number;           // degrees offset from ideal launch pad alignment
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
  crosswind: 0,
  windShear: 0.25,
  thermalLoad: 0.2,
  ambientTemperature: 18,
  atmosphericPressure: 1,
  padTilt: 0,
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
  /** Accumulated heating as a fraction of the heat-shield limit (burn-up at 1). */
  heat: number;
  stageSeparated: boolean;
  /** Plain-language explanation of the outcome, shown after the flight. */
  outcomeReason: string;
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
  heat: 0,
  stageSeparated: false,
  outcomeReason: '',
};

/** Predicted path for the current settings; same model and time step as the real flight. */
export function computeTrajectoryPreview(params: RocketParams): [number, number][] {
  return predictFlight(params).points;
}
