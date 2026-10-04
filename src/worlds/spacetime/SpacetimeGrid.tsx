import { useRef, useMemo, useCallback } from 'react';
import { ThreeEvent, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface CelestialBody {
  id: string;
  type: string;
  position: [number, number, number];
  mass: number;
  radius: number;
  color: string;
}

interface SpacetimeGridProps {
  bodies: CelestialBody[];
  /** Written by PhysicsSimulator each frame with live physics positions.
   *  When populated the grid uses these instead of stale React state positions. */
  livePhysicsRef?: React.MutableRefObject<Array<{ position: [number, number, number]; mass: number }>>;
  gridSize?: number;
  gridResolution?: number;
  universeScale?: number;
  onGridClick?: (position: [number, number, number]) => void;
}

const SpacetimeGrid = ({
  bodies,
  livePhysicsRef,
  gridSize = 120,
  gridResolution = 120,
  universeScale = 1,
  onGridClick,
}: SpacetimeGridProps) => {
  const handleGridClick = useCallback((event: ThreeEvent<PointerEvent>) => {
    if (!onGridClick) return;
    event.stopPropagation();
    const { x, y, z } = event.point;
    onGridClick([x, y, z]);
  }, [onGridClick]);

  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  // We rebuild the geometry when gridSize or resolution changes
  const geometry = useMemo(() => {
    const effectiveSize = gridSize * universeScale;
    const geo = new THREE.PlaneGeometry(effectiveSize, effectiveSize, gridResolution, gridResolution);
    geo.rotateX(-Math.PI / 2);
    return geo;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridSize, gridResolution, Math.round(universeScale * 10)]); // rebuild when scale changes meaningfully

  const shaderMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        // Stronger read on dark bg; still cyan / magenta accent family
        uGridColor: { value: new THREE.Color(0x7ef6ff) },
        uDepthColor: { value: new THREE.Color(0xff9fd0) },
        uGridSize: { value: gridSize },
        uUniverseScale: { value: universeScale },
      },
      vertexShader: `
        varying float vDepth;
        varying vec2 vUv;
        varying vec3 vWorldPos;
        void main() {
          vUv = uv;
          vDepth = -position.y;
          vWorldPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uGridColor;
        uniform vec3 uDepthColor;
        uniform float uGridSize;
        uniform float uUniverseScale;
        varying float vDepth;
        varying vec2 vUv;
        varying vec3 vWorldPos;

        void main() {
          // Grid lines
          vec2 grid = abs(fract(vWorldPos.xz * 0.5) - 0.5);
          float line = min(grid.x, grid.y);
          float gridLine = 1.0 - smoothstep(0.0, 0.04, line);

          // Depth-based color blend
          float depthFactor = smoothstep(0.0, 8.0, vDepth);
          vec3 color = mix(uGridColor, uDepthColor, depthFactor);
          // Extra lift on lines so the mesh pops against #050a14
          color = min(mix(color, color * 1.24, gridLine), vec3(1.0));

          float alpha = gridLine * (0.34 + depthFactor * 0.5);
          alpha = max(alpha, depthFactor * 0.2);

          // Edge fade-out — fade to transparent near grid boundary
          float halfSize = uGridSize * uUniverseScale * 0.5;
          float edgeDist = max(abs(vWorldPos.x), abs(vWorldPos.z)) / halfSize;
          float edgeFade = 1.0 - smoothstep(0.78, 1.0, edgeDist);
          alpha *= edgeFade;

          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
      wireframe: false,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridSize]); // material only rebuilt when base gridSize changes; universe scale updated via uniform

  // Keep universe-scale uniform in sync without rebuilding material
  useMemo(() => {
    if (shaderMaterial.uniforms) {
      shaderMaterial.uniforms.uUniverseScale.value = universeScale;
      shaderMaterial.uniforms.uGridSize.value = gridSize;
    }
  }, [shaderMaterial, universeScale, gridSize]);

  const deformGrid = useCallback((posArray: Float32Array) => {
    // Prefer live physics positions (updated every frame by PhysicsSimulator)
    // over React state positions (only updated on body add/remove)
    const liveBods = livePhysicsRef?.current?.length ? livePhysicsRef.current : bodies;
    const vertexCount = posArray.length / 3;
    const VERTICAL_SCALE = 0.72;
    const PARABOLA_DEPTH_GAIN = 1.7;
    const PARABOLA_SOFTNESS = 4.2;
    const MASS_LOG_MIN = 22.0;
    const MASS_LOG_MAX = 31.0;
    const MASS_VISUAL_MIN = 1.2;
    const MASS_VISUAL_MAX = 40.0;
    const MASS_CURVE = 1.55;
    const MASS_STRENGTH_EXP = 1.22;

    for (let i = 0; i < vertexCount; i++) {
      const x = posArray[i * 3];
      const z = posArray[i * 3 + 2];
      let totalDisplacement = 0;

      for (const body of liveBods) {
        const dx = x - body.position[0];
        const dz = z - body.position[2];
        const dist = Math.sqrt(dx * dx + dz * dz);
        // SI masses (e.g. 1.989e30) would blow up the formula directly.
        // Log-normalize anything above the arcade range so the grid stays visible
        // regardless of whether realistic or arcade mode is active.
        const visualMassBase = body.mass > 1000
          ? (() => {
              const logMass = Math.log10(body.mass);
              const normalizedMass = THREE.MathUtils.clamp(
                (logMass - MASS_LOG_MIN) / (MASS_LOG_MAX - MASS_LOG_MIN),
                0,
                1,
              );
              const curvedMass = Math.pow(normalizedMass, MASS_CURVE);
              return THREE.MathUtils.lerp(MASS_VISUAL_MIN, MASS_VISUAL_MAX, curvedMass);
            })()
          : body.mass;
        const superMassBoost = body.mass >= 4e30 ? 1.35 : body.mass >= 2e30 ? 1.15 : 1.0;
        const visualMass = visualMassBase * superMassBoost;
        // Smooth parabolic well: stronger center curvature without a hard tip clamp.
        const influence = (Math.pow(visualMass, MASS_STRENGTH_EXP) * PARABOLA_DEPTH_GAIN) / (dist * dist + PARABOLA_SOFTNESS);
        totalDisplacement += influence;
      }

      posArray[i * 3 + 1] = -(totalDisplacement * VERTICAL_SCALE);
    }
  // livePhysicsRef is a stable ref object — its .current is read at call time,
  // so it does not need to be in deps. bodies is included for the initial frame.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bodies]);

  useFrame((state) => {
    if (!meshRef.current) return;
    const geo = meshRef.current.geometry as THREE.BufferGeometry;
    const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
    const posArray = posAttr.array as Float32Array;

    deformGrid(posArray);
    posAttr.needsUpdate = true;
    geo.computeVertexNormals();

    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = state.clock.elapsedTime;
    }
  });

  return (
    <mesh ref={meshRef} geometry={geometry} material={shaderMaterial} onPointerDown={handleGridClick}>
      <primitive object={shaderMaterial} ref={materialRef} attach="material" />
    </mesh>
  );
};

export default SpacetimeGrid;
