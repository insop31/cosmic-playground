import * as THREE from 'three';
import { FIXED_SUBSTEP, adaptiveDt, detectEvents, integrate, type PhysicsBody } from './nbody';

/** Plain-data body for crossing the worker boundary. */
export interface BodySeed {
  id: string;
  x: number;
  z: number;
  vx: number;
  vz: number;
  mass: number;
  radius: number;
  type: string;
}

export interface PredictionRequest {
  bodies: BodySeed[];
  probe: BodySeed;
  effectiveG: number;
  /** Simulated seconds to look ahead. */
  horizon: number;
  /** Keep every Nth substep as a path point. */
  sampleEvery: number;
}

export type PredictionOutcome = 'bound' | 'escape' | 'collision';

export interface PredictionResult {
  /** Path as [x0, z0, x1, z1, …] in simulation coordinates. */
  path: Float32Array;
  outcome: PredictionOutcome;
  /** Simulated seconds until the collision, when there is one. */
  collisionAt: number | null;
}

const EMPTY_TRAIL = new Float32Array(0);

const toPhysicsBody = (seed: BodySeed): PhysicsBody => ({
  id: seed.id,
  position: new THREE.Vector3(seed.x, 0, seed.z),
  velocity: new THREE.Vector3(seed.vx, 0, seed.vz),
  force: new THREE.Vector3(),
  mass: seed.mass,
  radius: seed.radius,
  type: seed.type,
  color: '#ffffff',
  trailData: EMPTY_TRAIL,
  trailHead: 0,
  trailLen: 0,
  motionState: 'bound',
  isCloseApproach: false,
});

/**
 * Runs the real N-body step (same integrator, same collision rules, same
 * adaptive dt) on a copy of the world plus the probe, and reports where the
 * probe goes. Bound/escape is judged at the end from the probe's energy
 * relative to the heaviest other body.
 */
export const predictPath = (request: PredictionRequest): PredictionResult => {
  const bods = [...request.bodies.map(toPhysicsBody), toPhysicsBody(request.probe)];
  const probe = bods[bods.length - 1];
  const G = request.effectiveG;
  const points: number[] = [probe.position.x, probe.position.z];
  const removed = new Set<string>();
  const startMass = probe.mass;
  let elapsed = 0;
  let step = 0;

  while (elapsed < request.horizon) {
    const dt = adaptiveDt(FIXED_SUBSTEP, bods);
    integrate(bods, G, dt);
    detectEvents(bods, G, removed);
    elapsed += FIXED_SUBSTEP;
    step += 1;

    // The probe either got absorbed or absorbed something: that's a collision.
    if (removed.has(probe.id) || probe.mass !== startMass) {
      points.push(probe.position.x, probe.position.z);
      return { path: Float32Array.from(points), outcome: 'collision', collisionAt: elapsed };
    }
    if (removed.size) {
      for (let i = bods.length - 1; i >= 0; i--) if (removed.has(bods[i].id)) bods.splice(i, 1);
      removed.clear();
    }
    if (step % request.sampleEvery === 0) points.push(probe.position.x, probe.position.z);
  }

  const others = bods.filter((b) => b !== probe);
  let outcome: PredictionOutcome = 'bound';
  if (others.length > 0) {
    const anchor = others.reduce((max, b) => (b.mass > max.mass ? b : max));
    const r = Math.max(probe.position.distanceTo(anchor.position), 1e-6);
    const v = probe.velocity.distanceTo(anchor.velocity);
    const energy = 0.5 * v * v - (G * anchor.mass) / r;
    if (energy >= 0) outcome = 'escape';
  }
  points.push(probe.position.x, probe.position.z);
  return { path: Float32Array.from(points), outcome, collisionAt: null };
};
