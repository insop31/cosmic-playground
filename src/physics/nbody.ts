// Pure N-body engine for the Spacetime Lab. No React, no rendering: everything here
// operates on PhysicsBody records so it can be unit-tested and reused by the simulator.
import * as THREE from 'three';
import {
  CLOSE_APPROACH_FACTOR,
  MIN_SPAWN_DIST,
  REAL_G,
  SCHWARZSCHILD_SCENE_SCALE,
  SOFTENING_SQ,
  SPEED_OF_LIGHT,
} from './constants';

export const MAX_TRAIL_POINTS = 200;
/** Upper bound on sub-steps per fixed step during very close encounters. */
export const MAX_SUBDIVISIONS = 10;

export type MotionState = 'bound' | 'escaping' | 'captured';

export interface PhysicsBody {
  id: string;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  force: THREE.Vector3; // accumulated per step, reset each step
  mass: number;
  radius: number;
  type: string;
  color: string;
  // Pre-allocated ring-buffer trail [x,0,z, x,0,z, …]
  trailData: Float32Array;
  trailHead: number;
  trailLen: number;
  motionState: MotionState;
  isCloseApproach: boolean;
}

export interface PhysicsBodyInit {
  id: string;
  position: [number, number, number] | THREE.Vector3;
  velocity: [number, number, number] | THREE.Vector3;
  mass: number;
  radius: number;
  type: string;
  color: string;
}

export interface ImpactEvent {
  title: string;
  detail: string;
  position: [number, number, number];
}

const toVector = (v: [number, number, number] | THREE.Vector3) =>
  (v instanceof THREE.Vector3 ? v.clone() : new THREE.Vector3(v[0], v[1], v[2]));

export function createPhysicsBody(init: PhysicsBodyInit): PhysicsBody {
  const position = toVector(init.position);
  position.y = 0;
  const velocity = toVector(init.velocity);
  velocity.y = 0;
  return {
    id: init.id,
    position,
    velocity,
    force: new THREE.Vector3(),
    mass: init.mass,
    radius: init.radius,
    type: init.type,
    color: init.color,
    trailData: new Float32Array(MAX_TRAIL_POINTS * 3),
    trailHead: 0,
    trailLen: 0,
    motionState: 'bound',
    isCloseApproach: false,
  };
}

/** Black holes are pinned anchors in the current model. */
export function isStaticBody(body: PhysicsBody): boolean {
  return body.type === 'blackhole';
}

/**
 * Spawn-time circular orbit velocity around the most massive body present.
 * v_circ = sqrt(G·M / r).
 */
export function spawnOrbitalVelocity(
  spawnPos: THREE.Vector3,
  bods: PhysicsBody[],
  effectiveG: number,
): THREE.Vector3 {
  if (bods.length === 0) return new THREE.Vector3();
  const attractor = bods.reduce((best, b) => (b.mass > best.mass ? b : best));
  const rel = spawnPos.clone().sub(attractor.position);
  const dist = rel.length();
  if (dist < MIN_SPAWN_DIST) return new THREE.Vector3();
  const speed = Math.sqrt((effectiveG * attractor.mass) / dist);
  const tangent = new THREE.Vector3(-rel.z, 0, rel.x);
  if (tangent.lengthSq() < 1e-10) tangent.set(1, 0, 0);
  return tangent.normalize().multiplyScalar(speed).add(attractor.velocity);
}

/**
 * Event horizon radius in scene units. Uses the Schwarzschild formula scaled to the scene,
 * floored at the visual radius so absorption lines up with what the player sees.
 */
export function bhEventHorizon(bh: PhysicsBody): number {
  const rsMeters = (2 * REAL_G * bh.mass) / (SPEED_OF_LIGHT * SPEED_OF_LIGHT);
  return Math.max(bh.radius, rsMeters * SCHWARZSCHILD_SCENE_SCALE);
}

/**
 * Hill sphere radius of every body relative to its nearest more-massive neighbour.
 * r_Hill = a · cbrt(m / 3M). Infinity for a body with no heavier neighbour.
 */
export function hillSphereRadii(bods: PhysicsBody[]): number[] {
  return bods.map((b) => {
    let parentDist = Infinity;
    let parentMass = 0;
    for (const other of bods) {
      if (other === b || other.mass <= b.mass) continue;
      const d = b.position.distanceTo(other.position);
      if (d < parentDist) { parentDist = d; parentMass = other.mass; }
    }
    if (parentMass === 0) return Infinity;
    return parentDist * Math.cbrt(b.mass / (3 * parentMass));
  });
}

