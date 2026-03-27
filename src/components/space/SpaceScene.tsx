import { useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import SpacetimeGrid from './SpacetimeGrid';
import Starfield from './Starfield';
import PhysicsSimulator from './PhysicsSimulator';

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
  onBodyRemoved: (id: string) => void;
  onBodyUpdated: (id: string, mass: number, radius: number) => void;
  placementEnabled?: boolean;
  onPlaceBody?: (position: [number, number, number]) => void;
  universeScale?: number;
}

const GRID_SIZE = 120;

const SpaceScene = ({
  bodies,
  timeScale,
  onBodyRemoved,
  onBodyUpdated,
  placementEnabled = false,
  onPlaceBody,
  universeScale = 1,
}: SpaceSceneProps) => {
  // Shared ref written by PhysicsSimulator and read by SpacetimeGrid every frame.
  // Using a plain ref keeps grid deformation in sync with physics without any
  // React state updates in the hot path.
  const livePhysicsRef = useRef<Array<{ position: [number, number, number]; mass: number }>>([]);

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
        livePhysicsRef={livePhysicsRef}
        gridSize={GRID_SIZE}
        gridResolution={120}
        universeScale={universeScale}
      />

      <PhysicsSimulator
        bodies={bodies}
        timeScale={timeScale}
        onBodyRemoved={onBodyRemoved}
        onBodyUpdated={onBodyUpdated}
        livePhysicsRef={livePhysicsRef}
        universeScale={universeScale}
        gridSize={GRID_SIZE}
      />

      {placementEnabled && onPlaceBody && (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          onClick={(event) => {
            event.stopPropagation();
            onPlaceBody([event.point.x, 0, event.point.z]);
          }}
          onPointerMove={(event) => {
            if (!(event.buttons & 1)) return;
            event.stopPropagation();
            onPlaceBody([event.point.x, 0, event.point.z]);
          }}
        >
          <planeGeometry args={[GRID_SIZE * universeScale, GRID_SIZE * universeScale]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}

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
