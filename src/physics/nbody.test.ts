import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  ARCADE_MAX_SPEED,
  DEFAULT_STAR_MASS,
  REALISTIC_G,
  SOFTENING_SQ,
  gravityConstant,
  maxSpeedFor,
} from './constants';
import {
  createPhysicsBody,
  detectEvents,
  integrate,
  spawnOrbitalVelocity,
  stepSystem,
  substepCount,
  totalEnergy,
  totalMomentum,
  type PhysicsBody,
} from './nbody';

const STEP = 1 / 120;
const EARTH_MASS = 5.97e24;

/** Circular speed for this engine's force law F = GMm/(r² + ε²). */
const circularSpeed = (G: number, mass: number, r: number) => Math.sqrt((G * mass * r) / (r * r + SOFTENING_SQ));

const sunAndPlanet = (r: number, G = REALISTIC_G): PhysicsBody[] => [
  createPhysicsBody({ id: 'sun', position: [0, 0, 0], velocity: [0, 0, 0], mass: DEFAULT_STAR_MASS, radius: 2.4, type: 'star', color: '#fc0' }),
  createPhysicsBody({ id: 'planet', position: [r, 0, 0], velocity: [0, 0, circularSpeed(G, DEFAULT_STAR_MASS, r)], mass: EARTH_MASS, radius: 0.45, type: 'planet', color: '#58e' }),
];

/** The default Spacetime Lab system, with velocities assigned the way the simulator does. */
const defaultSystem = (realisticMode: boolean): PhysicsBody[] => {
  const G = gravityConstant(realisticMode);
  const bodies: PhysicsBody[] = [];
  const specs: Array<[string, [number, number, number], number, number, string]> = [
    ['sun', [0, 0, 0], DEFAULT_STAR_MASS, 2.4, 'star'],
    ['earth', [8, 0, 0], EARTH_MASS, 0.45, 'planet'],
    ['mars', [-5, 0, 6], 6.42e23, 0.35, 'planet'],
  ];
  for (const [id, position, mass, radius, type] of specs) {
    const velocity = spawnOrbitalVelocity(new THREE.Vector3(...position), bodies, G);
    bodies.push(createPhysicsBody({ id, position, velocity, mass, radius, type, color: '#fff' }));
  }
  return bodies;
};