/**
 * Dominant body for `bodyIdx`: the body whose Hill sphere contains it with the highest
 * M/d² pull, falling back to the strongest pull overall. Used only for classification.
 */
export function dominantBodyIndex(bodyIdx: number, bods: PhysicsBody[], hill: number[]): number {
  const body = bods[bodyIdx];
  let bestIdx = -1;
  let bestScore = -Infinity;
  for (let i = 0; i < bods.length; i++) {
    if (i === bodyIdx) continue;
    const d = Math.max(body.position.distanceTo(bods[i].position), 1e-6);
    const score = bods[i].mass / (d * d);
    if (d <= hill[i] && score > bestScore) { bestScore = score; bestIdx = i; }
  }
  if (bestIdx < 0) {
    for (let i = 0; i < bods.length; i++) {
      if (i === bodyIdx) continue;
      const d = Math.max(body.position.distanceTo(bods[i].position), 1e-6);
      const score = bods[i].mass / (d * d);
      if (score > bestScore) { bestScore = score; bestIdx = i; }
    }
  }
  return bestIdx;
}

/**
 * Number of equal sub-steps to split one fixed step into. Close encounters need finer
 * steps; splitting (rather than shortening) the step keeps simulated time exact.
 */
export function substepCount(bods: PhysicsBody[]): number {
  if (bods.length < 2) return 1;
  let minDist = Infinity;
  for (let i = 0; i < bods.length; i++) {
    for (let j = i + 1; j < bods.length; j++) {
      const d = bods[i].position.distanceTo(bods[j].position);
      if (d < minDist) minDist = d;
    }
  }
  if (!Number.isFinite(minDist)) return 1;
  const factor = Math.min(1, Math.max(1 / MAX_SUBDIVISIONS, minDist / 4.0));
  return Math.min(MAX_SUBDIVISIONS, Math.ceil(1 / factor));
}

/** F = G·m₁·m₂ / (r² + ε²) for every pair, written into body.force. Allocation-free. */
export function accumulateForces(bods: PhysicsBody[], effectiveG: number) {
  for (const b of bods) b.force.set(0, 0, 0);
  for (let i = 0; i < bods.length; i++) {
    const a = bods[i];
    for (let j = i + 1; j < bods.length; j++) {
      const b = bods[j];
      const dx = b.position.x - a.position.x;
      const dz = b.position.z - a.position.z;
      const r2 = dx * dx + dz * dz;
      const r = Math.sqrt(r2);
      if (r < 1e-12) continue;
      const forceMag = (effectiveG * a.mass * b.mass) / (r2 + SOFTENING_SQ);
      const fx = (dx / r) * forceMag;
      const fz = (dz / r) * forceMag;
      a.force.x += fx; a.force.z += fz;
      b.force.x -= fx; b.force.z -= fz;
    }
  }
}

const clampSpeed = (body: PhysicsBody, maxSpeed: number) => {
  if (!Number.isFinite(maxSpeed)) return;
  const speedSq = body.velocity.lengthSq();
  if (speedSq > maxSpeed * maxSpeed) body.velocity.multiplyScalar(maxSpeed / Math.sqrt(speedSq));
};

/**
 * Velocity Verlet:
 *   x(t+dt) = x + v·dt + ½·a·dt²
 *   v(t+dt) = v + ½·(a(t) + a(t+dt))·dt
 * Motion is confined to the XZ plane.
 */
export function integrate(bods: PhysicsBody[], effectiveG: number, dt: number, maxSpeed = Infinity) {
  accumulateForces(bods, effectiveG);
  const n = bods.length;
  const ax = new Float64Array(n);
  const az = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const b = bods[i];
    if (isStaticBody(b)) continue;
    ax[i] = b.force.x / b.mass;
    az[i] = b.force.z / b.mass;
  }

  for (let i = 0; i < n; i++) {
    const b = bods[i];
    if (isStaticBody(b)) {
      b.velocity.set(0, 0, 0);
      continue;
    }
    b.position.x += b.velocity.x * dt + 0.5 * ax[i] * dt * dt;
    b.position.z += b.velocity.z * dt + 0.5 * az[i] * dt * dt;
    b.position.y = 0;
  }

  accumulateForces(bods, effectiveG);
  for (let i = 0; i < n; i++) {
    const b = bods[i];
    if (isStaticBody(b)) {
      b.velocity.set(0, 0, 0);
      b.force.set(0, 0, 0);
      continue;
    }
    b.velocity.x += 0.5 * (ax[i] + b.force.x / b.mass) * dt;
    b.velocity.z += 0.5 * (az[i] + b.force.z / b.mass) * dt;
    b.velocity.y = 0;
    clampSpeed(b, maxSpeed);
  }
}

