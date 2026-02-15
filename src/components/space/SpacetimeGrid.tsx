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
}

const SpacetimeGrid = ({ bodies, gridSize = 40, gridResolution = 80 }: SpacetimeGridProps) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(gridSize, gridSize, gridResolution, gridResolution);
    geo.rotateX(-Math.PI / 2);
    return geo;
  }, [gridSize, gridResolution]);

  const shaderMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uGridColor: { value: new THREE.Color(0x00e5ff) },
        uDepthColor: { value: new THREE.Color(0x7c3aed) },
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
        varying float vDepth;
        varying vec2 vUv;
        varying vec3 vWorldPos;
        
        void main() {
          vec2 grid = abs(fract(vWorldPos.xz * 0.5) - 0.5);
          float line = min(grid.x, grid.y);
          float gridLine = 1.0 - smoothstep(0.0, 0.04, line);
          
          float depthFactor = smoothstep(0.0, 8.0, vDepth);
          vec3 color = mix(uGridColor, uDepthColor, depthFactor);
          
          float alpha = gridLine * (0.15 + depthFactor * 0.6);
          alpha = max(alpha, depthFactor * 0.08);
          
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
      wireframe: false,
    });
  }, []);

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
    }
  });

  return (
    <mesh ref={meshRef} geometry={geometry} material={shaderMaterial}>
      <primitive object={shaderMaterial} ref={materialRef} attach="material" />
    </mesh>
  );
};

export default SpacetimeGrid;
