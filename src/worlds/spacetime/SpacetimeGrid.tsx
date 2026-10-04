import { useEffect, useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { MAX_WELLS, WELL_GLSL, wellField } from './wellField';

interface SpacetimeGridProps {
  gridSize?: number;
  gridResolution?: number;
  universeScale?: number;
  onPointerDown?: (event: ThreeEvent<PointerEvent>) => void;
  onPointerMove?: (event: ThreeEvent<PointerEvent>) => void;
  onPointerUp?: (event: ThreeEvent<PointerEvent>) => void;
  onPointerLeave?: (event: ThreeEvent<PointerEvent>) => void;
}

/**
 * The spacetime sheet. Deformation happens in the vertex shader from the live
 * well list (wellField), so the CPU no longer rewrites 25k vertices a frame.
 * The CPU geometry stays flat at y = 0, which is exactly the plane the physics
 * runs on, so pointer picking returns simulation coordinates directly.
 */
const SpacetimeGrid = ({
  gridSize = 220,
  gridResolution = 200,
  universeScale = 1,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerLeave,
}: SpacetimeGridProps) => {
  const meshRef = useRef<THREE.Mesh>(null);

  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(gridSize, gridSize, gridResolution, gridResolution);
    geo.rotateX(-Math.PI / 2);
    return geo;
  }, [gridSize, gridResolution]);

  const material = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uWells: { value: Array.from({ length: MAX_WELLS }, () => new THREE.Vector4()) },
      uWellCount: { value: 0 },
      uUniverseScale: { value: 1 },
      uHalfExtent: { value: gridSize / 2 },
    },
    vertexShader: /* glsl */ `
      ${WELL_GLSL}
      varying vec3 vWorld;
      varying float vDepth;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        float depth = surfaceDepth(world.xz);
        world.y -= depth;
        vWorld = world.xyz;
        vDepth = depth;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uUniverseScale;
      uniform float uHalfExtent;
      varying vec3 vWorld;
      varying float vDepth;

      // Anti-aliased grid line: constant pixel width at any zoom.
      float gridLine(vec2 coord, float widthPx) {
        vec2 g = abs(fract(coord - 0.5) - 0.5) / max(fwidth(coord), vec2(1e-4));
        return 1.0 - clamp(min(g.x, g.y) / widthPx, 0.0, 1.0);
      }

      void main() {
        // Line spacing stretches with the universe, so expansion is visible as growing cells.
        vec2 coord = vWorld.xz / uUniverseScale;
        float minor = gridLine(coord / 2.0, 1.0);
        float major = gridLine(coord / 10.0, 1.4);

        vec3 cyan = vec3(0.247, 0.847, 0.961);
        vec3 cobalt = vec3(0.227, 0.388, 1.0);
        vec3 violet = vec3(0.56, 0.38, 1.0);
        float d = clamp(vDepth, 0.0, 12.0);
        vec3 lineColor = mix(cyan, cobalt, smoothstep(0.4, 3.5, d));
        lineColor = mix(lineColor, violet, smoothstep(4.0, 9.0, d));

        float lines = max(minor * 0.42, major);
        float alpha = lines * (0.32 + 0.4 * smoothstep(0.2, 5.0, d));

        // Faint fill so deep wells read as a surface, not just a wire cage.
        vec3 fill = cobalt * 0.35;
        float fillAlpha = 0.025 + 0.06 * smoothstep(0.5, 8.0, d);
        vec3 color = mix(fill, lineColor, lines);
        alpha = max(alpha, fillAlpha);

        // Fade toward the sheet's edge.
        float edge = max(abs(vWorld.x), abs(vWorld.z)) / (uHalfExtent * uUniverseScale);
        alpha *= 1.0 - smoothstep(0.7, 1.0, edge);

        gl_FragColor = vec4(color, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  }), [gridSize]);

  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);

  useFrame(() => {
    const uniforms = material.uniforms;
    const wells = uniforms.uWells.value as THREE.Vector4[];
    for (let i = 0; i < wellField.count; i++) {
      wells[i].fromArray(wellField.data, i * 4);
    }
    uniforms.uWellCount.value = wellField.count;
    uniforms.uUniverseScale.value = universeScale;
    meshRef.current?.scale.set(universeScale, 1, universeScale);
  });

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      material={material}
      renderOrder={-1}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerLeave}
    />
  );
};

export default SpacetimeGrid;
