import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, INITIAL_STATE, type RocketParams, type RocketState } from '@/worlds/rocket/rocketTypes';
import { DEFAULT_STAR_MASS } from '../physics/constants';
import { FLIGHT_DT, initialFlightState, stepFlight } from '../physics/rocket';
import { SIM_STEP, SimulationCore } from '../physics/simulation';
import type { CelestialBody } from '../physics/types';
import { buildDebrief, peakAltitude } from './debrief';
import { formatAltitude } from '../physics/altitude';
import { liveCoachMessage } from './coach';
import { SpacetimeMissionTracker } from './spacetimeMissions';
import { addNotebookEntry, clearNotebook, differingParams, listNotebook } from '../lib/notebook';
import { buildExportFile, parseImportFile } from '../lib/exportImport';

/** Fly a launch to its verdict and return the final RocketState the UI would hold. */
const flyToState = (params: RocketParams): RocketState => {
  let s = initialFlightState(params);
  for (let i = 0; i < 200 / FLIGHT_DT; i++) {
    const r = stepFlight(params, s);
    s = r.state;
    if (r.verdict) {
      return {
        ...INITIAL_STATE,
        phase: 'outcome',
        outcome: r.verdict.outcome,
        outcomeReason: r.verdict.reason,
        position: [s.px, s.py, 0],
        velocity: [s.vx, s.vy],
        maxAltitude: s.maxAltitude,
        heat: s.heat,
        maxDynamicPressure: s.maxQ,
        events: s.events,
      };
    }
  }
  throw new Error('no verdict');
};

describe('flight debrief', () => {
  it.each([
    ['crashed', { thrustForce: 15 }, /fuel|thrust/i],
    ['crashed', { thrustForce: 10, dryMass: 80, gravity: 25 }, /Raise thrust to about \d+ kN/],
    ['suborbital', {}, /stage separation/i],
    ['burnup', { thrustForce: 100, burnDuration: 3, atmosphericDensity: 1, thermalLoad: 1, launchAngle: 45 }, /Pitch over less|thrust|thermal/i],
    ['escape', { thrustForce: 60, fuelMass: 140 }, /less fuel|smaller stage 2/i],
    ['orbiting', { stageSeparation: true }, /escape/i],
  ] as const)('explains a %s and suggests a specific change', (outcome, overrides, suggestion) => {
    const params = { ...DEFAULT_PARAMS, ...overrides };
    const state = flyToState(params);
    expect(state.outcome).toBe(outcome);
    const debrief = buildDebrief(params, state);
    expect(debrief.causes.length).toBeGreaterThan(0);
    expect(debrief.suggestions.join(' ')).toMatch(suggestion);
    expect(debrief.numbers.find((n) => n.label === 'Δv budget')).toBeDefined();
  });

  it('reports the top of the arc when the verdict comes before it', () => {
    const state = flyToState(DEFAULT_PARAMS);
    expect(state.outcome).toBe('suborbital');
    const peak = peakAltitude(DEFAULT_PARAMS, state);
    expect(peak).toBeGreaterThan(state.maxAltitude);
    // The same number the verdict announced ("Will reach … and then fall back").
    expect(state.outcomeReason).toContain(formatAltitude(peak));
  });
});

describe('launch coach', () => {
  it('reads telemetry during flight and stays quiet before launch', () => {
    expect(liveCoachMessage(DEFAULT_PARAMS, INITIAL_STATE)).toBeNull();
    const hot = { ...INITIAL_STATE, phase: 'launching' as const, heat: 0.8 };
    expect(liveCoachMessage(DEFAULT_PARAMS, hot)?.tone).toBe('danger');
    const climbing = { ...INITIAL_STATE, phase: 'coasting' as const, altitude: 20, position: [0, 20, 0] as [number, number, number], velocity: [0.5, 0.5] as [number, number] };
    expect(liveCoachMessage(DEFAULT_PARAMS, climbing)?.text).toMatch(/Sideways speed/);
  });
});

