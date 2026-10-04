import { describe, expect, it } from 'vitest';
import { DEFAULT_STAR_MASS, REALISTIC_G } from '@/physics/constants';
import { orbitalElements } from '@/physics/orbits';
import { predictPath, type PredictSeed } from '@/physics/predict';
import { FLIGHT_DT, escapeSpeedAt, initialFlightState, stepFlight, type FlightState } from '@/physics/rocket';
import { MAX_FRAME_DELTA, ROCKET_STEP_CAP, planForwardSteps, stepCap } from '@/physics/schedule';
import { SIM_STEP, SimulationCore } from '@/physics/simulation';
import type { CelestialBody } from '@/physics/types';
import { DEFAULT_PARAMS } from '@/worlds/rocket/rocketTypes';
import { SPACETIME_TEMPLATES } from '@/worlds/spacetime/spacetimeTemplates';

const G = REALISTIC_G;
const circularSpeed = (r: number) => Math.sqrt((G * DEFAULT_STAR_MASS) / r);

const SUN: CelestialBody = { id: 'sun', type: 'star', position: [0, 0, 0], mass: DEFAULT_STAR_MASS, radius: 2.4, color: '#fff', velocity: [0, 0, 0] };
const EARTH: CelestialBody = { id: 'earth', type: 'planet', position: [10, 0, 0], mass: 5.97e24, radius: 0.45, color: '#fff', velocity: [0, 0, circularSpeed(10)] };
const MARS: CelestialBody = { id: 'mars', type: 'planet', position: [-16, 0, 0], mass: 6.42e23, radius: 0.35, color: '#fff', velocity: [0, 0, -circularSpeed(16)] };

const loadCore = (bodies: CelestialBody[]) => {
  const core = new SimulationCore();
  core.load(bodies, { realistic: true, expansionRate: 0 });
  return core;
};

const seed = (body: CelestialBody): PredictSeed => ({
  id: body.id,
  type: body.type,
  x: body.position[0],
  z: body.position[2],
  vx: body.velocity![0],
  vz: body.velocity![2],
  mass: body.mass,
  radius: body.radius,
});

/** Same frame loop as PhysicsSimulator: each frame asks for (clamped delta × speed). */
const runFrames = (core: SimulationCore, frames: number, delta: number, timeScale: number) => {
  for (let f = 0; f < frames; f++) core.tick(Math.min(delta, MAX_FRAME_DELTA) * timeScale);
  return core;
};

describe('scheduler', () => {
  it('runs two 1/120 s steps per 60 fps frame at 1×', () => {
    expect(planForwardSteps(1 / 60, SIM_STEP, stepCap(3)).steps).toBe(2);
  });

  it('runs 128 steps per frame at 64× when the budget allows', () => {
    const plan = planForwardSteps((1 / 60) * 64, SIM_STEP, stepCap(3));
    expect(plan.steps).toBe(128);
    expect(plan.limited).toBe(false);
  });

  it('caps work per frame in crowded systems and reports it', () => {
    const cap = stepCap(150);
    const plan = planForwardSteps((1 / 60) * 64, SIM_STEP, cap);
    expect(plan.steps).toBe(cap);
    expect(plan.limited).toBe(true);
    expect(plan.carry).toBeLessThanOrEqual(SIM_STEP);
  });

  it('clamps a long hitch before applying warp', () => {
    expect(planForwardSteps(Math.min(2, MAX_FRAME_DELTA), SIM_STEP, 256).steps).toBe(12);
  });

  it('rewinds at the same rate forward time was recorded', () => {
    const core = runFrames(loadCore([SUN, EARTH, MARS]), 180, 1 / 60, 1);
    const before = core.currentStep;
    runFrames(core, 60, 1 / 60, -1);
    expect(before - core.currentStep).toBe(120); // one simulated second = 120 steps
  });
});

