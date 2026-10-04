import React, { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import type { RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@/stage/World';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import { CelestialBody } from './types';
import {
  FIXED_SUBSTEP,
  MAX_HISTORY,
  MAX_SIM_BODIES,
  adaptiveDt,
  effectiveGravity,
  spawnOrbitalVelocity,
  stepWorld,
  type BodyType,
  type PhysicsBody,
  type SimImpact,
} from '@/sim/nbody';
import { planForwardSteps, planRewindSteps, reportSpacetimeSpeed, substepCap } from '@/sim/schedule';
import { liveWorld } from '@/sim/liveWorld';
import { BodyRenderer, MAX_TRAIL_POINTS, type MeshEntry } from './BodyVisuals';
import { surfaceHeight, updateWells } from './wellField';

/** Shown as a floating message box at the impact midpoint (world space). */
export type ImpactPopupState = SimImpact;

interface WorldSnapshot {
  id: string;
  px: number; py: number; pz: number;
  vx: number; vy: number; vz: number;
}

export interface PhysicsSimulatorProps {
  bodies: CelestialBody[];
  timeScale: number;
  realisticMode?: boolean;
  onBodyRemoved: (id: string) => void;
  onBodyUpdated: (id: string, mass: number, radius: number) => void;
  universeScale?: number;
  gridSize?: number;
  controlsRef: RefObject<OrbitControlsImpl | null>;
}

interface CameraSnapshot {
  position: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
}

const ImpactCameraDirector = ({
  activeImpact,
  controlsRef,
}: {
  activeImpact: ImpactPopupState | null;
  controlsRef: RefObject<OrbitControlsImpl | null>;
}) => {
  // Worlds always use a perspective camera (see stage/World.tsx).
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const snapshotRef = useRef<CameraSnapshot | null>(null);
  const focusTargetRef = useRef(new THREE.Vector3());
  /** True once auto framing has converged; then OrbitControls (scroll/drag) can move the camera. */
  const settledOnImpactRef = useRef(false);
  /** If the user moves the camera during the popup, do not snap back when the popup timer ends. */
  const userAdjustedDuringPopupRef = useRef(false);
  const scratchDir = useRef(new THREE.Vector3());
  const scratchDesiredPos = useRef(new THREE.Vector3());

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;

    if (activeImpact) {
      settledOnImpactRef.current = false;
      userAdjustedDuringPopupRef.current = false;
      if (!snapshotRef.current) {
        snapshotRef.current = {
          position: camera.position.clone(),
          target: controls.target.clone(),
          fov: camera.fov,
        };
      }
      focusTargetRef.current.set(...activeImpact.position);
    }
  }, [activeImpact, camera, controlsRef]);

  useFrame((_, delta) => {
    const controls = controlsRef.current;
    if (!controls) return;

    const dt = Math.min(delta, 0.05);
    const damping = 5.5;
    const minDistance = controls.minDistance ?? 8;
    const maxDistance = controls.maxDistance ?? 200;

    if (activeImpact) {
      const snapshot = snapshotRef.current;
      if (!snapshot) return;

      const direction = scratchDir.current.copy(snapshot.position).sub(snapshot.target);
      if (direction.lengthSq() < 1e-6) direction.set(0, 1, 1);
      direction.normalize();

      const desiredDistance = THREE.MathUtils.clamp(12, minDistance + 1, Math.min(maxDistance, 18));
      const desiredPosition = scratchDesiredPos.current
        .copy(focusTargetRef.current)
        .addScaledVector(direction, desiredDistance);
      const desiredFov = 42;
      const desiredCamY = desiredPosition.y + 1.25;

      if (!settledOnImpactRef.current) {
        camera.position.x = THREE.MathUtils.damp(camera.position.x, desiredPosition.x, damping, dt);
        camera.position.y = THREE.MathUtils.damp(camera.position.y, desiredCamY, damping, dt);
        camera.position.z = THREE.MathUtils.damp(camera.position.z, desiredPosition.z, damping, dt);
        controls.target.x = THREE.MathUtils.damp(controls.target.x, focusTargetRef.current.x, damping, dt);
        controls.target.y = THREE.MathUtils.damp(controls.target.y, focusTargetRef.current.y, damping, dt);
        controls.target.z = THREE.MathUtils.damp(controls.target.z, focusTargetRef.current.z, damping, dt);
        camera.fov = THREE.MathUtils.damp(camera.fov, desiredFov, 4.5, dt);
        camera.updateProjectionMatrix();
        controls.update();

        const dx = camera.position.x - desiredPosition.x;
        const dy = camera.position.y - desiredCamY;
        const dz = camera.position.z - desiredPosition.z;
        const posOk = dx * dx + dy * dy + dz * dz < 0.08;
        const targetOk = controls.target.distanceTo(focusTargetRef.current) < 0.14;
        const fovOk = Math.abs(camera.fov - desiredFov) < 0.45;
        if (posOk && targetOk && fovOk) settledOnImpactRef.current = true;
        return;
      }

      // Framing done: release camera so the user can zoom/pan while the popup stays for its time limit.
      if (!userAdjustedDuringPopupRef.current) {
        const dx2 = camera.position.x - desiredPosition.x;
        const dy2 = camera.position.y - desiredCamY;
        const dz2 = camera.position.z - desiredPosition.z;
        const stillAtImpact =
          dx2 * dx2 + dy2 * dy2 + dz2 * dz2 < 0.2
          && controls.target.distanceTo(focusTargetRef.current) < 0.22
          && Math.abs(camera.fov - desiredFov) < 0.65;
        if (!stillAtImpact) userAdjustedDuringPopupRef.current = true;
      }
      return;
    }

    const snapshot = snapshotRef.current;
    if (!snapshot) return;

    if (userAdjustedDuringPopupRef.current) {
      snapshotRef.current = null;
      userAdjustedDuringPopupRef.current = false;
      return;
    }

    camera.position.x = THREE.MathUtils.damp(camera.position.x, snapshot.position.x, damping, dt);
    camera.position.y = THREE.MathUtils.damp(camera.position.y, snapshot.position.y, damping, dt);
    camera.position.z = THREE.MathUtils.damp(camera.position.z, snapshot.position.z, damping, dt);
    controls.target.x = THREE.MathUtils.damp(controls.target.x, snapshot.target.x, damping, dt);
    controls.target.y = THREE.MathUtils.damp(controls.target.y, snapshot.target.y, damping, dt);
    controls.target.z = THREE.MathUtils.damp(controls.target.z, snapshot.target.z, damping, dt);
    camera.fov = THREE.MathUtils.damp(camera.fov, snapshot.fov, 4.5, dt);
    camera.updateProjectionMatrix();
    controls.update();

    const settled =
      camera.position.distanceTo(snapshot.position) < 0.05 &&
      controls.target.distanceTo(snapshot.target) < 0.05 &&
      Math.abs(camera.fov - snapshot.fov) < 0.1;

    if (settled) snapshotRef.current = null;
  });

  return null;
};

