import type { UnlockId } from '@/lib/unlocks';
import { DEFAULT_PARAMS, type RocketParams } from './rocketTypes';
import type { WeatherConditionId } from './weatherPresets';

export interface RocketScenario {
  id: 'earth-standard' | 'mars-storm-ascent';
  name: string;
  summary: string;
  params: RocketParams;
  weather: WeatherConditionId[];
  unlock?: UnlockId;
}

export const ROCKET_SCENARIOS: RocketScenario[] = [
  {
    id: 'earth-standard',
    name: 'Earth, clear day',
    summary: 'Standard gravity and air. The baseline for comparing changes.',
    params: DEFAULT_PARAMS,
    weather: [],
  },
  {
    id: 'mars-storm-ascent',
    name: 'Mars dust-storm ascent',
    summary: 'About 38% of Earth’s gravity and very thin, cold air, but a dust storm with strong, shifting winds.',
    params: {
      ...DEFAULT_PARAMS,
      gravity: 3.7,
      planetRadius: 35,
      atmosphericDensity: 0.12,
      atmosphericPressure: 0.6,
      ambientTemperature: -60,
      // The dust storm (wind weather) adds 38 m/s on top: 50 m/s, gusting.
      crosswind: 12,
      windShear: 0.3,
      thermalLoad: 0.15,
      thrustForce: 16,
      launchAngle: 8,
    },
    weather: ['wind', 'visibility'],
    unlock: 'mars-storm-ascent',
  },
];
