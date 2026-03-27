import React, { useRef, useState, useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { CelestialBody } from './SpaceScene';

// ── Physics Constants ──────────────────────────────────────────────────────
export const REAL_G = 6.674e-11;    // Newtonian constant (SI)
export const ARCADE_G = 0.5;        // Gameplay-tuned gravity
const REAL_GRAVITY_BOOST = 1.2e20;  // Normalization so SI masses remain playable in scene units
const SOFTENING_SQ = 0.25;          // ε² prevents singularity as r → 0
const HEAVY_MASS_THRESHOLD = 7;     // mass ≥ this → "star-class", repels other heavy bodies
const MAX_TRAIL_POINTS = 100;
const MAX_HISTORY = 3600;           // ~60 s of rewind at 60 fps
const MIN_ORBIT_DIST = 0.01;
const MAX_SIM_BODIES = 180;
const MAX_INTERACTION_RADIUS = 45;
const QUADTREE_CAPACITY = 6;
const QUADTREE_MAX_DEPTH = 6;
const MIN_ORBITAL_SPEED = 0.08;
const MAX_ORBITAL_SPEED_REALISTIC = 3.0;
const MAX_ORBITAL_SPEED_ARCADE = 6.0;
const BOUNDARY_DAMPING = 0.35;

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
  motionState: 'bound' | 'escaping' | 'captured';
}

type BodyType = 'star' | 'planet' | 'asteroid' | 'blackhole' | 'neutron' | 'comet' | string;
type Bounds2D = { minX: number; maxX: number; minZ: number; maxZ: number };

interface SpatialEntry {
  index: number;
  x: number;
  z: number;
}

class Quadtree {
  private bounds: Bounds2D;
  private depth: number;
  private entries: SpatialEntry[] = [];
  private children: Quadtree[] | null = null;

  constructor(bounds: Bounds2D, depth = 0) {
    this.bounds = bounds;
    this.depth = depth;
  }

  private containsPoint(x: number, z: number): boolean {
    return x >= this.bounds.minX && x <= this.bounds.maxX && z >= this.bounds.minZ && z <= this.bounds.maxZ;
  }

  private intersects(bounds: Bounds2D): boolean {
    return !(
      bounds.maxX < this.bounds.minX ||
      bounds.minX > this.bounds.maxX ||
      bounds.maxZ < this.bounds.minZ ||
      bounds.minZ > this.bounds.maxZ
    );
  }

  private subdivide() {
    const { minX, maxX, minZ, maxZ } = this.bounds;
    const midX = (minX + maxX) * 0.5;
    const midZ = (minZ + maxZ) * 0.5;
    const nextDepth = this.depth + 1;
    this.children = [
      new Quadtree({ minX, maxX: midX, minZ, maxZ: midZ }, nextDepth),
      new Quadtree({ minX: midX, maxX, minZ, maxZ: midZ }, nextDepth),
      new Quadtree({ minX, maxX: midX, minZ: midZ, maxZ }, nextDepth),
      new Quadtree({ minX: midX, maxX, minZ: midZ, maxZ }, nextDepth),
    ];
  }

  insert(entry: SpatialEntry): boolean {
    if (!this.containsPoint(entry.x, entry.z)) return false;

    if (!this.children && (this.entries.length < QUADTREE_CAPACITY || this.depth >= QUADTREE_MAX_DEPTH)) {
      this.entries.push(entry);
      return true;
    }

    if (!this.children) {
      this.subdivide();
      const oldEntries = this.entries;
      this.entries = [];
      for (const existing of oldEntries) {
        this.insert(existing);
      }
    }

    for (const child of this.children ?? []) {
      if (child.insert(entry)) return true;
    }

    this.entries.push(entry);
    return true;
  }

  query(bounds: Bounds2D, out: SpatialEntry[]) {
    if (!this.intersects(bounds)) return;
    for (const entry of this.entries) {
      if (
        entry.x >= bounds.minX &&
        entry.x <= bounds.maxX &&
        entry.z >= bounds.minZ &&
        entry.z <= bounds.maxZ
      ) {
        out.push(entry);
      }
    }
    for (const child of this.children ?? []) {
      child.query(bounds, out);
    }
  }
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
  realisticMode?: boolean;
  onBodyRemoved: (id: string) => void;
  onBodyUpdated: (id: string, mass: number, radius: number) => void;
  livePhysicsRef: React.MutableRefObject<Array<{ position: [number, number, number]; mass: number }>>;
  universeScale?: number;
  gridSize?: number;
}

