import * as THREE from 'three';

/**
 * N-body gravity for the Spacetime Lab, as pure functions over PhysicsBody
 * records. Moved verbatim from PhysicsSimulator.tsx so the live simulation,
 * the orbit predictor and the tests all run exactly the same maths.
 */

/** A collision or absorption detected during a step. */
export interface SimImpact {
  id: string;
  title: string;
  detail: string;
  position: [number, number, number];
}

// ─────────────────────────────────────────────────────────────────────────────
// Physics constants
// ─────────────────────────────────────────────────────────────────────────────
export const REAL_G            = 6.674e-11;   // SI gravitational constant
export const ARCADE_G          = 0.5;          // Arcade-mode tuned constant
// Tuned so G_eff * M_sun ≈ 10 at scene scale → circular orbit speed ≈ 1 scene-unit/s at r=10.
// Old value (1.2e20) produced accelerations of ~10^38 scene/s² — a body flew 10^33 units in one substep.
export const REAL_GRAVITY_BOOST       = 7.5e-20;
export const SOFTENING_SQ             = 0.64;         // ε²=0.64 (ε≈0.8) — avoids singularity and smooths close-range impulses
export const SPEED_OF_LIGHT           = 299_792_458;
export const SCHWARZSCHILD_SCENE_SCALE = 1e-8;
export const MAX_HISTORY              = 3600;         // ~60 s rewind at 60 fps
export const MIN_SPAWN_DIST           = 0.01;
export const MAX_SIM_BODIES           = 180;
export const FIXED_SUBSTEP            = 1 / 120;     // Physics substep (s)
export const MAX_SUBSTEPS             = 8;
export const CLOSE_APPROACH_FACTOR    = 3.0;

// ─────────────────────────────────────────────────────────────────────────────
// Internal types
// ─────────────────────────────────────────────────────────────────────────────
export interface PhysicsBody {
  id:       string;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  force:    THREE.Vector3;    // accumulated per step, reset each step
  mass:     number;
  radius:   number;
  type:     string;
  color:    string;
  // Pre-allocated ring-buffer trail [x,0,z, x,0,z, …]
  trailData: Float32Array;
  trailHead: number;          // write index into trailData (in units of 3 floats)
  trailLen:  number;          // how many valid points are stored (max MAX_TRAIL_POINTS)
  motionState:     'bound' | 'escaping' | 'captured';
  isCloseApproach: boolean;
}

export type BodyType = 'star' | 'planet' | 'asteroid' | 'blackhole' | 'neutron' | 'comet' | string;


// ─────────────────────────────────────────────────────────────────────────────
// Pure physics helpers — no type rules, all behaviour from mass/distance/velocity
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Spawn-time circular orbit velocity around the most massive body present.
 * v_circ = sqrt(G·M / r). No artificial speed cap — let physics run.
 */
export function spawnOrbitalVelocity(
  spawnPos:   THREE.Vector3,
  bods:       PhysicsBody[],
  effectiveG: number,
): THREE.Vector3 {
  if (bods.length === 0) return new THREE.Vector3();
  const attractor = bods.reduce((best, b) => (b.mass > best.mass ? b : best));
  const rel  = spawnPos.clone().sub(attractor.position);
  const dist = rel.length();
  if (dist < MIN_SPAWN_DIST) return new THREE.Vector3();
  const speed   = Math.sqrt(effectiveG * attractor.mass / dist);
  const radial  = rel.clone().normalize();
  const tangent = new THREE.Vector3(-radial.z, 0, radial.x);
  if (tangent.lengthSq() < 1e-10) tangent.set(1, 0, 0);
  return tangent.normalize().multiplyScalar(speed);
}

/**
 * Event horizon radius in scene units. Uses Schwarzschild formula scaled to scene,
 * floored at the visual mesh radius so absorption aligns with what the player sees.
 */
export function bhEventHorizon(bh: PhysicsBody): number {
  const rsMeters = (2 * REAL_G * bh.mass) / (SPEED_OF_LIGHT * SPEED_OF_LIGHT);
  return Math.max(bh.radius, rsMeters * SCHWARZSCHILD_SCENE_SCALE);
}

/**
 * Hill sphere radius of `b` relative to its nearest more-massive neighbour.
 * r_Hill = a · cbrt(m / 3M). Returns Infinity when `b` is the dominant body.
 */
