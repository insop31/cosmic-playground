// SimulationCore: the whole Spacetime Lab simulation behind one message-friendly API.
// It runs inside a Web Worker (src/workers/sim.worker.ts) or, as a fallback, on the main
// thread. It owns the bodies, the fixed-step clock, the rewind history and event markers.
import { gravityConstant, maxSpeedFor, velocityScaleFor } from './constants';
import { diagnostics, spawnOrbitalVelocity, stepSystem, type Diagnostics, type ImpactEvent } from './nbody';
import { addSeed, flyPrediction, type Prediction } from './predict';
import { planForwardSteps, stepCap } from './schedule';
import { MOTION_BOUND, NBodySystem } from './system';
import type { CelestialBody } from './types';

export const SIM_STEP = 1 / 120;          // Fixed physics step (s of simulated time)
export const HISTORY_LENGTH = 3600;       // One snapshot per step → 30 s to rewind
export const MAX_SIM_BODIES = 180;
const DIAGNOSTICS_EVERY = 12;             // Steps between conservation readouts (10 Hz)

/** Per-body values in a snapshot's `data` array. */
export const STATE_STRIDE = 9;
export const S_X = 0;
export const S_Z = 1;
export const S_VX = 2;   // realistic-mode units
export const S_VZ = 3;   // realistic-mode units
export const S_RADIUS = 4;
export const S_MOTION = 5;
export const S_DOMINANT = 6;
export const S_CLOSE = 7;
export const S_PINNED = 8;

const SLOT_STRIDE = 8; // x, z, vx, vz, mass, radius, pinned, physical radius

interface HistorySlot {
  step: number;
  count: number;
  ids: string[];
  data: Float64Array;
}

export interface TimelineMarker {
  step: number;
  kind: ImpactEvent['kind'];
  title: string;
}

export interface BodyUpdate {
  id: string;
  mass: number;
  radius: number;
}

export type { PredictedOutcome, Prediction } from './predict';

export interface TickResult {
  impacts: ImpactEvent[];
  removed: string[];
  restored: CelestialBody[];
  /** Bodies created by the simulation (fragments, tidal debris). */
  spawned: CelestialBody[];
  updated: BodyUpdate[];
  stepsTaken: number;
  /** True when this tick hit its step budget and dropped the rest (warp is being limited). */
  limited: boolean;
  /** 1 forward, −1 rewound or sought backwards, 0 nothing happened. */
  direction: 1 | -1 | 0;
}

export interface SimSnapshot {
  ids: string[];
  data: Float32Array;
  masses: Float64Array;
  step: number;
  simTime: number;
  historyStart: number;
  historyEnd: number;
  markers: TimelineMarker[];
  diagnostics: Diagnostics | null;
  realistic: boolean;
}

export interface SimConfig {
  realistic: boolean;
  expansionRate: number;
}

const emptyResult = (): TickResult => ({ impacts: [], removed: [], restored: [], spawned: [], updated: [], stepsTaken: 0, limited: false, direction: 0 });

export class SimulationCore {
  readonly sys = new NBodySystem();
  private info = new Map<string, CelestialBody>();
  private reported = new Map<string, { mass: number; radius: number }>();
  private realistic = true;
  private expansionRate = 0;
  private accum = 0;
  private rewindAccum = 0;
  private step = 0;
  private slots: (HistorySlot | undefined)[] = new Array(HISTORY_LENGTH);
  private histFirst = 0;
  private histLast = -1;
  private markers: TimelineMarker[] = [];
  private diag: Diagnostics | null = null;

  get currentStep() { return this.step; }
  get isRealistic() { return this.realistic; }

  load(bodies: CelestialBody[], config: SimConfig) {
    this.sys.clear();
    this.info.clear();
    this.reported.clear();
    this.realistic = config.realistic;
    this.expansionRate = config.expansionRate;
    this.accum = 0;
    this.rewindAccum = 0;
    this.step = 0;
    this.slots = new Array(HISTORY_LENGTH);
    this.histFirst = 0;
    this.histLast = -1;
    this.markers = [];
    for (const body of bodies) this.add(body);
    this.refreshDiagnostics();
  }

