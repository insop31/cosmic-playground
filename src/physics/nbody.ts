// Pure N-body engine for the Spacetime Lab, operating on the flat arrays of NBodySystem.
// No React, no rendering and no allocation in the per-step force loop.
import {
  CLOSE_APPROACH_FACTOR,
  MIN_SPAWN_DIST,
  REAL_G,
  SCHWARZSCHILD_SCENE_SCALE,
  SOFTENING_SQ,
  SPEED_OF_LIGHT,
} from './constants';
import { MOTION_BOUND, MOTION_CAPTURED, MOTION_ESCAPING, NBodySystem } from './system';

/** Upper bound on sub-steps per fixed step during very close encounters. */
export const MAX_SUBDIVISIONS = 10;

export type ImpactKind = 'merge' | 'absorb';

export interface ImpactEvent {
  kind: ImpactKind;
  title: string;
  detail: string;
  position: [number, number, number];
  /** Ids involved: the survivor first. */
  bodies: [string, string];
  /** Share of the pair's kinetic energy turned into heat (0–1). */
  kineticEnergyLost: number;
}

export interface StepOptions {
  effectiveG: number;
  maxSpeed?: number;
  expansionRate?: number;
}

export interface StepResult {
  impacts: ImpactEvent[];
  removed: string[];
}

export const isPinned = (sys: NBodySystem, i: number) => sys.pinned[i] === 1;

/**
 * Circular-orbit velocity around the most massive body for a body at (x, z),
 * v_circ = √(G·M / r), relative to the attractor's own motion.
 */
export function spawnOrbitalVelocity(sys: NBodySystem, x: number, z: number, effectiveG: number): [number, number] {
  if (sys.count === 0) return [0, 0];
  let best = 0;
  for (let i = 1; i < sys.count; i++) if (sys.mass[i] > sys.mass[best]) best = i;
  const rx = x - sys.px[best];
  const rz = z - sys.pz[best];
  const dist = Math.hypot(rx, rz);
  if (dist < MIN_SPAWN_DIST) return [0, 0];
  const speed = Math.sqrt((effectiveG * sys.mass[best]) / dist);
  return [(-rz / dist) * speed + sys.vx[best], (rx / dist) * speed + sys.vz[best]];
}

/**
 * Event horizon radius in scene units: the Schwarzschild radius scaled to the scene,
 * floored at the visual radius so absorption lines up with what the player sees.
 */
export function bhEventHorizon(mass: number, radius: number): number {
  const rsMeters = (2 * REAL_G * mass) / (SPEED_OF_LIGHT * SPEED_OF_LIGHT);
  return Math.max(radius, rsMeters * SCHWARZSCHILD_SCENE_SCALE);
}

/** a_i = Σ G·m_j / (r² + ε²) toward j. Pinned bodies feel nothing but still pull. */
export function computeAccelerations(sys: NBodySystem, effectiveG: number) {
  const { count, px, pz, ax, az, mass } = sys;
  for (let i = 0; i < count; i++) { ax[i] = 0; az[i] = 0; }
  for (let i = 0; i < count; i++) {
    for (let j = i + 1; j < count; j++) {
      const dx = px[j] - px[i];
      const dz = pz[j] - pz[i];
      const r2 = dx * dx + dz * dz;
      const r = Math.sqrt(r2);
      if (r < 1e-12) continue;
      const s = effectiveG / ((r2 + SOFTENING_SQ) * r); // G / ((r²+ε²)·r)
      ax[i] += dx * s * mass[j];
      az[i] += dz * s * mass[j];
      ax[j] -= dx * s * mass[i];
      az[j] -= dz * s * mass[i];
    }
  }
  for (let i = 0; i < count; i++) {
    if (sys.pinned[i]) { ax[i] = 0; az[i] = 0; }
  }
  sys.accValid = true;
}

/**
 * Number of equal sub-steps to split one fixed step into. Close encounters need finer
 * steps; splitting (rather than shortening) the step keeps simulated time exact.
 */
export function substepCount(sys: NBodySystem): number {
  const { count, px, pz } = sys;
  if (count < 2) return 1;
  let minD2 = Infinity;
  for (let i = 0; i < count; i++) {
    for (let j = i + 1; j < count; j++) {
      const dx = px[j] - px[i];
      const dz = pz[j] - pz[i];
      const d2 = dx * dx + dz * dz;
      if (d2 < minD2) minD2 = d2;
    }
  }
  const minDist = Math.sqrt(minD2);
  const factor = Math.min(1, Math.max(1 / MAX_SUBDIVISIONS, minDist / 4.0));
  return Math.min(MAX_SUBDIVISIONS, Math.ceil(1 / factor));
}

