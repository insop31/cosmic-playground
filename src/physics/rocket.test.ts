import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, normalizeRocketParams, type RocketParams } from '@/worlds/rocket/rocketTypes';
import { applyWeatherToParams } from '@/worlds/rocket/weatherPresets';
import {
  FLIGHT_DT,
  THRUST_SCALE,
  altitudeOf,
  buildOrbitPath,
  initialFlightState,
  predictFlight,
  stepFlight,
  vehicleSummary,
  type FlightEnvironment,
  type FlightState,
} from './rocket';

const params = (overrides: Partial<RocketParams>): RocketParams => ({ ...DEFAULT_PARAMS, ...overrides });

const fly = (p: RocketParams, env?: FlightEnvironment, maxSeconds = 200) => {
  let state: FlightState = initialFlightState(p, env);
  for (let i = 0; i < maxSeconds / FLIGHT_DT; i++) {
    const result = stepFlight(p, state, FLIGHT_DT, { env });
    state = result.state;
    if (result.verdict) return { state, verdict: result.verdict };
  }
  return { state, verdict: null };
};

const vacuum = (overrides: Partial<RocketParams> = {}) => params({
  launchAngle: 0, padTilt: 0, atmosphericDensity: 0, crosswind: 0, gravity: 0, ambientTemperature: 15, ...overrides,
});

const burnToEmpty = (p: RocketParams) => {
  let state = initialFlightState(p);
  for (let i = 0; i < 100_000 && state.stage !== 0; i++) state = stepFlight(p, state).state;
  return state;
};

describe('rocket flight model', () => {
  it.each([
    ['suborbital', {}],
    ['orbiting', { stageSeparation: true }],
    ['escape', { thrustForce: 60, fuelMass: 140 }],
    ['burnup', { thrustForce: 100, burnDuration: 3, atmosphericDensity: 1, thermalLoad: 1, launchAngle: 45 }],
    ['crashed', { thrustForce: 15 }],
  ] as const)('can end in %s', (outcome, overrides) => {
    const { verdict } = fly(params(overrides));
    expect(verdict?.outcome).toBe(outcome);
    expect(verdict?.reason.length).toBeGreaterThan(20);
  });

  it('explains why a single burn from the ground cannot orbit', () => {
    const { verdict } = fly(params({}));
    expect(verdict?.reason).toMatch(/single burn/);
  });

  it('holds an underpowered rocket on the pad and explains why', () => {
    const { state, verdict } = fly(params({ thrustForce: 10, dryMass: 80, gravity: 25 }));
    expect(state.liftedOff).toBe(false);
    expect(verdict?.reason).toMatch(/never left the pad/);
  });

  it('preview ends exactly where the flight does', () => {
    for (const overrides of [{}, { stageSeparation: true }, { thrustForce: 15 }]) {
      const p = params(overrides);
      const flight = fly(p, undefined, 90);
      const preview = predictFlight(p, 90);
      const [lastX, lastY] = preview.points[preview.points.length - 1];
      expect(preview.verdict?.outcome).toBe(flight.verdict?.outcome);
      expect(lastX).toBeCloseTo(flight.state.px, 9);
      expect(lastY).toBeCloseTo(flight.state.py, 9);
    }
  });

  it('matches the rocket equation in vacuum within 0.5%', () => {
    const p = vacuum();
    const state = burnToEmpty(p);
    const ve = (p.thrustForce * THRUST_SCALE * 1.15) / (p.fuelMass / p.burnDuration);
    const expected = ve * Math.log((p.dryMass + p.fuelMass) / p.dryMass);
    expect(Math.abs(Math.hypot(state.vx, state.vy) - expected) / expected).toBeLessThan(0.005);
    expect(Math.abs(vehicleSummary(p).deltaV - expected) / expected).toBeLessThan(1e-9);
  });

  it('staging delivers more velocity from the same propellant', () => {
    const single = burnToEmpty(vacuum());
    const staged = burnToEmpty(vacuum({ stageSeparation: true, stage2FuelShare: 0.3, stage2Thrust: 12 }));
    expect(staged.stageSeparated).toBe(true);
    expect(Math.hypot(staged.vx, staged.vy)).toBeGreaterThan(Math.hypot(single.vx, single.vy) * 1.1);
  });

  it('pitching over builds sideways speed; flying straight up does not', () => {
    const at = (launchAngle: number) => {
      let s = initialFlightState(params({ launchAngle }));
      for (let i = 0; i < 10 / FLIGHT_DT; i++) s = stepFlight(params({ launchAngle }), s).state;
      return s.vx;
    };
    expect(Math.abs(at(0))).toBeLessThan(1e-6);
    expect(at(20)).toBeGreaterThan(0.2);
  });

  it('lights stage 2 at the top of the climb', () => {
    const p = params({ stageSeparation: true });
    let s = initialFlightState(p);
    for (let i = 0; i < 120 / FLIGHT_DT; i++) {
      const r = stepFlight(p, s);
      s = r.state;
      const ignition = r.events.find((e) => e.kind === 'stage-ignition');
      if (ignition) {
        const radialSpeed = (s.vx * s.px + s.vy * (s.py + p.planetRadius)) / Math.hypot(s.px, s.py + p.planetRadius);
        expect(Math.abs(radialSpeed)).toBeLessThan(0.05);
        return;
      }
    }
    throw new Error('stage 2 never lit');
  });

  it('tracks Max-Q and logs it', () => {
    const { state } = fly(params({}));
    expect(state.maxQ).toBeGreaterThan(0);
    expect(state.events.some((e) => e.kind === 'max-q')).toBe(true);
  });

  it('draws an orbit that passes through the rocket position, clear of the ground', () => {
    const p = params({ stageSeparation: true });
    const { state, verdict } = fly(p);
    expect(verdict?.outcome).toBe('orbiting');
    const orbit = buildOrbitPath(p, state)!;
    const x = orbit.center[0] + orbit.axisDirection[0] * orbit.semiMajorAxis * Math.cos(orbit.angle)
      + orbit.perpendicularDirection[0] * orbit.semiMinorAxis * Math.sin(orbit.angle);
    const y = orbit.center[1] + orbit.axisDirection[1] * orbit.semiMajorAxis * Math.cos(orbit.angle)
      + orbit.perpendicularDirection[1] * orbit.semiMinorAxis * Math.sin(orbit.angle);
    expect(x).toBeCloseTo(state.px, 6);
    expect(y).toBeCloseTo(state.py, 6);
    expect(orbit.semiMajorAxis * (1 - orbit.eccentricity)).toBeGreaterThan(p.planetRadius);
  });

  it('keeps flying after the verdict without changing the orbit', () => {
    const p = params({ stageSeparation: true });
    const { state } = fly(p);
    let s = state;
    for (let i = 0; i < 600; i++) s = stepFlight(p, s, FLIGHT_DT, { coastOnly: true }).state;
    expect(altitudeOf(p, s)).toBeGreaterThan(18);
  });
});