function midpointBetween(a: THREE.Vector3, b: THREE.Vector3): [number, number, number] {
  return [(a.x + b.x) * 0.5, 0.75, (a.z + b.z) * 0.5];
}

export function describeMergeImpact(a: PhysicsBody, b: PhysicsBody): { title: string; detail: string } {
  const has = (t: string) => a.type === t || b.type === t;
  const both = (t: string, u: string) => (a.type === t && b.type === u) || (a.type === u && b.type === t);

  if (both('star', 'star')) {
    return { title: 'Stellar merger', detail: 'Two stars collided and fused; mass and momentum combined into one body.' };
  }
  if (has('star') && (has('planet') || has('asteroid') || has('comet'))) {
    return { title: 'Stellar collision', detail: 'A star-scale body swept up a smaller object in a high-energy impact.' };
  }
  if (both('planet', 'planet')) {
    return { title: 'Planetary collision', detail: 'Two worlds merged; material mixed into a single larger planet.' };
  }
  if (has('neutron')) {
    return { title: 'Neutron-star impact', detail: 'Ultra-dense matter collided; the survivor carries enormous binding energy.' };
  }
  if (has('asteroid') || has('comet')) {
    return { title: 'Minor body impact', detail: 'A small body hit a larger one and stuck — accretion in one stroke.' };
  }
  return { title: 'Gravitational merger', detail: 'Two bodies collided and coalesced; linear momentum was conserved.' };
}

export function describeBlackHoleImpact(other: PhysicsBody): { title: string; detail: string } {
  if (other.type === 'blackhole') {
    return { title: 'Black hole merger', detail: 'Two black holes merged into one heavier black hole.' };
  }
  if (other.type === 'star') {
    return { title: 'Event horizon crossing', detail: 'Stellar material crossed the point of no return and joined the black hole.' };
  }
  if (other.type === 'planet') {
    return { title: 'Tidal capture', detail: 'A planet was pulled past the horizon; only the black hole remains visible.' };
  }
  return { title: 'Horizon crossing', detail: 'A small body crossed the event horizon — gravity wins over all other forces.' };
}

/**
 * Collisions and absorptions, detected after integration. Removed body ids are added to
 * `toRemove`; survivors carry the combined mass, momentum and volume.
 */
export function detectEvents(bods: PhysicsBody[], toRemove: Set<string>): ImpactEvent[] {
  const impacts: ImpactEvent[] = [];
  for (const b of bods) b.isCloseApproach = false;

  for (let i = 0; i < bods.length; i++) {
    for (let j = i + 1; j < bods.length; j++) {
      const a = bods[i];
      const b = bods[j];
      if (toRemove.has(a.id) || toRemove.has(b.id)) continue;
      const dist = a.position.distanceTo(b.position);

      if (dist < (a.radius + b.radius) * CLOSE_APPROACH_FACTOR) {
        a.isCloseApproach = true;
        b.isCloseApproach = true;
      }

      // Black hole absorption: anything crossing the horizon (or visibly overlapping)
      // is swallowed. Between two black holes the heavier one survives.
      if (a.type === 'blackhole' || b.type === 'blackhole') {
        let bh = a.type === 'blackhole' ? a : b;
        let other = bh === a ? b : a;
        if (a.type === 'blackhole' && b.type === 'blackhole' && b.mass > a.mass) {
          bh = b;
          other = a;
        }
        const horizon = bhEventHorizon(bh);
        if (dist < horizon || dist < bh.radius + other.radius) {
          const { title, detail } = describeBlackHoleImpact(other);
          impacts.push({ title, detail, position: midpointBetween(bh.position, other.position) });
          bh.mass += other.mass;
          bh.radius = Math.cbrt(bh.radius ** 3 + other.radius ** 3);
          other.motionState = 'captured';
          toRemove.add(other.id);
        }
        continue;
      }

      if (dist < a.radius + b.radius) {
        const { title, detail } = describeMergeImpact(a, b);
        impacts.push({ title, detail, position: midpointBetween(a.position, b.position) });
        const [survivor, absorbed] = a.mass >= b.mass ? [a, b] : [b, a];
        const mS = survivor.mass;
        const mA = absorbed.mass;
        const mT = mS + mA;
        // Momentum conservation: v = (m1·v1 + m2·v2) / (m1+m2); position = centre of mass.
        survivor.velocity.multiplyScalar(mS).addScaledVector(absorbed.velocity, mA).divideScalar(mT);
        survivor.position.multiplyScalar(mS).addScaledVector(absorbed.position, mA).divideScalar(mT);
        survivor.radius = Math.cbrt(survivor.radius ** 3 + absorbed.radius ** 3);
        survivor.mass = mT;
        toRemove.add(absorbed.id);
      }
    }
  }
  return impacts;
}

