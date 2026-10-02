import { useRef } from 'react';
import type { MutableRefObject } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import SpacetimeGrid from './SpacetimeGrid';
import Starfield from './Starfield';
import PhysicsSimulator, { type LiveBodyState } from './PhysicsSimulator';

export type { CelestialBody } from '../../physics/types';
import type { CelestialBody } from '../../physics/types';

interface SpaceSceneProps {
  bodies: CelestialBody[];
  timeScale: number;
  onBodyRemoved: (id: string) => void;
  onBodyUpdated: (id: string, mass: number, radius: number) => void;
  onBodyRestored: (body: CelestialBody) => void;
  onGridClick?: (position: [number, number, number]) => void;
  realisticMode?: boolean;
  universeScale?: number;
  expansionRate?: number;
  simulationEpoch?: number;
  /** Written by PhysicsSimulator every step with live positions, velocities and masses. */
  livePhysicsRef: MutableRefObject<LiveBodyState[]>;
}

// Larger grid gives bodies more physical room — reduces extreme close-range forces on placement
const GRID_SIZE = 220;

const SpaceScene = ({
  bodies,
  timeScale,
  onBodyRemoved,
  onBodyUpdated,
  onBodyRestored,
  onGridClick,
  realisticMode = true,
  universeScale = 1,
  expansionRate = 0,
  simulationEpoch = 0,
  livePhysicsRef,
}: SpaceSceneProps) => {
  // livePhysicsRef is written by PhysicsSimulator and read by SpacetimeGrid every frame,
  // keeping grid deformation in sync with physics without React state in the hot path.
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
        onBodyRestored={onBodyRestored}
        livePhysicsRef={livePhysicsRef}
        expansionRate={expansionRate}
        simulationEpoch={simulationEpoch}
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