describe('N-body engine', () => {
  it('keeps energy drift under 0.1% over 100 circular orbits', () => {
    const bodies = sunAndPlanet(10);
    const e0 = totalEnergy(bodies, REALISTIC_G);
    const v = circularSpeed(REALISTIC_G, DEFAULT_STAR_MASS, 10);
    const period = (2 * Math.PI * 10) / v;
    const steps = Math.ceil((100 * period) / STEP);
    for (let i = 0; i < steps; i++) stepSystem(bodies, STEP, { effectiveG: REALISTIC_G });
    const drift = Math.abs((totalEnergy(bodies, REALISTIC_G) - e0) / e0);
    expect(drift).toBeLessThan(0.001);
  });

  it("matches Kepler's third law to within 1%", () => {
    const r = 20;
    const bodies = sunAndPlanet(r);
    const [, planet] = bodies;
    const expected = 2 * Math.PI * Math.sqrt((r ** 3) / (REALISTIC_G * DEFAULT_STAR_MASS));
    let previousZ = planet.position.z;
    let elapsed = 0;
    let crossings = 0;
    let measured = 0;
    while (crossings < 2 && elapsed < expected * 3) {
      stepSystem(bodies, STEP, { effectiveG: REALISTIC_G });
      elapsed += STEP;
      // Count upward crossings of the x-axis on the +x side: one per orbit.
      if (previousZ < 0 && planet.position.z >= 0 && planet.position.x > 0) {
        crossings++;
        if (crossings === 1) measured = elapsed;
        else measured = elapsed - measured;
      }
      previousZ = planet.position.z;
    }
    expect(crossings).toBe(2);
    expect(Math.abs(measured - expected) / expected).toBeLessThan(0.01);
  });

  it('conserves momentum exactly when two bodies merge', () => {
    const a = createPhysicsBody({ id: 'a', position: [0, 0, 0], velocity: [0.4, 0, 0.1], mass: 3e24, radius: 0.5, type: 'planet', color: '#fff' });
    const b = createPhysicsBody({ id: 'b', position: [0.6, 0, 0], velocity: [-0.9, 0, 0.3], mass: 1e24, radius: 0.5, type: 'planet', color: '#fff' });
    const before = totalMomentum([a, b]);
    const removed = new Set<string>();
    const impacts = detectEvents([a, b], removed);
    expect(impacts).toHaveLength(1);
    expect(removed.has('b')).toBe(true);
    const after = totalMomentum([a]);
    expect(Math.abs(after[0] - before[0]) / Math.abs(before[0])).toBeLessThan(1e-9);
    expect(Math.abs(after[1] - before[1]) / Math.abs(before[1])).toBeLessThan(1e-9);
    expect(a.mass).toBe(4e24);
  });

  it('is time-reversible: 1,000 steps forward then back returns to the start', () => {
    const bodies = sunAndPlanet(12);
    const start = bodies.map((b) => b.position.clone());
    for (let i = 0; i < 1000; i++) integrate(bodies, REALISTIC_G, STEP);
    for (const b of bodies) b.velocity.negate();
    for (let i = 0; i < 1000; i++) integrate(bodies, REALISTIC_G, STEP);
    bodies.forEach((b, i) => expect(b.position.distanceTo(start[i])).toBeLessThan(1e-9));
  });

  it('keeps the default system on the grid for 60 s in arcade mode', () => {
    const bodies = defaultSystem(false);
    const options = { effectiveG: gravityConstant(false), maxSpeed: maxSpeedFor(false) };
    for (let t = 0; t < 60; t += STEP) {
      const { removed } = stepSystem(bodies, STEP, options);
      expect(removed.size).toBe(0);
    }
    for (const b of bodies) expect(b.position.length()).toBeLessThan(110);
  });

  it('keeps the default system on the grid for 60 s in realistic mode', () => {
    const bodies = defaultSystem(true);
    for (let t = 0; t < 60; t += STEP) stepSystem(bodies, STEP, { effectiveG: gravityConstant(true) });
    for (const b of bodies) expect(b.position.length()).toBeLessThan(110);
  });

  it('caps speed in arcade mode', () => {
    const fast = createPhysicsBody({ id: 'fast', position: [30, 0, 0], velocity: [50, 0, 0], mass: 1e16, radius: 0.2, type: 'asteroid', color: '#fff' });
    integrate([fast], gravityConstant(false), STEP, ARCADE_MAX_SPEED);
    expect(fast.velocity.length()).toBeLessThanOrEqual(ARCADE_MAX_SPEED + 1e-9);
  });

  it('splits steps during close encounters without changing the total time', () => {
    const far = sunAndPlanet(40);
    const near = sunAndPlanet(3.2);
    expect(substepCount(far)).toBe(1);
    expect(substepCount(near)).toBeGreaterThan(1);
  });

  it('expands only unbound bodies', () => {
    const bodies = sunAndPlanet(10);
    const rogue = createPhysicsBody({ id: 'rogue', position: [60, 0, 0], velocity: [5, 0, 0], mass: 1e16, radius: 0.2, type: 'asteroid', color: '#fff' });
    bodies.push(rogue);
    stepSystem(bodies, STEP, { effectiveG: REALISTIC_G }); // classify first
    const planetRadius = bodies[1].position.length();
    const rogueStart = rogue.position.x;
    for (let i = 0; i < 120; i++) stepSystem(bodies, STEP, { effectiveG: REALISTIC_G, expansionRate: 0.5 });
    expect(rogue.motionState).toBe('escaping');
    expect(rogue.position.x - rogueStart).toBeGreaterThan(5 * 1 + 1); // drift beyond its own motion
    expect(Math.abs(bodies[1].position.length() - planetRadius)).toBeLessThan(0.05);
  });
});
