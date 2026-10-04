import { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { NOISE_GLSL } from '@/stage/materials';

// Star colour by spectral class, weighted toward cooler stars like the real sky.
const STAR_TINTS: [number, string][] = [
  [0.08, '#9db4ff'], // O/B blue-white
  [0.22, '#cad7ff'], // A white
  [0.45, '#f8f7ff'], // F
  [0.7, '#fff4ea'],  // G yellow-white
  [0.88, '#ffd2a1'], // K orange
  [1.0, '#ffb07a'],  // M red
];

interface StarfieldProps {
  count?: number;
  innerRadius?: number;
  depth?: number;
  nebula?: boolean;
}

const Starfield = ({ count = 4200, innerRadius = 90, depth = 160, nebula = true }: StarfieldProps) => {
  const pointsRef = useRef<THREE.Points>(null);

  const geometry = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const phase = new Float32Array(count);
    const tmp = new THREE.Color();

    for (let i = 0; i < count; i++) {
      const r = innerRadius + Math.random() * depth;
      const theta = Math.random() * Math.PI * 2;
      // Bias a share of stars toward a tilted galactic plane
      let phi = Math.acos(2 * Math.random() - 1);
      if (Math.random() < 0.35) phi = Math.PI / 2 + (Math.random() - 0.5) * 0.35;

      const x = r * Math.sin(phi) * Math.cos(theta);
      const y = r * Math.sin(phi) * Math.sin(theta);
      const z = r * Math.cos(phi);
      // tilt the band
      pos[i * 3] = x;
      pos[i * 3 + 1] = y * 0.82 + z * 0.57;
      pos[i * 3 + 2] = -y * 0.57 + z * 0.82;

      const pick = Math.random();
      const tint = STAR_TINTS.find(([threshold]) => pick <= threshold)?.[1] ?? '#ffffff';
      tmp.set(tint);
      col[i * 3] = tmp.r;
      col[i * 3 + 1] = tmp.g;
      col[i * 3 + 2] = tmp.b;

      // Few bright stars, many faint ones
      size[i] = 0.6 + Math.pow(Math.random(), 6) * 3.4;
      phase[i] = Math.random() * Math.PI * 2;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    return geo;
  }, [count, depth, innerRadius]);

  const material = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
    },
    vertexShader: /* glsl */ `
      attribute float aSize;
      attribute float aPhase;
      uniform float uTime;
      uniform float uPixelRatio;
      varying vec3 vColor;
      varying float vTwinkle;
      void main() {
        vColor = color;
        vTwinkle = 0.75 + 0.25 * sin(uTime * (0.6 + fract(aPhase) * 1.8) + aPhase);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * uPixelRatio * (220.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vTwinkle;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        float core = smoothstep(0.5, 0.0, d);
        float a = pow(max(core, 0.0), 2.2) * vTwinkle;
        if (a < 0.01) discard;
        gl_FragColor = vec4(vColor * a * 1.4, a);
      }
    `,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  }), []);

  const nebulaMaterial = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      uniform float uTime;
      ${NOISE_GLSL}
      void main() {
        vec3 d = normalize(vDir);
        // galactic band, tilted to match the starfield
        vec3 axis = normalize(vec3(0.0, 0.82, -0.57));
        float bd = dot(d, axis) * 3.2;
        float band = exp(-bd * bd);
        float n = fbm3(d * 2.4 + vec3(0.0, 0.0, uTime * 0.002));
        float wisps = smoothstep(-0.1, 0.7, n + snoise(d * 6.0) * 0.2);
        vec3 teal = vec3(0.02, 0.10, 0.16);
        vec3 violet = vec3(0.12, 0.03, 0.18);
        vec3 col = mix(teal, violet, smoothstep(-0.3, 0.5, snoise(d * 1.6 + 4.0) * 0.5));
        float intensity = wisps * wisps * (0.08 + band * 0.42);
        // dark dust lane through the band
        intensity *= 1.0 - band * smoothstep(0.1, 0.6, fbm3(d * 4.0 + 9.0)) * 0.7;
        gl_FragColor = vec4(col * intensity, 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  }), []);

  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
    nebulaMaterial.dispose();
  }, [geometry, material, nebulaMaterial]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    material.uniforms.uTime.value = t;
    nebulaMaterial.uniforms.uTime.value = t;
    if (pointsRef.current) {
      pointsRef.current.rotation.y = t * 0.003;
    }
  });

  return (
    <group>
      {nebula && (
        <mesh material={nebulaMaterial} renderOrder={-10} frustumCulled={false}>
          <sphereGeometry args={[innerRadius + depth + 40, 48, 32]} />
        </mesh>
      )}
      <points ref={pointsRef} geometry={geometry} material={material} frustumCulled={false} />
    </group>
  );
};

export default Starfield;