/**
 * E = ½·m·v_rel² − G·M·m/r relative to the dominant body.
 * E < 0 → bound (closed orbit); E ≥ 0 → escaping (open trajectory).
 */
export function classifyMotion(bods: PhysicsBody[], effectiveG: number, toRemove: Set<string>) {
  const hill = hillSphereRadii(bods);
  for (let i = 0; i < bods.length; i++) {
    const body = bods[i];
    if (toRemove.has(body.id) || body.motionState === 'captured') continue;
    const domIdx = dominantBodyIndex(i, bods, hill);
    if (domIdx < 0) { body.motionState = 'bound'; continue; }
    const dom = bods[domIdx];
    const rx = body.position.x - dom.position.x;
    const rz = body.position.z - dom.position.z;
    const vx = body.velocity.x - dom.velocity.x;
    const vz = body.velocity.z - dom.velocity.z;
    const r = Math.max(Math.sqrt(rx * rx + rz * rz), 1e-6);
    const specificEnergy = 0.5 * (vx * vx + vz * vz) - (effectiveG * dom.mass) / r;
    body.motionState = specificEnergy < 0 ? 'bound' : 'escaping';
  }
}

/**
 * Hubble-style expansion: unbound (escaping) bodies drift away from the system's centre
 * of mass in proportion to their distance. Bound systems hold together, as in reality.
 */
export function applyExpansion(bods: PhysicsBody[], rate: number, dt: number) {
  if (rate <= 0 || bods.length < 2) return;
  let totalMass = 0;
  let cx = 0;
  let cz = 0;
  for (const b of bods) {
    totalMass += b.mass;
    cx += b.position.x * b.mass;
    cz += b.position.z * b.mass;
  }
  if (totalMass <= 0) return;
  cx /= totalMass;
  cz /= totalMass;
  const k = rate * dt;
  for (const b of bods) {
    if (b.motionState !== 'escaping' || isStaticBody(b)) continue;
    b.position.x += (b.position.x - cx) * k;
    b.position.z += (b.position.z - cz) * k;
  }
}

export interface StepResult {
  impacts: ImpactEvent[];
  removed: Set<string>;
}

/**
 * One fixed simulation step of length `dt`, split into equal sub-steps during close
 * encounters. Returns the impacts that happened and the ids of bodies that were absorbed.
 */
export function stepSystem(
  bods: PhysicsBody[],
  dt: number,
  options: { effectiveG: number; maxSpeed?: number; expansionRate?: number },
): StepResult {
  const { effectiveG, maxSpeed = Infinity, expansionRate = 0 } = options;
  const removed = new Set<string>();
  const impacts: ImpactEvent[] = [];
  let active = bods;
  const n = substepCount(active);
  const h = dt / n;
  for (let k = 0; k < n; k++) {
    integrate(active, effectiveG, h, maxSpeed);
    const before = removed.size;
    impacts.push(...detectEvents(active, removed));
    if (removed.size !== before) active = active.filter((b) => !removed.has(b.id));
  }
  applyExpansion(active, expansionRate, dt);
  classifyMotion(active, effectiveG, removed);
  return { impacts, removed };
}

/**
 * Total kinetic + potential energy, used by tests and diagnostics. For the force law
 * F = k/(r² + ε²) the matching potential is U(r) = −(k/ε)·(π/2 − atan(r/ε)).
 */
export function totalEnergy(bods: PhysicsBody[], effectiveG: number): number {
  const eps = Math.sqrt(SOFTENING_SQ);
  let kinetic = 0;
  let potential = 0;
  for (let i = 0; i < bods.length; i++) {
    const a = bods[i];
    if (!isStaticBody(a)) kinetic += 0.5 * a.mass * a.velocity.lengthSq();
    for (let j = i + 1; j < bods.length; j++) {
      const b = bods[j];
      const r = a.position.distanceTo(b.position);
      const k = effectiveG * a.mass * b.mass;
      potential -= (k / eps) * (Math.PI / 2 - Math.atan(r / eps));
    }
  }
  return kinetic + potential;
}

/** Total linear momentum (x, z). */
export function totalMomentum(bods: PhysicsBody[]): [number, number] {
  let px = 0;
  let pz = 0;
  for (const b of bods) {
    px += b.mass * b.velocity.x;
    pz += b.mass * b.velocity.z;
  }
  return [px, pz];
}