/**
 * Kick-drift-kick leapfrog (equivalent to velocity Verlet, one force pass per step):
 *   v += a·dt/2;  x += v·dt;  a = a(x);  v += a·dt/2
 * Accelerations carry over between steps until masses or membership change.
 */
export function leapfrogStep(sys: NBodySystem, effectiveG: number, dt: number, maxSpeed = Infinity) {
  if (!sys.accValid) computeAccelerations(sys, effectiveG);
  const { count, px, pz, vx, vz, ax, az } = sys;
  const half = 0.5 * dt;
  for (let i = 0; i < count; i++) {
    if (sys.pinned[i]) { vx[i] = 0; vz[i] = 0; continue; }
    vx[i] += ax[i] * half;
    vz[i] += az[i] * half;
    px[i] += vx[i] * dt;
    pz[i] += vz[i] * dt;
  }
  computeAccelerations(sys, effectiveG);
  const capped = Number.isFinite(maxSpeed);
  const max2 = maxSpeed * maxSpeed;
  for (let i = 0; i < count; i++) {
    if (sys.pinned[i]) continue;
    vx[i] += ax[i] * half;
    vz[i] += az[i] * half;
    if (capped) {
      const s2 = vx[i] * vx[i] + vz[i] * vz[i];
      if (s2 > max2) {
        const k = maxSpeed / Math.sqrt(s2);
        vx[i] *= k;
        vz[i] *= k;
      }
    }
  }
}

export function describeMergeImpact(typeA: string, typeB: string): { title: string; detail: string } {
  const has = (t: string) => typeA === t || typeB === t;
  const both = (t: string, u: string) => (typeA === t && typeB === u) || (typeA === u && typeB === t);
  if (both('star', 'star')) {
    return { title: 'Stellar merger', detail: 'Two stars collided and fused; mass and momentum combined into one body.' };
  }
  if (has('star') && (has('planet') || has('asteroid') || has('comet'))) {
    return { title: 'Stellar collision', detail: 'A star swept up a smaller object in a high-energy impact.' };
  }
  if (both('planet', 'planet')) {
    return { title: 'Planetary collision', detail: 'Two worlds merged into a single larger planet.' };
  }
  if (has('neutron')) {
    return { title: 'Neutron-star impact', detail: 'Ultra-dense matter collided; the survivor carries the combined mass.' };
  }
  if (has('asteroid') || has('comet')) {
    return { title: 'Minor body impact', detail: 'A small body hit a larger one and stuck: accretion in one stroke.' };
  }
  return { title: 'Gravitational merger', detail: 'Two bodies collided and coalesced.' };
}

export function describeBlackHoleImpact(otherType: string): { title: string; detail: string } {
  if (otherType === 'blackhole') {
    return { title: 'Black hole merger', detail: 'Two black holes merged into one heavier black hole.' };
  }
  if (otherType === 'star') {
    return { title: 'Event horizon crossing', detail: 'Stellar material crossed the point of no return and joined the black hole.' };
  }
  if (otherType === 'planet') {
    return { title: 'Tidal capture', detail: 'A planet was pulled past the horizon; only the black hole remains.' };
  }
  return { title: 'Horizon crossing', detail: 'A small body crossed the event horizon: nothing escapes from inside it.' };
}

/** Kinetic energy share lost when bodies i and j stick together (perfectly inelastic). */
function mergeEnergyLoss(sys: NBodySystem, i: number, j: number): number {
  const { vx, vz, mass } = sys;
  const before = 0.5 * mass[i] * (vx[i] ** 2 + vz[i] ** 2) + 0.5 * mass[j] * (vx[j] ** 2 + vz[j] ** 2);
  if (before <= 0) return 0;
  const mt = mass[i] + mass[j];
  const cx = (mass[i] * vx[i] + mass[j] * vx[j]) / mt;
  const cz = (mass[i] * vz[i] + mass[j] * vz[j]) / mt;
  const after = 0.5 * mt * (cx * cx + cz * cz);
  return Math.max(0, Math.min(1, 1 - after / before));
}

/**
 * Merge body `absorbed` into `survivor`: momentum and centre of mass are conserved and
 * the radius grows with the combined volume. Pinned survivors stay where they are.
 */
