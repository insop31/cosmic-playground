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
import { toKmPerSecond } from './units';

/** Upper bound on sub-steps per fixed step during very close encounters. */
export const MAX_SUBDIVISIONS = 10;

export type ImpactKind = 'merge' | 'absorb' | 'bounce' | 'fragment' | 'tidal';

/** Impact speed (relative to the pair's mutual escape speed) above which bodies bounce. */
export const BOUNCE_SPEED_RATIO = 1;
/** Impact speed ratio above which the smaller body shatters. */
export const FRAGMENT_SPEED_RATIO = 2.5;
export const FRAGMENT_COUNT = 4;
const BOUNCE_RESTITUTION = 0.5;
const FRAGMENT_RESTITUTION = 0.3;
/** Smallest body (kg) that can shatter into fragments. */
const MIN_FRAGMENT_PARENT_MASS = 1e15;
/** Impactors lighter than this share of the target are simply accreted (a crater). */
export const ACCRETION_MASS_RATIO = 1e-3;
const G_SI = 6.674e-11;
const KM_PER_S_PER_SCENE_UNIT = toKmPerSecond(1);

/**
 * Mutual escape speed of a touching pair in scene units (realistic mode), from their real
 * masses and radii: v = √(2G(m₁+m₂)/(R₁+R₂)). Scene radii are exaggerated for visibility,
 * so the real radii are what decide whether bodies stick, bounce or shatter.
 */
export function mutualEscapeSpeed(m1: number, m2: number, physR1: number, physR2: number): number {
  const metresPerSecond = Math.sqrt((2 * G_SI * (m1 + m2)) / Math.max(physR1 + physR2, 1));
  return metresPerSecond / 1000 / KM_PER_S_PER_SCENE_UNIT;
}
export const TIDAL_STREAM_PIECES = 6;
/** Bodies treated as infinitely heavy in a collision (pinned) use this effective mass. */
const PINNED_MASS = 1e60;

/** A body created during a step (fragments, tidal debris), described by its parent. */
export interface SpawnedBody {
  id: string;
  parentId: string;
  type: string;
  x: number;
  z: number;
  vx: number;
  vz: number;
  mass: number;
  radius: number;
  physRadius: number;
}

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
  /** Fragments and debris are only created while the system stays below this size. */
  maxBodies?: number;
  /** Arcade speeds are this many times realistic ones; collisions judge realistic speeds. */
  velocityScale?: number;
}