// ── Orbital velocity helper ────────────────────────────────────────────────
function isStarClass(body: PhysicsBody): boolean {
  return body.type === 'star' || body.mass >= HEAVY_MASS_THRESHOLD;
}

function shouldRepel(a: PhysicsBody, b: PhysicsBody): boolean {
  return isStarClass(a) && isStarClass(b);
}

function shouldAttract(a: PhysicsBody, b: PhysicsBody): boolean {
  const aIsStar = a.type === 'star';
  const bIsStar = b.type === 'star';
  const aIsPlanetary = a.type === 'planet' || a.type === 'asteroid' || a.type === 'comet';
  const bIsPlanetary = b.type === 'planet' || b.type === 'asteroid' || b.type === 'comet';
  return (aIsStar && bIsPlanetary) || (bIsStar && aIsPlanetary) || (!shouldRepel(a, b));
}

function computeOrbitalVelocity(newPos: THREE.Vector3, physicsBodies: PhysicsBody[], realisticMode: boolean): THREE.Vector3 {
  if (physicsBodies.length === 0) return new THREE.Vector3();

  // Find the most massive body (the "Attractor")
  const attractor = physicsBodies.reduce((best, b) => (b.mass > best.mass ? b : best));

  const R = newPos.clone().sub(attractor.position);
  const dist = R.length();
  if (dist < MIN_ORBIT_DIST) return new THREE.Vector3();

  // Circular orbit speed: v = sqrt(G * M / r)
  const effectiveG = realisticMode ? REAL_G * REAL_GRAVITY_BOOST : ARCADE_G;
  const rawSpeed = Math.sqrt(effectiveG * attractor.mass / dist);
  const maxSpeed = realisticMode ? MAX_ORBITAL_SPEED_REALISTIC : MAX_ORBITAL_SPEED_ARCADE;
  const speed = Math.min(maxSpeed, Math.max(MIN_ORBITAL_SPEED, rawSpeed));

  // Tangent = normalize(R) × UP
  const up = new THREE.Vector3(0, 1, 0);
  const radialDir = R.clone().normalize();
  let tangent = radialDir.clone().cross(up);
  if (tangent.lengthSq() < 1e-8) {
    tangent = new THREE.Vector3(1, 0, 0);
  } else {
    tangent.normalize();
  }

  return tangent.multiplyScalar(speed);
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
  realisticMode = true,
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
        const providedVel = new THREE.Vector3(...(body.velocity ?? [0, 0, 0]));
        const hasProvidedVelocity = providedVel.lengthSq() > 1e-12;
        const vel = hasProvidedVelocity
          ? providedVel
          : computeOrbitalVelocity(pos, physicsRef.current, realisticMode);

        physicsRef.current.push({
          id:            body.id,
          position:      pos.clone(),
          velocity:      vel,
          force:         new THREE.Vector3(),
          mass:          body.mass,
          radius:        body.radius,
          type:          body.type as BodyType,
          color:         body.color,
          trailPositions: [],
          motionState:   'bound',
        });
      }
    }

    // Remove bodies deleted via the UI
    physicsRef.current = physicsRef.current.filter(b => incomingIds.has(b.id));
    for (const id of currentIds) {
      if (!incomingIds.has(id)) meshEntriesRef.current.delete(id);
    }

    setRenderList([...bodies]);
  }, [bodies, realisticMode]);

  // ── N-body Physics Loop ────────────────────────────────────────────────
  useFrame((_, delta) => {
    if (timeScale === 0) return;

    const bods = physicsRef.current.slice(0, MAX_SIM_BODIES);

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

    const effectiveG = realisticMode ? REAL_G * REAL_GRAVITY_BOOST : ARCADE_G;

    // ── A. Reset accumulated forces ──────────────────────────────────
    for (const b of bods) b.force.set(0, 0, 0);

    const toRemove = new Set<string>();

    // ── B. Broad-phase (quadtree) + narrow-phase resolution ───────────
    const halfGrid = (gridSize * universeScale) / 2;
    const quadtree = new Quadtree(
      { minX: -halfGrid * 1.6, maxX: halfGrid * 1.6, minZ: -halfGrid * 1.6, maxZ: halfGrid * 1.6 },
      0,
    );

    for (let i = 0; i < bods.length; i++) {
      quadtree.insert({ index: i, x: bods[i].position.x, z: bods[i].position.z });
    }

    const candidateSet = new Set<string>();
    const queryResult: SpatialEntry[] = [];
    const interactionRange = Math.min(MAX_INTERACTION_RADIUS, halfGrid * 0.9);

    for (let i = 0; i < bods.length; i++) {
      queryResult.length = 0;
      const center = bods[i].position;
      quadtree.query(
        {
          minX: center.x - interactionRange,
          maxX: center.x + interactionRange,
          minZ: center.z - interactionRange,
          maxZ: center.z + interactionRange,
        },
        queryResult,
      );

      for (const candidate of queryResult) {
        if (candidate.index <= i) continue;
        candidateSet.add(`${i}:${candidate.index}`);
      }
    }

    for (const pairKey of candidateSet) {
      const splitAt = pairKey.indexOf(':');
      const i = Number(pairKey.slice(0, splitAt));
      const j = Number(pairKey.slice(splitAt + 1));
      if (!Number.isInteger(i) || !Number.isInteger(j)) continue;
      if (!bods[i] || !bods[j]) continue;
        if (toRemove.has(bods[i].id) || toRemove.has(bods[j].id)) continue;

        const a = bods[i];
        const b = bods[j];

        const diff = b.position.clone().sub(a.position);
        const r    = diff.length();

        const aIsPlanet = a.type === 'planet';
        const bIsPlanet = b.type === 'planet';
        const aIsStar = a.type === 'star' || a.type === 'neutron';
        const bIsStar = b.type === 'star' || b.type === 'neutron';
        const aIsAsteroid = a.type === 'asteroid' || a.type === 'comet';
        const bIsAsteroid = b.type === 'asteroid' || b.type === 'comet';
        const aIsBlackHole = a.type === 'blackhole';
        const bIsBlackHole = b.type === 'blackhole';

        // Event horizon capture for planet-blackhole interaction.
        if ((aIsPlanet && bIsBlackHole) || (bIsPlanet && aIsBlackHole)) {
          const planet = aIsPlanet ? a : b;
          const blackHole = aIsBlackHole ? a : b;
          const eventHorizon = Math.max(blackHole.radius * 2.2, 0.2);
          if (r < eventHorizon) {
            planet.motionState = 'captured';
            blackHole.mass += planet.mass;
            blackHole.radius = Math.cbrt(Math.pow(blackHole.radius, 3) + Math.pow(planet.radius, 3));
            toRemove.add(planet.id);
            continue;
          }
        }

        // ── Collision & per-type resolution ───────────────────────────
        if (r < a.radius + b.radius) {
          // CASE 1: Planet + Planet → merge (momentum conserved)
          if (aIsPlanet && bIsPlanet) {
            const [survivor, absorbed] = a.mass >= b.mass ? [a, b] : [b, a];
            const totalMass = survivor.mass + absorbed.mass;
            survivor.velocity
              .multiplyScalar(survivor.mass)
              .addScaledVector(absorbed.velocity, absorbed.mass)
              .divideScalar(totalMass);
            survivor.radius = Math.cbrt(
              Math.pow(survivor.radius, 3) + Math.pow(absorbed.radius, 3)
            );
            survivor.mass = totalMass;
            toRemove.add(absorbed.id);
            continue;
          }

          // CASE 2: Planet + Star → planet absorbed.
          if ((aIsPlanet && bIsStar) || (bIsPlanet && aIsStar)) {
            const planet = aIsPlanet ? a : b;
            const star = aIsStar ? a : b;
            planet.motionState = 'captured';
            star.mass += planet.mass;
            star.radius = Math.cbrt(Math.pow(star.radius, 3) + Math.pow(planet.radius, 3));
            toRemove.add(planet.id);
            continue;
          }

          // CASE 3: Planet + Asteroid → impact changes trajectory.
          if ((aIsPlanet && bIsAsteroid) || (bIsPlanet && aIsAsteroid)) {
            const planet = aIsPlanet ? a : b;
            const asteroid = aIsAsteroid ? a : b;
            const impactDir = planet.position.clone().sub(asteroid.position).normalize();
            planet.velocity.multiplyScalar(0.92).addScaledVector(impactDir, 0.08);
            asteroid.velocity.multiplyScalar(-0.35);
            continue;
          }

          // CASE 4: Planet + Black Hole → if collision, absorbed.
          if ((aIsPlanet && bIsBlackHole) || (bIsPlanet && aIsBlackHole)) {
            const planet = aIsPlanet ? a : b;
            const blackHole = aIsBlackHole ? a : b;
            planet.motionState = 'captured';
            blackHole.mass += planet.mass;
            blackHole.radius = Math.cbrt(Math.pow(blackHole.radius, 3) + Math.pow(planet.radius, 3));
            toRemove.add(planet.id);
            continue;
          }

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

        if (r > interactionRange) continue;

        // Softened r² to prevent force blow-up at very close range
        const rSq = Math.max(r * r, SOFTENING_SQ);
        const forceMag = effectiveG * a.mass * b.mass / rSq;
        const direction = diff.normalize();
        const forceVec = direction.multiplyScalar(forceMag);

        // Attraction by default, explicit anti-gravity for star-class pairs.
        if (shouldRepel(a, b)) {
          // Repulsion: push away from each other.
          a.force.sub(forceVec);
          b.force.add(forceVec);
        } else if (shouldAttract(a, b)) {
          // Attraction: pull toward each other.
          a.force.add(forceVec);
          b.force.sub(forceVec);
        }
    }

    // ── C. Semi-implicit Euler integration + mesh sync ────────────────
    for (const body of bods) {
      if (toRemove.has(body.id)) continue;

      // a = F / m  →  velocity += a * dt  (update v before x = semi-implicit Euler)
      body.velocity.addScaledVector(body.force, dt / body.mass);

      const maxSpeed = realisticMode ? MAX_ORBITAL_SPEED_REALISTIC : MAX_ORBITAL_SPEED_ARCADE;
      const speedNow = body.velocity.length();
      if (speedNow > maxSpeed) {
        body.velocity.multiplyScalar(maxSpeed / speedNow);
      }

      // position += velocity * dt
      body.position.addScaledVector(body.velocity, dt);

      // Keep simulation on the XZ plane (y = 0)
      body.position.y = 0;
      body.velocity.y = 0;

      // Boundary handling: keep objects in scene instead of deleting instantly.
      const halfGrid = (gridSize * universeScale) / 2;
      if (body.position.x < -halfGrid) {
        body.position.x = -halfGrid;
        body.velocity.x = Math.abs(body.velocity.x) * BOUNDARY_DAMPING;
      } else if (body.position.x > halfGrid) {
        body.position.x = halfGrid;
        body.velocity.x = -Math.abs(body.velocity.x) * BOUNDARY_DAMPING;
      }
      if (body.position.z < -halfGrid) {
        body.position.z = -halfGrid;
        body.velocity.z = Math.abs(body.velocity.z) * BOUNDARY_DAMPING;
      } else if (body.position.z > halfGrid) {
        body.position.z = halfGrid;
        body.velocity.z = -Math.abs(body.velocity.z) * BOUNDARY_DAMPING;
      }

      const strongestAttractor = bods
        .filter((other) => other.id !== body.id)
        .reduce<PhysicsBody | null>((best, other) => {
          if (!best) return other;
          return other.mass > best.mass ? other : best;
        }, null);

      if (!strongestAttractor) {
        body.motionState = 'bound';
      } else {
        const rel = body.position.clone().sub(strongestAttractor.position);
        const distance = Math.max(rel.length(), 1e-3);
        const speed = body.velocity.length();
        const escapeSpeed = Math.sqrt((2 * effectiveG * strongestAttractor.mass) / distance);
        body.motionState = speed > escapeSpeed ? 'escaping' : 'bound';
      }

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
          entry.meshRef.current.scale.set(body.radius, body.radius, body.radius);
        }
        if (entry.glowRef.current) {
          const glowScale = body.radius * 1.8;
          entry.glowRef.current.scale.set(glowScale, glowScale, glowScale);
          const glowMaterial = entry.glowRef.current.material as THREE.MeshBasicMaterial;
          if (glowMaterial) {
            glowMaterial.opacity = body.motionState === 'escaping' ? 0.16 : 0.08;
          }
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