describe('64× warp', () => {
  it('gives exactly the same N-body state as running 64 times as many frames at 1×', () => {
    const slow = runFrames(loadCore([SUN, EARTH, MARS]), 64 * 30, 1 / 60, 1);
    const fast = runFrames(loadCore([SUN, EARTH, MARS]), 30, 1 / 60, 64);
    expect(fast.currentStep).toBe(slow.currentStep);
    for (const id of ['sun', 'earth', 'mars']) {
      const a = slow.sys.indexOf(id);
      const b = fast.sys.indexOf(id);
      expect(fast.sys.px[b]).toBe(slow.sys.px[a]);
      expect(fast.sys.pz[b]).toBe(slow.sys.pz[a]);
      expect(fast.sys.vx[b]).toBe(slow.sys.vx[a]);
    }
  });

  it('flies the rocket identically at 64× and at 1×', () => {
    const fly = (frames: number, timeScale: number) => {
      let s: FlightState = initialFlightState(DEFAULT_PARAMS);
      let carry = 0;
      for (let f = 0; f < frames; f++) {
        const plan = planForwardSteps(carry + (1 / 60) * timeScale, FLIGHT_DT, ROCKET_STEP_CAP);
        carry = plan.carry;
        for (let i = 0; i < plan.steps; i++) s = stepFlight(DEFAULT_PARAMS, s).state;
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
    const probe: CelestialBody = { id: 'probe', type: 'planet', position: [0, 0, 22], mass: 1e23, radius: 0.3, color: '#fff', velocity: [circularSpeed(22), 0, 0] };
    const horizon = 5;
    const result = predictPath({ bodies: [SUN, EARTH, MARS].map(seed), probe: seed(probe), realistic: true, horizon, sampleEvery: 1 });

    const core = loadCore([SUN, EARTH, MARS, probe]);
    runFrames(core, Math.round(horizon / SIM_STEP), SIM_STEP, 1);
    const i = core.sys.indexOf('probe');

    const n = result.points.length;
    expect(result.points[n - 2]).toBeCloseTo(core.sys.px[i], 4);
    expect(result.points[n - 1]).toBeCloseTo(core.sys.pz[i], 4);
    expect(result.outcome).toBe('bound');
  });

  it('flags a path that falls into the star as a collision', () => {
    const probe: PredictSeed = { id: 'probe', type: 'asteroid', x: 0, z: 12, vx: 0.05, vz: 0, mass: 1e23, radius: 0.3 };
    const result = predictPath({ bodies: [seed(SUN)], probe, realistic: true, horizon: 30, sampleEvery: 8 });
    expect(result.outcome).toBe('collision');
    expect(result.hitId).toBe('sun');
    expect(result.time).toBeGreaterThan(0);
  });

  it('flags a path faster than escape speed as escaping', () => {
    const probe: PredictSeed = { id: 'probe', type: 'comet', x: 30, z: 0, vx: 0, vz: circularSpeed(30) * 1.6, mass: 1e23, radius: 0.3 };
    expect(predictPath({ bodies: [seed(SUN)], probe, realistic: true, horizon: 6, sampleEvery: 8 }).outcome).toBe('escape');
  });
});

describe('orbital elements', () => {
  it('reads a circular orbit as e ≈ 0 with Kepler period 2πr/v', () => {
    const v = circularSpeed(10);
    const mu = G * (DEFAULT_STAR_MASS + EARTH.mass);
    const el = orbitalElements(10, 0, 0, v, mu);
    expect(el.energy).toBeLessThan(0);
    expect(el.eccentricity).toBeLessThan(0.01);
    expect(el.semiMajorAxis).toBeCloseTo(10, 1);
    expect(el.period).toBeCloseTo((2 * Math.PI * 10) / v, 0);
    expect(Math.sqrt((2 * mu) / el.distance) / Math.sqrt(mu / el.distance)).toBeCloseTo(Math.SQRT2, 5);
  });
});

describe('rocket display units', () => {
  it('maps altitude onto the atmosphere layers drawn in the scene', async () => {
    const { altitudeKm, escapeFraction } = await import('@/worlds/rocket/units');
    expect(altitudeKm(0)).toBe(0);
    expect(altitudeKm(8)).toBeCloseTo(12);
    expect(altitudeKm(20)).toBeCloseTo(50);
    expect(altitudeKm(33)).toBeCloseTo(80);
    expect(altitudeKm(45)).toBeCloseTo(600);
    expect(altitudeKm(4)).toBeCloseTo(6); // linear inside a layer
    expect(escapeFraction(DEFAULT_PARAMS, escapeSpeedAt(DEFAULT_PARAMS, 10), 10)).toBeCloseTo(1);
  });

  it('reports a thrust-to-weight ratio below 1 when the vehicle cannot lift off', async () => {
    const { liftoffTwr } = await import('@/worlds/rocket/units');
    expect(liftoffTwr(DEFAULT_PARAMS)).toBeGreaterThan(1);
    expect(liftoffTwr({ ...DEFAULT_PARAMS, thrustForce: 5 })).toBeLessThan(1);
  });
});

describe('Gravity Slingshot template', () => {
  it('flings the comet out faster than it arrived, without a collision', () => {
    const template = SPACETIME_TEMPLATES.find((t) => t.id === 'gravity-slingshot')!;
    const core = loadCore(template.createBodies().map((b, i) => ({ ...b, id: `b${i}` })));
    const sys = core.sys;
    const at = (id: string) => sys.indexOf(id);
    const energy = () => {
      const c = at('b2');
      const s = at('b0');
      const v2 = (sys.vx[c] - sys.vx[s]) ** 2 + (sys.vz[c] - sys.vz[s]) ** 2;
      return 0.5 * v2 - (G * sys.mass[s]) / Math.hypot(sys.px[c] - sys.px[s], sys.pz[c] - sys.pz[s]);
    };
    const before = energy();
    let closest = Infinity;
    for (let t = 0; t < 40; t += SIM_STEP * 8) {
      const result = core.tick(SIM_STEP * 8);
      expect(result.removed).toEqual([]);
      const c = at('b2');
      const g = at('b1');
      closest = Math.min(closest, Math.hypot(sys.px[c] - sys.px[g], sys.pz[c] - sys.pz[g]));
    }
    expect(closest).toBeLessThan(3);
    expect(energy()).toBeGreaterThan(before + 0.1);
  });
});