function mergeInto(sys: NBodySystem, survivor: number, absorbed: number) {
  const { px, pz, vx, vz, mass, radius } = sys;
  const mS = mass[survivor];
  const mA = mass[absorbed];
  const mT = mS + mA;
  if (!sys.pinned[survivor]) {
    vx[survivor] = (mS * vx[survivor] + mA * vx[absorbed]) / mT;
    vz[survivor] = (mS * vz[survivor] + mA * vz[absorbed]) / mT;
    px[survivor] = (mS * px[survivor] + mA * px[absorbed]) / mT;
    pz[survivor] = (mS * pz[survivor] + mA * pz[absorbed]) / mT;
  }
  radius[survivor] = Math.cbrt(radius[survivor] ** 3 + radius[absorbed] ** 3);
  mass[survivor] = mT;
  sys.accValid = false;
}

/**
 * Collisions and absorptions, detected after integration. Absorbed bodies are removed
 * from the system and their ids returned through `removed`.
 */
export function detectCollisions(sys: NBodySystem, removed: string[]): ImpactEvent[] {
  const impacts: ImpactEvent[] = [];
  const gone = new Uint8Array(sys.count);
  const { px, pz, mass, radius, types, ids } = sys;
  for (let i = 0; i < sys.count; i++) sys.closeApproach[i] = 0;

  for (let i = 0; i < sys.count; i++) {
    if (gone[i]) continue;
    for (let j = i + 1; j < sys.count; j++) {
      if (gone[j] || gone[i]) continue;
      const dist = Math.hypot(px[j] - px[i], pz[j] - pz[i]);
      if (dist < (radius[i] + radius[j]) * CLOSE_APPROACH_FACTOR) {
        sys.closeApproach[i] = 1;
        sys.closeApproach[j] = 1;
      }

      const aBH = types[i] === 'blackhole';
      const bBH = types[j] === 'blackhole';
      if (aBH || bBH) {
        // Anything crossing the horizon (or visibly overlapping) is swallowed.
        // Between two black holes the heavier one survives.
        let bh = aBH ? i : j;
        let other = bh === i ? j : i;
        if (aBH && bBH && mass[j] > mass[i]) { bh = j; other = i; }
        const horizon = bhEventHorizon(mass[bh], radius[bh]);
        if (dist < horizon || dist < radius[bh] + radius[other]) {
          const { title, detail } = describeBlackHoleImpact(types[other]);
          const kineticEnergyLost = mergeEnergyLoss(sys, bh, other);
          impacts.push({
            kind: 'absorb',
            title,
            detail,
            position: [(px[bh] + px[other]) / 2, 0.75, (pz[bh] + pz[other]) / 2],
            bodies: [ids[bh], ids[other]],
            kineticEnergyLost,
          });
          mergeInto(sys, bh, other);
          sys.motion[other] = MOTION_CAPTURED;
          gone[other] = 1;
        }
        continue;
      }

      if (dist < radius[i] + radius[j]) {
        const [survivor, absorbed] = mass[i] >= mass[j] ? [i, j] : [j, i];
        const { title, detail } = describeMergeImpact(types[i], types[j]);
        const kineticEnergyLost = mergeEnergyLoss(sys, survivor, absorbed);
        impacts.push({
          kind: 'merge',
          title,
          detail,
          position: [(px[i] + px[j]) / 2, 0.75, (pz[i] + pz[j]) / 2],
          bodies: [ids[survivor], ids[absorbed]],
          kineticEnergyLost,
        });
        mergeInto(sys, survivor, absorbed);
        gone[absorbed] = 1;
      }
    }
  }

  // Remove absorbed bodies (highest index first so swap-removal keeps indices valid).
  for (let i = sys.count - 1; i >= 0; i--) {
    if (gone[i]) {
      removed.push(sys.ids[i]);
      sys.removeAt(i);
    }
  }
  return impacts;
}

/** Hill radius of every body relative to its nearest heavier neighbour (∞ if none). */
export function hillSphereRadii(sys: NBodySystem): Float64Array {
  const { count, px, pz, mass } = sys;
  const hill = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    let parentDist = Infinity;
    let parentMass = 0;
    for (let j = 0; j < count; j++) {
      if (j === i || mass[j] <= mass[i]) continue;
      const d = Math.hypot(px[j] - px[i], pz[j] - pz[i]);
      if (d < parentDist) { parentDist = d; parentMass = mass[j]; }
    }
    hill[i] = parentMass === 0 ? Infinity : parentDist * Math.cbrt(mass[i] / (3 * parentMass));
  }
  return hill;
}

/**
 * Classify each body as bound or escaping relative to its dominant body: the body whose
 * Hill sphere contains it with the strongest pull, else the strongest pull overall.
 * Specific energy ε = v²/2 − G·M/r < 0 means bound.
 */
