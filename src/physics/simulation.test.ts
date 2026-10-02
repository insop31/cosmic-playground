import { describe, expect, it } from 'vitest';
import { DEFAULT_STAR_MASS, SOFTENING_SQ, gravityConstant } from './constants';
import { substepCount } from './nbody';
import { HISTORY_LENGTH, MAX_SIM_BODIES, SIM_STEP, SimulationCore } from './simulation';
import { SimulationClient } from './simulationClient';
import { SimulationHost } from './simulationProtocol';
import type { CelestialBody } from './types';
import { SPACETIME_TEMPLATES } from '../components/space/spacetimeTemplates';

const body = (id: string, x: number, mass: number, radius: number, type = 'planet', velocity: [number, number, number] = [0, 0, 0]): CelestialBody => ({
  id, type, position: [x, 0, 0], mass, radius, color: '#fff', velocity,
});

const defaultSystem = (): CelestialBody[] => [
  body('sun', 0, DEFAULT_STAR_MASS, 2.4, 'star'),
  body('earth', 8, 5.97e24, 0.45),
  { ...body('mars', -5, 6.42e23, 0.35), position: [-5, 0, 6] },
];

const positions = (core: SimulationCore) => {
  const { sys } = core;
  const out: Record<string, [number, number]> = {};
  for (let i = 0; i < sys.count; i++) out[sys.ids[i]] = [sys.px[i], sys.pz[i]];
  return out;
};

const run = (core: SimulationCore, seconds: number) => {
  const ticks = Math.round(seconds / (SIM_STEP * 8));
  for (let i = 0; i < ticks; i++) core.tick(SIM_STEP * 8);
};

