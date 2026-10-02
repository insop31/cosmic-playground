import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, type RocketParams } from '../components/rocket/rocketTypes';
import { applyWeatherToParams } from '../components/rocket/weatherPresets';
import {
  FLIGHT_DT,
  STAGE_ONE_DRY_FRACTION,
  buildOrbitPath,
  initialFlightState,
  predictFlight,
  stepFlight,
  type FlightState,
} from './rocket';

const params = (overrides: Partial<RocketParams>): RocketParams => ({ ...DEFAULT_PARAMS, ...overrides });

const fly = (p: RocketParams, maxSeconds = 120) => {
  let state: FlightState = initialFlightState();
  for (let i = 0; i < maxSeconds / FLIGHT_DT; i++) {
    const result = stepFlight(p, state);
    state = result.state;
    if (result.verdict) return { state, verdict: result.verdict };
  }
  return { state, verdict: null };
};

describe('Rocket flight model', () => {
  it.each([
    ['orbiting', { launchAngle: 18, thrustForce: 20, fuelMass: 110, burnDuration: 12 }],
    ['escape', {}],
    ['suborbital', { launchAngle: 10, thrustForce: 15, fuelMass: 60, burnDuration: 12 }],
    ['burnup', { launchAngle: 45, thrustForce: 100, burnDuration: 3, atmosphericDensity: 1, thermalLoad: 1 }],
    ['crashed', { thrustForce: 10, fuelMass: 200 }],
  ] as const)('can end in %s', (outcome, overrides) => {
    const { verdict } = fly(params(overrides));
    expect(verdict?.outcome).toBe(outcome);
    expect(verdict?.reason.length).toBeGreaterThan(20);
  });

  it('holds an underpowered rocket on the pad and explains why', () => {
    // Even with empty tanks the weight exceeds the thrust, so it can never lift off.
    const { state, verdict } = fly(params({ thrustForce: 10, dryMass: 80, gravity: 25 }));
    expect(state.liftedOff).toBe(false);
    expect(verdict?.reason).toMatch(/never left the pad/);
  });

  it('preview ends exactly where the flight does', () => {
    for (const overrides of [{}, { launchAngle: 10, thrustForce: 15, fuelMass: 60 }, { launchAngle: 18, thrustForce: 20, fuelMass: 110 }]) {
      const p = params(overrides);
      const flight = fly(p, 60);
      const preview = predictFlight(p, 60);
      const [lastX, lastY] = preview.points[preview.points.length - 1];
      expect(preview.verdict?.outcome).toBe(flight.verdict?.outcome);
      expect(lastX).toBeCloseTo(flight.state.px, 9);
      expect(lastY).toBeCloseTo(Math.max(flight.state.py, 0), 9);
    }
  });

  it('matches the rocket equation in vacuum within 0.5%', () => {
    // Vertical launch, no air: Δv = F·T/m_fuel · ln(m0/mf), minus gravity loss g·T.
    const p = params({ launchAngle: 0, padTilt: 0, atmosphericDensity: 0, crosswind: 0, ambientTemperature: 15, atmosphericPressure: 1 });
    let state = initialFlightState();
    while (state.fuel > 0) state = stepFlight(p, state).state;
    const thrustFactor = 1.04 * (1 - 0 * 0.0024); // pressure 1 atm, 15 °C
    const m0 = p.dryMass + p.fuelMass;
    const mf = p.dryMass;
    const expected = ((p.thrustForce * thrustFactor * p.burnDuration) / p.fuelMass) * Math.log(m0 / mf)
      - p.gravity * 0.01 * p.burnDuration;
    expect(Math.abs(state.vy - expected) / expected).toBeLessThan(0.005);
  });

  it('stage separation drops stage-1 mass and adds speed', () => {
    const p = params({ atmosphericDensity: 0, crosswind: 0 });
    let single = initialFlightState();
    let staged = initialFlightState();
    const pStaged = { ...p, stageSeparation: true };
    let separated = false;
    while (single.fuel > 0) single = stepFlight(p, single).state;
    while (staged.fuel > 0) {
      const result = stepFlight(pStaged, staged);
      staged = result.state;
      if (result.events.includes('stage-separation')) separated = true;
    }
    expect(separated).toBe(true);
    expect(staged.stageSeparated).toBe(true);
    expect(STAGE_ONE_DRY_FRACTION).toBeGreaterThan(0);
    expect(Math.hypot(staged.vx, staged.vy)).toBeGreaterThan(Math.hypot(single.vx, single.vy) * 1.05);
  });

  it('draws an orbit that passes through the rocket position', () => {
    const p = params({ launchAngle: 18, thrustForce: 20, fuelMass: 110, burnDuration: 12 });
    const { state, verdict } = fly(p);
    expect(verdict?.outcome).toBe('orbiting');
    const orbit = buildOrbitPath(p, state)!;
    const x = orbit.center[0] + orbit.axisDirection[0] * orbit.semiMajorAxis * Math.cos(orbit.angle)
      + orbit.perpendicularDirection[0] * orbit.semiMinorAxis * Math.sin(orbit.angle);
    const y = orbit.center[1] + orbit.axisDirection[1] * orbit.semiMajorAxis * Math.cos(orbit.angle)
      + orbit.perpendicularDirection[1] * orbit.semiMinorAxis * Math.sin(orbit.angle);
    expect(x).toBeCloseTo(state.px, 6);
    expect(y).toBeCloseTo(state.py, 6);
    // Lowest point stays above the surface.
    const periapsis = orbit.semiMajorAxis * (1 - orbit.eccentricity);
    expect(periapsis).toBeGreaterThan(p.planetRadius);
  });

  it('applies weather on top of base values without changing them', () => {
    const base = params({ crosswind: 0 });
    const flown = applyWeatherToParams(base, new Set(['wind']));
    expect(base.crosswind).toBe(0);
    expect(flown.crosswind).toBe(38);
    // Applying weather to the already-flown values would double it; the UI keeps base values apart.
    expect(applyWeatherToParams(flown, new Set(['wind'])).crosswind).toBe(60);
  });
});
