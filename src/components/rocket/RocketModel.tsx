import { useRef, useMemo } from 'react';
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

  // Reset refs when state resets
  if (state.phase === 'idle') {
    velocityRef.current = [0, 0];
    posRef.current = [0, 0];
    fuelRef.current = 1;
  }

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    if (state.phase !== 'launching' && state.phase !== 'coasting') {
      // Position rocket at pad
      groupRef.current.position.set(0, 1.2, 0);
      groupRef.current.rotation.set(0, 0, 0);
      return;
    }

    const dt = delta * 2; // speed up sim a bit
    const angleRad = (params.launchAngle * Math.PI) / 180;
    let [vx, vy] = velocityRef.current;
    let [px, py] = posRef.current;
    let fuel = fuelRef.current;

    const totalMass = params.fuelMass + params.dryMass;

    if (fuel > 0 && state.phase === 'launching') {
      const currentMass = params.dryMass + fuel * params.fuelMass;
      const thrustAcc = (params.thrustForce / (currentMass / totalMass));
      vx += Math.sin(angleRad) * thrustAcc * dt * 0.008;
      vy += Math.cos(angleRad) * thrustAcc * dt * 0.008;
      fuel -= dt / params.burnDuration;

      if (fuel <= 0) {
        fuel = 0;
        onUpdateState((prev) => ({ ...prev, phase: 'coasting', fuel: 0 }));
      }
    }

    // Gravity
    vy -= params.gravity * dt * 0.008;

    // Drag
    const speed = Math.sqrt(vx * vx + vy * vy);
    const atmosphereFactor = Math.max(0, 1 - py * 0.02) * params.atmosphericDensity;
    const dragForce = 0.5 * params.dragCoefficient * atmosphereFactor * speed * speed * 0.005;
    if (speed > 0) {
      vx -= (vx / speed) * dragForce * dt;
      vy -= (vy / speed) * dragForce * dt;
    }

    px += vx * dt;
    py += vy * dt;

    velocityRef.current = [vx, vy];
    posRef.current = [px, py];
    fuelRef.current = fuel;

    // Check outcomes
    if (py < 0 && state.elapsed > 0.5) {
      onUpdateState((prev) => ({
        ...prev,
        phase: 'outcome',
        outcome: prev.maxAltitude > 30 ? 'suborbital' : 'crashed',
        position: [px, 0, 0],
      }));
      return;
    }

    // Escape
    if (py > 60) {
      const totalSpeed = Math.sqrt(vx * vx + vy * vy);
      const escapeVel = Math.sqrt(2 * params.gravity * 0.008 * params.planetRadius);
      onUpdateState((prev) => ({
        ...prev,
        phase: 'outcome',
        outcome: totalSpeed > escapeVel ? 'escape' : 'orbiting',
      }));
      return;
    }

    // Update visual position
    groupRef.current.position.set(px * 2, 1.2 + py * 2, 0);
    // Tilt rocket in direction of velocity
    const rocketAngle = Math.atan2(vx, vy);
    groupRef.current.rotation.set(0, 0, -rocketAngle);

    onUpdateState((prev) => ({
      ...prev,
      altitude: py,
      maxAltitude: Math.max(prev.maxAltitude, py),
      fuel: Math.max(fuel, 0),
      velocity: [vx, vy],
      elapsed: prev.elapsed + dt,
      position: [px, py, 0],
      trajectory: [...prev.trajectory.slice(-500), [px, py]],
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