export function classifyMotion(sys: NBodySystem, effectiveG: number) {
  const { count, px, pz, vx, vz, mass } = sys;
  const hill = hillSphereRadii(sys);
  for (let i = 0; i < count; i++) {
    let best = -1;
    let bestScore = -Infinity;
    let bestAny = -1;
    let bestAnyScore = -Infinity;
    for (let j = 0; j < count; j++) {
      if (j === i) continue;
      const d = Math.max(Math.hypot(px[j] - px[i], pz[j] - pz[i]), 1e-6);
      const score = mass[j] / (d * d);
      if (score > bestAnyScore) { bestAnyScore = score; bestAny = j; }
      if (d <= hill[j] && score > bestScore) { bestScore = score; best = j; }
    }
    const dom = best >= 0 ? best : bestAny;
    sys.dominant[i] = dom;
    if (dom < 0) { sys.motion[i] = MOTION_BOUND; continue; }
    const rx = px[i] - px[dom];
    const rz = pz[i] - pz[dom];
    const rvx = vx[i] - vx[dom];
    const rvz = vz[i] - vz[dom];
    const r = Math.max(Math.hypot(rx, rz), 1e-6);
    const energy = 0.5 * (rvx * rvx + rvz * rvz) - (effectiveG * mass[dom]) / r;
    sys.motion[i] = energy < 0 ? MOTION_BOUND : MOTION_ESCAPING;
  }
}

/**
 * Hubble-style expansion: escaping bodies drift away from the centre of mass in
 * proportion to their distance. Bound systems hold together, as in reality.
 */
export function applyExpansion(sys: NBodySystem, rate: number, dt: number) {
  const { count, px, pz, mass } = sys;
  if (rate <= 0 || count < 2) return;
  let total = 0;
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < count; i++) {
    total += mass[i];
    cx += px[i] * mass[i];
    cz += pz[i] * mass[i];
  }
  if (total <= 0) return;
  cx /= total;
  cz /= total;
  const k = rate * dt;
  let moved = false;
  for (let i = 0; i < count; i++) {
    if (sys.motion[i] !== MOTION_ESCAPING || sys.pinned[i]) continue;
    px[i] += (px[i] - cx) * k;
    pz[i] += (pz[i] - cz) * k;
    moved = true;
  }
  if (moved) sys.accValid = false;
}

/**
 * One fixed simulation step of length `dt`, split into equal sub-steps during close
 * encounters. Returns the impacts that happened and the ids of absorbed bodies.
 */
export function stepSystem(sys: NBodySystem, dt: number, options: StepOptions): StepResult {
  const { effectiveG, maxSpeed = Infinity, expansionRate = 0 } = options;
  const removed: string[] = [];
  const impacts: ImpactEvent[] = [];
  const n = substepCount(sys);
  const h = dt / n;
  for (let k = 0; k < n; k++) {
    leapfrogStep(sys, effectiveG, h, maxSpeed);
    impacts.push(...detectCollisions(sys, removed));
  }
  applyExpansion(sys, expansionRate, dt);
  classifyMotion(sys, effectiveG);
  return { impacts, removed };
}

export interface Diagnostics {
  kinetic: number;
  potential: number;
  energy: number;
  momentumX: number;
  momentumZ: number;
  /** z-component of total angular momentum about the origin (motion is in the XZ plane). */
  angularMomentum: number;
}

/**
 * Conserved quantities. For the force law F = k/(r² + ε²) the matching potential is
 * U(r) = −(k/ε)·(π/2 − atan(r/ε)). Pinned bodies carry no kinetic energy or momentum.
 */
export function diagnostics(sys: NBodySystem, effectiveG: number): Diagnostics {
  const { count, px, pz, vx, vz, mass } = sys;
  const eps = Math.sqrt(SOFTENING_SQ);
  let kinetic = 0;
  let potential = 0;
  let momentumX = 0;
  let momentumZ = 0;
  let angularMomentum = 0;
  for (let i = 0; i < count; i++) {
    if (!sys.pinned[i]) {
      kinetic += 0.5 * mass[i] * (vx[i] * vx[i] + vz[i] * vz[i]);
      momentumX += mass[i] * vx[i];
      momentumZ += mass[i] * vz[i];
      // L_y for motion in the XZ plane: m·(z·vx − x·vz)
      angularMomentum += mass[i] * (pz[i] * vx[i] - px[i] * vz[i]);
    }
    for (let j = i + 1; j < count; j++) {
      const r = Math.hypot(px[j] - px[i], pz[j] - pz[i]);
      const k = effectiveG * mass[i] * mass[j];
      potential -= (k / eps) * (Math.PI / 2 - Math.atan(r / eps));
    }
  }
  return { kinetic, potential, energy: kinetic + potential, momentumX, momentumZ, angularMomentum };
}
