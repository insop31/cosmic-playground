import { useEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject, RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import SpacetimeGrid, { type GridPointerEvent } from './SpacetimeGrid';
import type { CelestialBody } from '../../physics/types';
import type { Prediction, PredictedOutcome } from '../../physics/simulation';
import { aimFromDrag, planPlacement } from '../../physics/placement';
import type { LiveBodyState, SimulationControls } from './PhysicsSimulator';

const GHOST_ID = '__ghost__';
const PREDICTION_SECONDS = 20;
const REPREDICT_INTERVAL = 0.4; // s between refreshes while the system moves
const MAX_GHOST_POINTS = 1024;

const OUTCOME_COLOR: Record<PredictedOutcome, string> = {
  bound: '#4ade80',
  escape: '#fbbf24',
  collision: '#f87171',
};

export type PendingBody = Omit<CelestialBody, 'id' | 'position'>;

interface PlacementLayerProps {
  bodies: CelestialBody[];
  pending: PendingBody | null;
  velocityScale: number;
  livePhysicsRef: MutableRefObject<LiveBodyState[]>;
  simulationRef: MutableRefObject<SimulationControls | null>;
  controlsRef: RefObject<OrbitControlsImpl | null>;
  onPlace: (point: [number, number, number], aimedVelocity: [number, number, number] | null, predicted: PredictedOutcome | null) => void;
  gridSize: number;
  gridResolution: number;
  universeScale: number;
  realisticMode: boolean;
}

interface GhostLabel {
  text: string;
  color: string;
  position: [number, number, number];
}

const PlacementLayer = ({
  bodies,
  pending,
  velocityScale,
  livePhysicsRef,
  simulationRef,
  controlsRef,
  onPlace,
  gridSize,
  gridResolution,
  universeScale,
  realisticMode,
}: PlacementLayerProps) => {
  const hoverRef = useRef<[number, number, number] | null>(null);
  const aimStartRef = useRef<[number, number, number] | null>(null);
  const aimEndRef = useRef<[number, number, number] | null>(null);
  const inFlightRef = useRef(false);
  const sinceRequestRef = useRef(Infinity);
  const [label, setLabel] = useState<GhostLabel | null>(null);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  // Outcome of the latest preview, handed over with the placement (for Predict First missions).
  const lastOutcomeRef = useRef<PredictedOutcome | null>(null);
  const bodiesRef = useRef(bodies);
  bodiesRef.current = bodies;

  const ghostLine = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_GHOST_POINTS * 3), 3));
    geometry.setDrawRange(0, 0);
    const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: '#4ade80', transparent: true, opacity: 0.9 }));
    line.frustumCulled = false;
    return line;
  }, []);
  const aimLine = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    geometry.setDrawRange(0, 0);
    const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9 }));
    line.frustumCulled = false;
    return line;
  }, []);
  const ghostMarker = useMemo(() => new THREE.Mesh(
    new THREE.SphereGeometry(1, 20, 20),
    new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35, depthWrite: false }),
  ), []);

  const clearGhost = () => {
    ghostLine.geometry.setDrawRange(0, 0);
    aimLine.geometry.setDrawRange(0, 0);
    ghostMarker.visible = false;
    lastOutcomeRef.current = null;
    setLabel(null);
  };

  useEffect(() => {
    if (!pending) {
      hoverRef.current = null;
      aimStartRef.current = null;
      if (controlsRef.current) controlsRef.current.enabled = true;
      clearGhost();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  /** Where the body would go and how it would start, exactly as placement will do it. */
  const currentPlan = () => {
    const body = pendingRef.current;
    const start = aimStartRef.current ?? hoverRef.current;
    if (!body || !start) return null;
    const aimed = aimStartRef.current && aimEndRef.current ? aimFromDrag(aimStartRef.current, aimEndRef.current) : null;
    const plan = planPlacement(start, body.radius ?? 0.3, livePhysicsRef.current, velocityScale, aimed);
    return { body, plan, aimed };
  };

  const requestPrediction = () => {
    const current = currentPlan();
    const sim = simulationRef.current;
    if (!current || !sim || inFlightRef.current) return;
    inFlightRef.current = true;
    sinceRequestRef.current = 0;
    const candidate: CelestialBody = { ...current.body, id: GHOST_ID, position: current.plan.position, velocity: current.plan.velocity };
    sim.predict(candidate, PREDICTION_SECONDS).then((prediction) => {
      inFlightRef.current = false;
      if (prediction && pendingRef.current) showPrediction(prediction, current.plan.position);
    });
  };

  const showPrediction = (prediction: Prediction, start: [number, number, number]) => {
    const attr = ghostLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    const count = Math.min(prediction.points.length / 2, MAX_GHOST_POINTS);
    for (let k = 0; k < count; k++) {
      arr[k * 3] = prediction.points[k * 2];
      arr[k * 3 + 1] = 0.08;
      arr[k * 3 + 2] = prediction.points[k * 2 + 1];
    }
    attr.needsUpdate = true;
    ghostLine.geometry.setDrawRange(0, count);
    lastOutcomeRef.current = prediction.outcome;
    const color = OUTCOME_COLOR[prediction.outcome];
    (ghostLine.material as THREE.LineBasicMaterial).color.set(color);
    ghostMarker.visible = true;
    ghostMarker.position.set(start[0], 0, start[2]);
    ghostMarker.scale.setScalar(pendingRef.current?.radius ?? 0.3);
    const end: [number, number, number] = [prediction.points[(count - 1) * 2], 1.2, prediction.points[(count - 1) * 2 + 1]];
    const hitName = prediction.hitId
      ? (bodiesRef.current.find((b) => b.id === prediction.hitId)?.name ?? bodiesRef.current.find((b) => b.id === prediction.hitId)?.type ?? 'a body')
      : '';
    const text = prediction.outcome === 'bound'
      ? 'Stays in orbit'
      : prediction.outcome === 'escape'
        ? 'Escapes the system'
        : `Hits ${hitName} in ${prediction.time.toFixed(1)} s`;
    setLabel({ text, color, position: end });
  };

  const updateAimLine = () => {
    const start = aimStartRef.current;
    const end = aimEndRef.current;
    if (!start || !end) {
      aimLine.geometry.setDrawRange(0, 0);
      return;
    }
    const attr = aimLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    arr.set([start[0], 0.15, start[2], end[0], 0.15, end[2]]);
    attr.needsUpdate = true;
    aimLine.geometry.setDrawRange(0, 2);
  };

  useFrame((_, delta) => {
    if (!pendingRef.current) return;
    sinceRequestRef.current += delta;
    if ((hoverRef.current || aimStartRef.current) && sinceRequestRef.current > REPREDICT_INTERVAL) requestPrediction();
  });

  const finishAim = () => {
    const start = aimStartRef.current;
    if (!start) return;
    const aimed = aimEndRef.current ? aimFromDrag(start, aimEndRef.current) : null;
    aimStartRef.current = null;
    aimEndRef.current = null;
    if (controlsRef.current) controlsRef.current.enabled = true;
    updateAimLine();
    onPlace(start, aimed, lastOutcomeRef.current);
  };

  useEffect(() => {
    // Releasing the pointer off the grid still places the body.
    const onWindowPointerUp = () => finishAim();
    window.addEventListener('pointerup', onWindowPointerUp);
    return () => window.removeEventListener('pointerup', onWindowPointerUp);
  });

  const handleDown = (event: GridPointerEvent) => {
    if (!pendingRef.current || event.nativeEvent.button !== 0) return;
    aimStartRef.current = event.point;
    aimEndRef.current = event.point;
    if (controlsRef.current) controlsRef.current.enabled = false;
    sinceRequestRef.current = Infinity;
  };

  const handleMove = (event: GridPointerEvent) => {
    if (!pendingRef.current) return;
    if (aimStartRef.current) {
      aimEndRef.current = event.point;
      updateAimLine();
    } else {
      hoverRef.current = event.point;
    }
  };

  const handleUp = () => finishAim();

  return (
    <>
      <SpacetimeGrid
        bodies={bodies}
        livePhysicsRef={livePhysicsRef}
        gridSize={gridSize}
        gridResolution={gridResolution}
        universeScale={universeScale}
        realisticMode={realisticMode}
        onGridPointerDown={pending ? handleDown : undefined}
        onGridPointerMove={pending ? handleMove : undefined}
        onGridPointerUp={pending ? handleUp : undefined}
      />
      <primitive object={ghostLine} />
      <primitive object={aimLine} />
      <primitive object={ghostMarker} />
      {pending && label && (
        <Html position={label.position} center style={{ pointerEvents: 'none' }} zIndexRange={[400, 0]}>
          <div
            className="whitespace-nowrap rounded-md border bg-background/85 px-2 py-1 text-xs font-mono"
            style={{ color: label.color, borderColor: label.color }}
          >
            {label.text}
          </div>
        </Html>
      )}
    </>
  );
};

export default PlacementLayer;
