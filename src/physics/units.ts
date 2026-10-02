// Conversions from scene units to real-world units for readouts.
//
// The scene uses its own units: distance in scene units, time in simulated seconds and
// mass in kilograms (scaled by REALISTIC_G). Two anchors tie them to reality:
//   • distance: Earth's default orbit (8 scene units) is 1 astronomical unit;
//   • time: one Earth orbit around one solar mass at 1 AU takes exactly one year.
// With those two, every speed, period and distance can be shown in real units.
import { DEFAULT_STAR_MASS, REALISTIC_G } from './constants';

export const SCENE_UNITS_PER_AU = 8;
export const KM_PER_AU = 149_597_870.7;
export const SECONDS_PER_DAY = 86_400;
export const DAYS_PER_YEAR = 365.25;
export const EARTH_MASS_KG = 5.972e24;

/** Simulated seconds in one year: the period of a 1 AU orbit around one solar mass. */
export const SIM_SECONDS_PER_YEAR =
  2 * Math.PI * Math.sqrt((SCENE_UNITS_PER_AU ** 3) / (REALISTIC_G * DEFAULT_STAR_MASS));

export const toAU = (sceneDistance: number) => sceneDistance / SCENE_UNITS_PER_AU;

export const simSecondsToDays = (seconds: number) => (seconds / SIM_SECONDS_PER_YEAR) * DAYS_PER_YEAR;

/** Speed in km/s from a scene speed (scene units per simulated second). */
export const toKmPerSecond = (sceneSpeed: number) => {
  const auPerYear = toAU(sceneSpeed) * SIM_SECONDS_PER_YEAR;
  return (auPerYear * KM_PER_AU) / (DAYS_PER_YEAR * SECONDS_PER_DAY);
};

export const toSolarMasses = (kg: number) => kg / DEFAULT_STAR_MASS;
export const toEarthMasses = (kg: number) => kg / EARTH_MASS_KG;

/** "84 days", "1.9 years" — whichever reads naturally. */
export const formatDuration = (days: number) => {
  if (!Number.isFinite(days)) return '—';
  if (days < 1) return `${(days * 24).toFixed(1)} hours`;
  if (days < 400) return `${days.toFixed(0)} days`;
  return `${(days / DAYS_PER_YEAR).toFixed(2)} years`;
};

/** Mass in the unit a student would recognise for its size. */
export const formatMass = (kg: number) => {
  const solar = toSolarMasses(kg);
  if (solar >= 0.01) return `${solar.toFixed(2)} M☉`;
  const earth = toEarthMasses(kg);
  if (earth >= 0.001) return `${earth.toFixed(earth >= 10 ? 0 : 2)} M⊕`;
  return `${kg.toExponential(1)} kg`;
};
