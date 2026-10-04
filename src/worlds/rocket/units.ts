import { SCALE_HEIGHT, escapeSpeedAt, vehicleSummary } from '@/physics/rocket';
import type { RocketParams } from './rocketTypes';

/**
 * Display units for the Rocket Lab. The flight model runs in scene units;
 * these map them onto familiar scales, consistent with what the scene shows.
 */
export { altitudeKm } from '@/physics/altitude';

/** Where the air has thinned below 1% of its surface density: "space" for the flight log. */
export const SPACE_ALTITUDE = SCALE_HEIGHT * Math.log(100);

/** Speed as a fraction of the escape speed at this height (≥ 1 means it will not come back). */
export const escapeFraction = (params: RocketParams, speed: number, altitude: number) =>
  speed / escapeSpeedAt(params, Math.max(altitude, 0));

/** Thrust-to-weight ratio on the pad: above 1 the vehicle can lift off. */
export const liftoffTwr = (params: RocketParams) => vehicleSummary(params).liftoffThrustToWeight;

export const UNITS_NOTE =
  'Altitude follows the atmosphere layers shown in the scene, so its scale changes with height. Speed is in the model’s own units per second; the percentage compares it with the escape speed at the current height.';