// ─────────────────────────────────────────────────────────────────────────────
// PhysicsSimulator
// ─────────────────────────────────────────────────────────────────────────────
const PhysicsSimulator: React.FC<PhysicsSimulatorProps> = ({
  bodies,
  timeScale,
  realisticMode = true,
  onBodyRemoved,
  onBodyUpdated,
  universeScale = 1,
  gridSize = 120,
  controlsRef,
}) => {
  const physicsRef     = useRef<PhysicsBody[]>([]);
  const meshEntriesRef = useRef(new Map<string, MeshEntry>());
  const historyRef     = useRef<WorldSnapshot[][]>([]);
  const accumRef       = useRef(0);
  const rewindAccumRef = useRef(0);
  const [renderList, setRenderList] = useState<CelestialBody[]>([]);
  const [activeImpact, setActiveImpact] = useState<ImpactPopupState | null>(null);
  const [hasPendingImpact, setHasPendingImpact] = useState(false);
  // Holds the most recent collision that arrived while a popup was already showing.
  // At most one item — always replaced by the newest so the queue never grows unbounded.
  const pendingImpactRef = useRef<ImpactPopupState | null>(null);
  const activeImpactRef  = useRef<ImpactPopupState | null>(null);

  const queueImpactPopups = useCallback((items: ImpactPopupState[]) => {
    if (items.length === 0) return;
    const latest = items[items.length - 1];
    if (!activeImpactRef.current) {
      activeImpactRef.current = latest;
      setActiveImpact(latest);
    } else {
      // Replace pending with newest — prevents unbounded queue buildup
      pendingImpactRef.current = latest;
      setHasPendingImpact(true);
    }
  }, []);

  const dismissImpact = useCallback(() => {
    const next = pendingImpactRef.current;
    pendingImpactRef.current = null;
    activeImpactRef.current = next;
    setHasPendingImpact(false);
    setActiveImpact(next);
  }, []);

  // ── Sync incoming React bodies → physicsRef ──────────────────────────────
  useEffect(() => {
    const effectiveG  = effectiveGravity(realisticMode);
    const currentIds  = new Set(physicsRef.current.map(b => b.id));
    const incomingIds = new Set(bodies.map(b => b.id));

    for (const body of bodies) {
      if (currentIds.has(body.id)) continue;
      const pos         = new THREE.Vector3(...body.position);
      const providedVel = new THREE.Vector3(...(body.velocity ?? [0, 0, 0]));
      const vel         = providedVel.lengthSq() > 1e-12
        ? providedVel.clone()
        : spawnOrbitalVelocity(pos, physicsRef.current, effectiveG);

      physicsRef.current.push({
        id:             body.id,
        position:       pos.clone(),
        velocity:       vel,
        force:          new THREE.Vector3(),
        mass:           body.mass,
        radius:         body.radius,
        type:           body.type as BodyType,
        color:          body.color,
        trailData:      new Float32Array(MAX_TRAIL_POINTS * 3),
        trailHead:      0,
        trailLen:       0,
        motionState:    'bound',
        isCloseApproach: false,
      });
    }

    physicsRef.current = physicsRef.current.filter(b => incomingIds.has(b.id));
    for (const id of currentIds) {
      if (!incomingIds.has(id)) meshEntriesRef.current.delete(id);
    }
    setRenderList([...bodies]);
  }, [bodies, realisticMode]);

  // ── Trails: one point per substep, so a trail always spans the same simulated time ──
  const recordTrails = (bods: PhysicsBody[], removed: Set<string>) => {
    for (const body of bods) {
      if (removed.has(body.id)) continue;
      const idx = body.trailHead * 3;
      body.trailData[idx]     = body.position.x;
      body.trailData[idx + 1] = surfaceHeight(body.position.x, body.position.z) + 0.06;
      body.trailData[idx + 2] = body.position.z;
      body.trailHead = (body.trailHead + 1) % MAX_TRAIL_POINTS;
      body.trailLen  = Math.min(body.trailLen + 1, MAX_TRAIL_POINTS);
    }
  };

  // ── Mesh sync (once per frame; bypasses React re-render) ─────────────────
  // Bodies rest in their own well on the visual sheet; physics stays at y = 0.
  const syncMeshes = (bods: PhysicsBody[]) => {
    for (const body of bods) {
      const entry = meshEntriesRef.current.get(body.id);
      if (!entry) continue;

      const group = entry.groupRef.current;
      if (group) {
        group.position.set(
          body.position.x,
          surfaceHeight(body.position.x, body.position.z) + body.radius * 0.85,
          body.position.z,
        );
      }

      if (entry.meshRef.current)
        entry.meshRef.current.scale.setScalar(body.radius);

      if (entry.glowRef.current) {
        entry.glowRef.current.scale.setScalar(body.radius * 1.8);
        const mat = entry.glowRef.current.material as THREE.MeshBasicMaterial;
        if (mat) mat.opacity = body.motionState === 'escaping' ? 0.18 : 0.08;
      }

      // Unroll ring-buffer into the LineGeometry attribute in correct order
      const arr  = entry.trailAttr.array as Float32Array;
      const len  = body.trailLen;
      const head = body.trailHead;
      for (let k = 0; k < len; k++) {
        const src = ((head - len + k + MAX_TRAIL_POINTS) % MAX_TRAIL_POINTS) * 3;
        const dst = k * 3;
        arr[dst]     = body.trailData[src];
        arr[dst + 1] = body.trailData[src + 1];
        arr[dst + 2] = body.trailData[src + 2];
      }
      entry.trailAttr.needsUpdate = true;
      entry.trailLine.geometry.setDrawRange(0, len);
    }
  };

  /** Publishes the frame's end state to the well field and the live-world window. */
  const publishFrame = () => {
    updateWells(physicsRef.current);
    liveWorld.bodies = physicsRef.current;
    liveWorld.effectiveG = effectiveGravity(realisticMode);
  };

  // ── Master physics step ───────────────────────────────────────────────────
  /** Runs one substep; returns true if any body was removed. */
  const stepPhysics = (bods: PhysicsBody[], dt: number) => {
    // Snapshot for time-rewind
    historyRef.current.push(bods.map(b => ({
      id: b.id,
      px: b.position.x, py: b.position.y, pz: b.position.z,
      vx: b.velocity.x, vy: b.velocity.y, vz: b.velocity.z,
    })));
    if (historyRef.current.length > MAX_HISTORY) historyRef.current.shift();

    // Integrate, resolve collisions, classify bound/escaping (src/sim/nbody.ts)
    const { impacts, removed } = stepWorld(bods, effectiveGravity(realisticMode), dt);
    if (impacts.length) {
      queueImpactPopups(impacts.map(impact => ({
        ...impact,
        position: [impact.position[0], surfaceHeight(impact.position[0], impact.position[2]) + 2.5, impact.position[2]],
      })));
    }

    recordTrails(bods, removed);

    // Remove absorbed bodies from physics and React state
    if (removed.size > 0) {
      physicsRef.current = physicsRef.current.filter(b => !removed.has(b.id));
      for (const id of removed) meshEntriesRef.current.delete(id);
      setRenderList(prev => prev.filter(b => !removed.has(b.id)));
      removed.forEach(id => onBodyRemoved(id));
      // Notify parent of mass/radius changes on survivors (e.g. after absorbing mass)
      for (const body of physicsRef.current) {
        const orig = bodies.find(b => b.id === body.id);
        if (orig && (orig.mass !== body.mass || orig.radius !== body.radius)) {
          onBodyUpdated(body.id, body.mass, body.radius);
        }
      }
      return true;
    }
    return false;
  };

  // ── Frame loop ────────────────────────────────────────────────────────────
  useFrame((_, delta) => {
    if (timeScale === 0) {
      publishFrame();
      syncMeshes(physicsRef.current);
      return;
    }
    let bods = physicsRef.current.slice(0, MAX_SIM_BODIES);

    // Rewind: restore from history at the rate forward time produced it
    if (timeScale < 0) {
      const plan = planRewindSteps(rewindAccumRef.current, delta, timeScale, FIXED_SUBSTEP);
      rewindAccumRef.current = plan.carry;
      for (let s = 0; s < plan.steps; s++) {
        const snap = historyRef.current.pop();
        if (!snap) break;
        for (const entry of snap) {
          const b = bods.find(x => x.id === entry.id);
          if (b) {
            b.position.set(entry.px, entry.py, entry.pz);
            b.velocity.set(entry.vx, entry.vy, entry.vz);
          }
        }
      }
      publishFrame();
      syncMeshes(bods);
      return;
    }

    // Forward: fixed substeps; warp runs more of them, within a per-frame work budget
    const plan = planForwardSteps(accumRef.current, delta, timeScale, FIXED_SUBSTEP, substepCap(bods.length));
    accumRef.current = plan.carry;
    for (let s = 0; s < plan.steps; s++) {
      const dt = adaptiveDt(FIXED_SUBSTEP, bods);
      // An absorbed body must stop pulling on the others for the rest of the frame.
      if (stepPhysics(bods, dt)) bods = physicsRef.current.slice(0, MAX_SIM_BODIES);
    }
    // Drain remainder if no full substep fired (e.g. first frame, slow motion)
    if (plan.steps === 0 && accumRef.current > 0) {
      const dt = adaptiveDt(accumRef.current, bods);
      stepPhysics(bods, dt);
      accumRef.current = 0;
    }
    reportSpacetimeSpeed(plan.simulated, delta, plan.limited);

    publishFrame();
    syncMeshes(physicsRef.current);
  });

  return (
    <>
      <ImpactCameraDirector
        activeImpact={activeImpact}
        controlsRef={controlsRef}
      />
      {activeImpact && (
        <Html
          key={activeImpact.id}
          position={activeImpact.position}
          center
          style={{ pointerEvents: 'none' }}
          zIndexRange={[500, 0]}
        >
          <div
            className="scene-label scene-label-accent w-[340px] border-l-primary px-4 py-3.5"
            style={{ pointerEvents: 'auto' }}
            role="status"
          >
            <div className="mb-2 flex items-start justify-between gap-3">
              <div>
                <span className="scene-tag mb-1 bg-primary/15 text-primary">Collision</span>
                <div className="font-display text-[15px] font-semibold uppercase tracking-[0.08em] text-foreground">
                  {activeImpact.title}
                </div>
              </div>
              <button
                onClick={dismissImpact}
                className="hud-focus mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-hud-dim transition-colors hover:bg-white/10 hover:text-foreground"
                title="Dismiss"
                aria-label="Dismiss collision report"
              >
                <svg width="12" height="12" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M11.7816 4.03157C12.0062 3.80702 12.0062 3.44295 11.7816 3.2184C11.5571 2.99385 11.193 2.99385 10.9685 3.2184L7.50005 6.68682L4.03164 3.2184C3.80708 2.99385 3.44301 2.99385 3.21846 3.2184C2.99391 3.44295 2.99391 3.80702 3.21846 4.03157L6.68688 7.50001L3.21846 10.9684C2.99391 11.193 2.99391 11.5571 3.21846 11.7816C3.44301 12.0061 3.80708 12.0061 4.03164 11.7816L7.50005 8.31319L10.9685 11.7816C11.193 12.0061 11.5571 12.0061 11.7816 11.7816C12.0062 11.5571 12.0062 11.193 11.7816 10.9684L8.31322 7.50001L11.7816 4.03157Z" fill="currentColor" fillRule="evenodd" clipRule="evenodd" />
                </svg>
              </button>
            </div>
            <p className="text-[13px] leading-relaxed text-foreground/85">
              {activeImpact.detail}
            </p>
            {hasPendingImpact && (
              <p className="mt-2.5 border-t border-white/[0.07] pt-2 font-mono text-[11px] text-primary/80">
                +1 more collision — dismiss to view
              </p>
            )}
          </div>
        </Html>
      )}
      {renderList.map(body => (
        <BodyRenderer key={body.id} body={body} meshEntriesRef={meshEntriesRef} />
      ))}
    </>
  );
};

export default PhysicsSimulator;
