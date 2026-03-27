import React, { useRef, useState, useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { CelestialBody } from './SpaceScene';

// ─────────────────────────────────────────────────────────────────────────────
// Physics constants
// ─────────────────────────────────────────────────────────────────────────────
export const REAL_G            = 6.674e-11;   // SI gravitational constant
export const ARCADE_G          = 0.5;          // Arcade-mode tuned constant
// Tuned so G_eff * M_sun ≈ 10 at scene scale → circular orbit speed ≈ 1 scene-unit/s at r=10.
// Old value (1.2e20) produced accelerations of ~10^38 scene/s² — a body flew 10^33 units in one substep.
const REAL_GRAVITY_BOOST       = 7.5e-20;
const SOFTENING_SQ             = 0.64;         // ε²=0.64 (ε≈0.8) — avoids singularity and smooths close-range impulses
const SPEED_OF_LIGHT           = 299_792_458;
const SCHWARZSCHILD_SCENE_SCALE = 1e-8;
const MAX_TRAIL_POINTS         = 200;
const MAX_HISTORY              = 3600;         // ~60 s rewind at 60 fps
const MIN_SPAWN_DIST           = 0.01;
const MAX_SIM_BODIES           = 180;
const FIXED_SUBSTEP            = 1 / 120;     // Physics substep (s)
const MAX_SUBSTEPS             = 8;
const CLOSE_APPROACH_FACTOR    = 3.0;

// ─────────────────────────────────────────────────────────────────────────────
// Internal types
// ─────────────────────────────────────────────────────────────────────────────
interface PhysicsBody {
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

type BodyType = 'star' | 'planet' | 'asteroid' | 'blackhole' | 'neutron' | 'comet' | string;

interface WorldSnapshot {
  id: string;
  px: number; py: number; pz: number;
  vx: number; vy: number; vz: number;
}

interface MeshEntry {
  groupRef:  React.MutableRefObject<THREE.Group | null>;
  meshRef:   React.MutableRefObject<THREE.Mesh | null>;
  glowRef:   React.MutableRefObject<THREE.Mesh | null>;
  trailLine: THREE.Line;
  trailAttr: THREE.BufferAttribute;
}

export interface PhysicsSimulatorProps {
  bodies: CelestialBody[];
  timeScale: number;
  realisticMode?: boolean;
  onBodyRemoved: (id: string) => void;
  onBodyUpdated: (id: string, mass: number, radius: number) => void;
  livePhysicsRef: React.MutableRefObject<Array<{ position: [number, number, number]; mass: number }>>;
  universeScale?: number;
  gridSize?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure physics helpers — no type rules, all behaviour from mass/distance/velocity
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Spawn-time circular orbit velocity around the most massive body present.
 * v_circ = sqrt(G·M / r). No artificial speed cap — let physics run.
 */
function spawnOrbitalVelocity(
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
  let tangent   = new THREE.Vector3(-radial.z, 0, radial.x);
  if (tangent.lengthSq() < 1e-10) tangent.set(1, 0, 0);
  return tangent.normalize().multiplyScalar(speed);
}

/**
 * Event horizon radius in scene units. Uses Schwarzschild formula scaled to scene,
 * floored at the visual mesh radius so absorption aligns with what the player sees.
 */
function bhEventHorizon(bh: PhysicsBody): number {
  const rsMeters = (2 * REAL_G * bh.mass) / (SPEED_OF_LIGHT * SPEED_OF_LIGHT);
  return Math.max(bh.radius, rsMeters * SCHWARZSCHILD_SCENE_SCALE);
}

/**
 * Hill sphere radius of `b` relative to its nearest more-massive neighbour.
 * r_Hill = a · cbrt(m / 3M). Returns Infinity when `b` is the dominant body.
 */
function hillSphereRadius(b: PhysicsBody, bods: PhysicsBody[]): number {
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
function dominantBodyIndex(bodyIdx: number, bods: PhysicsBody[]): number {
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
function adaptiveDt(baseDt: number, bods: PhysicsBody[]): number {
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

// ─────────────────────────────────────────────────────────────────────────────
// BodyRenderer — visual-only, writes nothing to physics state
// ─────────────────────────────────────────────────────────────────────────────
interface BodyRendererProps {
  body:           CelestialBody;
  meshEntriesRef: React.MutableRefObject<Map<string, MeshEntry>>;
}

const BodyRenderer: React.FC<BodyRendererProps> = ({ body, meshEntriesRef }) => {
  const groupRef = useRef<THREE.Group | null>(null);
  const meshRef  = useRef<THREE.Mesh  | null>(null);
  const glowRef  = useRef<THREE.Mesh  | null>(null);

  const { trailLine, trailAttr } = useMemo(() => {
    const geo  = new THREE.BufferGeometry();
    const data = new Float32Array(MAX_TRAIL_POINTS * 3);
    const attr = new THREE.BufferAttribute(data, 3);
    geo.setAttribute('position', attr);
    geo.setDrawRange(0, 0);
    const mat = new THREE.LineBasicMaterial({ color: body.color, transparent: true, opacity: 0.35 });
    return { trailLine: new THREE.Line(geo, mat), trailAttr: attr };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    meshEntriesRef.current.set(body.id, { groupRef, meshRef, glowRef, trailLine, trailAttr });
    return () => { meshEntriesRef.current.delete(body.id); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body.id]);

  const glowColor        = useMemo(() => new THREE.Color(body.color), [body.color]);
  const isBlackHole      = body.type === 'blackhole';
  const emissiveIntensity = body.type === 'star' ? 2 : isBlackHole ? 0.1 : 0.5;

  return (
    <>
      <primitive object={trailLine} />
      <group ref={groupRef} position={body.position}>
        <mesh ref={meshRef} scale={body.radius}>
          <sphereGeometry args={[1, 32, 32]} />
          <meshStandardMaterial
            color={isBlackHole ? '#000000' : body.color}
            emissive={body.color}
            emissiveIntensity={emissiveIntensity}
            roughness={0.3}
            metalness={0.7}
          />
        </mesh>
        {!isBlackHole && (
          <mesh ref={glowRef} scale={body.radius * 1.8}>
            <sphereGeometry args={[1, 16, 16]} />
            <meshBasicMaterial color={glowColor} transparent opacity={0.08} side={THREE.BackSide} />
          </mesh>
        )}
        {isBlackHole && (
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <ringGeometry args={[1.5, 3, 64]} />
            <meshBasicMaterial color="#ff6600" transparent opacity={0.4} side={THREE.DoubleSide} />
          </mesh>
        )}
      </group>
    </>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// PhysicsSimulator
// ─────────────────────────────────────────────────────────────────────────────
const PhysicsSimulator: React.FC<PhysicsSimulatorProps> = ({
  bodies,
  timeScale,
  realisticMode = true,
  onBodyRemoved,
  onBodyUpdated,
  livePhysicsRef,
  universeScale = 1,
  gridSize = 120,
}) => {
  const physicsRef     = useRef<PhysicsBody[]>([]);
  const meshEntriesRef = useRef(new Map<string, MeshEntry>());
  const historyRef     = useRef<WorldSnapshot[][]>([]);
  const accumRef       = useRef(0);
  const [renderList, setRenderList] = useState<CelestialBody[]>([]);

  // ── Sync incoming React bodies → physicsRef ──────────────────────────────
  useEffect(() => {
    const effectiveG  = realisticMode ? REAL_G * REAL_GRAVITY_BOOST : ARCADE_G;
    const currentIds  = new Set(physicsRef.current.map(b => b.id));
    const incomingIds = new Set(bodies.map(b => b.id));

    for (const body of bodies) {
      if (currentIds.has(body.id)) continue;
      const pos         = new THREE.Vector3(...body.position);
      const providedVel = new THREE.Vector3(...(body.velocity ?? [0, 0, 0]));
      const vel         = providedVel.lengthSq() > 1e-12
        ? providedVel.clone()
        : spawnOrbitalVelocity(pos, physicsRef.current, effectiveG);

      physicsRef.current.push({
        id:             body.id,
        position:       pos.clone(),
        velocity:       vel,
        force:          new THREE.Vector3(),
        mass:           body.mass,
        radius:         body.radius,
        type:           body.type as BodyType,
        color:          body.color,
        trailData:      new Float32Array(MAX_TRAIL_POINTS * 3),
        trailHead:      0,
        trailLen:       0,
        motionState:    'bound',
        isCloseApproach: false,
      });
    }

    physicsRef.current = physicsRef.current.filter(b => incomingIds.has(b.id));
    for (const id of currentIds) {
      if (!incomingIds.has(id)) meshEntriesRef.current.delete(id);
    }
    setRenderList([...bodies]);
  }, [bodies, realisticMode]);

  // ── Layer 1: Force accumulation ───────────────────────────────────────────
  // F = G·m₁·m₂ / (r² + ε²)  applied to ALL pairs — same law for all types.
  const accumulateForces = (bods: PhysicsBody[], effectiveG: number) => {
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
  const integrate = (bods: PhysicsBody[], effectiveG: number, dt: number) => {
    // Stage 1: compute a(t)
    accumulateForces(bods, effectiveG);
    const aOld = new Map<string, THREE.Vector3>();
    for (const b of bods) {
      aOld.set(b.id, b.force.clone().multiplyScalar(1 / b.mass));
    }

    // Stage 2: advance positions
    for (const b of bods) {
      const a = aOld.get(b.id)!;
      b.position.addScaledVector(b.velocity, dt);
      b.position.addScaledVector(a, 0.5 * dt * dt);
      b.position.y = 0; // keep simulation on XZ plane
    }

    // Stage 3: recompute a(t+dt) at new positions
    accumulateForces(bods, effectiveG);

    // Stage 4: update velocities with averaged acceleration — no mutation of aOld
    for (const b of bods) {
      const a0 = aOld.get(b.id)!;
      const a1 = b.force.clone().multiplyScalar(1 / b.mass);
      const avgAcc = a0.clone().add(a1).multiplyScalar(0.5);
      b.velocity.addScaledVector(avgAcc, dt);
      b.velocity.y = 0;
    }
  };

  // ── Layer 3: Event detection & resolution (post-integration) ─────────────
  // Events are DETECTED here, never forced into the integration loop.
  const detectEvents = (
    bods:       PhysicsBody[],
    effectiveG: number,
    toRemove:   Set<string>,
  ) => {
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
          survivor.velocity.copy(newVel);
          survivor.position.copy(newPos);
          survivor.radius = Math.cbrt(rSurv ** 3 + absorbed.radius ** 3);
          survivor.mass   = mT;
          toRemove.add(absorbed.id);
        }
      }
    }
  };

  // ── Layer 4: Energy-based bound/escape classification ─────────────────────
  // E = ½·m·v_rel² − G·M·m/r   relative to the dominant body (Hill-sphere based).
  // E < 0  → gravitationally bound  (orbit, elliptical/circular)
  // E ≥ 0  → escaping or flyby (hyperbolic)
  const classifyMotion = (bods: PhysicsBody[], effectiveG: number, toRemove: Set<string>) => {
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

  // ── Layer 5: Mesh sync (bypasses React re-render every frame) ────────────
  const syncMeshes = (bods: PhysicsBody[], toRemove: Set<string>) => {
    for (const body of bods) {
      if (toRemove.has(body.id)) continue;

      // Write position to ring-buffer trail (pre-allocated — no GC pressure)
      const idx = body.trailHead * 3;
      body.trailData[idx]     = body.position.x;
      body.trailData[idx + 1] = 0;
      body.trailData[idx + 2] = body.position.z;
      body.trailHead = (body.trailHead + 1) % MAX_TRAIL_POINTS;
      body.trailLen  = Math.min(body.trailLen + 1, MAX_TRAIL_POINTS);

      const entry = meshEntriesRef.current.get(body.id);
      if (!entry) continue;

      entry.groupRef.current?.position.copy(body.position);

      if (entry.meshRef.current)
        entry.meshRef.current.scale.setScalar(body.radius);

      if (entry.glowRef.current) {
        entry.glowRef.current.scale.setScalar(body.radius * 1.8);
        const mat = entry.glowRef.current.material as THREE.MeshBasicMaterial;
        if (mat) mat.opacity = body.motionState === 'escaping' ? 0.18 : 0.08;
      }

      // Unroll ring-buffer into the LineGeometry attribute in correct order
      const arr  = entry.trailAttr.array as Float32Array;
      const len  = body.trailLen;
      const head = body.trailHead;
      for (let k = 0; k < len; k++) {
        const src = ((head - len + k + MAX_TRAIL_POINTS) % MAX_TRAIL_POINTS) * 3;
        const dst = k * 3;
        arr[dst]     = body.trailData[src];
        arr[dst + 1] = body.trailData[src + 1];
        arr[dst + 2] = body.trailData[src + 2];
      }
      entry.trailAttr.needsUpdate = true;
      entry.trailLine.geometry.setDrawRange(0, len);
    }
  };

  // ── Master physics step ───────────────────────────────────────────────────
  const stepPhysics = (bods: PhysicsBody[], dt: number) => {
    const effectiveG = realisticMode ? REAL_G * REAL_GRAVITY_BOOST : ARCADE_G;
    const toRemove   = new Set<string>();

    // Snapshot for time-rewind
    historyRef.current.push(bods.map(b => ({
      id: b.id,
      px: b.position.x, py: b.position.y, pz: b.position.z,
      vx: b.velocity.x, vy: b.velocity.y, vz: b.velocity.z,
    })));
    if (historyRef.current.length > MAX_HISTORY) historyRef.current.shift();

    // 1. Integrate motion — forces → positions & velocities
    integrate(bods, effectiveG, dt);

    // 2. Detect & resolve events (collisions, absorptions) — post-integration
    detectEvents(bods, effectiveG, toRemove);

    // 3. Classify each body's orbital state using mechanical energy
    classifyMotion(bods, effectiveG, toRemove);

    // 4. Sync Three.js meshes and trails
    syncMeshes(bods, toRemove);

    // 5. Remove absorbed bodies from physics and React state
    if (toRemove.size > 0) {
      physicsRef.current = physicsRef.current.filter(b => !toRemove.has(b.id));
      for (const id of toRemove) meshEntriesRef.current.delete(id);
      setRenderList(prev => prev.filter(b => !toRemove.has(b.id)));
      toRemove.forEach(id => onBodyRemoved(id));
      // Notify parent of mass/radius changes on survivors (e.g. after absorbing mass)
      for (const body of physicsRef.current) {
        const orig = bodies.find(b => b.id === body.id);
        if (orig && (orig.mass !== body.mass || orig.radius !== body.radius)) {
          onBodyUpdated(body.id, body.mass, body.radius);
        }
      }
    }

    // 6. Publish live positions for SpacetimeGrid deformation
    livePhysicsRef.current = physicsRef.current.map(b => ({
      position: [b.position.x, 0, b.position.z] as [number, number, number],
      mass:     b.mass,
    }));
  };

  // ── Frame loop ────────────────────────────────────────────────────────────
  useFrame((_, delta) => {
    if (timeScale === 0) return;
    const bods = physicsRef.current.slice(0, MAX_SIM_BODIES);

    // Rewind: restore from history buffer, no integration
    if (timeScale < 0) {
      const steps = Math.max(1, Math.round(Math.abs(timeScale)));
      for (let s = 0; s < steps; s++) {
        const snap = historyRef.current.pop();
        if (!snap) break;
        for (const entry of snap) {
          const b = bods.find(x => x.id === entry.id);
          if (b) {
            b.position.set(entry.px, entry.py, entry.pz);
            b.velocity.set(entry.vx, entry.vy, entry.vz);
          }
        }
      }
      for (const body of bods) {
        const e = meshEntriesRef.current.get(body.id);
        if (e?.groupRef.current) e.groupRef.current.position.copy(body.position);
      }
      livePhysicsRef.current = physicsRef.current.map(b => ({
        position: [b.position.x, 0, b.position.z] as [number, number, number],
        mass: b.mass,
      }));
      return;
    }

    // Forward: fixed-step accumulator for frame-rate-independent simulation
    const frameDt = Math.min(delta * timeScale, 0.1);
    accumRef.current += frameDt;

    let steps = 0;
    while (accumRef.current >= FIXED_SUBSTEP && steps < MAX_SUBSTEPS) {
      const dt = adaptiveDt(FIXED_SUBSTEP, bods);
      stepPhysics(bods, dt);
      accumRef.current -= FIXED_SUBSTEP;
      steps++;
    }
    // Drain remainder if no full substep fired (e.g. first frame)
    if (steps === 0 && accumRef.current > 0) {
      const dt = adaptiveDt(accumRef.current, bods);
      stepPhysics(bods, dt);
      accumRef.current = 0;
    }
  });

  return (
    <>
      {renderList.map(body => (
        <BodyRenderer key={body.id} body={body} meshEntriesRef={meshEntriesRef} />
      ))}
    </>
  );
};

export default PhysicsSimulator;
