import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import * as THREE from 'three';
import { Html } from '@/stage/World';
import { liveWorld } from '@/sim/liveWorld';
import { onPrediction, requestPrediction, cancelPredictions } from '@/sim/predictorClient';
import type { PredictionResult } from '@/sim/predict';
import {
  bodyLabel,
  computePlacementVelocity,
  resolveSpawnPosition,
  useSpacetimeStore,
} from '@/stores/spacetimeStore';
import { surfaceHeight } from './wellField';

/** Drag distance → launch speed. One scene unit of drag = 0.12 u/s. */
const AIM_SPEED_PER_UNIT = 0.12;
const MAX_AIM_SPEED = 4;
/** Below this drag length a press counts as a click (default circular orbit). */
const CLICK_DRAG_THRESHOLD = 0.6;
const PREDICTION_HORIZON_S = 24;
const REFRESH_MS = 300;

const OUTCOME_STYLE = {
  bound: { color: '#4ade80', label: 'Stable orbit' },
  escape: { color: '#f5b83d', label: 'Escapes the system' },
  collision: { color: '#ff5c6c', label: 'Collision' },
} as const;

type Vec3 = [number, number, number];

const liveBodiesForPlacement = () => liveWorld.bodies.map((b) => ({
  position: [b.position.x, 0, b.position.z] as Vec3,
  mass: b.mass,
  radius: b.radius,
}));

const onSheet = (x: number, z: number, lift = 0.08) => new THREE.Vector3(x, surfaceHeight(x, z) + lift, z);

/** Hit point of a screen position on the physics plane (y = 0). */
const PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

/**
 * Placement with a velocity anchor. Hovering shows the body and the path it
 * would take with the default (circular-orbit) speed; pressing and dragging
 * aims the launch velocity by hand. Release to place. The predicted path is
 * computed by the real integrator in a worker: green stays bound, amber
 * escapes, red ends in a collision.
 */
