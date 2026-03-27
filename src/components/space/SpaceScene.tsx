import { useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import SpacetimeGrid from './SpacetimeGrid';
import Starfield from './Starfield';
import PhysicsSimulator from './PhysicsSimulator';

export interface CelestialBody {
  id: string;
  name?: string;
  type: string;
  bodyClass?: 'rocky' | 'gas' | 'ice' | 'star' | 'asteroid' | 'blackhole' | 'neutron' | 'comet';
  position: [number, number, number];
  mass: number;
  radius: number;
  physicalRadius?: number;
  color: string;
  atmosphere?: boolean;
  eventHorizonRadius?: number;
  velocity?: [number, number, number];
}

interface SpaceSceneProps {
  bodies: CelestialBody[];
  timeScale: number;
  onBodyRemoved: (id: string) => void;
  onBodyUpdated: (id: string, mass: number, radius: number) => void;
  onGridClick?: (position: [number, number, number]) => void;
  realisticMode?: boolean;
  universeScale?: number;
}

// Larger grid gives bodies more physical room — reduces extreme close-range forces on placement
const GRID_SIZE = 220;

const SpaceScene = ({
  bodies,
  timeScale,
  onBodyRemoved,
  onBodyUpdated,
  onGridClick,
  realisticMode = true,
  universeScale = 1,
}: SpaceSceneProps) => {
  // Shared ref written by PhysicsSimulator and read by SpacetimeGrid every frame.
  // Using a plain ref keeps grid deformation in sync with physics without any
  // React state updates in the hot path.
  const livePhysicsRef = useRef<Array<{ position: [number, number, number]; mass: number }>>([]);
  const controlsRef = useRef<OrbitControlsImpl | null>(null);

  return (
    <Canvas
      camera={{ position: [0, 45, 45], fov: 55, near: 0.1, far: 800 }}
      gl={{ antialias: true, alpha: false }}
      style={{ background: 'black' }}
    >
      <color attach="background" args={['#050a14']} />
      <fog attach="fog" args={['#050a14', 120, 350]} />

      <ambientLight intensity={0.15} />
      <pointLight position={[20, 30, 20]} intensity={0.5} color="#00e5ff" />
      <pointLight position={[-15, 20, -10]} intensity={0.3} color="#7c3aed" />

      <Starfield />

      <SpacetimeGrid
        bodies={bodies}
        livePhysicsRef={livePhysicsRef}
        gridSize={GRID_SIZE}
        gridResolution={160}
        universeScale={universeScale}
        onGridClick={onGridClick}
      />

      <PhysicsSimulator
        bodies={bodies}
        timeScale={timeScale}
        onBodyRemoved={onBodyRemoved}
        onBodyUpdated={onBodyUpdated}
        livePhysicsRef={livePhysicsRef}
        universeScale={universeScale}
        gridSize={GRID_SIZE}
        realisticMode={realisticMode}
        controlsRef={controlsRef}
      />

      <OrbitControls
        ref={controlsRef}
        enableDamping
        dampingFactor={0.05}
        minDistance={8}
        maxDistance={200}
        maxPolarAngle={Math.PI / 2.1}
      />
    </Canvas>
  );
};

export default SpaceScene;