export function hillSphereRadius(b: PhysicsBody, bods: PhysicsBody[]): number {
  let parentDist = Infinity;
  let parentMass = 0;
  for (const other of bods) {
    if (other === b || other.mass <= b.mass) continue;
    const d = b.position.distanceTo(other.position);
    if (d < parentDist) { parentDist = d; parentMass = other.mass; }
  }
  if (parentMass === 0) return Infinity;
  return parentDist * Math.cbrt(b.mass / (3 * parentMass));
}

/**
 * Dominant body index for body at `bodyIdx`.
 * Prefers the body whose Hill sphere contains `body` AND has the highest
 * gravitational influence score (M / d²). Falls back to pure M/d² if none.
 * Used only for energy classification — does NOT force or change motion.
 */
export function dominantBodyIndex(bodyIdx: number, bods: PhysicsBody[]): number {
  const body = bods[bodyIdx];
  let bestIdx = -1, bestScore = -Infinity;

  // Pass 1 — Hill-sphere candidates only.
  for (let i = 0; i < bods.length; i++) {
    if (i === bodyIdx) continue;
    const cand  = bods[i];
    const d     = Math.max(body.position.distanceTo(cand.position), 1e-6);
    const hR    = hillSphereRadius(cand, bods);
    const score = cand.mass / (d * d);
    if (d <= hR && score > bestScore) { bestScore = score; bestIdx = i; }
  }

  // Pass 2 — fallback: no Hill-sphere candidate, pick strongest pull.
  if (bestIdx < 0) {
    for (let i = 0; i < bods.length; i++) {
      if (i === bodyIdx) continue;
      const d     = Math.max(body.position.distanceTo(bods[i].position), 1e-6);
      const score = bods[i].mass / (d * d);
      if (score > bestScore) { bestScore = score; bestIdx = i; }
    }
  }
  return bestIdx;
}

/**
 * Adaptive timestep: shortens when bodies are close to prevent numerical blow-up.
 */
export function midpointBetween(a: THREE.Vector3, b: THREE.Vector3): [number, number, number] {
  return [(a.x + b.x) * 0.5, 0.75, (a.z + b.z) * 0.5];
}

export function describeMergeImpact(a: PhysicsBody, b: PhysicsBody): { title: string; detail: string } {
  const ta = a.type;
  const tb = b.type;
  const has = (t: string) => ta === t || tb === t;
  const both = (t: string, u: string) => (ta === t && tb === u) || (ta === u && tb === t);

  if (has('blackhole')) {
    return { title: 'Black hole interaction', detail: 'Extreme gravity dominated this encounter.' };
  }
  if (both('star', 'star')) {
    return {
      title: 'Stellar merger',
      detail: 'Two stars collided and fused; mass and momentum combined into one body.',
    };
  }
  if (has('star') && (has('planet') || has('asteroid') || has('comet'))) {
    return {
      title: 'Stellar collision',
      detail: 'A star-scale body swept up a smaller object in a high-energy impact.',
    };
  }
  if (both('planet', 'planet')) {
    return {
      title: 'Planetary collision',
      detail: 'Two worlds merged; material mixed into a single larger planet.',
    };
  }
  if (has('neutron')) {
    return {
      title: 'Neutron-star impact',
      detail: 'Ultra-dense matter collided; the survivor carries enormous binding energy.',
    };
  }
  if (has('asteroid') || has('comet')) {
    return {
      title: 'Minor body impact',
      detail: 'A small body hit a larger one and stuck — accretion in one stroke.',
    };
  }
  return {
    title: 'Gravitational merger',
    detail: 'Two bodies collided and coalesced; linear momentum was conserved.',
  };
}

export function describeBlackHoleImpact(_bh: PhysicsBody, other: PhysicsBody): { title: string; detail: string } {
  if (other.type === 'star') {
    return {
      title: 'Event horizon crossing',
      detail: 'Stellar material crossed the point of no return and joined the black hole.',
    };
  }
  if (other.type === 'planet') {
    return {
      title: 'Tidal capture',
      detail: 'A planet was pulled past the horizon; only the black hole remains visible.',
    };
  }
  return {
    title: 'Horizon crossing',
    detail: 'A small body crossed the event horizon — gravity wins over all other forces.',
  };
}

