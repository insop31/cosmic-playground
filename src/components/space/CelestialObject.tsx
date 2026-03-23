import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface CelestialBody {
  id: string;
  type: string;
  position: [number, number, number];
  mass: number;
  radius: number;
  color: string;
  velocity?: [number, number, number];
}

interface CelestialObjectProps {
  body: CelestialBody;
  timeScale: number;
  allBodies: CelestialBody[];
  onUpdatePosition: (id: string, pos: [number, number, number], vel: [number, number, number]) => void;
  universeScale?: number;
  gridSize?: number;
}

interface Snapshot {
  pos: [number, number, number];
  vel: [number, number, number];
}

const G = 0.5;
const H0 = 0.000025; // Hubble constant (game scale)
const MAX_HISTORY = 7200; // ~120 s at 60 fps

const CelestialObject = ({
  body,
  timeScale,
  allBodies,
  onUpdatePosition,
  universeScale = 1,
  gridSize = 120,
}: CelestialObjectProps) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);

  // Live position and velocity tracked inside the loop
  const posRef = useRef<THREE.Vector3>(new THREE.Vector3(...body.position));
  const velocity = useRef<THREE.Vector3>(
    new THREE.Vector3(...(body.velocity || [0, 0, 0]))
  );

  // History buffer for time-rewind
  const history = useRef<Snapshot[]>([]);

  const trailPositions = useRef<number[]>([]);
  const trailMeshRef = useRef<THREE.Line | null>(null);

  const glowColor = useMemo(() => new THREE.Color(body.color), [body.color]);

  const trailLine = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(300 * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setDrawRange(0, 0);
    const mat = new THREE.LineBasicMaterial({ color: body.color, transparent: true, opacity: 0.3 });
    const line = new THREE.Line(geo, mat);
    trailMeshRef.current = line;
    return line;
  }, [body.color]);

  useFrame((_, delta) => {
    if (!meshRef.current || timeScale === 0) return;

    const halfGrid = (gridSize * universeScale) / 2 - body.radius;

    if (timeScale > 0) {
      // ── Forward time ──────────────────────────────────────────
      const dt = delta * timeScale;
      const pos = posRef.current;

      // Gravitational acceleration from all other bodies
      const acc = new THREE.Vector3(0, 0, 0);
      for (const other of allBodies) {
        if (other.id === body.id) continue;
        const otherPos = new THREE.Vector3(...other.position);
        const dir = otherPos.clone().sub(pos);
        const distSq = Math.max(dir.lengthSq(), 0.5);
        const force = (G * other.mass) / distSq;
        acc.add(dir.normalize().multiplyScalar(force));
      }

      velocity.current.add(acc.multiplyScalar(dt));

      // Hubble expansion kick (push radially away from origin)
      const hubbleKickX = pos.x * H0 * dt;
      const hubbleKickZ = pos.z * H0 * dt;
      velocity.current.x += hubbleKickX;
      velocity.current.z += hubbleKickZ;

      // Integrate position
      pos.x += velocity.current.x * dt;
      pos.z += velocity.current.z * dt;
      pos.y = 0;

      // Clamp to grid bounds
      pos.x = Math.max(-halfGrid, Math.min(halfGrid, pos.x));
      pos.z = Math.max(-halfGrid, Math.min(halfGrid, pos.z));

      const newPos: [number, number, number] = [pos.x, 0, pos.z];

      // Save snapshot to history
      history.current.push({
        pos: [...newPos],
        vel: [velocity.current.x, velocity.current.y, velocity.current.z],
      });
      if (history.current.length > MAX_HISTORY) {
        history.current.shift();
      }

      // Update trail
      trailPositions.current.push(newPos[0], newPos[1], newPos[2]);
      const maxPoints = 100;
      if (trailPositions.current.length > maxPoints * 3) {
        trailPositions.current.splice(0, 3);
      }

      meshRef.current.position.set(...newPos);
      if (glowRef.current) glowRef.current.position.set(...newPos);

      onUpdatePosition(body.id, newPos, [velocity.current.x, velocity.current.y, velocity.current.z]);

    } else {
      // ── Rewind time ───────────────────────────────────────────
      // Pop one snapshot per frame (|timeScale| controls speed via delta doesn't matter much here,
      // but we pop multiple snapshots proportional to |timeScale| for smoother rewind at higher speeds)
      const stepsBack = Math.max(1, Math.round(Math.abs(timeScale)));
      for (let s = 0; s < stepsBack; s++) {
        if (history.current.length === 0) break;
        const snap = history.current.pop()!;
        posRef.current.set(...snap.pos);
        velocity.current.set(...snap.vel);

        // Trim trail to match
        trailPositions.current.splice(-3);
      }

      const pos = posRef.current;
      const newPos: [number, number, number] = [pos.x, 0, pos.z];

      meshRef.current.position.set(...newPos);
      if (glowRef.current) glowRef.current.position.set(...newPos);

      onUpdatePosition(body.id, newPos, [velocity.current.x, velocity.current.y, velocity.current.z]);
    }

    // Always sync trail geometry
    if (trailMeshRef.current) {
      const attr = trailMeshRef.current.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      const len = Math.min(trailPositions.current.length, arr.length);
      for (let i = 0; i < len; i++) {
        arr[i] = trailPositions.current[i];
      }
      attr.needsUpdate = true;
      trailMeshRef.current.geometry.setDrawRange(0, trailPositions.current.length / 3);
    }
  });

  const emissiveIntensity = body.type === 'star' ? 2 : body.type === 'blackhole' ? 0.1 : 0.5;
  const isBlackHole = body.type === 'blackhole';

  return (
    <group>
      <primitive object={trailLine} />

      <mesh ref={meshRef} position={body.position}>
        <sphereGeometry args={[body.radius, 32, 32]} />
        <meshStandardMaterial
          color={isBlackHole ? '#000000' : body.color}
          emissive={body.color}
          emissiveIntensity={emissiveIntensity}
          roughness={0.3}
          metalness={0.7}
        />
      </mesh>

      {!isBlackHole && (
        <mesh ref={glowRef} position={body.position}>
          <sphereGeometry args={[body.radius * 1.8, 16, 16]} />
          <meshBasicMaterial
            color={glowColor}
            transparent
            opacity={0.08}
            side={THREE.BackSide}
          />
        </mesh>
      )}

      {isBlackHole && (
        <mesh position={body.position} rotation={[Math.PI / 2, 0, 0]}>
          <ringGeometry args={[body.radius * 1.5, body.radius * 3, 64]} />
          <meshBasicMaterial
            color="#ff6600"
            transparent
            opacity={0.4}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
    </group>
  );
};

export default CelestialObject;
