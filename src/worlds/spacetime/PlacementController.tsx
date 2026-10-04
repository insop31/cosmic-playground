import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import * as THREE from 'three';
import { Html } from '@/stage/World';
import { aimFromDrag, planPlacement } from '@/physics/placement';
import type { Prediction } from '@/physics/predict';
import { cancelPredictions, onPrediction, requestPrediction } from '@/physics/predictorClient';
import { toKmPerSecond } from '@/physics/units';
import { bodyLabel, placementNeighbours, useSpacetimeStore } from '@/stores/spacetimeStore';
import { liveWorld, predictionSeeds } from './liveWorld';
import { surfaceHeight } from './wellField';

const PREDICTION_HORIZON_S = 24;
const REFRESH_MS = 300;
const PROBE_ID = '__probe__';

const OUTCOME_STYLE = {
  bound: { color: '#4ade80', label: 'Stays in orbit' },
  escape: { color: '#f5b83d', label: 'Escapes the system' },
  collision: { color: '#ff5c6c', label: 'Collision' },
} as const;

type Vec3 = [number, number, number];

const onSheet = (x: number, z: number, lift = 0.08) => new THREE.Vector3(x, surfaceHeight(x, z) + lift, z);

/** Hit point of a screen position on the physics plane (y = 0). */
const PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

/**
 * Placement with a velocity anchor. Hovering shows the body and the path it
 * would take with the default (circular-orbit) speed; pressing and dragging
 * aims the launch velocity by hand. Release to place. The predicted path is
 * computed with the simulation's own physics in a worker: green stays bound,
 * amber escapes, red ends in a collision. What it showed is passed on with the
 * placement, for the Predict First objectives.
 */
const PlacementController = () => {
  const pending = useSpacetimeStore((state) => state.pendingPlacement);
  const velocityScale = useSpacetimeStore((state) => state.placementVelocityScale);
  const placeOnGrid = useSpacetimeStore((state) => state.placeOnGrid);
  const { camera, gl, raycaster } = useThree();

  const [anchor, setAnchor] = useState<Vec3 | null>(null);
  const [velocity, setVelocity] = useState<Vec3>([0, 0, 0]);
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const draggingRef = useRef(false);
  const aimedRef = useRef<Vec3 | null>(null);
  const lastRequestRef = useRef(0);
  const predictionRef = useRef<Prediction | null>(null);
  predictionRef.current = prediction;

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
      aimedRef.current = null;
    }
  }, [pending]);

  /** Where the body would go and how it would start, exactly as placement will do it. */
  const plan = useCallback((point: Vec3, aimed: Vec3 | null) => {
    const store = useSpacetimeStore.getState();
    return planPlacement(point, pending?.radius ?? 0.3, placementNeighbours(store.bodies), velocityScale, aimed);
  }, [pending, velocityScale]);

  const predict = useCallback((position: Vec3, v: Vec3) => {
    if (!pending) return;
    lastRequestRef.current = performance.now();
    requestPrediction({
      bodies: predictionSeeds(),
      probe: { id: PROBE_ID, type: pending.type, x: position[0], z: position[2], vx: v[0], vz: v[2], mass: pending.mass, radius: pending.radius, physRadius: pending.physicalRadius },
      realistic: liveWorld.realistic,
      horizon: PREDICTION_HORIZON_S,
      sampleEvery: 8,
    });
  }, [pending]);

  const hover = useCallback((point: THREE.Vector3) => {
    if (!pending || draggingRef.current) return;
    const p = plan([point.x, 0, point.z], null);
    setAnchor(p.position);
    setVelocity(p.velocity);
    predict(p.position, p.velocity);
  }, [pending, plan, predict]);

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
    aimedRef.current = null;
    const origin = anchor;

    const onMove = (e: PointerEvent) => {
      const point = pointOnPlane(e.clientX, e.clientY);
      if (!point) return;
      const aimed = aimFromDrag(origin, [point.x, 0, point.z]);
      if (!aimed && !aimedRef.current) return;
      const v = aimed ?? aimedRef.current!;
      aimedRef.current = v;
      setVelocity(v);
      if (performance.now() - lastRequestRef.current > 30) predict(origin, v);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      draggingRef.current = false;
      if (!useSpacetimeStore.getState().pendingPlacement) return;
      // A plain click keeps the circular orbit (× the speed slider).
      placeOnGrid(origin, aimedRef.current, predictionRef.current?.outcome ?? null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [anchor, pending, placeOnGrid, pointOnPlane, predict]);

  // Bodies keep moving while you aim; refresh the forecast a few times a second.
  useFrame(() => {
    if (!pending || !anchor) return;
    if (performance.now() - lastRequestRef.current > REFRESH_MS) {
      if (aimedRef.current) predict(anchor, aimedRef.current);
      else hover(new THREE.Vector3(anchor[0], 0, anchor[2]));
    }
  });

  const pathPoints = useMemo(() => {
    if (!prediction || prediction.points.length < 4) return null;
    const points: THREE.Vector3[] = [];
    for (let i = 0; i < prediction.points.length; i += 2) points.push(onSheet(prediction.points[i], prediction.points[i + 1], 0.1));
    return points;
  }, [prediction]);

  const speed = Math.hypot(velocity[0], velocity[2]);
  // The arrow is drawn at the same scale that dragging uses, so it ends under the pointer.
  const DRAW_SCALE = 1 / 0.18;
  const tip: Vec3 | null = anchor ? [anchor[0] + velocity[0] * DRAW_SCALE, 0, anchor[2] + velocity[2] * DRAW_SCALE] : null;
  const style = prediction ? OUTCOME_STYLE[prediction.outcome] : null;
  const hitName = prediction?.hitId
    ? (() => {
      const body = useSpacetimeStore.getState().bodies.find((b) => b.id === prediction.hitId);
      return body ? bodyLabel(body) : 'a body';
    })()
    : null;

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

          <Html position={onSheet(tip[0], tip[2], 1.4)} center style={{ pointerEvents: 'none' }}>
            <div className="scene-label whitespace-nowrap px-2.5 py-1.5 font-mono text-[11px] leading-tight" data-testid="placement-preview">
              <div className="text-foreground">{bodyLabel(pending)} · {toKmPerSecond(speed).toFixed(1)} km/s</div>
              {style && prediction && (
                <div style={{ color: style.color }}>
                  {prediction.outcome === 'collision'
                    ? `Hits ${hitName ?? 'a body'} in ${prediction.time.toFixed(1)} s`
                    : style.label}
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
