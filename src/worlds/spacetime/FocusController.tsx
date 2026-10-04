import { useEffect, useRef, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import { gsap, motionDuration } from '@/motion/gsap';
import { liveWorld } from '@/sim/liveWorld';
import { useSpacetimeStore } from '@/stores/spacetimeStore';
import { surfaceHeight } from './wellField';

const bodyAnchor = (id: string, out: THREE.Vector3) => {
  const body = liveWorld.bodies.find((b) => b.id === id);
  if (!body) return null;
  return out.set(body.position.x, surfaceHeight(body.position.x, body.position.z) + body.radius * 0.85, body.position.z);
};

/**
 * Selecting a body flies the camera to it (GSAP, eased like a slow dolly),
 * then keeps it centred as it moves while "follow" is on. The user can still
 * orbit and zoom around it.
 */
const FocusController = ({ controlsRef }: { controlsRef: RefObject<OrbitControlsImpl | null> }) => {
  const camera = useThree((state) => state.camera);
  const selectedId = useSpacetimeStore((state) => state.selectedBodyId);
  const follow = useSpacetimeStore((state) => state.followSelected);
  const flyingRef = useRef(false);
  const lastAnchor = useRef(new THREE.Vector3());
  const scratch = useRef(new THREE.Vector3());

  useEffect(() => {
    const controls = controlsRef.current;
    if (!selectedId || !controls) return;
    const anchor = bodyAnchor(selectedId, new THREE.Vector3());
    if (!anchor) return;
    const body = liveWorld.bodies.find((b) => b.id === selectedId)!;

    // Keep the current viewing direction, but never look up from under the sheet.
    const direction = camera.position.clone().sub(controls.target).normalize();
    direction.y = Math.max(direction.y, 0.45);
    direction.normalize();
    const distance = THREE.MathUtils.clamp(body.radius * 9, 9, 40);

    const fromPos = camera.position.clone();
    const fromTarget = controls.target.clone();
    const progress = { t: 0 };
    flyingRef.current = true;
    const tween = gsap.to(progress, {
      t: 1,
      duration: motionDuration(0.9),
      ease: 'camera',
      onUpdate: () => {
        // Re-read the anchor each tick: the body keeps moving during the flight.
        const live = bodyAnchor(selectedId, scratch.current) ?? anchor;
        controls.target.lerpVectors(fromTarget, live, progress.t);
        camera.position.lerpVectors(fromPos, live.clone().addScaledVector(direction, distance), progress.t);
        controls.update();
      },
      onComplete: () => {
        flyingRef.current = false;
        bodyAnchor(selectedId, lastAnchor.current);
      },
    });
    return () => {
      tween.kill();
      flyingRef.current = false;
    };
  }, [camera, controlsRef, selectedId]);

  useFrame(() => {
    const controls = controlsRef.current;
    if (!selectedId || flyingRef.current || !controls) return;
    const anchor = bodyAnchor(selectedId, scratch.current);
    if (!anchor) return;
    // Track the anchor every frame so turning follow back on doesn't jump.
    if (follow) {
      const delta = anchor.clone().sub(lastAnchor.current);
      if (delta.lengthSq() > 0) {
        camera.position.add(delta);
        controls.target.add(delta);
        controls.update();
      }
    }
    lastAnchor.current.copy(anchor);
  });

  return null;
};

export default FocusController;