export function adaptiveDt(baseDt: number, bods: PhysicsBody[]): number {
  if (bods.length < 2) return baseDt;
  let minDist = Infinity;
  for (let i = 0; i < bods.length; i++) {
    for (let j = i + 1; j < bods.length; j++) {
      const d = bods[i].position.distanceTo(bods[j].position);
      if (d < minDist) minDist = d;
    }
  }
  if (!Number.isFinite(minDist)) return baseDt;
  const factor = Math.min(1, Math.max(0.1, minDist / 4.0));
  return Math.max(1e-5, baseDt * factor);
}

export function isStaticBody(body: PhysicsBody): boolean {
  return body.type === 'blackhole';
}

// ── Layer 1: Force accumulation ───────────────────────────────────────────
// F = G·m₁·m₂ / (r² + ε²)  applied to ALL pairs — same law for all types.
export const accumulateForces = (bods: PhysicsBody[], effectiveG: number) => {
  for (const b of bods) b.force.set(0, 0, 0);
  for (let i = 0; i < bods.length; i++) {
    for (let j = i + 1; j < bods.length; j++) {
      const a    = bods[i];
      const b    = bods[j];
      const diff = b.position.clone().sub(a.position);
      const rSqSoft  = diff.lengthSq() + SOFTENING_SQ;
      const forceMag = effectiveG * a.mass * b.mass / rSqSoft;
      const fv       = diff.normalize().multiplyScalar(forceMag);
      a.force.add(fv);
      b.force.sub(fv);
    }
  }
};

// ── Layer 2: Velocity Verlet integration ──────────────────────────────────
// x(t+dt) = x + v·dt + ½·a·dt²
// a_new   = recompute forces at x(t+dt)
// v(t+dt) = v + ½·(a_old + a_new)·dt
export const integrate = (bods: PhysicsBody[], effectiveG: number, dt: number) => {
  // Stage 1: compute a(t)
  accumulateForces(bods, effectiveG);
  const aOld = new Map<string, THREE.Vector3>();
  for (const b of bods) {
    aOld.set(
      b.id,
      isStaticBody(b) ? new THREE.Vector3() : b.force.clone().multiplyScalar(1 / b.mass),
    );
  }

  // Stage 2: advance positions
  for (const b of bods) {
    if (isStaticBody(b)) {
      b.velocity.set(0, 0, 0);
      b.force.set(0, 0, 0);
      continue;
    }
    const a = aOld.get(b.id)!;
    b.position.addScaledVector(b.velocity, dt);
    b.position.addScaledVector(a, 0.5 * dt * dt);
    b.position.y = 0; // keep simulation on XZ plane
  }

  // Stage 3: recompute a(t+dt) at new positions
  accumulateForces(bods, effectiveG);

  // Stage 4: update velocities with averaged acceleration — no mutation of aOld
  for (const b of bods) {
    if (isStaticBody(b)) {
      b.velocity.set(0, 0, 0);
      b.force.set(0, 0, 0);
      continue;
    }
    const a0 = aOld.get(b.id)!;
    const a1 = b.force.clone().multiplyScalar(1 / b.mass);
    const avgAcc = a0.clone().add(a1).multiplyScalar(0.5);
    b.velocity.addScaledVector(avgAcc, dt);
    b.velocity.y = 0;
  }
};

