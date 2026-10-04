import { useRef } from 'react';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { WorldEffects, useWorldActive } from '@/stage/World';
import { useSpacetimeStore } from '@/stores/spacetimeStore';
import { useEffectiveTimeScale } from '@/stores/timeStore';
import SpacetimeGrid from './SpacetimeGrid';
import Starfield from './Starfield';
import PhysicsSimulator from './PhysicsSimulator';

// Larger grid gives bodies more physical room — reduces extreme close-range forces on placement
const GRID_SIZE = 220;

/** Spacetime Lab world: rendered inside a <World> portal of the shared stage canvas. */
const SpacetimeWorld = () => {
  const active = useWorldActive();
  const bodies = useSpacetimeStore((state) => state.bodies);
  const realisticMode = useSpacetimeStore((state) => state.realisticMode);
  const universeScale = useSpacetimeStore((state) => state.universeScale);
  const onBodyRemoved = useSpacetimeStore((state) => state.removeBody);
  const onBodyUpdated = useSpacetimeStore((state) => state.updateBody);
  const onGridClick = useSpacetimeStore((state) => state.placeOnGrid);
  const liveTimeScale = useEffectiveTimeScale();
  // A hidden world is paused.
  const timeScale = active ? liveTimeScale : 0;

  // Shared ref written by PhysicsSimulator and read by SpacetimeGrid every frame.
  // Using a plain ref keeps grid deformation in sync with physics without any
  // React state updates in the hot path.
  const livePhysicsRef = useRef<Array<{ position: [number, number, number]; mass: number }>>([]);
  const controlsRef = useRef<OrbitControlsImpl | null>(null);

  return (
    <>
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
        enabled={active}
        enableDamping
        dampingFactor={0.05}
        minDistance={8}
        maxDistance={200}
        maxPolarAngle={Math.PI / 2.1}
      />

      <WorldEffects bloomThreshold={0.85} bloomIntensity={0.7} bloomRadius={0.7} vignetteDarkness={0.55} />
    </>
  );
};

export default SpacetimeWorld;
