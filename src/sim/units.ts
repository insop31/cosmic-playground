import { ESCAPE_VELOCITY } from './rocket';

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

export const altitudeKm = (py: number) => {
  if (py <= 0) return 0;
  for (let i = 1; i < ALTITUDE_BREAKS.length; i++) {
    const [u1, k1] = ALTITUDE_BREAKS[i];
    if (py <= u1) {
      const [u0, k0] = ALTITUDE_BREAKS[i - 1];
      return k0 + ((py - u0) / (u1 - u0)) * (k1 - k0);
    }
  }
  const [uLast, kLast] = ALTITUDE_BREAKS[ALTITUDE_BREAKS.length - 1];
  return kLast + (py - uLast) * KM_PER_UNIT_ABOVE;
};

/**
 * Speed stays in the model's own units (u/s). What matters for the outcome is
 * how it compares with escape speed, so that is shown alongside.
 */
export const escapeFraction = (sceneSpeed: number) => sceneSpeed / ESCAPE_VELOCITY;
export { ESCAPE_VELOCITY };

/** Above this altitude the model has no air at all. */
export const SPACE_ALTITUDE_UNITS = 45;

export const UNITS_NOTE =
  `Altitude follows the atmosphere layers shown in the scene, so its scale changes with height. Speed is in the model’s own units per second; escape speed here is ${ESCAPE_VELOCITY.toFixed(2)} u/s.`;
