/**
 * Display altitude for the Rocket Lab. The flight model runs in scene units;
 * altitude is shown in km following the atmosphere layers drawn in the scene
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

/** An altitude for text, e.g. "52 km" or "9,000 km". */
export const formatAltitude = (altitude: number) => {
  const km = altitudeKm(altitude);
  return `${km < 10 ? km.toFixed(1) : Math.round(km).toLocaleString('en-US')} km`;
};