  /** Add a body. Ids already seen in this run are ignored (they were absorbed or removed). */
  add(body: CelestialBody): boolean {
    if (this.info.has(body.id) || this.sys.count >= MAX_SIM_BODIES) return false;
    const velScale = velocityScaleFor(this.realistic);
    const v = body.velocity ?? [0, 0, 0];
    const hasVelocity = v[0] * v[0] + v[2] * v[2] > 1e-12;
    const [vx, vz] = hasVelocity
      ? [v[0] * velScale, v[2] * velScale]
      : spawnOrbitalVelocity(this.sys, body.position[0], body.position[2], gravityConstant(this.realistic));
    const pinned = body.pinned ?? false;
    this.sys.add({
      id: body.id,
      type: body.type,
      x: body.position[0],
      z: body.position[2],
      vx: pinned ? 0 : vx,
      vz: pinned ? 0 : vz,
      mass: body.mass,
      radius: body.radius,
      physRadius: body.physicalRadius,
      pinned,
    });
    this.info.set(body.id, { ...body, pinned });
    this.reported.set(body.id, { mass: body.mass, radius: body.radius });
    return true;
  }

  remove(id: string): boolean {
    return this.sys.remove(id);
  }

  setPinned(id: string, pinned: boolean) {
    const i = this.sys.indexOf(id);
    if (i < 0) return;
    this.sys.pinned[i] = pinned ? 1 : 0;
    if (pinned) { this.sys.vx[i] = 0; this.sys.vz[i] = 0; }
    this.sys.accValid = false;
    const info = this.info.get(id);
    if (info) this.info.set(id, { ...info, pinned });
  }

  /** Switch gravity mode, rescaling velocities (live and in history) so orbits keep their shape. */
  setRealistic(realistic: boolean) {
    if (realistic === this.realistic) return;
    const ratio = velocityScaleFor(realistic) / velocityScaleFor(this.realistic);
    const { sys } = this;
    for (let i = 0; i < sys.count; i++) { sys.vx[i] *= ratio; sys.vz[i] *= ratio; }
    for (const slot of this.slots) {
      if (!slot) continue;
      for (let k = 0; k < slot.count; k++) {
        slot.data[k * SLOT_STRIDE + 2] *= ratio;
        slot.data[k * SLOT_STRIDE + 3] *= ratio;
      }
    }
    this.realistic = realistic;
    sys.accValid = false;
    this.refreshDiagnostics();
  }

  setExpansionRate(rate: number) {
    this.expansionRate = rate;
  }

  /** Advance (dt > 0) or rewind (dt < 0) by `dt` seconds of simulated time. */
  tick(dt: number): TickResult {
    if (dt > 0) return this.forward(dt);
    if (dt < 0) return this.rewind(-dt);
    return emptyResult();
  }

  private forward(dt: number): TickResult {
    const result = emptyResult();
    // Warp runs more fixed steps per tick, within a work budget that shrinks as the
    // system gets crowded; time beyond the budget is dropped, never carried.
    const plan = planForwardSteps(this.accum + dt, SIM_STEP, stepCap(this.sys.count));
    this.accum = plan.carry;
    result.limited = plan.limited;
    const effectiveG = gravityConstant(this.realistic);
    const maxSpeed = maxSpeedFor(this.realistic);
    for (let n = 0; n < plan.steps; n++) {
      this.record();
      const { impacts, removed, spawned } = stepSystem(this.sys, SIM_STEP, {
        effectiveG,
        maxSpeed,
        expansionRate: this.expansionRate,
        maxBodies: MAX_SIM_BODIES,
        velocityScale: velocityScaleFor(this.realistic),
      });
      const velScale = velocityScaleFor(this.realistic);
      for (const piece of spawned) {
        const parent = this.info.get(piece.parentId);
        const body: CelestialBody = {
          id: piece.id,
          name: `${parent?.name ?? parent?.type ?? 'Body'} fragment`,
          type: piece.type,
          bodyClass: 'asteroid',
          position: [piece.x, 0, piece.z],
          velocity: [piece.vx / velScale, 0, piece.vz / velScale],
          mass: piece.mass,
          radius: piece.radius,
          physicalRadius: piece.physRadius,
          color: parent?.color ?? '#b0a898',
        };
        this.info.set(body.id, body);
        this.reported.set(body.id, { mass: body.mass, radius: body.radius });
        result.spawned.push(body);
      }
      this.step++;
      result.stepsTaken++;
      for (const impact of impacts) {
        this.markers.push({ step: this.step, kind: impact.kind, title: impact.title });
      }
      result.impacts.push(...impacts);
      result.removed.push(...removed);
      if (this.step % DIAGNOSTICS_EVERY === 0 || impacts.length) this.refreshDiagnostics();
    }
    if (result.stepsTaken > 0) result.direction = 1;
    result.updated = this.collectUpdates();
    return result;
  }

