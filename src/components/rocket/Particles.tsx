import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

const FlameParticles = ({ active, intensity = 1 }: { active: boolean; intensity?: number }) => {
  const count = 200;
  const pointsRef = useRef<THREE.Points>(null);

  const [positions, velocities, lifetimes] = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const vel = new Float32Array(count * 3);
    const life = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      life[i] = Math.random();
    }
    return [pos, vel, life];
  }, []);

  useFrame((_, delta) => {
    if (!pointsRef.current || !active) return;
    const posAttr = pointsRef.current.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = posAttr.array as Float32Array;

    for (let i = 0; i < count; i++) {
      lifetimes[i] -= delta * 3;
      if (lifetimes[i] <= 0) {
        // Respawn
        lifetimes[i] = 1;
        arr[i * 3] = (Math.random() - 0.5) * 0.3 * intensity;
        arr[i * 3 + 1] = 0;
        arr[i * 3 + 2] = (Math.random() - 0.5) * 0.3 * intensity;
        velocities[i * 3] = (Math.random() - 0.5) * 0.5;
        velocities[i * 3 + 1] = -(2 + Math.random() * 3) * intensity;
        velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.5;
      }
      arr[i * 3] += velocities[i * 3] * delta;
      arr[i * 3 + 1] += velocities[i * 3 + 1] * delta;
      arr[i * 3 + 2] += velocities[i * 3 + 2] * delta;
    }
    posAttr.needsUpdate = true;
  });

  if (!active) return null;

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={count} array={positions} itemSize={3} />
      </bufferGeometry>
      <pointsMaterial
        size={0.15}
        color="#ff6600"
        transparent
        opacity={0.8}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </points>
  );
};

// Smoke particles
const SmokeParticles = ({ active }: { active: boolean }) => {
  const count = 100;
  const pointsRef = useRef<THREE.Points>(null);

  const [positions, velocities, lifetimes] = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const vel = new Float32Array(count * 3);
    const life = new Float32Array(count);
    for (let i = 0; i < count; i++) life[i] = Math.random();
    return [pos, vel, life];
  }, []);

  useFrame((_, delta) => {
    if (!pointsRef.current || !active) return;
    const posAttr = pointsRef.current.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = posAttr.array as Float32Array;

    for (let i = 0; i < count; i++) {
      lifetimes[i] -= delta * 1.5;
      if (lifetimes[i] <= 0) {
        lifetimes[i] = 1;
        arr[i * 3] = (Math.random() - 0.5) * 1;
        arr[i * 3 + 1] = -0.5;
        arr[i * 3 + 2] = (Math.random() - 0.5) * 1;
        velocities[i * 3] = (Math.random() - 0.5) * 2;
        velocities[i * 3 + 1] = -0.5 + Math.random() * 0.5;
        velocities[i * 3 + 2] = (Math.random() - 0.5) * 2;
      }
      arr[i * 3] += velocities[i * 3] * delta;
      arr[i * 3 + 1] += velocities[i * 3 + 1] * delta;
      arr[i * 3 + 2] += velocities[i * 3 + 2] * delta;
    }
    posAttr.needsUpdate = true;
  });

  if (!active) return null;

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={count} array={positions} itemSize={3} />
      </bufferGeometry>
      <pointsMaterial
        size={0.3}
        color="#888888"
        transparent
        opacity={0.3}
        depthWrite={false}
      />
    </points>
  );
};

export { FlameParticles, SmokeParticles };
