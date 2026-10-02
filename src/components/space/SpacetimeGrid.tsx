import { useRef, useMemo, useEffect } from 'react';
import { ThreeEvent, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { gravityConstant } from '../../physics/constants';

/** Most bodies the shader sums over; the heaviest are kept when there are more. */
export const MAX_GRID_BODIES = 64;
// Depth = A · ln(1 + Φ/Φ₀), Φ = Σ G·M / √(r² + s²): the real potential, log-compressed so a
// star's well and a black hole's both fit on screen. A planet's dent is tiny next to its
// star's, exactly as in reality.
const DEPTH_SCALE = 3.2;
const POTENTIAL_REFERENCE = 0.6;
const GRID_SOFTENING_SQ = 1.44;

interface GridBody {
  position: [number, number, number];
  mass: number;
}

export interface GridPointerEvent {
  point: [number, number, number];
  nativeEvent: PointerEvent;
}

interface SpacetimeGridProps {
  bodies: GridBody[];
  /** Live positions and masses, written by the simulator every tick. */
  livePhysicsRef?: React.MutableRefObject<GridBody[]>;
  gridSize?: number;
  gridResolution?: number;
  universeScale?: number;
  realisticMode?: boolean;
  onGridPointerDown?: (event: GridPointerEvent) => void;
  onGridPointerMove?: (event: GridPointerEvent) => void;
  onGridPointerUp?: (event: GridPointerEvent) => void;
}

const toGridEvent = (event: ThreeEvent<PointerEvent>): GridPointerEvent => ({
  point: [event.point.x, 0, event.point.z],
  nativeEvent: event.nativeEvent,
});

const SpacetimeGrid = ({
  bodies,
  livePhysicsRef,
  gridSize = 120,
  gridResolution = 120,
  universeScale = 1,
  realisticMode = true,
  onGridPointerDown,
  onGridPointerMove,
  onGridPointerUp,
}: SpacetimeGridProps) => {
  const meshRef = useRef<THREE.Mesh>(null);

  // Flat geometry: displacement happens in the vertex shader, so pointer picking hits y = 0.
  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(gridSize, gridSize, gridResolution, gridResolution);
    geo.rotateX(-Math.PI / 2);
    return geo;
  }, [gridSize, gridResolution]);

  const material = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uBodies: { value: Array.from({ length: MAX_GRID_BODIES }, () => new THREE.Vector4()) },
      uBodyCount: { value: 0 },
      uGridColor: { value: new THREE.Color(0x7ef6ff) },
      uDepthColor: { value: new THREE.Color(0xff9fd0) },
      uHalfSize: { value: gridSize * 0.5 },
    },
    vertexShader: `
      #define MAX_BODIES ${MAX_GRID_BODIES}
      uniform vec4 uBodies[MAX_BODIES]; // x, z, G·M, unused
      uniform int uBodyCount;
      varying float vDepth;
      varying vec2 vLocalXZ;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        float potential = 0.0;
        for (int i = 0; i < MAX_BODIES; i++) {
          if (i >= uBodyCount) break;
          vec2 d = world.xz - uBodies[i].xy;
          potential += uBodies[i].z / sqrt(dot(d, d) + ${GRID_SOFTENING_SQ.toFixed(2)});
        }
        float depth = ${DEPTH_SCALE.toFixed(2)} * log(1.0 + potential / ${POTENTIAL_REFERENCE.toFixed(2)});
        world.y -= depth;
        vDepth = depth;
        // Lines are drawn in the grid's own coordinates, so expansion visibly stretches them.
        vLocalXZ = position.xz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      uniform vec3 uGridColor;
      uniform vec3 uDepthColor;
      uniform float uHalfSize;
      varying float vDepth;
      varying vec2 vLocalXZ;
      void main() {
        vec2 grid = abs(fract(vLocalXZ * 0.5) - 0.5);
        float line = min(grid.x, grid.y);
        float gridLine = 1.0 - smoothstep(0.0, 0.04, line);
        float depthFactor = smoothstep(0.0, 8.0, vDepth);
        vec3 color = mix(uGridColor, uDepthColor, depthFactor);
        color = min(mix(color, color * 1.24, gridLine), vec3(1.0));
        float alpha = gridLine * (0.34 + depthFactor * 0.5);
        alpha = max(alpha, depthFactor * 0.2);
        float edgeDist = max(abs(vLocalXZ.x), abs(vLocalXZ.y)) / uHalfSize;
        alpha *= 1.0 - smoothstep(0.78, 1.0, edgeDist);
        gl_FragColor = vec4(color, alpha);
      }
    `,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  }), [gridSize]);

  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame(() => {
    const source = livePhysicsRef?.current?.length ? livePhysicsRef.current : bodies;
    const G = gravityConstant(realisticMode);
    const slots = material.uniforms.uBodies.value as THREE.Vector4[];
    const list = source.length > MAX_GRID_BODIES
      ? [...source].sort((a, b) => b.mass - a.mass).slice(0, MAX_GRID_BODIES)
      : source;
    for (let i = 0; i < list.length; i++) {
      slots[i].set(list[i].position[0], list[i].position[2], G * list[i].mass, 0);
    }
    material.uniforms.uBodyCount.value = list.length;
  });

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      material={material}
      scale={[universeScale, 1, universeScale]}
      onPointerDown={onGridPointerDown ? (e) => { e.stopPropagation(); onGridPointerDown(toGridEvent(e)); } : undefined}
      onPointerMove={onGridPointerMove ? (e) => onGridPointerMove(toGridEvent(e)) : undefined}
      onPointerUp={onGridPointerUp ? (e) => onGridPointerUp(toGridEvent(e)) : undefined}
    />
  );
};

export default SpacetimeGrid;