const PlacementController = () => {
  const pending = useSpacetimeStore((state) => state.pendingPlacement);
  const velocityScale = useSpacetimeStore((state) => state.placementVelocityScale);
  const placeOnGrid = useSpacetimeStore((state) => state.placeOnGrid);
  const { camera, gl, raycaster } = useThree();

  const [anchor, setAnchor] = useState<Vec3 | null>(null);
  const [velocity, setVelocity] = useState<Vec3>([0, 0, 0]);
  const [prediction, setPrediction] = useState<PredictionResult | null>(null);
  const draggingRef = useRef(false);
  const aimedRef = useRef(false);
  const aimedVelocityRef = useRef<Vec3>([0, 0, 0]);
  const lastRequestRef = useRef(0);

  // Predictions arrive asynchronously from the worker.
  useEffect(() => {
    onPrediction(setPrediction);
    return () => {
      onPrediction(null);
      cancelPredictions();
    };
  }, []);

  useEffect(() => {
    if (!pending) {
      setAnchor(null);
      setPrediction(null);
      draggingRef.current = false;
      aimedRef.current = false;
    }
  }, [pending]);

  const defaultVelocity = useCallback(
    (position: Vec3) => computePlacementVelocity(position, liveBodiesForPlacement(), velocityScale),
    [velocityScale],
  );

  const predict = useCallback((position: Vec3, v: Vec3) => {
    if (!pending) return;
    lastRequestRef.current = performance.now();
    requestPrediction({
      bodies: liveWorld.bodies.map((b) => ({
        id: b.id, x: b.position.x, z: b.position.z, vx: b.velocity.x, vz: b.velocity.z, mass: b.mass, radius: b.radius, type: b.type,
      })),
      probe: { id: '__probe__', x: position[0], z: position[2], vx: v[0], vz: v[2], mass: pending.mass, radius: pending.radius, type: pending.type },
      effectiveG: liveWorld.effectiveG,
      horizon: PREDICTION_HORIZON_S,
      sampleEvery: 8,
    });
  }, [pending]);

  const hover = useCallback((point: THREE.Vector3) => {
    if (!pending || draggingRef.current) return;
    const position = resolveSpawnPosition([point.x, 0, point.z], pending.radius ?? 0.3, liveBodiesForPlacement());
    const v = defaultVelocity(position);
    setAnchor(position);
    setVelocity(v);
    predict(position, v);
  }, [defaultVelocity, pending, predict]);

  const pointOnPlane = useCallback((clientX: number, clientY: number) => {
    const rect = gl.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    return raycaster.ray.intersectPlane(PLANE, new THREE.Vector3());
  }, [camera, gl, raycaster]);

  // Dragging tracks the pointer on the window so passing over a body doesn't stop it.
  const startAim = useCallback((event: ThreeEvent<PointerEvent>) => {
    if (!pending || event.button !== 0 || !anchor) return;
    event.stopPropagation();
    draggingRef.current = true;
    aimedRef.current = false;
    const origin = anchor;

    const onMove = (e: PointerEvent) => {
      const point = pointOnPlane(e.clientX, e.clientY);
      if (!point) return;
      const dx = point.x - origin[0];
      const dz = point.z - origin[2];
      const length = Math.hypot(dx, dz);
      if (length < CLICK_DRAG_THRESHOLD && !aimedRef.current) return;
      aimedRef.current = true;
      const speed = Math.min(length * AIM_SPEED_PER_UNIT, MAX_AIM_SPEED);
      const v: Vec3 = [(dx / length) * speed, 0, (dz / length) * speed];
      aimedVelocityRef.current = v;
      setVelocity(v);
      if (performance.now() - lastRequestRef.current > 30) predict(origin, v);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      draggingRef.current = false;
      const store = useSpacetimeStore.getState();
      if (!store.pendingPlacement) return;
      // A plain click keeps the old behaviour: circular orbit × the speed slider.
      placeOnGrid(origin, aimedRef.current ? aimedVelocityRef.current : defaultVelocity(origin));
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [anchor, defaultVelocity, pending, placeOnGrid, pointOnPlane, predict]);

  // Bodies keep moving while you aim; refresh the forecast a few times a second.
  useFrame(() => {
    if (!pending || !anchor) return;
    if (performance.now() - lastRequestRef.current > REFRESH_MS) predict(anchor, velocity);
  });

  const pathPoints = useMemo(() => {
    if (!prediction || prediction.path.length < 4) return null;
    const points: THREE.Vector3[] = [];
    for (let i = 0; i < prediction.path.length; i += 2) points.push(onSheet(prediction.path[i], prediction.path[i + 1], 0.1));
    return points;
  }, [prediction]);

  const speed = Math.hypot(velocity[0], velocity[2]);
  const tip: Vec3 | null = anchor
    ? [anchor[0] + velocity[0] / AIM_SPEED_PER_UNIT, 0, anchor[2] + velocity[2] / AIM_SPEED_PER_UNIT]
    : null;
  const style = prediction ? OUTCOME_STYLE[prediction.outcome] : null;

  return (
    <>
      {/* Invisible catcher so hover and press work anywhere on the plane */}
      {pending && (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          onPointerMove={(e) => hover(e.point)}
          onPointerDown={startAim}
          visible={false}
        >
          <planeGeometry args={[600, 600]} />
          <meshBasicMaterial />
        </mesh>
      )}

      {pending && anchor && tip && (
        <group>
          {/* Ghost of the body being placed */}
          <mesh position={onSheet(anchor[0], anchor[2], pending.radius * 0.85)} scale={pending.radius}>
            <sphereGeometry args={[1, 32, 32]} />
            <meshBasicMaterial color={pending.color} transparent opacity={0.55} depthWrite={false} />
          </mesh>

          {/* Velocity anchor: arrow from the body to the aim point */}
          <Line points={[onSheet(anchor[0], anchor[2], 0.3), onSheet(tip[0], tip[2], 0.3)]} color="#3fd8f5" lineWidth={2.5} />
          <mesh position={onSheet(tip[0], tip[2], 0.3)}>
            <sphereGeometry args={[0.28, 16, 16]} />
            <meshBasicMaterial color="#3fd8f5" />
          </mesh>

          {pathPoints && style && (
            <Line points={pathPoints} color={style.color} lineWidth={2} dashed dashSize={0.9} gapSize={0.55} transparent opacity={0.95} />
          )}

          <Html position={onSheet(tip[0], tip[2], 1.4)} center style={{ pointerEvents: 'none' }} zIndexRange={[40, 0]}>
            <div className="scene-label whitespace-nowrap px-2.5 py-1.5 font-mono text-[11px] leading-tight">
              <div className="text-foreground">{bodyLabel(pending)} · {speed.toFixed(2)} u/s</div>
              {style && (
                <div style={{ color: style.color }}>
                  {style.label}
                  {prediction?.outcome === 'collision' && prediction.collisionAt !== null && ` in ${prediction.collisionAt.toFixed(1)} s`}
                </div>
              )}
            </div>
          </Html>
        </group>
      )}
    </>
  );
};

export default PlacementController;
