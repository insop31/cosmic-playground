import { describe, expect, it } from 'vitest';
import { DEFAULT_STAR_MASS, REALISTIC_G } from './constants';
import {
  SCENE_UNITS_PER_AU,
  SIM_SECONDS_PER_YEAR,
  formatDuration,
  formatMass,
  simSecondsToDays,
  toAU,
  toKmPerSecond,
} from './units';

describe('real-world units', () => {
  it('maps the default Earth orbit to 1 AU, one year and about 30 km/s', () => {
    const r = SCENE_UNITS_PER_AU;
    const speed = Math.sqrt((REALISTIC_G * DEFAULT_STAR_MASS) / r);
    const period = (2 * Math.PI * r) / speed;
    expect(toAU(r)).toBe(1);
    expect(simSecondsToDays(period)).toBeCloseTo(365.25, 6);
    expect(period).toBeCloseTo(SIM_SECONDS_PER_YEAR, 9);
    expect(toKmPerSecond(speed)).toBeCloseTo(29.78, 1);
  });

  it('formats masses and durations in familiar units', () => {
    expect(formatMass(DEFAULT_STAR_MASS)).toBe('1.00 M☉');
    expect(formatMass(5.972e24)).toBe('1.00 M⊕');
    expect(formatDuration(88)).toBe('88 days');
    expect(formatDuration(4332)).toBe('11.86 years');
  });
});
