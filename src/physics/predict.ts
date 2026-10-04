// Orbit prediction: fly a copy of the system with one more body and report where it goes.
// It runs the same step function, at the same fixed step, as the live simulation, so a
// preview and the real run agree step for step. Used by the simulation core and by the
// placement preview's own worker (so previews never hold up the running simulation).
import { gravityConstant, maxSpeedFor, velocityScaleFor } from './constants';
import { spawnOrbitalVelocity, stepSystem } from './nbody';
import { MOTION_ESCAPING, NBodySystem } from './system';

/** The physics step; prediction uses it unchanged. */
export const PREDICTION_STEP = 1 / 120;
export const MAX_PREDICTION_BODIES = 180;
/** A probe this far from the origin has left the scene for good. */
const ESCAPE_DISTANCE = 140;

export type PredictedOutcome = 'bound' | 'escape' | 'collision';

export interface Prediction {
  /** Path of the probe as x, z pairs. */
  points: Float32Array;
  outcome: PredictedOutcome;
  /** Id of the body it hits, for collisions. */
  hitId?: string;
  /** Seconds of simulated time until the outcome (or the full horizon). */
  time: number;
}

/** A body as plain data. Velocities are in realistic-mode units, like CelestialBody. */
export interface PredictSeed {
  id: string;
  type: string;
  x: number;
  z: number;
  vx: number;
  vz: number;
  mass: number;
  radius: number;
  physRadius?: number;
  pinned?: boolean;
}

export interface PredictionRequest {
  bodies: PredictSeed[];
  /** The body to follow. A zero velocity means "circular orbit around the heaviest body". */
  probe: PredictSeed;
  realistic: boolean;
  /** Seconds of simulated time to look ahead. */
  horizon: number;
  /** Keep every Nth step as a path point. */
  sampleEvery: number;
}

/** Add a seed to `sim`, converting its velocity to the active gravity mode. */
export const addSeed = (sim: NBodySystem, seed: PredictSeed, realistic: boolean) => {
  const velScale = velocityScaleFor(realistic);
  const hasVelocity = seed.vx * seed.vx + seed.vz * seed.vz > 1e-12;
  const [vx, vz] = hasVelocity
    ? [seed.vx * velScale, seed.vz * velScale]
    : spawnOrbitalVelocity(sim, seed.x, seed.z, gravityConstant(realistic));
  return sim.add({
    id: seed.id,
    type: seed.type,
    x: seed.x,
    z: seed.z,
    vx: seed.pinned ? 0 : vx,
    vz: seed.pinned ? 0 : vz,
    mass: seed.mass,
    radius: seed.radius,
    physRadius: seed.physRadius,
    pinned: seed.pinned,
  });
};

/**
 * Step `sim` (which already contains the probe) and follow the probe. Collision when it
 * is absorbed or hits something; escape when it leaves the scene or ends unbound.
 */
export const flyPrediction = (sim: NBodySystem, probeId: string, realistic: boolean, seconds: number, sampleEvery: number): Prediction => {
  const start = sim.indexOf(probeId);
  const points: number[] = start >= 0 ? [sim.px[start], sim.pz[start]] : [];
  const steps = Math.round(seconds / PREDICTION_STEP);
  const options = {
    effectiveG: gravityConstant(realistic),
    maxSpeed: maxSpeedFor(realistic),
    maxBodies: MAX_PREDICTION_BODIES,
    velocityScale: velocityScaleFor(realistic),
  };
  for (let s = 1; s <= steps; s++) {
    const { impacts } = stepSystem(sim, PREDICTION_STEP, options);
    const hit = impacts.find((impact) => impact.bodies.includes(probeId));
    const i = sim.indexOf(probeId);
    if (hit || i < 0) {
      if (i >= 0) points.push(sim.px[i], sim.pz[i]);
      else if (hit) points.push(hit.position[0], hit.position[2]);
      const hitId = hit ? hit.bodies.find((b) => b !== probeId) : undefined;
      return { points: Float32Array.from(points), outcome: 'collision', hitId, time: s * PREDICTION_STEP };
    }
    if (s % sampleEvery === 0) points.push(sim.px[i], sim.pz[i]);
    if (Math.hypot(sim.px[i], sim.pz[i]) > ESCAPE_DISTANCE) {
      points.push(sim.px[i], sim.pz[i]);
      return { points: Float32Array.from(points), outcome: 'escape', time: s * PREDICTION_STEP };
    }
  }
  const i = sim.indexOf(probeId);
  if (i >= 0 && steps % sampleEvery !== 0) points.push(sim.px[i], sim.pz[i]);
  const outcome: PredictedOutcome = i >= 0 && sim.motion[i] === MOTION_ESCAPING ? 'escape' : 'bound';
  return { points: Float32Array.from(points), outcome, time: seconds };
};

/** Predict from plain data (the placement preview's worker). */
export const predictPath = (request: PredictionRequest): Prediction => {
  const sim = new NBodySystem();
  for (const seed of request.bodies) {
    if (sim.count >= MAX_PREDICTION_BODIES - 1) break;
    if (!sim.has(seed.id)) addSeed(sim, seed, request.realistic);
  }
  addSeed(sim, request.probe, request.realistic);
  return flyPrediction(sim, request.probe.id, request.realistic, request.horizon, Math.max(1, request.sampleEvery));
};
