import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { FlameParticles, SmokeParticles } from './Particles';
import { RocketParams, RocketState } from './rocketTypes';

interface RocketModelProps {
  params: RocketParams;
  state: RocketState;
  onUpdateState: (updater: (prev: RocketState) => RocketState) => void;
}

const RocketModel = ({ params, state, onUpdateState }: RocketModelProps) => {
  const groupRef = useRef<THREE.Group>(null);
  const velocityRef = useRef<[number, number]>([0, 0]);
  const posRef = useRef<[number, number]>([0, 0]);
  const fuelRef = useRef(1);
  const prevPhaseRef = useRef(state.phase);

  // Reset refs when state resets to idle
  if (state.phase === 'idle' && prevPhaseRef.current !== 'idle') {
    velocityRef.current = [0, 0];
    posRef.current = [0, 0];
    fuelRef.current = 1;
    if (groupRef.current) {
      groupRef.current.position.set(0, 1.2, 0);
      groupRef.current.rotation.set(0, 0, 0);
    }
  }
  // Also reset when launching starts fresh
  if (state.phase === 'launching' && prevPhaseRef.current === 'idle') {
    velocityRef.current = [0, 0];
    posRef.current = [0, 0];
    fuelRef.current = 1;
    if (groupRef.current) {
      groupRef.current.position.set(0, 1.2, 0);
      groupRef.current.rotation.set(0, 0, 0);
    }
  }
  prevPhaseRef.current = state.phase;

  useFrame((_, delta) => {
    if (!groupRef.current) return;

    const isEscaping = state.phase === 'outcome' && state.outcome === 'escape';
    if (state.phase !== 'launching' && state.phase !== 'coasting' && !isEscaping) {
      return;
    }

    const dt = Math.min(delta, 0.05); // clamp delta for stable integration
    const angleRad = (params.launchAngle * Math.PI) / 180;
    let [vx, vy] = velocityRef.current;
    let [px, py] = posRef.current;
    let fuel = fuelRef.current;

    if (isEscaping) {
      // Just keep flying linearly out of the camera's view, but still update the trajectory trail!
      px += vx * dt;
      py += vy * dt;
      posRef.current = [px, py];
      groupRef.current.position.set(px * 2, 1.2 + py * 2, 0);
      onUpdateState((prev) => ({
        ...prev,
        position: [px, py, 0],
        altitude: py,
        maxAltitude: Math.max(prev.maxAltitude, py),
        trajectory: [...prev.trajectory, [px, py]],
      }));
      return;
    }

    if (fuel > 0 && state.phase === 'launching') {
      const currentMass = params.dryMass + fuel * params.fuelMass;
      const thrustAcc = params.thrustForce / currentMass;
      vx += Math.sin(angleRad) * thrustAcc * dt;
      vy += Math.cos(angleRad) * thrustAcc * dt;
      fuel -= dt / params.burnDuration;

      if (fuel <= 0) {
        fuel = 0;
        onUpdateState((prev) => ({ ...prev, phase: 'coasting', fuel: 0 }));
      }
    }

    // Gravity
    vy -= params.gravity * dt * 0.01;

    // Drag
    const speed = Math.sqrt(vx * vx + vy * vy);
    const atmosphereFactor = Math.max(0, 1 - py * 0.015) * params.atmosphericDensity;
    const dragForce = 0.5 * params.dragCoefficient * atmosphereFactor * speed * speed * 0.003;
    if (speed > 0.001) {
      vx -= (vx / speed) * dragForce * dt;
      vy -= (vy / speed) * dragForce * dt;
    }

    px += vx * dt;
    py += vy * dt;

    velocityRef.current = [vx, vy];
    posRef.current = [px, py];
    fuelRef.current = fuel;

    // Check crash
    if (py < 0 && (vx !== 0 || vy !== 0)) {
      py = 0;
      const maxAlt = Math.max(state.maxAltitude, py);
      onUpdateState((prev) => ({
        ...prev,
        phase: 'outcome',
        outcome: prev.maxAltitude > 25 ? 'suborbital' : 'crashed',
        position: [px, 0, 0],
        altitude: 0,
      }));
      return;
    }

    // Escape / orbit detection
    if (py > 50) {
      const totalSpeed = Math.sqrt(vx * vx + vy * vy);
      const escapeVel = 0.8;
      onUpdateState((prev) => ({
        ...prev,
        phase: 'outcome',
        outcome: totalSpeed > escapeVel ? 'escape' : 'orbiting',
        position: [px, py, 0],
      }));
      return;
    }

    // Update visual position
    groupRef.current.position.set(px * 2, 1.2 + py * 2, 0);
    const rocketAngle = Math.atan2(vx, Math.max(vy, 0.001));
    groupRef.current.rotation.z = THREE.MathUtils.lerp(
      groupRef.current.rotation.z,
      -rocketAngle,
      Math.min(1, dt * 10)
    );

    onUpdateState((prev) => ({
      ...prev,
      altitude: py,
      maxAltitude: Math.max(prev.maxAltitude, py),
      fuel: Math.max(fuel, 0),
      velocity: [vx, vy],
      elapsed: prev.elapsed + dt,
      position: [px, py, 0],
      trajectory: [...prev.trajectory, [px, py]],
    }));
  });

  const isThrusting = state.phase === 'launching' && fuelRef.current > 0;

  return (
    <group ref={groupRef} position={[0, 1.2, 0]}>
      {/* Rocket body */}
      <mesh position={[0, 0.8, 0]}>
        <cylinderGeometry args={[0.12, 0.18, 1.6, 12]} />
        <meshStandardMaterial color="#cccccc" metalness={0.8} roughness={0.2} />
      </mesh>

      {/* Nose cone */}
      <mesh position={[0, 1.8, 0]}>
        <coneGeometry args={[0.12, 0.5, 12]} />
        <meshStandardMaterial color="#ff3333" metalness={0.6} roughness={0.3} />
      </mesh>

      {/* Fins */}
      {[0, Math.PI / 2, Math.PI, Math.PI * 1.5].map((rot, i) => (
        <mesh key={i} position={[Math.sin(rot) * 0.18, 0.1, Math.cos(rot) * 0.18]} rotation={[0, rot, 0]}>
          <boxGeometry args={[0.02, 0.3, 0.2]} />
          <meshStandardMaterial color="#ff3333" metalness={0.5} roughness={0.4} />
        </mesh>
      ))}

      {/* Engine nozzle */}
      <mesh position={[0, -0.1, 0]}>
        <cylinderGeometry args={[0.08, 0.15, 0.2, 12]} />
        <meshStandardMaterial color="#333333" metalness={0.9} roughness={0.1} />
      </mesh>

      {/* Stage separator line */}
      {params.stageSeparation && (
        <mesh position={[0, 0.4, 0]}>
          <torusGeometry args={[0.19, 0.01, 8, 24]} />
          <meshStandardMaterial color="#ffcc00" emissive="#ffcc00" emissiveIntensity={0.5} />
        </mesh>
      )}

      {/* Flame */}
      <group position={[0, -0.2, 0]}>
        <FlameParticles active={isThrusting} intensity={params.thrustForce / 30} />
      </group>

      {/* Smoke at base */}
      <group position={[0, -0.3, 0]}>
        <SmokeParticles active={isThrusting && state.altitude < 5} />
      </group>

      {/* Engine glow */}
      {isThrusting && (
        <pointLight position={[0, -0.3, 0]} color="#ff4400" intensity={3} distance={8} />
      )}
    </group>
  );
};

export default RocketModel;
