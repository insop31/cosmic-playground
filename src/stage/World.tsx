import { createContext, useContext, useMemo, type ComponentProps, type ReactNode } from 'react';
import { createPortal, useFrame, useThree } from '@react-three/fiber';
import { Html as DreiHtml } from '@react-three/drei';
import { Bloom, EffectComposer, SMAA, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';
import { useQualityTier } from '@/stores/appStore';

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

/** Scene labels sit above the stasis field (z-5) but below the HUD (z-10). */
const SCENE_LABEL_Z: [number, number] = [8, 0];

/**
 * drei <Html> ignores parent visibility, so DOM labels from a hidden world
 * would stay on screen. This wrapper only mounts them while the world is
 * active, and keeps them under the HUD.
 */
export const Html = (props: ComponentProps<typeof DreiHtml>) => {
  const active = useWorldActive();
  // Scene labels always sit below the HUD (z-10), whatever range a caller asks for.
  return active ? <DreiHtml {...props} zIndexRange={SCENE_LABEL_Z} /> : null;
};

interface WorldEffectsProps {
  bloomThreshold: number;
  bloomIntensity: number;
  bloomRadius: number;
  vignetteDarkness: number;
}

/** Renders the world without post-processing (low quality tier). */
const DirectRender = () => {
  useFrame(({ gl, scene, camera }) => {
    gl.render(scene, camera);
  }, 1);
  return null;
};

/**
 * Post-processing for the active world. The composer (or DirectRender on the
 * low tier) takes over rendering at frame priority 1, so mounting it only in
 * the active world is what decides which scene reaches the screen.
 *
 * MSAA targets and the ToneMapping effect both render black on some GPUs
 * (seen on ANGLE/D3D11), so anti-aliasing uses SMAA and multisampling stays 0.
 */
export const WorldEffects = ({ bloomThreshold, bloomIntensity, bloomRadius, vignetteDarkness }: WorldEffectsProps) => {
  const active = useWorldActive();
  const tier = useQualityTier();
  if (!active) return null;
  if (tier === 'low') return <DirectRender />;
  // Separate composers rather than conditional children: the composer expects a fixed effect list.
  if (tier === 'medium') {
    return (
      <EffectComposer multisampling={0} key="medium">
        <Bloom mipmapBlur luminanceThreshold={bloomThreshold} luminanceSmoothing={0.25} intensity={bloomIntensity} radius={bloomRadius} />
        <Vignette offset={0.32} darkness={vignetteDarkness} />
      </EffectComposer>
    );
  }
  return (
    <EffectComposer multisampling={0} key="high">
      <Bloom mipmapBlur luminanceThreshold={bloomThreshold} luminanceSmoothing={0.25} intensity={bloomIntensity} radius={bloomRadius} />
      <SMAA />
      <Vignette offset={0.32} darkness={vignetteDarkness} />
    </EffectComposer>
  );
};
