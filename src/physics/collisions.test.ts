import { describe, expect, it } from 'vitest';
import { DEFAULT_STAR_MASS, REALISTIC_G } from './constants';
import { FRAGMENT_COUNT, TIDAL_STREAM_PIECES, detectCollisions, diagnostics, mutualEscapeSpeed, rocheLimit, type SpawnedBody } from './nbody';
import { orbitalElements, conicPoints } from './orbits';
import { SimulationCore } from './simulation';
import { NBodySystem, type BodyInit } from './system';
import type { CelestialBody } from './types';

const G = REALISTIC_G;

// An Earth-like target and a Mars-like impactor, touching.
const pair = (speed: number, a: Partial<BodyInit> = {}, b: Partial<BodyInit> = {}) => {
  const sys = new NBodySystem(4);
  sys.add({ id: 'big', type: 'planet', x: 0, z: 0, vx: 0, vz: 0, mass: 5.97e24, radius: 0.45, physRadius: 6.371e6, ...a });
  sys.add({ id: 'small', type: 'planet', x: 0.7, z: 0, vx: -speed, vz: 0.02, mass: 6.42e23, radius: 0.35, physRadius: 3.39e6, ...b });
  return sys;
};

const escapeSpeed = (sys: NBodySystem) => mutualEscapeSpeed(sys.mass[0], sys.mass[1], sys.physRadius[0], sys.physRadius[1]);

const collide = (sys: NBodySystem) => {
  const before = diagnostics(sys, G);
  const removed: string[] = [];
  const spawned: SpawnedBody[] = [];
  const impacts = detectCollisions(sys, removed, G, spawned);
  const after = diagnostics(sys, G);
  return { impacts, removed, spawned, before, after };
};

describe('collision outcomes', () => {
  it('uses real radii: Earth and Mars have a mutual escape speed near 9.5 km/s', () => {
    const sys = pair(0);
    // 1 scene unit per second ≈ 26.7 km/s in realistic mode
    expect(escapeSpeed(sys) * 26.7).toBeGreaterThan(9);
    expect(escapeSpeed(sys) * 26.7).toBeLessThan(10.5);
  });

  it('accretes tiny impactors whatever their speed', () => {
    const sys = pair(0, {}, { type: 'asteroid', mass: 1e16, radius: 0.28, physRadius: 1000 });
    sys.vx[1] = -40 * escapeSpeed(sys);
    const { impacts, removed } = collide(sys);
    expect(impacts[0].kind).toBe('merge');
    expect(removed).toEqual(['small']);
  });

  it('merges slow impacts', () => {
    const sys = pair(0);
    sys.vx[1] = -0.5 * escapeSpeed(sys);
    const { impacts, removed } = collide(sys);
    expect(impacts[0].kind).toBe('merge');
    expect(impacts[0].kineticEnergyLost).toBe(1);
    expect(removed).toEqual(['small']);
  });

  it('bounces faster impacts, keeping momentum and losing energy', () => {
    const sys = pair(0);
    sys.vx[1] = -1.8 * escapeSpeed(sys);
    const { impacts, removed, before, after } = collide(sys);
    expect(impacts[0].kind).toBe('bounce');
    // Restitution 0.5 keeps 25% of the (almost head-on) impact energy; 75% becomes heat.
    expect(impacts[0].kineticEnergyLost).toBeGreaterThan(0.7);
    expect(impacts[0].kineticEnergyLost).toBeLessThan(0.76);
    expect(removed).toEqual([]);
    expect(after.momentumX).toBeCloseTo(before.momentumX, 6);
    expect(after.kinetic).toBeLessThan(before.kinetic);
    // The pair now separates.
    expect(sys.vx[1] - sys.vx[0]).toBeGreaterThan(0);
  });

  it('shatters the smaller body in violent impacts without creating energy', () => {
    const sys = pair(0);
    sys.vx[1] = -4 * escapeSpeed(sys);
    const { impacts, removed, spawned, before, after } = collide(sys);
    expect(impacts[0].kind).toBe('fragment');
    expect(removed).toEqual(['small']);
    expect(spawned).toHaveLength(FRAGMENT_COUNT);
    expect(sys.count).toBe(1 + FRAGMENT_COUNT);
    expect(spawned.reduce((m, b) => m + b.mass, 0) / 6.42e23).toBeCloseTo(1, 9);
    expect(Math.abs(after.momentumX - before.momentumX) / Math.abs(before.momentumX)).toBeLessThan(1e-9);
    expect(Math.abs(after.momentumZ - before.momentumZ) / Math.abs(before.momentumZ)).toBeLessThan(1e-9);
    expect(after.kinetic).toBeLessThan(before.kinetic);
  });

  it('pulls a star into a stream inside a black hole Roche limit', () => {
    const sys = new NBodySystem(4);
    sys.add({ id: 'bh', type: 'blackhole', x: 0, z: 0, vx: 0, vz: 0, mass: 5e30, radius: 1.4 });
    const limit = rocheLimit(1.2, DEFAULT_STAR_MASS, 5e30);
    sys.add({ id: 'star', type: 'star', x: limit * 0.9, z: 0, vx: 0, vz: 1, mass: DEFAULT_STAR_MASS, radius: 1.2 });
    const { impacts, removed, spawned, before, after } = collide(sys);
    expect(impacts[0].kind).toBe('tidal');
    expect(removed).toEqual(['star']);
    expect(spawned).toHaveLength(TIDAL_STREAM_PIECES);
    expect(Math.abs(after.momentumZ - before.momentumZ) / Math.abs(before.momentumZ)).toBeLessThan(1e-9);
  });
});

