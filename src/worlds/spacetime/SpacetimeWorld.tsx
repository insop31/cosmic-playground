import { useCallback, useRef } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { WorldEffects, useWorldActive } from '@/stage/World';
import { bodyLabel, useSpacetimeStore } from '@/stores/spacetimeStore';
import { logLabEvent } from '@/stores/eventStore';
import { useEffectiveTimeScale } from '@/stores/timeStore';
import SpacetimeGrid from './SpacetimeGrid';
import Starfield from './Starfield';
import PhysicsSimulator from './PhysicsSimulator';
import PlacementController from './PlacementController';
import FocusController from './FocusController';
import BootCamera from './BootCamera';
import { useAppStore, useQualityTier } from '@/stores/appStore';

// Larger grid gives bodies more physical room — reduces extreme close-range forces on placement
const GRID_SIZE = 220;
const SPACE = '#05070d';

/** Spacetime Lab world: rendered inside a <World> portal of the shared stage canvas. */
const SpacetimeWorld = () => {
  const active = useWorldActive();
  const bodies = useSpacetimeStore((state) => state.bodies);
  const realisticMode = useSpacetimeStore((state) => state.realisticMode);
  const universeScale = useSpacetimeStore((state) => state.universeScale);
  const aiming = useSpacetimeStore((state) => Boolean(state.pendingPlacement));
  const removeBody = useSpacetimeStore((state) => state.removeBody);
  const onBodyUpdated = useSpacetimeStore((state) => state.updateBody);
  const booting = useAppStore((state) => state.booting);
  const tier = useQualityTier();
  const liveTimeScale = useEffectiveTimeScale();
  // A hidden world is paused.
  const timeScale = active ? liveTimeScale : 0;
  const controlsRef = useRef<OrbitControlsImpl | null>(null);

  // The simulator only removes a body when another one absorbs it.
  const onBodyRemoved = useCallback((id: string) => {
    const body = useSpacetimeStore.getState().bodies.find((entry) => entry.id === id);
    if (body) logLabEvent('spacetime', `${bodyLabel(body)} absorbed in a collision`, 'danger');
    removeBody(id);
  }, [removeBody]);

  // Clicking empty space clears the selection (a drag that turned the view doesn't count).
  const pressRef = useRef<{ x: number; y: number } | null>(null);
  const onGridDown = useCallback((event: ThreeEvent<PointerEvent>) => {
    pressRef.current = { x: event.nativeEvent.clientX, y: event.nativeEvent.clientY };
  }, []);
  const onGridUp = useCallback((event: ThreeEvent<PointerEvent>) => {
    const press = pressRef.current;
    pressRef.current = null;
    if (!press || Math.hypot(event.nativeEvent.clientX - press.x, event.nativeEvent.clientY - press.y) > 5) return;
    const store = useSpacetimeStore.getState();
    if (!store.pendingPlacement && store.selectedBodyId) store.selectBody(null);
  }, []);

  return (
    <>
      <color attach="background" args={[SPACE]} />
      <fog attach="fog" args={[SPACE, 140, 380]} />

      {/* Stars carry their own point lights; these only keep night sides readable */}
      <ambientLight intensity={0.14} />
      <hemisphereLight args={['#8fb8ff', '#1a0f2e', 0.35]} />
      <directionalLight position={[30, 40, 20]} intensity={0.75} color="#e8f0ff" />

      <Starfield />

      <SpacetimeGrid gridSize={GRID_SIZE} gridResolution={tier === 'low' ? 120 : 200} universeScale={universeScale} onPointerDown={onGridDown} onPointerUp={onGridUp} />

      <PhysicsSimulator
        bodies={bodies}
        timeScale={timeScale}
        onBodyRemoved={onBodyRemoved}
        onBodyUpdated={onBodyUpdated}
        universeScale={universeScale}
        gridSize={GRID_SIZE}
        realisticMode={realisticMode}
        controlsRef={controlsRef}
      />

      <PlacementController />
      <FocusController controlsRef={controlsRef} />
      <BootCamera controlsRef={controlsRef} />

      <OrbitControls
        ref={controlsRef}
        enabled={active && !booting}
        // While aiming a new body, left-drag sets its velocity instead of turning the view.
        enableRotate={!aiming}
        enableDamping
        dampingFactor={0.05}
        minDistance={6}
        maxDistance={220}
        maxPolarAngle={Math.PI / 2.1}
      />

      <WorldEffects bloomThreshold={0.85} bloomIntensity={0.7} bloomRadius={0.7} vignetteDarkness={0.55} />
    </>
  );
};

export default SpacetimeWorld;