// ── Layer 3: Event detection & resolution (post-integration) ─────────────
// Events are DETECTED here, never forced into the integration loop.
export const detectEvents = (
  bods:       PhysicsBody[],
  _effectiveG: number,
  toRemove:   Set<string>,
): SimImpact[] => {
  const impacts: SimImpact[] = [];
  let impactSeq = 0;
  const nextId = () => `impact-${Date.now()}-${impactSeq++}`;

  // Reset close-approach flags
  for (const b of bods) b.isCloseApproach = false;

  for (let i = 0; i < bods.length; i++) {
    for (let j = i + 1; j < bods.length; j++) {
      const a = bods[i];
      const b = bods[j];
      if (toRemove.has(a.id) || toRemove.has(b.id)) continue;

      const dist = a.position.distanceTo(b.position);

      // ── Close approach detection (flyby / slingshot zone) ──
      if (dist < (a.radius + b.radius) * CLOSE_APPROACH_FACTOR) {
        a.isCloseApproach = true;
        b.isCloseApproach = true;
      }

      // ── Black hole absorption ──────────────────────────────
      // Black hole is always treated as extremely massive. Any other body
      // crossing its event horizon (or visually overlapping) is absorbed.
      // The black hole NEVER disappears here.
      if (a.type === 'blackhole' || b.type === 'blackhole') {
        const bh    = a.type === 'blackhole' ? a : b;
        const other = bh === a ? b : a;
        const horizon = bhEventHorizon(bh);
        if (dist < horizon || dist < bh.radius + other.radius) {
          const { title, detail } = describeBlackHoleImpact(bh, other);
          impacts.push({
            id: nextId(),
            title,
            detail,
            position: midpointBetween(bh.position, other.position),
          });
          bh.mass    += other.mass;
          bh.radius   = Math.cbrt(bh.radius ** 3 + other.radius ** 3);
          other.motionState = 'captured';
          toRemove.add(other.id);
        }
        continue; // handled — skip generic collision below
      }

      // ── General collision: merge with conservation laws ────
      // Outcome depends on mass ratio and relative velocity — same rule for all.
      if (dist < a.radius + b.radius) {
        const { title, detail } = describeMergeImpact(a, b);
        impacts.push({
          id: nextId(),
          title,
          detail,
          position: midpointBetween(a.position, b.position),
        });

        const [survivor, absorbed] = a.mass >= b.mass ? [a, b] : [b, a];
        const mS  = survivor.mass;
        const mA  = absorbed.mass;
        const mT  = mS + mA;

        // Momentum conservation: v_new = (m1·v1 + m2·v2) / (m1+m2)
        const newVel = survivor.velocity.clone().multiplyScalar(mS)
          .addScaledVector(absorbed.velocity, mA)
          .divideScalar(mT);

        // Centre of mass position
        const newPos = survivor.position.clone().multiplyScalar(mS)
          .addScaledVector(absorbed.position, mA)
          .divideScalar(mT);

        // Volume-conserving radius: r_new = cbrt(r1³ + r2³)
        const rSurv = survivor.radius;
        if (isStaticBody(survivor)) {
          survivor.velocity.set(0, 0, 0);
        } else {
          survivor.velocity.copy(newVel);
          survivor.position.copy(newPos);
        }
        survivor.radius = Math.cbrt(rSurv ** 3 + absorbed.radius ** 3);
        survivor.mass   = mT;
        toRemove.add(absorbed.id);
      }
    }
  }
  return impacts;
};

// ── Layer 4: Energy-based bound/escape classification ─────────────────────
// E = ½·m·v_rel² − G·M·m/r   relative to the dominant body (Hill-sphere based).
// E < 0  → gravitationally bound  (orbit, elliptical/circular)
// E ≥ 0  → escaping or flyby (hyperbolic)
export const classifyMotion = (bods: PhysicsBody[], effectiveG: number, toRemove: Set<string>) => {
  for (let i = 0; i < bods.length; i++) {
    const body = bods[i];
    if (toRemove.has(body.id) || body.motionState === 'captured') continue;

    const domIdx = dominantBodyIndex(i, bods);
    if (domIdx < 0) { body.motionState = 'bound'; continue; }

    const dom    = bods[domIdx];
    const relPos = body.position.clone().sub(dom.position);
    const relVel = body.velocity.clone().sub(dom.velocity);
    const r      = Math.max(relPos.length(), 1e-6);
    const v      = relVel.length();

    // Total mechanical energy in the two-body frame
    const energy = 0.5 * body.mass * v * v - (effectiveG * dom.mass * body.mass) / r;
    const vEsc   = Math.sqrt(2 * effectiveG * dom.mass / r);

    body.motionState = (energy < 0 && v < vEsc) ? 'bound' : 'escaping';
  }
};

/** Gravitational constant in scene units for the chosen gravity model. */
export const effectiveGravity = (realisticMode: boolean) =>
  (realisticMode ? REAL_G * REAL_GRAVITY_BOOST : ARCADE_G);

/**
 * One full simulation step: integrate, then resolve collisions, then classify
 * each body as bound or escaping. Mutates `bods`; returns what happened.
 */
export const stepWorld = (bods: PhysicsBody[], effectiveG: number, dt: number) => {
  const removed = new Set<string>();
  integrate(bods, effectiveG, dt);
  const impacts = detectEvents(bods, effectiveG, removed);
  classifyMotion(bods, effectiveG, removed);
  return { impacts, removed };
};