  private rewind(dt: number): TickResult {
    this.rewindAccum += dt;
    const steps = Math.floor(this.rewindAccum / SIM_STEP);
    if (steps === 0) return emptyResult();
    this.rewindAccum -= steps * SIM_STEP;
    return this.seek(Math.max(this.histFirst, this.step - steps));
  }

  /** Jump to any recorded step (backwards or, after a rewind, forwards again). */
  seek(target: number): TickResult {
    if (this.histLast < this.step) this.record(); // keep the live state so it can be returned to
    const t = Math.round(target);
    if (t === this.step || t < this.histFirst || t > this.histLast) return emptyResult();
    const slot = this.slots[t % HISTORY_LENGTH];
    if (!slot || slot.step !== t) return emptyResult();
    const result = this.restore(slot);
    result.direction = t < this.step ? -1 : 1;
    this.step = t;
    this.accum = 0;
    this.refreshDiagnostics();
    result.updated = this.collectUpdates();
    return result;
  }

  /** Store the current state as the snapshot for the current step. */
  private record() {
    const s = this.step;
    if (this.histLast >= s) {
      // Stepping forward from an earlier point: everything after it is no longer the future.
      this.histLast = s - 1;
      this.markers = this.markers.filter((m) => m.step <= s);
    }
    if (this.histLast < this.histFirst) this.histFirst = s;
    if (s - this.histFirst + 1 > HISTORY_LENGTH) {
      this.histFirst = s - HISTORY_LENGTH + 1;
      this.markers = this.markers.filter((m) => m.step >= this.histFirst);
    }
    const { sys } = this;
    const idx = s % HISTORY_LENGTH;
    let slot = this.slots[idx];
    const needed = sys.count * SLOT_STRIDE;
    if (!slot || slot.data.length < needed) {
      slot = { step: s, count: 0, ids: [], data: new Float64Array(Math.max(needed, 16 * SLOT_STRIDE)) };
      this.slots[idx] = slot;
    }
    slot.step = s;
    slot.count = sys.count;
    slot.ids = sys.ids.slice(0, sys.count);
    for (let i = 0; i < sys.count; i++) {
      const o = i * SLOT_STRIDE;
      slot.data[o] = sys.px[i];
      slot.data[o + 1] = sys.pz[i];
      slot.data[o + 2] = sys.vx[i];
      slot.data[o + 3] = sys.vz[i];
      slot.data[o + 4] = sys.mass[i];
      slot.data[o + 5] = sys.radius[i];
      slot.data[o + 6] = sys.pinned[i];
      slot.data[o + 7] = sys.physRadius[i];
    }
    this.histLast = s;
  }

