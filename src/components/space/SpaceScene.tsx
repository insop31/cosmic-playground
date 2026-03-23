import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
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
}

const GRID_SIZE = 120;

const SpaceScene = ({ bodies, timeScale, onUpdateBody, universeScale = 1 }: SpaceSceneProps) => {
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
      <SpacetimeGrid bodies={bodies} gridSize={GRID_SIZE} gridResolution={120} universeScale={universeScale} />

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
