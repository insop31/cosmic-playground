import { createContext, useContext, useMemo, type ComponentProps, type ReactNode } from 'react';
import { createPortal, useThree } from '@react-three/fiber';
import { Html as DreiHtml } from '@react-three/drei';
import { Bloom, EffectComposer, SMAA, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';

/**
 * A world is one lab's 3D content (Spacetime or Rocket) living in its own
 * THREE.Scene with its own camera, portalled into the single shared <Canvas>.
 *
 * Inside a world, useThree() returns that world's scene and camera, so camera
 * rigs and controls written for a standalone canvas keep working. Only the
 * active world is rendered, receives pointer events and shows DOM labels; the
 * inactive world stays mounted (keeping its simulation state) but invisible.
 */
const WorldActiveContext = createContext(true);

export const useWorldActive = () => useContext(WorldActiveContext);

export interface WorldCameraOptions {
  position: [number, number, number];
  fov: number;
  near: number;
  far: number;
}

interface WorldProps {
  active: boolean;
  camera: WorldCameraOptions;
  children: ReactNode;
}

export const World = ({ active, camera: cameraOptions, children }: WorldProps) => {
  const size = useThree((state) => state.size);
  const scene = useMemo(() => new THREE.Scene(), []);
  const camera = useMemo(() => {
    const cam = new THREE.PerspectiveCamera(cameraOptions.fov, 1, cameraOptions.near, cameraOptions.far);
    cam.position.set(...cameraOptions.position);
    return cam;
    // Initial pose only: after mount the world's own rigs and controls own the camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Passing `size` makes R3F keep this camera's aspect ratio in sync with the canvas.
  const portalState = useMemo(
    () => ({ camera, size, events: { enabled: active } }),
    [active, camera, size],
  );

  return createPortal(
    <WorldActiveContext.Provider value={active}>{children}</WorldActiveContext.Provider>,
    scene,
    portalState,
  );
};

/**
 * drei <Html> ignores parent visibility, so DOM labels from a hidden world
 * would stay on screen. This wrapper only mounts them while the world is active.
 */
export const Html = (props: ComponentProps<typeof DreiHtml>) => {
  const active = useWorldActive();
  return active ? <DreiHtml {...props} /> : null;
};

interface WorldEffectsProps {
  bloomThreshold: number;
  bloomIntensity: number;
  bloomRadius: number;
  vignetteDarkness: number;
}

/**
 * Post-processing for the active world. The composer takes over rendering
 * (frame priority 1), so mounting it only in the active world is what decides
 * which scene reaches the screen.
 *
 * MSAA targets and the ToneMapping effect both render black on some GPUs
 * (seen on ANGLE/D3D11), so anti-aliasing uses SMAA and multisampling stays 0.
 */
export const WorldEffects = ({ bloomThreshold, bloomIntensity, bloomRadius, vignetteDarkness }: WorldEffectsProps) => {
  const active = useWorldActive();
  if (!active) return null;
  return (
    <EffectComposer multisampling={0}>
      <Bloom mipmapBlur luminanceThreshold={bloomThreshold} luminanceSmoothing={0.25} intensity={bloomIntensity} radius={bloomRadius} />
      <SMAA />
      <Vignette offset={0.32} darkness={vignetteDarkness} />
    </EffectComposer>
  );
};
