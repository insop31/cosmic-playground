import { Canvas } from '@react-three/fiber';
import { PerformanceMonitor } from '@react-three/drei';
import { useAppStore, useQualityTier, type QualityTier } from '@/stores/appStore';
import SpacetimeWorld from '@/worlds/spacetime/SpacetimeWorld';
import RocketWorld from '@/worlds/rocket/RocketWorld';
import { World, type WorldCameraOptions } from './World';

const SPACETIME_CAMERA: WorldCameraOptions = { position: [0, 45, 45], fov: 55, near: 0.1, far: 800 };
const ROCKET_CAMERA: WorldCameraOptions = { position: [5.5, 4.8, 13.5], fov: 42, near: 0.1, far: 20000 };

/**
 * Device-pixel-ratio range per quality tier. Every extra pixel is shaded, bloomed
 * and anti-aliased, so 2× on a high-density laptop screen cost 4× the GPU work of
 * 1× for little visible gain; 1.5× with SMAA looks the same.
 */
const DPR: Record<QualityTier, number | [number, number]> = {
  high: [1, 1.5],
  medium: [1, 1.25],
  low: 1,
};

const STEP_DOWN: Record<QualityTier, QualityTier> = { high: 'medium', medium: 'low', low: 'low' };
const STEP_UP: Record<QualityTier, QualityTier> = { high: 'high', medium: 'high', low: 'medium' };

/**
 * The one persistent WebGL canvas. Both labs stay mounted as portalled worlds;
 * the mode decides which world renders and takes input.
 */
const StageCanvas = () => {
  const mode = useAppStore((state) => state.mode);
  const booting = useAppStore((state) => state.booting);
  const markReady = useAppStore((state) => state.markReady);
  const tier = useQualityTier();

  // In "auto", sustained low frame rates step quality down; recovery steps it back up.
  const adjust = (direction: 'up' | 'down') => {
    const app = useAppStore.getState();
    if (app.quality !== 'auto') return;
    app.setAutoTier(direction === 'down' ? STEP_DOWN[app.autoTier] : STEP_UP[app.autoTier]);
  };

  return (
    <Canvas
      dpr={DPR[tier]}
      // No MSAA on the canvas: medium and high render through the effect composer (SMAA
      // on high), so a multisampled default framebuffer only cost memory and bandwidth.
      gl={{ antialias: false, alpha: false, powerPreference: 'high-performance', stencil: false }}
      style={{ background: 'hsl(var(--background))' }}
      onCreated={() => markReady('stage')}
      aria-label={mode === 'spacetime' ? 'Spacetime Lab 3D view' : 'Rocket Lab 3D view'}
    >
      <PerformanceMonitor
        // Step down when most of the last 2.5 s ran under 50 fps (70 on 120 Hz screens):
        // the default 40 left laptops in the 40s, which still feels laggy, on high.
        bounds={(refreshRate) => (refreshRate > 100 ? [70, 100] : [50, 58])}
        onDecline={() => adjust('down')}
        onIncline={() => adjust('up')}
        flipflops={4}
        onFallback={() => {
          const app = useAppStore.getState();
          if (app.quality === 'auto') app.setAutoTier('low');
        }}
      />
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
