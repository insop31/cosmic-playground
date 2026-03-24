import { useRef, useMemo, useCallback } from 'react';
import { useFrame } from '@react-three/fiber';
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
  gridSize?: number;
  gridResolution?: number;
  universeScale?: number;
  mergeEvent?: { x: number; z: number; intensity: number } | null;
}

const SpacetimeGrid = ({
  bodies,
  gridSize = 120,
  gridResolution = 120,
  universeScale = 1,
  mergeEvent = null,
}: SpacetimeGridProps) => {
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
        uGridColor: { value: new THREE.Color(0x00e5ff) },
        uDepthColor: { value: new THREE.Color(0x7c3aed) },
        uGridSize: { value: gridSize },
        uUniverseScale: { value: universeScale },
        uMergeEvent: { value: new THREE.Vector4(0, 0, -999, 0) },
        // ↑ x=worldX, y=worldZ, z=eventTime (set to -999 = inactive), w=intensity
      },
      vertexShader: `
        uniform float uTime;
        uniform vec4 uMergeEvent;  // x,z = position; z = eventTime; w = intensity
        varying float vDepth;
        varying vec2 vUv;
        varying vec3 vWorldPos;
        void main() {
          vUv = uv;
          vec3 pos = position;

          // Gravitational wave ripple from merge event
          float timeSinceMerge = uTime - uMergeEvent.z;
          if (timeSinceMerge > 0.0 && timeSinceMerge < 3.0) {
            float dx = pos.x - uMergeEvent.x;
            float dz = pos.z - uMergeEvent.y;
            float dist = sqrt(dx*dx + dz*dz);
            float wave = sin(dist * 2.0 - timeSinceMerge * 8.0)
                       * uMergeEvent.w
                       * exp(-timeSinceMerge * 1.5)
                       * exp(-dist * 0.05);
            pos.y += wave;
          }

          vDepth = -pos.y;
          vWorldPos = pos;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
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

          float alpha = gridLine * (0.15 + depthFactor * 0.6);
          alpha = max(alpha, depthFactor * 0.08);

          // Edge fade-out — fade to transparent near grid boundary
          float halfSize = uGridSize * uUniverseScale * 0.5;
          float edgeDist = max(abs(vWorldPos.x), abs(vWorldPos.z)) / halfSize;
          float edgeFade = 1.0 - smoothstep(0.72, 1.0, edgeDist);
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
    const vertexCount = posArray.length / 3;
    for (let i = 0; i < vertexCount; i++) {
      const x = posArray[i * 3];
      const z = posArray[i * 3 + 2];
      let totalDisplacement = 0;

      for (const body of bodies) {
        const dx = x - body.position[0];
        const dz = z - body.position[2];
        const dist = Math.sqrt(dx * dx + dz * dz);
        const influence = (body.mass * 2) / (dist * dist + 1.5);
        totalDisplacement += influence;
      }

      posArray[i * 3 + 1] = -totalDisplacement;
    }
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
      
      if (mergeEvent) {
        materialRef.current.uniforms.uMergeEvent.value.set(
          mergeEvent.x,
          mergeEvent.z,
          state.clock.elapsedTime,
          mergeEvent.intensity
        );
      }
    }
  });

  return (
    <mesh ref={meshRef} geometry={geometry} material={shaderMaterial}>
      <primitive object={shaderMaterial} ref={materialRef} attach="material" />
    </mesh>
  );
};

export default SpacetimeGrid;
