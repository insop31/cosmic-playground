import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useRef } from 'react';
import SpacetimeGrid from './SpacetimeGrid';
import CelestialObject from './CelestialObject';
import Starfield from './Starfield';

export interface CelestialBody {
  id: string;
  type: string;
  position: [number, number, number];
  mass: number;
  radius: number;
  color: string;
  velocity?: [number, number, number];
}

interface SpaceSceneProps {
  bodies: CelestialBody[];
  timeScale: number;
  onUpdateBody: (id: string, pos: [number, number, number], vel: [number, number, number]) => void;
  universeScale?: number;
  onMerge: (idA: string, idB: string) => void;
  mergeEvent?: { x: number; z: number; intensity: number } | null;
}

const GRID_SIZE = 120;

// ─── Merge multipliers per type pair ───────────────────────────────────────
const MERGE_MULTIPLIERS: Record<string, number> = {
  'blackhole+blackhole': 1.5,
  'blackhole+star':      2.0,
  'blackhole+planet':    2.0,
  'blackhole+neutron':   1.8,
  'blackhole+asteroid':  2.5,
  'blackhole+comet':     2.5,
  'star+star':           1.2,
  'star+planet':         1.0,
  'default':             1.0,
};

function getMergeMultiplier(typeA: string, typeB: string): number {
  const key1 = `${typeA}+${typeB}`;
  const key2 = `${typeB}+${typeA}`;
  return MERGE_MULTIPLIERS[key1] ?? MERGE_MULTIPLIERS[key2] ?? MERGE_MULTIPLIERS['default'];
}

// ─── Collision Arbiter ─────────────────────────────────────────────────────
// Runs every frame, checks all body pairs, fires onMerge when two overlap.
const CollisionArbiter = ({
  bodies,
  onMerge,
}: {
  bodies: CelestialBody[];
  onMerge: (idA: string, idB: string) => void;
}) => {
  const recentlyMerged = useRef<Set<string>>(new Set());

  useFrame(() => {
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i];
        const b = bodies[j];

        // Skip if either is already being merged this frame
        if (recentlyMerged.current.has(a.id) || recentlyMerged.current.has(b.id)) continue;

        const dx = a.position[0] - b.position[0];
        const dz = a.position[2] - b.position[2];
        const distance = Math.sqrt(dx * dx + dz * dz);
        const multiplier = getMergeMultiplier(a.type, b.type);
        const threshold = (a.radius + b.radius) * multiplier;

        if (distance < threshold) {
          // Lock both IDs immediately to prevent double-merge
          recentlyMerged.current.add(a.id);
          recentlyMerged.current.add(b.id);

          // Fire merge callback to Index.tsx
          onMerge(a.id, b.id);

          // Clean up lock after 500ms (both bodies will be gone by then)
          setTimeout(() => {
            recentlyMerged.current.delete(a.id);
            recentlyMerged.current.delete(b.id);
          }, 500);
        }
      }
    }
  });

  return null; // renders nothing, pure logic component
};

const SpaceScene = ({ bodies, timeScale, onUpdateBody, universeScale = 1, onMerge, mergeEvent }: SpaceSceneProps) => {
  return (
    <Canvas
      camera={{ position: [0, 25, 25], fov: 60, near: 0.1, far: 500 }}
      gl={{ antialias: true, alpha: false }}
      style={{ background: 'black' }}
    >
      <color attach="background" args={['#050a14']} />
      <fog attach="fog" args={['#050a14', 80, 200]} />

      <ambientLight intensity={0.15} />
      <pointLight position={[20, 30, 20]} intensity={0.5} color="#00e5ff" />
      <pointLight position={[-15, 20, -10]} intensity={0.3} color="#7c3aed" />

      <Starfield />
      <SpacetimeGrid
        bodies={bodies}
        gridSize={GRID_SIZE}
        gridResolution={120}
        universeScale={universeScale}
        mergeEvent={mergeEvent}
      />
      <CollisionArbiter bodies={bodies} onMerge={onMerge} />

      {bodies.map((body) => (
        <CelestialObject
          key={body.id}
          body={body}
          timeScale={timeScale}
          allBodies={bodies}
          onUpdatePosition={onUpdateBody}
          universeScale={universeScale}
          gridSize={GRID_SIZE}
        />
      ))}

      <OrbitControls
        enableDamping
        dampingFactor={0.05}
        minDistance={5}
        maxDistance={120}
        maxPolarAngle={Math.PI / 2.1}
      />
    </Canvas>
  );
};

export default SpaceScene;