describe('orbital elements', () => {
  it('describes a circular orbit', () => {
    const mu = G * DEFAULT_STAR_MASS;
    const r = 8;
    const v = Math.sqrt(mu / r);
    const el = orbitalElements(r, 0, 0, v, mu);
    expect(el.eccentricity).toBeLessThan(1e-9);
    expect(el.semiMajorAxis).toBeCloseTo(8, 9);
    expect(el.period).toBeCloseTo(2 * Math.PI * Math.sqrt(512 / mu), 9);
    const points = conicPoints(el, 0, 0, 32);
    for (const [x, z] of points) expect(Math.hypot(x, z)).toBeCloseTo(8, 6);
  });

  it('finds periapsis and apoapsis of an ellipse, and marks fast bodies unbound', () => {
    const mu = G * DEFAULT_STAR_MASS;
    const el = orbitalElements(10, 0, 0, Math.sqrt(mu / 10) * 0.8, mu);
    expect(el.apoapsisDistance).toBeCloseTo(10, 6);
    expect(el.periapsisDistance).toBeLessThan(10);
    expect(el.periapsisDirection[0]).toBeCloseTo(-1, 6);
    const fast = orbitalElements(10, 0, 0, Math.sqrt((2 * mu) / 10) * 1.1, mu);
    expect(fast.energy).toBeGreaterThan(0);
    expect(fast.period).toBe(Infinity);
    expect(conicPoints(fast, 0, 0).length).toBeGreaterThan(10);
  });
});

describe('predictions', () => {
  const sun: CelestialBody = { id: 'sun', type: 'star', position: [0, 0, 0], mass: DEFAULT_STAR_MASS, radius: 2.4, color: '#fc0', velocity: [0, 0, 0] };
  const rock = (velocity: [number, number, number]): CelestialBody => ({ id: 'ghost', type: 'asteroid', position: [12, 0, 0], mass: 1e16, radius: 0.28, color: '#aaa', velocity });

  it('predicts orbit, escape and collision without changing the live system', () => {
    const core = new SimulationCore();
    core.load([sun], { realistic: true, expansionRate: 0 });
    const vCirc = Math.sqrt((G * DEFAULT_STAR_MASS) / 12);
    expect(core.predict(rock([0, 0, vCirc])).outcome).toBe('bound');
    expect(core.predict(rock([vCirc * 2, 0, 0])).outcome).toBe('escape');
    const hit = core.predict(rock([-vCirc, 0, 0]));
    expect(hit.outcome).toBe('collision');
    expect(hit.hitId).toBe('sun');
    expect(core.sys.count).toBe(1);
    expect(core.currentStep).toBe(0);
  });

  it('ghost path matches the real run to within 1% over 10 s', () => {
    const system: CelestialBody[] = [
      sun,
      { id: 'earth', type: 'planet', position: [8, 0, 0], mass: 5.97e24, radius: 0.45, color: '#58e', velocity: [0, 0, 0] },
    ];
    const vCirc = Math.sqrt((G * DEFAULT_STAR_MASS) / 12);
    const candidate = rock([0.2, 0, vCirc * 1.1]);
    const core = new SimulationCore();
    core.load(system, { realistic: true, expansionRate: 0 });
    const prediction = core.predict(candidate, 10);
    core.add(candidate);
    for (let i = 0; i < 1200; i++) core.tick(1 / 120);
    const k = core.sys.indexOf('ghost');
    const n = prediction.points.length;
    const [px, pz] = [prediction.points[n - 2], prediction.points[n - 1]];
    const travelled = Math.hypot(core.sys.px[k] - 12, core.sys.pz[k]);
    expect(Math.hypot(core.sys.px[k] - px, core.sys.pz[k] - pz) / travelled).toBeLessThan(0.01);
  });

  it('reports fragments created by the simulation', () => {
    const core = new SimulationCore();
    core.load([
      { id: 'planet', type: 'planet', position: [0, 0, 0], mass: 6e24, radius: 0.45, color: '#58e', velocity: [0, 0, 0], pinned: true },
      { id: 'rock', name: 'Rock', type: 'asteroid', position: [3, 0, 0], mass: 1e22, radius: 0.2, color: '#aaa', velocity: [-6, 0, 0.01] },
    ], { realistic: true, expansionRate: 0 });
    let spawned: CelestialBody[] = [];
    for (let i = 0; i < 120 && spawned.length === 0; i++) spawned = core.tick(1 / 120).spawned;
    expect(spawned).toHaveLength(FRAGMENT_COUNT);
    expect(spawned[0].name).toBe('Rock fragment');
  });
});