describe('SimulationCore', () => {
  it('advances in fixed steps', () => {
    const core = new SimulationCore();
    core.load(defaultSystem(), { realistic: true, expansionRate: 0 });
    core.tick(SIM_STEP * 5 + SIM_STEP / 2);
    expect(core.currentStep).toBe(5);
    core.tick(SIM_STEP / 2);
    expect(core.currentStep).toBe(6);
  });

  it('rewinds to exactly the earlier state', () => {
    const core = new SimulationCore();
    core.load(defaultSystem(), { realistic: true, expansionRate: 0 });
    run(core, 1);
    const earlier = positions(core);
    const earlierStep = core.currentStep;
    run(core, 1);
    const result = core.seek(earlierStep);
    expect(result.direction).toBe(-1);
    expect(core.currentStep).toBe(earlierStep);
    expect(positions(core)).toEqual(earlier);
  });

  it('can seek forward again after a rewind, then overwrites the future when played', () => {
    const core = new SimulationCore();
    core.load(defaultSystem(), { realistic: true, expansionRate: 0 });
    run(core, 1);
    const live = positions(core);
    const liveStep = core.currentStep;
    core.seek(liveStep - 60);
    core.seek(liveStep);
    expect(positions(core)).toEqual(live);
    core.seek(liveStep - 60);
    core.tick(SIM_STEP);
    expect(core.snapshot().historyEnd).toBe(liveStep - 59);
  });

  it('restores a body absorbed in a collision when rewound past the impact', () => {
    const core = new SimulationCore();
    core.load([
      body('sun', 0, DEFAULT_STAR_MASS, 2.4, 'star'),
      body('rock', 4, 1e20, 0.3, 'asteroid', [-2, 0, 0.01]),
    ], { realistic: true, expansionRate: 0 });
    const startStep = core.currentStep;
    let removed: string[] = [];
    let updatedSun = false;
    for (let i = 0; i < 200 && removed.length === 0; i++) {
      const result = core.tick(SIM_STEP);
      removed = result.removed;
      updatedSun = updatedSun || result.updated.some((u) => u.id === 'sun');
    }
    expect(removed).toEqual(['rock']);
    expect(updatedSun).toBe(true);
    expect(core.snapshot().markers).toHaveLength(1);
    const result = core.seek(startStep);
    expect(result.restored.map((b) => b.id)).toEqual(['rock']);
    expect(result.restored[0].mass).toBe(1e20);
    expect(result.updated.find((u) => u.id === 'sun')?.mass).toBe(DEFAULT_STAR_MASS);
    expect(core.sys.count).toBe(2);
  });

  it('removes bodies added after the moment it rewinds to', () => {
    const core = new SimulationCore();
    core.load(defaultSystem(), { realistic: true, expansionRate: 0 });
    run(core, 0.5);
    const before = core.currentStep;
    core.add(body('late', 30, 1e16, 0.2, 'asteroid'));
    run(core, 0.5);
    // The body joined at step `before`, so the snapshot for that step already holds it.
    const result = core.seek(before - 1);
    expect(result.removed).toEqual(['late']);
    expect(core.add(body('late', 30, 1e16, 0.2, 'asteroid'))).toBe(false); // id already used this run
  });

  it('keeps the default system on the grid for 60 s in arcade mode', () => {
    const core = new SimulationCore();
    core.load(defaultSystem(), { realistic: false, expansionRate: 0 });
    let removed = 0;
    for (let t = 0; t < 60; t += SIM_STEP * 8) removed += core.tick(SIM_STEP * 8).removed.length;
    expect(removed).toBe(0);
    for (const [x, z] of Object.values(positions(core))) expect(Math.hypot(x, z)).toBeLessThan(110);
  });

  it('switching to arcade keeps orbits the same shape', () => {
    const core = new SimulationCore();
    core.load(defaultSystem(), { realistic: true, expansionRate: 0 });
    run(core, 2);
    core.setRealistic(false);
    const radii: number[] = [];
    for (let i = 0; i < 40; i++) {
      run(core, 0.5);
      const [x, z] = positions(core).earth;
      radii.push(Math.hypot(x, z));
    }
    expect(Math.max(...radii) - Math.min(...radii)).toBeLessThan(0.3);
  });

  it('caps history and the number of bodies', () => {
    const core = new SimulationCore();
    core.load(defaultSystem(), { realistic: true, expansionRate: 0 });
    for (let i = 0; i < HISTORY_LENGTH + 50; i++) core.tick(SIM_STEP);
    const snap = core.snapshot();
    expect(snap.historyEnd - snap.historyStart).toBeLessThanOrEqual(HISTORY_LENGTH);
    for (let i = 0; i < MAX_SIM_BODIES + 5; i++) core.add(body(`b${i}`, 40 + i, 1e16, 0.1, 'asteroid'));
    expect(core.sys.count).toBe(MAX_SIM_BODIES);
  });

  it('matches a reference velocity-Verlet integrator on every template', () => {
    const G = gravityConstant(true);
    for (const template of SPACETIME_TEMPLATES) {
      const core = new SimulationCore();
      core.load(template.createBodies().map((b, i) => ({ ...b, id: `t${i}` })), { realistic: true, expansionRate: 0 });
      const { sys } = core;
      const n = sys.count;
      // Reference state copied after the core assigned spawn velocities.
      const x = Array.from(sys.px.slice(0, n));
      const z = Array.from(sys.pz.slice(0, n));
      const vx = Array.from(sys.vx.slice(0, n));
      const vz = Array.from(sys.vz.slice(0, n));
      const m = Array.from(sys.mass.slice(0, n));
      const pinned = Array.from(sys.pinned.slice(0, n));
      const acc = () => {
        const ax = new Array(n).fill(0);
        const az = new Array(n).fill(0);
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
          if (i === j) continue;
          const dx = x[j] - x[i];
          const dz = z[j] - z[i];
          const r2 = dx * dx + dz * dz;
          const r = Math.sqrt(r2);
          const f = (G * m[j]) / (r2 + SOFTENING_SQ);
          ax[i] += (f * dx) / r;
          az[i] += (f * dz) / r;
        }
        return [ax.map((a, i) => (pinned[i] ? 0 : a)), az.map((a, i) => (pinned[i] ? 0 : a))];
      };
      for (let step = 0; step < 600; step++) {
        const subs = substepCount(sys);
        core.tick(SIM_STEP);
        expect(sys.count).toBe(n); // templates are stable: no collisions in the first 5 s
        const h = SIM_STEP / subs;
        for (let s = 0; s < subs; s++) {
          const [ax0, az0] = acc();
          for (let i = 0; i < n; i++) {
            if (pinned[i]) continue;
            x[i] += vx[i] * h + 0.5 * ax0[i] * h * h;
            z[i] += vz[i] * h + 0.5 * az0[i] * h * h;
          }
          const [ax1, az1] = acc();
          for (let i = 0; i < n; i++) {
            if (pinned[i]) continue;
            vx[i] += 0.5 * (ax0[i] + ax1[i]) * h;
            vz[i] += 0.5 * (az0[i] + az1[i]) * h;
          }
        }
      }
      for (let i = 0; i < n; i++) {
        expect(Math.abs(sys.px[i] - x[i])).toBeLessThan(1e-6);
        expect(Math.abs(sys.pz[i] - z[i])).toBeLessThan(1e-6);
      }
    }
  });
});

describe('simulation messaging', () => {
  it('ignores commands from an older run', () => {
    const host = new SimulationHost();
    host.handle({ type: 'load', epoch: 2, bodies: defaultSystem(), config: { realistic: true, expansionRate: 0 } });
    expect(host.handle({ type: 'tick', epoch: 1, dt: 1 })).toBeNull();
    const reply = host.handle({ type: 'tick', epoch: 2, dt: SIM_STEP * 3 });
    expect(reply?.type === 'state' && reply.snapshot.step).toBe(3);
  });

  it('runs on the main thread when workers are unavailable', () => {
    const messages: number[] = [];
    const client = new SimulationClient((message) => {
      if (message.type === 'state') messages.push(message.snapshot.step);
    });
    expect(client.usesWorker).toBe(false); // jsdom has no Worker
    client.send({ type: 'load', epoch: 0, bodies: defaultSystem(), config: { realistic: true, expansionRate: 0 } });
    client.tick(0, SIM_STEP * 4);
    expect(messages).toEqual([0, 4]);
    client.dispose();
  });
});
