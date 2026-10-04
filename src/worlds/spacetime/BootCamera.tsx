import { useEffect, useRef, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import { gsap, motionDuration } from '@/motion/gsap';
import { liveWorld } from '@/sim/liveWorld';
import { useAppStore } from '@/stores/appStore';
import { wellField } from './wellField';

const HOME_POSITION = new THREE.Vector3(0, 45, 45);
const ORBIT_RADIUS = 120;
const ORBIT_HEIGHT = 62;

/**
 * Opening shot for the Spacetime world: a slow orbit high above the sheet
 * while the intro is up, then a dolly down to the working view when the
 * visitor enters. Also reports real start-up milestones for the boot log.
 */
const BootCamera = ({ controlsRef }: { controlsRef: RefObject<OrbitControlsImpl | null> }) => {
  const camera = useThree((state) => state.camera);
  const booting = useAppStore((state) => state.booting);
  const markReady = useAppStore((state) => state.markReady);
  const angle = useRef(0.6);
  const framesWithMesh = useRef(0);

  useFrame((_, delta) => {
    // Readiness: physics has published bodies; the sheet has rendered with its wells.
    if (liveWorld.bodies.length > 0) markReady('physics');
    if (wellField.count > 0 && ++framesWithMesh.current === 2) markReady('mesh');

    if (!useAppStore.getState().booting) return;
    angle.current += Math.min(delta, 0.05) * 0.06;
    camera.position.set(Math.sin(angle.current) * ORBIT_RADIUS, ORBIT_HEIGHT, Math.cos(angle.current) * ORBIT_RADIUS);
    controlsRef.current?.target.set(0, -2, 0);
    controlsRef.current?.update();
  });

  // Leaving the intro: glide down to the working view.
  useEffect(() => {
    if (booting) return undefined;
    const controls = controlsRef.current;
    if (!controls) return undefined;
    const fromPos = camera.position.clone();
    const fromTarget = controls.target.clone();
    if (fromPos.distanceTo(HOME_POSITION) < 1) return undefined;
    const progress = { t: 0 };
    const tween = gsap.to(progress, {
      t: 1,
      duration: motionDuration(2.2),
      ease: 'camera',
      onUpdate: () => {
        camera.position.lerpVectors(fromPos, HOME_POSITION, progress.t);
        controls.target.lerpVectors(fromTarget, new THREE.Vector3(0, 0, 0), progress.t);
        controls.update();
      },
    });
    return () => { tween.kill(); };
  }, [booting, camera, controlsRef]);

  return null;
};

export default BootCamera;