  /** Make the system exactly match a snapshot, restoring or removing bodies as needed. */
  private restore(slot: HistorySlot): TickResult {
    const result = emptyResult();
    const { sys } = this;
    const inSnapshot = new Set(slot.ids);
    for (let i = sys.count - 1; i >= 0; i--) {
      if (!inSnapshot.has(sys.ids[i])) {
        result.removed.push(sys.ids[i]);
        sys.removeAt(i);
      }
    }
    const velScale = velocityScaleFor(this.realistic);
    for (let k = 0; k < slot.count; k++) {
      const id = slot.ids[k];
      const o = k * SLOT_STRIDE;
      let i = sys.indexOf(id);
      if (i < 0) {
        const original = this.info.get(id);
        if (!original) continue;
        i = sys.add({ id, type: original.type, x: 0, z: 0, vx: 0, vz: 0, mass: 0, radius: 0, physRadius: original.physicalRadius });
        result.restored.push({
          ...original,
          position: [slot.data[o], 0, slot.data[o + 1]],
          velocity: [slot.data[o + 2] / velScale, 0, slot.data[o + 3] / velScale],
          mass: slot.data[o + 4],
          radius: slot.data[o + 5],
          pinned: slot.data[o + 6] === 1,
        });
      }
      sys.px[i] = slot.data[o];
      sys.pz[i] = slot.data[o + 1];
      sys.vx[i] = slot.data[o + 2];
      sys.vz[i] = slot.data[o + 3];
      sys.mass[i] = slot.data[o + 4];
      sys.radius[i] = slot.data[o + 5];
      sys.pinned[i] = slot.data[o + 6];
      sys.physRadius[i] = slot.data[o + 7];
      sys.motion[i] = MOTION_BOUND;
    }
    sys.accValid = false;
    for (const body of result.restored) {
      this.reported.set(body.id, { mass: body.mass, radius: body.radius });
    }
    return result;
  }

  /** Mass/radius values that changed since they were last reported. */
  private collectUpdates(): BodyUpdate[] {
    const updates: BodyUpdate[] = [];
    const { sys } = this;
    for (let i = 0; i < sys.count; i++) {
      const last = this.reported.get(sys.ids[i]);
      if (!last || last.mass !== sys.mass[i] || last.radius !== sys.radius[i]) {
        updates.push({ id: sys.ids[i], mass: sys.mass[i], radius: sys.radius[i] });
        this.reported.set(sys.ids[i], { mass: sys.mass[i], radius: sys.radius[i] });
      }
    }
    return updates;
  }

  private refreshDiagnostics() {
    this.diag = diagnostics(this.sys, gravityConstant(this.realistic));
  }

  /**
   * Fly a copy of the system with `candidate` added and report its path and fate. The
   * live simulation is not touched.
   */
  predict(candidate: CelestialBody, seconds = 20, sampleEvery = 4): Prediction {
    const sim = this.sys.clone();
    const v = candidate.velocity ?? [0, 0, 0];
    addSeed(sim, {
      id: candidate.id,
      type: candidate.type,
      x: candidate.position[0],
      z: candidate.position[2],
      vx: v[0],
      vz: v[2],
      mass: candidate.mass,
      radius: candidate.radius,
      physRadius: candidate.physicalRadius,
      pinned: candidate.pinned,
    }, this.realistic);
    return flyPrediction(sim, candidate.id, this.realistic, seconds, sampleEvery);
  }

  snapshot(): SimSnapshot {
    const { sys } = this;
    const velScale = velocityScaleFor(this.realistic);
    const data = new Float32Array(sys.count * STATE_STRIDE);
    const masses = new Float64Array(sys.count);
    for (let i = 0; i < sys.count; i++) {
      const o = i * STATE_STRIDE;
      data[o + S_X] = sys.px[i];
      data[o + S_Z] = sys.pz[i];
      data[o + S_VX] = sys.vx[i] / velScale;
      data[o + S_VZ] = sys.vz[i] / velScale;
      data[o + S_RADIUS] = sys.radius[i];
      data[o + S_MOTION] = sys.motion[i];
      data[o + S_DOMINANT] = sys.dominant[i];
      data[o + S_CLOSE] = sys.closeApproach[i];
      data[o + S_PINNED] = sys.pinned[i];
      masses[i] = sys.mass[i];
    }
    return {
      ids: sys.ids.slice(0, sys.count),
      data,
      masses,
      step: this.step,
      simTime: this.step * SIM_STEP,
      historyStart: this.histLast >= this.histFirst ? this.histFirst : this.step,
      historyEnd: Math.max(this.histLast, this.step),
      markers: this.markers.slice(),
      diagnostics: this.diag,
      realistic: this.realistic,
    };
  }
}
