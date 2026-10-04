import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  FIXED_SUBSTEP,
  adaptiveDt,
  effectiveGravity,
  stepWorld,
  type PhysicsBody,
} from '@/sim/nbody';
import { planForwardSteps, planRewindSteps, planRocketSteps, substepCap } from '@/sim/schedule';
import { predictPath, type BodySeed } from '@/sim/predict';
import { orbitalElements } from '@/sim/orbit';
import { stepAscent, type AscentState } from '@/sim/rocket';
import { DEFAULT_PARAMS } from '@/worlds/rocket/rocketTypes';

const G = effectiveGravity(true);

const seedBody = (seed: BodySeed): PhysicsBody => ({
  id: seed.id,
  position: new THREE.Vector3(seed.x, 0, seed.z),
  velocity: new THREE.Vector3(seed.vx, 0, seed.vz),
  force: new THREE.Vector3(),
  mass: seed.mass,
  radius: seed.radius,
  type: seed.type,
  color: '#fff',
  trailData: new Float32Array(0),
  trailHead: 0,
  trailLen: 0,
  motionState: 'bound',
  isCloseApproach: false,
});

const SUN: BodySeed = { id: 'sun', x: 0, z: 0, vx: 0, vz: 0, mass: 1.989e30, radius: 2.4, type: 'star' };
const circularSpeed = (r: number) => Math.sqrt((G * SUN.mass) / r);
const EARTH: BodySeed = { id: 'earth', x: 10, z: 0, vx: 0, vz: circularSpeed(10), mass: 5.97e24, radius: 0.45, type: 'planet' };
const MARS: BodySeed = { id: 'mars', x: -16, z: 0, vx: 0, vz: -circularSpeed(16), mass: 6.42e23, radius: 0.35, type: 'planet' };

const makeWorld = () => [SUN, EARTH, MARS].map(seedBody);

/** Same frame loop as PhysicsSimulator, minus rendering. */
const runFrames = (bods: PhysicsBody[], frames: number, delta: number, timeScale: number) => {
  let accumulator = 0;
  for (let f = 0; f < frames; f++) {
    const plan = planForwardSteps(accumulator, delta, timeScale, FIXED_SUBSTEP, substepCap(bods.length));
    accumulator = plan.carry;
    for (let s = 0; s < plan.steps; s++) stepWorld(bods, G, adaptiveDt(FIXED_SUBSTEP, bods));
  }
  return bods;
};

describe('scheduler', () => {
  it('runs two 1/120 s substeps per 60 fps frame at 1×', () => {
    expect(planForwardSteps(0, 1 / 60, 1, FIXED_SUBSTEP, 8).steps).toBe(2);
  });

  it('runs 128 substeps per frame at 64× when the budget allows', () => {
    const plan = planForwardSteps(0, 1 / 60, 64, FIXED_SUBSTEP, substepCap(3));
    expect(plan.steps).toBe(128);
    expect(plan.limited).toBe(false);
  });

  it('caps work per frame in crowded systems and reports it', () => {
    const cap = substepCap(150);
    const plan = planForwardSteps(0, 1 / 60, 64, FIXED_SUBSTEP, cap);
    expect(plan.steps).toBe(cap);
    expect(plan.limited).toBe(true);
    expect(plan.carry).toBeLessThanOrEqual(FIXED_SUBSTEP);
  });

  it('clamps a long hitch before applying warp', () => {
    expect(planForwardSteps(0, 2, 1, FIXED_SUBSTEP, 256).steps).toBe(12);
  });

  it('rewinds at the same rate forward time was recorded', () => {
    let carry = 0;
    let popped = 0;
    for (let f = 0; f < 60; f++) {
      const plan = planRewindSteps(carry, 1 / 60, -1, FIXED_SUBSTEP);
      carry = plan.carry;
      popped += plan.steps;
    }
    expect(popped).toBe(120); // one simulated second = 120 substeps
  });
});

