import { SCALE_HEIGHT, escapeSpeedAt, vehicleSummary } from '@/physics/rocket';
import type { RocketParams } from './rocketTypes';

/**
 * Display units for the Rocket Lab. The flight model runs in scene units;
 * these map them onto familiar scales, consistent with what the scene shows.
 *
 * Altitude follows the atmosphere layers drawn in the scene
 * (troposphere to 12 km, stratosphere to 50 km, mesosphere to 80 km,
 * thermosphere to 600 km), linear within each layer.
 */
const ALTITUDE_BREAKS: [number, number][] = [
  [0, 0],
  [8, 12],
  [20, 50],
  [33, 80],
  [45, 600],
];
const KM_PER_UNIT_ABOVE = 50;

export const altitudeKm = (altitude: number) => {
  if (altitude <= 0) return 0;
  for (let i = 1; i < ALTITUDE_BREAKS.length; i++) {
    const [u1, k1] = ALTITUDE_BREAKS[i];
    if (altitude <= u1) {
      const [u0, k0] = ALTITUDE_BREAKS[i - 1];
      return k0 + ((altitude - u0) / (u1 - u0)) * (k1 - k0);
    }
  }
  const [uLast, kLast] = ALTITUDE_BREAKS[ALTITUDE_BREAKS.length - 1];
  return kLast + (altitude - uLast) * KM_PER_UNIT_ABOVE;
};

/** Where the air has thinned below 1% of its surface density: "space" for the flight log. */
export const SPACE_ALTITUDE = SCALE_HEIGHT * Math.log(100);

/** Speed as a fraction of the escape speed at this height (≥ 1 means it will not come back). */
export const escapeFraction = (params: RocketParams, speed: number, altitude: number) =>
  speed / escapeSpeedAt(params, Math.max(altitude, 0));

/** Thrust-to-weight ratio on the pad: above 1 the vehicle can lift off. */
export const liftoffTwr = (params: RocketParams) => vehicleSummary(params).liftoffThrustToWeight;

export const UNITS_NOTE =
  'Altitude follows the atmosphere layers shown in the scene, so its scale changes with height. Speed is in the model’s own units per second; the percentage compares it with the escape speed at the current height.';
