import { useEffect, useRef, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';

export interface ImpactPopupState {
  id: string;
  title: string;
  detail: string;
  /** The conservation numbers for this impact. */
  stats?: string;
  position: [number, number, number];
}

interface CameraSnapshot {
  position: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
}

/** Frames a collision while its report is open, then hands the camera back. */
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

export default ImpactCameraDirector;
