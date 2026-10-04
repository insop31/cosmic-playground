import { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

// Particles carry their own age so the shader can ramp colour, size and alpha.
const makeParticleMaterial = (kind: 'flame' | 'smoke') => new THREE.ShaderMaterial({
  uniforms: {
    uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
    uSize: { value: kind === 'flame' ? 0.34 : 3.2 },
  },
  vertexShader: /* glsl */ `
    attribute float aLife;
    attribute float aSeed;
    uniform float uPixelRatio;
    uniform float uSize;
    varying float vLife;
    varying float vSeed;
    void main() {
      vLife = aLife;
      vSeed = aSeed;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      float grow = ${kind === 'flame' ? 'mix(0.55, 1.4, 1.0 - aLife)' : 'mix(2.6, 0.7, aLife)'};
      gl_PointSize = uSize * grow * uPixelRatio * (300.0 / -mv.z);
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: /* glsl */ `
    varying float vLife;
    varying float vSeed;
    void main() {
      vec2 c = gl_PointCoord - 0.5;
      float d = length(c);
      float soft = smoothstep(0.5, 0.0, d);
      ${kind === 'flame'
        ? `vec3 hot = vec3(1.0, 0.95, 0.85);
           vec3 mid = vec3(1.0, 0.58, 0.16);
           vec3 cool = vec3(0.75, 0.16, 0.04);
           vec3 col = mix(cool, mid, smoothstep(0.15, 0.6, vLife));
           col = mix(col, hot, smoothstep(0.65, 1.0, vLife));
           float a = soft * smoothstep(0.0, 0.35, vLife);
           gl_FragColor = vec4(col * 2.2 * a, a);`
        : `vec3 col = mix(vec3(0.42, 0.42, 0.44), vec3(0.72, 0.7, 0.68), vSeed);
           float a = pow(max(soft, 0.0), 1.6) * smoothstep(0.0, 0.6, vLife) * smoothstep(1.0, 0.85, vLife) * 0.14;
           gl_FragColor = vec4(col, a);`}
    }
  `,
  transparent: true,
  depthWrite: false,
  blending: kind === 'flame' ? THREE.AdditiveBlending : THREE.NormalBlending,
  toneMapped: kind !== 'flame',
});

const FlameParticles = ({ active, intensity = 1 }: { active: boolean; intensity?: number }) => {
  const count = 260;
  const pointsRef = useRef<THREE.Points>(null);

  const { geometry, velocities, lifetimes } = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const life = new Float32Array(count);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      life[i] = Math.random();
      seed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aLife', new THREE.BufferAttribute(life, 1));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    return { geometry: geo, velocities: new Float32Array(count * 3), lifetimes: life };
  }, []);
  const material = useMemo(() => makeParticleMaterial('flame'), []);

  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);

  useFrame((_, delta) => {
    if (!pointsRef.current || !active) return;
    const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
    const lifeAttr = geometry.getAttribute('aLife') as THREE.BufferAttribute;
    const arr = posAttr.array as Float32Array;
    const spread = 0.12 * Math.sqrt(intensity);

    for (let i = 0; i < count; i++) {
      lifetimes[i] -= delta * 3;
      if (lifetimes[i] <= 0) {
        lifetimes[i] = 1;
        arr[i * 3] = (Math.random() - 0.5) * spread;
        arr[i * 3 + 1] = 0;
        arr[i * 3 + 2] = (Math.random() - 0.5) * spread;
        velocities[i * 3] = (Math.random() - 0.5) * 0.5;
        velocities[i * 3 + 1] = -(2 + Math.random() * 3) * intensity;
        velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.5;
      }
      arr[i * 3] += velocities[i * 3] * delta;
      arr[i * 3 + 1] += velocities[i * 3 + 1] * delta;
      arr[i * 3 + 2] += velocities[i * 3 + 2] * delta;
    }
    posAttr.needsUpdate = true;
    lifeAttr.needsUpdate = true;
  });

  if (!active) return null;

  return <points ref={pointsRef} geometry={geometry} material={material} frustumCulled={false} />;
};

const SmokeParticles = ({ active }: { active: boolean }) => {
  const count = 140;
  const pointsRef = useRef<THREE.Points>(null);

  const { geometry, velocities, lifetimes } = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const life = new Float32Array(count);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      life[i] = Math.random();
      seed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aLife', new THREE.BufferAttribute(life, 1));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    return { geometry: geo, velocities: new Float32Array(count * 3), lifetimes: life };
  }, []);
  const material = useMemo(() => makeParticleMaterial('smoke'), []);

  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);

  useFrame((_, delta) => {
    if (!pointsRef.current || !active) return;
    const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
    const lifeAttr = geometry.getAttribute('aLife') as THREE.BufferAttribute;
    const arr = posAttr.array as Float32Array;

    for (let i = 0; i < count; i++) {
      lifetimes[i] -= delta * 1.2;
      if (lifetimes[i] <= 0) {
        lifetimes[i] = 1;
        arr[i * 3] = (Math.random() - 0.5) * 1;
        arr[i * 3 + 1] = -0.5;
        arr[i * 3 + 2] = (Math.random() - 0.5) * 1;
        const angle = Math.random() * Math.PI * 2;
        const speed = 1 + Math.random() * 1.6;
        velocities[i * 3] = Math.cos(angle) * speed;
        velocities[i * 3 + 1] = -0.3 + Math.random() * 0.6;
        velocities[i * 3 + 2] = Math.sin(angle) * speed;
      }
      arr[i * 3] += velocities[i * 3] * delta;
      arr[i * 3 + 1] += velocities[i * 3 + 1] * delta;
      arr[i * 3 + 2] += velocities[i * 3 + 2] * delta;
      velocities[i * 3 + 1] += delta * 0.35; // smoke rises as it cools
    }
    posAttr.needsUpdate = true;
    lifeAttr.needsUpdate = true;
  });

  if (!active) return null;

  return <points ref={pointsRef} geometry={geometry} material={material} frustumCulled={false} />;
};

export { FlameParticles, SmokeParticles };