describe('weather hazards', () => {
  const stormy = (seed: number): FlightEnvironment => ({ lightning: true, seed });

  it('lightning can strike in the clouds and shut the engines down; the seed replays it exactly', () => {
    const p = params({});
    let strikes = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const a = fly(p, stormy(seed));
      const b = fly(p, stormy(seed));
      expect(b.state.px).toBe(a.state.px);
      const hit = a.state.events.find((e) => e.kind === 'lightning');
      if (hit) {
        strikes++;
        expect(a.state.engineOut).toBe(true);
        expect(hit.altitude).toBeLessThan(15);
      }
    }
    expect(strikes).toBeGreaterThan(2);
    expect(strikes).toBeLessThan(20);
  });

  it('extreme cold can make seals leak and cut thrust', () => {
    const p = params({ ambientTemperature: -55 });
    let failures = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const { state } = fly(p, { lightning: false, seed });
      if (state.events.some((e) => e.kind === 'seal-failure')) {
        failures++;
        expect(state.engineFactor).toBeLessThan(1);
      }
    }
    expect(failures).toBeGreaterThan(3);
    const warm = fly(params({}), { lightning: false, seed: 3 });
    expect(warm.state.events.some((e) => e.kind === 'seal-failure')).toBe(false);
  });

  it('applies weather on top of base values without changing them', () => {
    const base = params({ crosswind: 0 });
    const flown = applyWeatherToParams(base, new Set(['wind']));
    expect(base.crosswind).toBe(0);
    expect(flown.crosswind).toBe(38);
  });

  it('fills in settings missing from old saved presets', () => {
    const old = { ...DEFAULT_PARAMS } as Partial<RocketParams>;
    delete old.stage2Thrust;
    delete old.stage2FuelShare;
    expect(normalizeRocketParams(old).stage2Thrust).toBe(DEFAULT_PARAMS.stage2Thrust);
  });
});