describe('spacetime missions', () => {
  const body = (id: string, type: string, x: number, mass: number, radius: number, velocity: [number, number, number] = [0, 0, 0]): CelestialBody => ({
    id, type, position: [x, 0, 0], mass, radius, color: '#fff', velocity,
  });

  const run = (core: SimulationCore, tracker: SpacetimeMissionTracker, seconds: number) => {
    const typeOf = (id: string) => core.sys.types[core.sys.indexOf(id)];
    const unlocked = new Set<string>();
    // One tick runs at most a few steps, so advance by simulated time, not by calls.
    const end = core.snapshot().simTime + seconds;
    while (core.snapshot().simTime < end - 1e-9) {
      const result = core.tick(SIM_STEP * 8);
      tracker.noteImpacts(result.impacts).forEach((m) => unlocked.add(m));
      tracker.update(core.snapshot(), typeOf).forEach((m) => unlocked.add(m));
    }
    return unlocked;
  };

  it('Gravity Master needs a star with two planets bound for three outer laps', () => {
    const core = new SimulationCore();
    core.load([body('sun', 'star', 0, DEFAULT_STAR_MASS, 2.4), body('a', 'planet', 8, 6e24, 0.45), body('b', 'planet', 12, 6e23, 0.35)], { realistic: true, expansionRate: 0 });
    const tracker = new SpacetimeMissionTracker();
    const outerPeriod = 2 * Math.PI * Math.sqrt(12 ** 3 / (6.674e-11 * 7.5e-20 * DEFAULT_STAR_MASS));
    expect(run(core, tracker, outerPeriod * 2.5).has('gravity-master')).toBe(false);
    expect(run(core, tracker, outerPeriod).has('gravity-master')).toBe(true);
  });

  it('System Architect needs five bound bodies for 30 s', () => {
    const core = new SimulationCore();
    core.load([
      body('sun', 'star', 0, DEFAULT_STAR_MASS, 2.4),
      ...[8, 12, 16, 20].map((r, k) => body(`p${k}`, 'planet', r, 1e24, 0.3)),
    ], { realistic: true, expansionRate: 0 });
    const tracker = new SpacetimeMissionTracker();
    expect(run(core, tracker, 25).has('system-architect')).toBe(false);
    expect(run(core, tracker, 6).has('system-architect')).toBe(true);
  });

  it('Slingshot Expert needs a flyby of a moving star that speeds a small body up', () => {
    const fly = (cometX: number) => {
      const core = new SimulationCore();
      // A comet meets a companion star head-on and is swung round with its orbital motion.
      core.load([
        body('sun', 'star', 0, DEFAULT_STAR_MASS, 2.4),
        body('companion', 'star', 30, DEFAULT_STAR_MASS * 0.4, 1.4),
        { ...body('comet', 'comet', cometX, 2e14, 0.22, [0, 0, -0.6]), position: [cometX, 0, 5] },
      ], { realistic: true, expansionRate: 0 });
      return run(core, new SpacetimeMissionTracker(), 20);
    };
    expect(fly(26).has('slingshot-expert')).toBe(true);
    // Passing far from the companion changes nothing.
    expect(fly(15).has('slingshot-expert')).toBe(false);
  });

  it('Collision Course needs an aimed body predicted to hit that then hits', () => {
    const core = new SimulationCore();
    core.load([body('sun', 'star', 0, DEFAULT_STAR_MASS, 2.4)], { realistic: true, expansionRate: 0 });
    const tracker = new SpacetimeMissionTracker();
    const rock = body('rock', 'asteroid', 12, 1e16, 0.28, [-1.5, 0, 0]);
    const prediction = core.predict(rock);
    expect(prediction.outcome).toBe('collision');
    core.add(rock);
    tracker.notePlacement('rock', true, core.snapshot().simTime, prediction.outcome);
    expect(run(core, tracker, 15).has('collision-course')).toBe(true);
  });

  it("Kepler's Check needs two bound bodies inspected around the same parent", () => {
    const core = new SimulationCore();
    core.load([body('sun', 'star', 0, DEFAULT_STAR_MASS, 2.4), body('a', 'planet', 8, 6e24, 0.45), body('b', 'planet', 14, 6e23, 0.35)], { realistic: true, expansionRate: 0 });
    core.tick(SIM_STEP * 8);
    const tracker = new SpacetimeMissionTracker();
    expect(tracker.noteInspection('a', core.snapshot())).toEqual([]);
    expect(tracker.noteInspection('b', core.snapshot())).toEqual(['kepler-check']);
  });
});

describe('lab notebook and file sharing', () => {
  beforeEach(() => window.localStorage.clear());

  it('records runs newest first and lists the settings that differ', () => {
    const base = { outcome: 'crashed' as const, prediction: null, weather: [], cause: 'x', metrics: { deltaV: 1, peakAltitude: 2, maxQ: 0.1, heat: 0.2, flightTime: 3 } };
    addNotebookEntry({ ...base, params: DEFAULT_PARAMS });
    addNotebookEntry({ ...base, outcome: 'orbiting', params: { ...DEFAULT_PARAMS, stageSeparation: true, thrustForce: 40 } });
    const entries = listNotebook();
    expect(entries[0].outcome).toBe('orbiting');
    expect(differingParams(entries[0].params, entries[1].params).sort()).toEqual(['stageSeparation', 'thrustForce']);
    expect(clearNotebook()).toEqual([]);
  });

  it('exports and re-imports scenarios and presets, rejecting bad files', () => {
    const scenario = {
      id: 's', name: 'Inner system', createdAt: '', updatedAt: '', placementVelocityScale: 1, realisticMode: true,
      bodies: [{ id: 'sun', type: 'star', position: [0, 0, 0] as [number, number, number], mass: DEFAULT_STAR_MASS, radius: 2.4, color: '#ffcc00' }],
    };
    const preset = { id: 'p', name: 'Orbit', createdAt: '', updatedAt: '', params: { ...DEFAULT_PARAMS, stageSeparation: true } };
    const file = buildExportFile([scenario], [preset]);
    const imported = parseImportFile(file);
    expect(imported.spacetimeScenarios[0].name).toBe('Inner system');
    expect(imported.rocketPresets[0].params.stageSeparation).toBe(true);
    expect(() => parseImportFile('not json')).toThrow(/not valid JSON/);
    expect(() => parseImportFile(JSON.stringify({ format: 'other', version: 1 }))).toThrow(/not a Cosmic Playground/);
    const broken = JSON.parse(file);
    broken.spacetimeScenarios[0].bodies[0].mass = -1;
    expect(() => parseImportFile(JSON.stringify(broken))).toThrow(/mass/);
  });
});
