import { Canvas } from '@react-three/fiber';
import { useAppStore } from '@/stores/appStore';
import SpacetimeWorld from '@/worlds/spacetime/SpacetimeWorld';
import RocketWorld from '@/worlds/rocket/RocketWorld';
import { World, type WorldCameraOptions } from './World';

const SPACETIME_CAMERA: WorldCameraOptions = { position: [0, 45, 45], fov: 55, near: 0.1, far: 800 };
const ROCKET_CAMERA: WorldCameraOptions = { position: [5.5, 4.8, 13.5], fov: 42, near: 0.1, far: 20000 };

/**
 * The one persistent WebGL canvas. Both labs stay mounted as portalled worlds;
 * the mode decides which world renders and takes input.
 */
const StageCanvas = () => {
  const mode = useAppStore((state) => state.mode);
  const booting = useAppStore((state) => state.booting);
  const markReady = useAppStore((state) => state.markReady);

  return (
    <Canvas
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
      style={{ background: 'hsl(var(--background))' }}
      onCreated={() => markReady('stage')}
    >
      <World active={booting || mode === 'spacetime'} camera={SPACETIME_CAMERA}>
        <SpacetimeWorld />
      </World>
      <World active={!booting && mode === 'rocket'} camera={ROCKET_CAMERA}>
        <RocketWorld />
      </World>
    </Canvas>
  );
};

export default StageCanvas;
