import React, { useRef, useState, useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { CelestialBody } from './SpaceScene';

// ── Physics Constants ──────────────────────────────────────────────────────
export const G = 0.5;               // Gravitational constant (gameplay-tuned)
const SOFTENING_SQ = 0.25;          // ε² prevents singularity as r → 0
const HEAVY_MASS_THRESHOLD = 7;     // mass ≥ this → "star-class", repels other heavy bodies
const MAX_TRAIL_POINTS = 100;
const MAX_HISTORY = 3600;           // ~60 s of rewind at 60 fps

// ── Internal Types ─────────────────────────────────────────────────────────
interface PhysicsBody {
  id: string;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  force: THREE.Vector3;             // accumulated each frame, reset per frame
  mass: number;
  radius: number;
  type: string;
  color: string;
  trailPositions: number[];         // flat [x,y,z, x,y,z, ...] buffer
}

interface WorldSnapshot {
  id: string;
  px: number; py: number; pz: number;
  vx: number; vy: number; vz: number;
}

interface MeshEntry {
  groupRef: React.MutableRefObject<THREE.Group | null>;
  meshRef: React.MutableRefObject<THREE.Mesh | null>;
  glowRef: React.MutableRefObject<THREE.Mesh | null>;
  trailLine: THREE.Line;
  trailAttr: THREE.BufferAttribute;
}

export interface PhysicsSimulatorProps {
  bodies: CelestialBody[];
  timeScale: number;
  onBodyRemoved: (id: string) => void;
  onBodyUpdated: (id: string, mass: number, radius: number) => void;
  livePhysicsRef: React.MutableRefObject<Array<{ position: [number, number, number]; mass: number }>>;
  universeScale?: number;
  gridSize?: number;
}

// ── Orbital velocity helper ────────────────────────────────────────────────
function computeOrbitalVelocity(newPos: THREE.Vector3, physicsBodies: PhysicsBody[]): THREE.Vector3 {
  if (physicsBodies.length === 0) return new THREE.Vector3();

  // Find the most massive body (the "Attractor")
  const attractor = physicsBodies.reduce((best, b) => (b.mass > best.mass ? b : best));

  const R = newPos.clone().sub(attractor.position);
  const dist = R.length();
  if (dist < 0.01) return new THREE.Vector3();

  // Circular orbit speed: v = sqrt(G * M / r)
  const speed = Math.sqrt(G * attractor.mass / dist);

  // Tangent: normalize(R) × UP  →  [nx,0,nz] × [0,1,0] = [-nz, 0, nx]
  const nx = R.x / dist;
  const nz = R.z / dist;
  return new THREE.Vector3(-nz, 0, nx).multiplyScalar(speed);
}

// ── Per-body visual renderer ───────────────────────────────────────────────
interface BodyRendererProps {
  body: CelestialBody;
  meshEntriesRef: React.MutableRefObject<Map<string, MeshEntry>>;
}

const BodyRenderer: React.FC<BodyRendererProps> = ({ body, meshEntriesRef }) => {
  const groupRef = useRef<THREE.Group | null>(null);
  const meshRef  = useRef<THREE.Mesh | null>(null);
  const glowRef  = useRef<THREE.Mesh | null>(null);

  // Build trail geometry once on mount
  const { trailLine, trailAttr } = useMemo(() => {
    const geo  = new THREE.BufferGeometry();
    const data = new Float32Array(MAX_TRAIL_POINTS * 3);
    const attr = new THREE.BufferAttribute(data, 3);
    geo.setAttribute('position', attr);
    geo.setDrawRange(0, 0);
    const mat  = new THREE.LineBasicMaterial({ color: body.color, transparent: true, opacity: 0.3 });
    return { trailLine: new THREE.Line(geo, mat), trailAttr: attr };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Register this body's mesh entries so the physics loop can write to them
  useEffect(() => {
    meshEntriesRef.current.set(body.id, { groupRef, meshRef, glowRef, trailLine, trailAttr });
    return () => { meshEntriesRef.current.delete(body.id); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body.id]);

  const glowColor        = useMemo(() => new THREE.Color(body.color), [body.color]);
  const isBlackHole      = body.type === 'blackhole';
  const emissiveIntensity = body.type === 'star' ? 2 : body.type === 'blackhole' ? 0.1 : 0.5;

  return (
    <>
      {/* Trail lives in world space — outside the moving group */}
      <primitive object={trailLine} />

      {/* Group is repositioned by physics loop each frame */}
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

// ── PhysicsSimulator ───────────────────────────────────────────────────────
const PhysicsSimulator: React.FC<PhysicsSimulatorProps> = ({
  bodies,
  timeScale,
  onBodyRemoved,
  onBodyUpdated,
  livePhysicsRef,
  universeScale = 1,
  gridSize = 120,
}) => {
  // Physics state — never triggers re-render during the hot path
  const physicsRef     = useRef<PhysicsBody[]>([]);
  const meshEntriesRef = useRef(new Map<string, MeshEntry>());
  const historyRef     = useRef<WorldSnapshot[][]>([]);

  // Render state — only updates when bodies are actually added or removed
  const [renderList, setRenderList] = useState<CelestialBody[]>([]);

  // ── Sync bodies prop → physicsRef ──────────────────────────────────────
  useEffect(() => {
    const currentIds  = new Set(physicsRef.current.map(b => b.id));
    const incomingIds = new Set(bodies.map(b => b.id));

    // Add newly arrived bodies with proper orbital velocity
    for (const body of bodies) {
      if (!currentIds.has(body.id)) {
        const pos = new THREE.Vector3(...body.position);

        // Use computed orbital velocity for all bodies except the very first
        // (first body — typically the star — uses its provided velocity)
        const vel = physicsRef.current.length > 0
          ? computeOrbitalVelocity(pos, physicsRef.current)
          : new THREE.Vector3(...(body.velocity ?? [0, 0, 0]));

        physicsRef.current.push({
          id:            body.id,
          position:      pos.clone(),
          velocity:      vel,
          force:         new THREE.Vector3(),
          mass:          body.mass,
          radius:        body.radius,
          type:          body.type,
          color:         body.color,
          trailPositions: [],
        });
      }
    }

    // Remove bodies deleted via the UI
    physicsRef.current = physicsRef.current.filter(b => incomingIds.has(b.id));
    for (const id of currentIds) {
      if (!incomingIds.has(id)) meshEntriesRef.current.delete(id);
    }

    setRenderList([...bodies]);
  }, [bodies]);

  // ── N-body Physics Loop ────────────────────────────────────────────────
  useFrame((_, delta) => {
    if (timeScale === 0) return;

    const bods = physicsRef.current;

    // ── Rewind path ────────────────────────────────────────────────────
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
      // Sync meshes after rewind
      for (const body of bods) {
        const entry = meshEntriesRef.current.get(body.id);
        if (entry?.groupRef.current) entry.groupRef.current.position.copy(body.position);
      }
      return;
    }

    // Clamp dt to prevent instability at very low frame rates
    const dt = Math.min(delta * timeScale, 0.1);

    // ── Save snapshot for time-rewind ─────────────────────────────────
    const snapshot: WorldSnapshot[] = bods.map(b => ({
      id: b.id,
      px: b.position.x, py: b.position.y, pz: b.position.z,
      vx: b.velocity.x, vy: b.velocity.y, vz: b.velocity.z,
    }));
    historyRef.current.push(snapshot);
    if (historyRef.current.length > MAX_HISTORY) historyRef.current.shift();

    // ── A. Reset accumulated forces ──────────────────────────────────
    for (const b of bods) b.force.set(0, 0, 0);

    const toRemove = new Set<string>();

    // ── B. Force accumulation + collision detection ───────────────────
    // O(n²) nested loop — each pair processed once (j starts at i+1)
    for (let i = 0; i < bods.length; i++) {
      for (let j = i + 1; j < bods.length; j++) {
        if (toRemove.has(bods[i].id) || toRemove.has(bods[j].id)) continue;

        const a = bods[i];
        const b = bods[j];

        const diff = b.position.clone().sub(a.position);
        const r    = diff.length();

        // ── Collision & Merging ──────────────────────────────────────
        if (r < a.radius + b.radius) {
          const [survivor, absorbed] = a.mass >= b.mass ? [a, b] : [b, a];
          const totalMass = survivor.mass + absorbed.mass;

          // Conservation of momentum: v_new = (m1*v1 + m2*v2) / (m1+m2)
          survivor.velocity
            .multiplyScalar(survivor.mass)
            .addScaledVector(absorbed.velocity, absorbed.mass)
            .divideScalar(totalMass);

          // Volume-conserving radius: r_new = cbrt(r1³ + r2³)
          survivor.radius = Math.cbrt(
            Math.pow(survivor.radius, 3) + Math.pow(absorbed.radius, 3)
          );
          survivor.mass = totalMass;

          toRemove.add(absorbed.id);
          continue;
        }

        // Softened r² to prevent force blow-up at very close range
        const rSq = Math.max(r * r, SOFTENING_SQ);

        // Anti-gravity: if both bodies are "heavy" (star-class) → repel
        const bothHeavy = a.mass >= HEAVY_MASS_THRESHOLD && b.mass >= HEAVY_MASS_THRESHOLD;
        const forceMag  = G * a.mass * b.mass / rSq;
        const forceVec  = diff.normalize().multiplyScalar(forceMag);

        if (bothHeavy) {
          // Repulsion — invert direction for both
          a.force.sub(forceVec);
          b.force.add(forceVec);
        } else {
          // Attraction — Newton's law
          a.force.add(forceVec);
          b.force.sub(forceVec);
        }
      }
    }

    // ── C. Semi-implicit Euler integration + mesh sync ────────────────
    for (const body of bods) {
      if (toRemove.has(body.id)) continue;

      // a = F / m  →  velocity += a * dt  (update v before x = semi-implicit Euler)
      body.velocity.addScaledVector(body.force, dt / body.mass);

      // position += velocity * dt
      body.position.addScaledVector(body.velocity, dt);

      // Keep simulation on the XZ plane (y = 0)
      body.position.y = 0;
      body.velocity.y = 0;

      // Boundary clamp: wrap at universe edge
      const halfGrid = (gridSize * universeScale) / 2;
      body.position.x = Math.max(-halfGrid, Math.min(halfGrid, body.position.x));
      body.position.z = Math.max(-halfGrid, Math.min(halfGrid, body.position.z));

      // Trail ring-buffer update
      body.trailPositions.push(body.position.x, 0, body.position.z);
      if (body.trailPositions.length > MAX_TRAIL_POINTS * 3) {
        body.trailPositions.splice(0, 3);
      }

      // ── Sync Three.js objects directly (bypasses React re-render) ──
      const entry = meshEntriesRef.current.get(body.id);
      if (entry) {
        // Move the group → all children (mesh, glow, ring) follow automatically
        entry.groupRef.current?.position.copy(body.position);

        // Update scale only if radius changed (after merge)
        if (entry.meshRef.current) {
          entry.meshRef.current.scale.setScalar(body.radius);
        }
        if (entry.glowRef.current) {
          entry.glowRef.current.scale.setScalar(body.radius * 1.8);
        }

        // Sync trail geometry
        const arr = entry.trailAttr.array as Float32Array;
        const pts = body.trailPositions;
        const len = Math.min(pts.length, arr.length);
        for (let k = 0; k < len; k++) arr[k] = pts[k];
        entry.trailAttr.needsUpdate = true;
        entry.trailLine.geometry.setDrawRange(0, pts.length / 3);
      }
    }

    // ── Remove absorbed bodies ──────────────────────────────────────────
    if (toRemove.size > 0) {
      physicsRef.current = physicsRef.current.filter(b => !toRemove.has(b.id));
      for (const id of toRemove) meshEntriesRef.current.delete(id);

      setRenderList(prev => prev.filter(b => !toRemove.has(b.id)));
      toRemove.forEach(id => onBodyRemoved(id));

      // Notify parent of updated mass/radius for surviving merged bodies
      for (const body of physicsRef.current) {
        const original = bodies.find(b => b.id === body.id);
        if (original && (original.mass !== body.mass || original.radius !== body.radius)) {
          onBodyUpdated(body.id, body.mass, body.radius);
        }
      }
    }

    // ── Publish live positions for SpacetimeGrid deformation ───────────
    livePhysicsRef.current = physicsRef.current.map(b => ({
      position: [b.position.x, 0, b.position.z] as [number, number, number],
      mass:     b.mass,
    }));
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
