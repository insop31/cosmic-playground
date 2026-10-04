import { useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Bloom, EffectComposer, SMAA, Vignette } from '@react-three/postprocessing';
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
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
      style={{ background: 'black' }}
    >
      <color attach="background" args={['#050a14']} />
      <fog attach="fog" args={['#050a14', 120, 350]} />

      {/* Stars carry their own point lights; these only keep night sides readable */}
      <ambientLight intensity={0.14} />
      <hemisphereLight args={['#8fb8ff', '#1a0f2e', 0.35]} />
      <directionalLight position={[30, 40, 20]} intensity={0.75} color="#e8f0ff" />

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

      {/* MSAA targets and the ToneMapping effect both render black on some GPUs
          (seen on ANGLE/D3D11), so anti-aliasing uses SMAA instead. */}
      <EffectComposer multisampling={0}>
        <Bloom mipmapBlur luminanceThreshold={0.85} luminanceSmoothing={0.25} intensity={0.7} radius={0.7} />
        <SMAA />
        <Vignette offset={0.32} darkness={0.55} />
      </EffectComposer>
    </Canvas>
  );
};

export default SpaceScene;
