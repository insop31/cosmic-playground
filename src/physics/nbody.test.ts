import { describe, expect, it } from 'vitest';
import { ARCADE_MAX_SPEED, DEFAULT_STAR_MASS, REALISTIC_G, SOFTENING_SQ } from './constants';
import {
  detectCollisions,
  diagnostics,
  leapfrogStep,
  stepSystem,
  substepCount,
} from './nbody';
import { MOTION_ESCAPING, NBodySystem, type BodyInit } from './system';

const STEP = 1 / 120;
const EARTH_MASS = 5.97e24;

/** Circular speed for this engine's force law F = GMm/(r² + ε²). */
const circularSpeed = (G: number, mass: number, r: number) => Math.sqrt((G * mass * r) / (r * r + SOFTENING_SQ));

const system = (bodies: BodyInit[]) => {
  const sys = new NBodySystem(4);
  for (const body of bodies) sys.add(body);
  return sys;
};

const sun = (extra: Partial<BodyInit> = {}): BodyInit => ({
  id: 'sun', type: 'star', x: 0, z: 0, vx: 0, vz: 0, mass: DEFAULT_STAR_MASS, radius: 2.4, ...extra,
});

const planetAt = (r: number, extra: Partial<BodyInit> = {}): BodyInit => ({
  id: 'planet', type: 'planet', x: r, z: 0, vx: 0, vz: circularSpeed(REALISTIC_G, DEFAULT_STAR_MASS, r),
  mass: EARTH_MASS, radius: 0.45, ...extra,
});