describe('64× warp', () => {
  it('gives exactly the same N-body state as running 64 times as many frames at 1×', () => {
    const slow = runFrames(makeWorld(), 64 * 30, 1 / 60, 1);
    const fast = runFrames(makeWorld(), 30, 1 / 60, 64);
    for (let i = 0; i < slow.length; i++) {
      expect(fast[i].position.x).toBe(slow[i].position.x);
      expect(fast[i].position.z).toBe(slow[i].position.z);
      expect(fast[i].velocity.x).toBe(slow[i].velocity.x);
    }
  });

  it('flies the rocket identically at 64× and at 1×', () => {
    const start: AscentState = { px: 0, py: 0, vx: 0, vy: 0, fuel: 1, elapsed: 0, maxAltitude: 0 };
    const fly = (frames: number, timeScale: number) => {
      let s = start;
      let launching = true;
      for (let f = 0; f < frames; f++) {
        const { steps, dt } = planRocketSteps(1 / 60, timeScale);
        for (let i = 0; i < steps; i++) {
          const r = stepAscent(s, DEFAULT_PARAMS, launching, dt);
          s = r.next;
          if (r.cutoff) launching = false;
        }
      }
      return s;
    };
    const slow = fly(64 * 4, 1);
    const fast = fly(4, 64);
    expect(fast).toEqual(slow);
  });
});

describe('orbit predictor', () => {
  it('matches the live simulation step for step', () => {
    const probe: BodySeed = { id: 'probe', x: 0, z: 22, vx: circularSpeed(22), vz: 0, mass: 1e23, radius: 0.3, type: 'planet' };
    const horizon = 5;
    const result = predictPath({ bodies: [SUN, EARTH, MARS], probe, effectiveG: G, horizon, sampleEvery: 1 });

    const world = [SUN, EARTH, MARS, probe].map(seedBody);
    const steps = Math.round(horizon / FIXED_SUBSTEP);
    for (let i = 0; i < steps; i++) stepWorld(world, G, adaptiveDt(FIXED_SUBSTEP, world));
    const live = world[3];

    const n = result.path.length;
    expect(result.path[n - 2]).toBeCloseTo(live.position.x, 6);
    expect(result.path[n - 1]).toBeCloseTo(live.position.z, 6);
    expect(result.outcome).toBe('bound');
  });

  it('flags a path that falls into the star as a collision', () => {
    // Free-fall time from r = 12 is about 15 s.
    const probe: BodySeed = { id: 'probe', x: 0, z: 12, vx: 0.05, vz: 0, mass: 1e23, radius: 0.3, type: 'asteroid' };
    const result = predictPath({ bodies: [SUN], probe, effectiveG: G, horizon: 30, sampleEvery: 8 });
    expect(result.outcome).toBe('collision');
    expect(result.collisionAt).toBeGreaterThan(0);
  });

  it('flags a path faster than escape speed as escaping', () => {
    const probe: BodySeed = { id: 'probe', x: 30, z: 0, vx: 0, vz: circularSpeed(30) * 1.6, mass: 1e23, radius: 0.3, type: 'comet' };
    expect(predictPath({ bodies: [SUN], probe, effectiveG: G, horizon: 6, sampleEvery: 8 }).outcome).toBe('escape');
  });
});

describe('orbital elements', () => {
  it('reads a circular orbit as e ≈ 0 with Kepler period 2πr/v', () => {
    const world = [SUN, EARTH].map(seedBody);
    const el = orbitalElements(world[1], world, G)!;
    expect(el.bound).toBe(true);
    expect(el.eccentricity).toBeLessThan(0.01);
    expect(el.semiMajorAxis!).toBeCloseTo(10, 1);
    expect(el.period!).toBeCloseTo((2 * Math.PI * 10) / circularSpeed(10), 0);
    expect(el.escapeSpeed / el.circularSpeed).toBeCloseTo(Math.SQRT2, 5);
  });
});