export interface StepResult {
  impacts: ImpactEvent[];
  removed: string[];
  spawned: SpawnedBody[];
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

/**
 * Impact energy: the kinetic energy of the pair's relative motion, ½·μ·v_rel², with
 * μ = m₁m₂/(m₁+m₂). It is the same in every frame, and it is the most a collision can
 * turn into heat. A pinned body counts as infinitely heavy (μ = the other mass).
 */
function impactEnergy(sys: NBodySystem, i: number, j: number): number {
  const dvx = sys.vx[i] - sys.vx[j];
  const dvz = sys.vz[i] - sys.vz[j];
  let mu: number;
  if (sys.pinned[i] && sys.pinned[j]) return 0;
  if (sys.pinned[i]) mu = sys.mass[j];
  else if (sys.pinned[j]) mu = sys.mass[i];
  else mu = (sys.mass[i] * sys.mass[j]) / (sys.mass[i] + sys.mass[j]);
  return 0.5 * mu * (dvx * dvx + dvz * dvz);
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
  sys.physRadius[survivor] = Math.cbrt(sys.physRadius[survivor] ** 3 + sys.physRadius[absorbed] ** 3);
  mass[survivor] = mT;
  sys.accValid = false;
}

let spawnSeq = 0;

const kineticEnergy = (sys: NBodySystem, i: number) =>
  (sys.pinned[i] ? 0 : 0.5 * sys.mass[i] * (sys.vx[i] ** 2 + sys.vz[i] ** 2));

/**
 * Inelastic collision along the line of centres with restitution `e`, then push the pair
 * apart so they no longer overlap. Momentum is conserved; pinned bodies do not move.
 */
function bounce(sys: NBodySystem, i: number, j: number, e: number) {
  const { px, pz, vx, vz, radius } = sys;
  const dx = px[j] - px[i];
  const dz = pz[j] - pz[i];
  const dist = Math.max(Math.hypot(dx, dz), 1e-9);
  const nx = dx / dist;
  const nz = dz / dist;
  const mi = sys.pinned[i] ? PINNED_MASS : sys.mass[i];
  const mj = sys.pinned[j] ? PINNED_MASS : sys.mass[j];
  const ui = vx[i] * nx + vz[i] * nz;
  const uj = vx[j] * nx + vz[j] * nz;
  if (ui - uj > 0) {
    // Approaching: exchange normal momentum.
    const total = mi * ui + mj * uj;
    const vi = (total + mj * e * (uj - ui)) / (mi + mj);
    const vj = (total + mi * e * (ui - uj)) / (mi + mj);
    if (!sys.pinned[i]) { vx[i] += (vi - ui) * nx; vz[i] += (vi - ui) * nz; }
    if (!sys.pinned[j]) { vx[j] += (vj - uj) * nx; vz[j] += (vj - uj) * nz; }
  }
  const overlap = radius[i] + radius[j] - dist;
  if (overlap > 0) {
    const shareI = mj / (mi + mj);
    const shareJ = mi / (mi + mj);
    if (!sys.pinned[i]) { px[i] -= nx * overlap * shareI * 1.01; pz[i] -= nz * overlap * shareI * 1.01; }
    if (!sys.pinned[j]) { px[j] += nx * overlap * shareJ * 1.01; pz[j] += nz * overlap * shareJ * 1.01; }
  }
  sys.accValid = false;
}

/**
 * Split body `p` into `pieces` equal fragments. The fragments share its momentum; the
 * extra spread speed draws on `energyBudget` (energy the impact already turned to heat),
 * so total kinetic energy never increases. Pieces are laid out along `axis`.
 */
function shatter(
  sys: NBodySystem,
  p: number,
  pieces: number,
  energyBudget: number,
  axis: [number, number],
  spawned: SpawnedBody[],
) {
  const mass = sys.mass[p] / pieces;
  const radius = sys.radius[p] / Math.cbrt(pieces);
  // ½·m_total·s² = energyBudget  →  every piece moves ±s from the parent's velocity.
  const spread = Math.sqrt((2 * Math.max(energyBudget, 0)) / sys.mass[p]);
  const [ax, az] = axis;
  for (let k = 0; k < pieces; k++) {
    // Symmetric offsets (−1.5, −0.5, 0.5, 1.5 …) so the spreads cancel out.
    const offset = k - (pieces - 1) / 2;
    const sign = Math.sign(offset);
    const physRadius = sys.physRadius[p] / Math.cbrt(pieces);
  spawned.push({
      id: `${sys.ids[p]}~${(spawnSeq++).toString(36)}`,
      parentId: sys.ids[p],
      type: sys.types[p] === 'star' ? 'debris' : sys.types[p] === 'debris' ? 'debris' : 'asteroid',
      x: sys.px[p] + ax * offset * radius * 2.2,
      z: sys.pz[p] + az * offset * radius * 2.2,
      vx: sys.vx[p] + ax * spread * sign * (Math.abs(offset) / ((pieces - 1) / 2 || 1)),
      vz: sys.vz[p] + az * spread * sign * (Math.abs(offset) / ((pieces - 1) / 2 || 1)),
      mass,
      radius,
      physRadius,
    });
  }
}

const canShatter = (sys: NBodySystem, i: number) =>
  !sys.pinned[i]
  && sys.mass[i] >= MIN_FRAGMENT_PARENT_MASS
  && (sys.types[i] === 'asteroid' || sys.types[i] === 'comet' || sys.types[i] === 'planet' || sys.types[i] === 'debris');

/** Roche limit (scene units) for a star of radius r and mass m near a black hole of mass M. */
export const rocheLimit = (r: number, m: number, M: number) => r * Math.cbrt((2 * M) / m);

/**
 * Collisions, absorptions and tidal disruptions, detected after integration. Outcomes
 * follow the impact speed relative to the pair's mutual escape speed
 * v_esc = √(2G(m₁+m₂)/(r₁+r₂)): slow impacts merge, faster ones bounce ("hit and run"),
 * and violent ones shatter the smaller body. Removed bodies are taken out of the system
 * and created bodies are added to it; both are reported.
 */
export function detectCollisions(
  sys: NBodySystem,
  removed: string[],
  effectiveG = 0,
  spawned: SpawnedBody[] = [],
  maxBodies = Infinity,
  velocityScale = 1,
): ImpactEvent[] {
  const impacts: ImpactEvent[] = [];
  const n = sys.count;
  const gone = new Uint8Array(n);
  const { px, pz, mass, radius, types, ids } = sys;
  for (let i = 0; i < n; i++) sys.closeApproach[i] = 0;
  let room = maxBodies - n;

  for (let i = 0; i < n; i++) {
    if (gone[i]) continue;
    for (let j = i + 1; j < n; j++) {
      if (gone[j] || gone[i]) continue;
      const dist = Math.hypot(px[j] - px[i], pz[j] - pz[i]);
      if (dist < (radius[i] + radius[j]) * CLOSE_APPROACH_FACTOR) {
        sys.closeApproach[i] = 1;
        sys.closeApproach[j] = 1;
      }
      const midpoint: [number, number, number] = [(px[i] + px[j]) / 2, 0.75, (pz[i] + pz[j]) / 2];

      const aBH = types[i] === 'blackhole';
      const bBH = types[j] === 'blackhole';
      if (aBH || bBH) {
        let bh = aBH ? i : j;
        let other = bh === i ? j : i;
        if (aBH && bBH && mass[j] > mass[i]) { bh = j; other = i; }
        const horizon = bhEventHorizon(mass[bh], radius[bh]);

        // Tidal disruption: a star inside the Roche limit is pulled into a stream.
        if (types[other] === 'star' && dist >= horizon && room >= TIDAL_STREAM_PIECES - 1
          && dist < rocheLimit(radius[other], mass[other], mass[bh])) {
          const ux = (px[other] - px[bh]) / dist;
          const uz = (pz[other] - pz[bh]) / dist;
          // Tides stretch the star along the line to the hole; the stream's spread speed
          // is a fraction of the star's own escape speed, taken from its binding energy.
          const bindingBudget = 0.15 * effectiveG * mass[other] * mass[other] / Math.max(radius[other], 1e-6);
          const before = spawned.length;
          shatter(sys, other, TIDAL_STREAM_PIECES, Math.min(bindingBudget, kineticEnergy(sys, other) * 0.5), [ux, uz], spawned);
          room -= spawned.length - before - 1;
          impacts.push({
            kind: 'tidal',
            title: 'Tidal disruption',
            detail: 'The black hole pulled harder on the near side of the star than on the far side, stretching it into a stream of gas.',
            position: midpoint,
            bodies: [ids[bh], ids[other]],
            kineticEnergyLost: 0,
          });
          gone[other] = 1;
          continue;
        }

        if (dist < horizon || dist < radius[bh] + radius[other]) {
          const { title, detail } = describeBlackHoleImpact(types[other]);
          // Sticking together removes all relative motion: every joule of impact energy becomes heat.
          impacts.push({ kind: 'absorb', title, detail, position: midpoint, bodies: [ids[bh], ids[other]], kineticEnergyLost: 1 });
          mergeInto(sys, bh, other);
          sys.motion[other] = MOTION_CAPTURED;
          gone[other] = 1;
        }
        continue;
      }

      if (dist >= radius[i] + radius[j]) continue;

      // Compare in realistic-mode units so arcade mode (faster everything) gives the same outcome.
      const relSpeed = Math.hypot(sys.vx[i] - sys.vx[j], sys.vz[i] - sys.vz[j]) / velocityScale;
      const escapeSpeed = mutualEscapeSpeed(mass[i], mass[j], sys.physRadius[i], sys.physRadius[j]);
      const ratio = relSpeed / escapeSpeed;
      const [big, small] = mass[i] >= mass[j] ? [i, j] : [j, i];
      const accretion = mass[small] / mass[big] < ACCRETION_MASS_RATIO;

      if (ratio <= BOUNCE_SPEED_RATIO || accretion || sys.pinned[i] && sys.pinned[j]) {
        const { title, detail } = describeMergeImpact(types[i], types[j]);
        impacts.push({ kind: 'merge', title, detail, position: midpoint, bodies: [ids[big], ids[small]], kineticEnergyLost: 1 });
        mergeInto(sys, big, small);
        gone[small] = 1;
        continue;
      }

      const impactBefore = impactEnergy(sys, i, j);
      const shattering = ratio > FRAGMENT_SPEED_RATIO && canShatter(sys, small) && room >= FRAGMENT_COUNT - 1;
      bounce(sys, i, j, shattering ? FRAGMENT_RESTITUTION : BOUNCE_RESTITUTION);
      // Energy lost by the bounce (frame-independent, so the same as the total KE lost).
      const heat = Math.max(0, impactBefore - impactEnergy(sys, i, j));

      if (shattering) {
        const dx = px[small] - px[big];
        const dz = pz[small] - pz[big];
        const d = Math.max(Math.hypot(dx, dz), 1e-9);
        // Fragments fan out across the impact direction; half the heat feeds their spread.
        const before = spawned.length;
        shatter(sys, small, FRAGMENT_COUNT, heat * 0.5, [-dz / d, dx / d], spawned);
        room -= spawned.length - before - 1;
        impacts.push({
          kind: 'fragment',
          title: 'Shattering impact',
          detail: `The impact was ${ratio.toFixed(1)}× faster than the pair's escape speed, so the smaller body broke into ${FRAGMENT_COUNT} fragments.`,
          position: midpoint,
          bodies: [ids[big], ids[small]],
          // Up to half the heat is handed back as the fragments' spread; the rest stays heat.
          kineticEnergyLost: impactBefore > 0 ? Math.min(1, (heat * 0.5) / impactBefore) : 0,
        });
        gone[small] = 1;
      } else {
        impacts.push({
          kind: 'bounce',
          title: 'Hit and run',
          detail: `The bodies met at ${ratio.toFixed(1)}× their mutual escape speed: too fast to stick together, so they bounced apart.`,
          position: midpoint,
          bodies: [ids[big], ids[small]],
          kineticEnergyLost: impactBefore > 0 ? Math.min(1, heat / impactBefore) : 0,
        });
      }
    }
  }

  // Remove absorbed bodies (highest index first so swap-removal keeps indices valid).
  for (let i = n - 1; i >= 0; i--) {
    if (gone[i]) {
      removed.push(sys.ids[i]);
      sys.removeAt(i);
    }
  }
  for (const body of spawned) {
    if (!sys.has(body.id)) {
      sys.add({ id: body.id, type: body.type, x: body.x, z: body.z, vx: body.vx, vz: body.vz, mass: body.mass, radius: body.radius, physRadius: body.physRadius });
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
  const { effectiveG, maxSpeed = Infinity, expansionRate = 0, maxBodies = Infinity, velocityScale = 1 } = options;
  const removed: string[] = [];
  const spawned: SpawnedBody[] = [];
  const impacts: ImpactEvent[] = [];
  const n = substepCount(sys);
  const h = dt / n;
  for (let k = 0; k < n; k++) {
    leapfrogStep(sys, effectiveG, h, maxSpeed);
    impacts.push(...detectCollisions(sys, removed, effectiveG, spawned, maxBodies, velocityScale));
  }
  applyExpansion(sys, expansionRate, dt);
  classifyMotion(sys, effectiveG);
  // A fragment that was itself absorbed in a later sub-step never needs reporting.
  const removedSet = new Set(removed);
  return { impacts, removed: removed.filter((id) => !spawned.some((b) => b.id === id)), spawned: spawned.filter((b) => !removedSet.has(b.id)) };
}

export interface Diagnostics {
  kinetic: number;
  potential: number;
  energy: number;
  momentumX: number;
  momentumZ: number;
  /** z-component of total angular momentum about the origin (motion is in the XZ plane). */
  angularMomentum: number;
  /** Σ m·|v|: the size momentum changes are measured against. */
  momentumScale: number;
  /** Σ m·|r × v|: the size angular-momentum changes are measured against. */
  angularMomentumScale: number;
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
  let momentumScale = 0;
  let angularMomentumScale = 0;
  for (let i = 0; i < count; i++) {
    if (!sys.pinned[i]) {
      kinetic += 0.5 * mass[i] * (vx[i] * vx[i] + vz[i] * vz[i]);
      momentumX += mass[i] * vx[i];
      momentumZ += mass[i] * vz[i];
      // L_y for motion in the XZ plane: m·(z·vx − x·vz)
      const l = mass[i] * (pz[i] * vx[i] - px[i] * vz[i]);
      angularMomentum += l;
      momentumScale += mass[i] * Math.hypot(vx[i], vz[i]);
      angularMomentumScale += Math.abs(l);
    }
    for (let j = i + 1; j < count; j++) {
      const r = Math.hypot(px[j] - px[i], pz[j] - pz[i]);
      const k = effectiveG * mass[i] * mass[j];
      potential -= (k / eps) * (Math.PI / 2 - Math.atan(r / eps));
    }
  }
  return {
    kinetic,
    potential,
    energy: kinetic + potential,
    momentumX,
    momentumZ,
    angularMomentum,
    momentumScale,
    angularMomentumScale,
  };
}