describe('N-body engine', () => {
  it('keeps energy drift under 0.1% over 100 circular orbits', () => {
    const sys = system([sun(), planetAt(10)]);
    const e0 = diagnostics(sys, REALISTIC_G).energy;
    const period = (2 * Math.PI * 10) / circularSpeed(REALISTIC_G, DEFAULT_STAR_MASS, 10);
    const steps = Math.ceil((100 * period) / STEP);
    for (let i = 0; i < steps; i++) stepSystem(sys, STEP, { effectiveG: REALISTIC_G });
    const drift = Math.abs((diagnostics(sys, REALISTIC_G).energy - e0) / e0);
    expect(drift).toBeLessThan(0.001);
  });

  it('conserves angular momentum in a two-body orbit', () => {
    const sys = system([sun(), planetAt(12)]);
    const l0 = diagnostics(sys, REALISTIC_G).angularMomentum;
    for (let i = 0; i < 20_000; i++) stepSystem(sys, STEP, { effectiveG: REALISTIC_G });
    const l1 = diagnostics(sys, REALISTIC_G).angularMomentum;
    expect(Math.abs((l1 - l0) / l0)).toBeLessThan(1e-9);
  });

  it("matches Kepler's third law to within 1%", () => {
    const r = 20;
    const sys = system([sun(), planetAt(r)]);
    const p = sys.indexOf('planet');
    const expected = 2 * Math.PI * Math.sqrt((r ** 3) / (REALISTIC_G * DEFAULT_STAR_MASS));
    let previousZ = sys.pz[p];
    let elapsed = 0;
    let first = 0;
    let measured = 0;
    let crossings = 0;
    while (crossings < 2 && elapsed < expected * 3) {
      stepSystem(sys, STEP, { effectiveG: REALISTIC_G });
      elapsed += STEP;
      if (previousZ < 0 && sys.pz[p] >= 0 && sys.px[p] > 0) {
        crossings++;
        if (crossings === 1) first = elapsed;
        else measured = elapsed - first;
      }
      previousZ = sys.pz[p];
    }
    expect(crossings).toBe(2);
    expect(Math.abs(measured - expected) / expected).toBeLessThan(0.01);
  });

  it('conserves momentum exactly when two bodies merge', () => {
    const sys = system([
      // A gentle impact, well below the pair's mutual escape speed, so they stick.
      { id: 'a', type: 'planet', x: 0, z: 0, vx: 0.04, vz: 0.01, mass: 3e24, radius: 0.5 },
      { id: 'b', type: 'planet', x: 0.6, z: 0, vx: -0.09, vz: 0.03, mass: 1e24, radius: 0.5 },
    ]);
    const before = diagnostics(sys, REALISTIC_G);
    const removed: string[] = [];
    const impacts = detectCollisions(sys, removed);
    expect(impacts).toHaveLength(1);
    expect(impacts[0].kineticEnergyLost).toBeGreaterThan(0);
    expect(removed).toEqual(['b']);
    const after = diagnostics(sys, REALISTIC_G);
    expect(Math.abs(after.momentumX - before.momentumX) / Math.abs(before.momentumX)).toBeLessThan(1e-9);
    expect(Math.abs(after.momentumZ - before.momentumZ) / Math.abs(before.momentumZ)).toBeLessThan(1e-9);
    expect(sys.mass[sys.indexOf('a')]).toBe(4e24);
  });

  it('is time-reversible: 1,000 steps forward then back returns to the start', () => {
    const sys = system([sun(), planetAt(12)]);
    const start = [sys.px[0], sys.pz[0], sys.px[1], sys.pz[1]];
    for (let i = 0; i < 1000; i++) leapfrogStep(sys, REALISTIC_G, STEP);
    for (let i = 0; i < sys.count; i++) { sys.vx[i] = -sys.vx[i]; sys.vz[i] = -sys.vz[i]; }
    for (let i = 0; i < 1000; i++) leapfrogStep(sys, REALISTIC_G, STEP);
    const end = [sys.px[0], sys.pz[0], sys.px[1], sys.pz[1]];
    end.forEach((v, k) => expect(Math.abs(v - start[k])).toBeLessThan(1e-9));
  });

  it('caps speed in arcade mode', () => {
    const sys = system([{ id: 'fast', type: 'asteroid', x: 30, z: 0, vx: 50, vz: 0, mass: 1e16, radius: 0.2 }]);
    leapfrogStep(sys, REALISTIC_G * 4, STEP, ARCADE_MAX_SPEED);
    expect(Math.hypot(sys.vx[0], sys.vz[0])).toBeLessThanOrEqual(ARCADE_MAX_SPEED + 1e-9);
  });

  it('keeps pinned bodies still while they keep pulling', () => {
    const sys = system([sun({ type: 'blackhole', pinned: true }), planetAt(10)]);
    for (let i = 0; i < 600; i++) stepSystem(sys, STEP, { effectiveG: REALISTIC_G });
    expect(sys.px[sys.indexOf('sun')]).toBe(0);
    expect(sys.pz[sys.indexOf('sun')]).toBe(0);
    const p = sys.indexOf('planet');
    expect(Math.hypot(sys.px[p], sys.pz[p])).toBeCloseTo(10, 1);
  });

  it('splits steps during close encounters', () => {
    expect(substepCount(system([sun(), planetAt(40)]))).toBe(1);
    expect(substepCount(system([sun(), planetAt(3.2)]))).toBeGreaterThan(1);
  });

  it('expands only unbound bodies', () => {
    const sys = system([
      sun(),
      planetAt(10),
      { id: 'rogue', type: 'asteroid', x: 60, z: 0, vx: 5, vz: 0, mass: 1e16, radius: 0.2 },
    ]);
    stepSystem(sys, STEP, { effectiveG: REALISTIC_G });
    const p = sys.indexOf('planet');
    const rogue = sys.indexOf('rogue');
    const planetRadius = Math.hypot(sys.px[p], sys.pz[p]);
    const rogueStart = sys.px[rogue];
    for (let i = 0; i < 120; i++) stepSystem(sys, STEP, { effectiveG: REALISTIC_G, expansionRate: 0.5 });
    expect(sys.motion[sys.indexOf('rogue')]).toBe(MOTION_ESCAPING);
    expect(sys.px[sys.indexOf('rogue')] - rogueStart).toBeGreaterThan(6);
    expect(Math.abs(Math.hypot(sys.px[p], sys.pz[p]) - planetRadius)).toBeLessThan(0.05);
  });
});
