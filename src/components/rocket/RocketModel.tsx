import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { FlameParticles, SmokeParticles } from './Particles';
import { OrbitPathState, RocketParams, RocketState } from './rocketTypes';

interface RocketModelProps {
  params: RocketParams;
  state: RocketState;
  onUpdateState: (updater: (prev: RocketState) => RocketState) => void;
  timeScale: number;
}

const ROCKET_SCALE = 1.75;
const TRAJECTORY_LIMIT = 2400;
const ESCAPE_VELOCITY = 1.1;
const MIN_ORBITAL_SPEED = 0.32;
const ORBIT_ALTITUDE_THRESHOLD = 45;

const appendTrajectoryPoint = (trajectory: [number, number][], point: [number, number]) => {
  const next = [...trajectory, point];
  return next.length > TRAJECTORY_LIMIT ? next.slice(next.length - TRAJECTORY_LIMIT) : next;
};

const normalizeVector = (x: number, y: number): [number, number] => {
  const length = Math.hypot(x, y) || 1;
  return [x / length, y / length];
};

const computeRocketAngle = (vx: number, vy: number) => {
  const safeVy = Math.abs(vy) < 0.001 ? (vy >= 0 ? 0.001 : -0.001) : vy;
  return Math.atan2(vx, safeVy);
};

const smoothRotateZ = (current: number, target: number, factor: number) => {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + delta * factor;
};

const smoothMove = (current: number, target: number, smoothing: number, dt: number) =>
  THREE.MathUtils.damp(current, target, smoothing, dt);

const buildOrbitPath = (
  px: number,
  py: number,
  vx: number,
  vy: number,
  planetRadius: number
): OrbitPathState | null => {
  const focus: [number, number] = [0, -planetRadius];
  const rx = px - focus[0];
  const ry = py - focus[1];
  const radius = Math.hypot(rx, ry);
  if (radius < planetRadius + 10) return null;

  const axisDirection = normalizeVector(rx, ry);
  const tangentSeed: [number, number] = [-axisDirection[1], axisDirection[0]];
  const tangentDot = vx * tangentSeed[0] + vy * tangentSeed[1];
  const tangentSign = tangentDot >= 0 ? 1 : -1;
  const perpendicularDirection: [number, number] = [tangentSeed[0] * tangentSign, tangentSeed[1] * tangentSign];

  const totalSpeed = Math.hypot(vx, vy);
  const tangentialSpeed = Math.abs(vx * perpendicularDirection[0] + vy * perpendicularDirection[1]);
  const radialSpeed = Math.abs(vx * axisDirection[0] + vy * axisDirection[1]);
  const speedRatio = THREE.MathUtils.clamp(tangentialSpeed / ESCAPE_VELOCITY, 0.45, 0.92);
  const eccentricity = THREE.MathUtils.clamp(
    0.62 - (speedRatio - 0.55) * 0.9 + (radialSpeed / Math.max(totalSpeed, 0.001)) * 0.28,
    0.16,
    0.72
  );
  const semiMajorAxis = radius / (1 - eccentricity);
  const semiMinorAxis = semiMajorAxis * Math.sqrt(1 - eccentricity * eccentricity);
  const center: [number, number] = [
    focus[0] - axisDirection[0] * semiMajorAxis * eccentricity,
    focus[1] - axisDirection[1] * semiMajorAxis * eccentricity,
  ];

  return {
    center,
    focus,
    semiMajorAxis,
    semiMinorAxis,
    eccentricity,
    axisDirection,
    perpendicularDirection,
    angle: 0,
    angularSpeed: THREE.MathUtils.clamp(tangentialSpeed / Math.max(radius, 1), 0.18, 0.52),
  };
};

const RocketModel = ({ params, state, onUpdateState, timeScale }: RocketModelProps) => {
  const groupRef = useRef<THREE.Group>(null);
  const velocityRef = useRef<[number, number]>([0, 0]);
  const posRef = useRef<[number, number]>([0, 0]);
  const fuelRef = useRef(1);
  const prevPhaseRef = useRef(state.phase);
  const historyRef = useRef<{vx: number, vy: number, px: number, py: number, fuel: number, uiState: RocketState}[]>([]);

  // Reset refs when state resets to idle
  if (state.phase === 'idle' && prevPhaseRef.current !== 'idle') {
    velocityRef.current = [0, 0];
    posRef.current = [0, 0];
    fuelRef.current = 1;
    historyRef.current = [];
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
    historyRef.current = [];
    if (groupRef.current) {
      groupRef.current.position.set(0, 1.2, 0);
      groupRef.current.rotation.set(0, 0, 0);
    }
  }
  prevPhaseRef.current = state.phase;

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    if (timeScale === 0) return;

    if (timeScale < 0) {
      if (state.phase === 'idle') return;
      
      const steps = Math.max(1, Math.round(Math.abs(timeScale)));
      let lastSnap = null;
      for (let s = 0; s < steps; s++) {
        const snap = historyRef.current.pop();
        if (!snap) break;
        lastSnap = snap;
      }
      
      if (lastSnap) {
        velocityRef.current = [lastSnap.vx, lastSnap.vy];
        posRef.current = [lastSnap.px, lastSnap.py];
        fuelRef.current = lastSnap.fuel;
        
        groupRef.current.position.set(lastSnap.px * 2, 1.2 + lastSnap.py * 2, 0);
        const rocketAngle = computeRocketAngle(lastSnap.vx, lastSnap.vy);
        groupRef.current.rotation.z = -rocketAngle;
        
        onUpdateState(() => lastSnap.uiState);
      }
      return;
    }

    const isEscaping = state.phase === 'outcome' && state.outcome === 'escape';
    const isOrbiting = state.phase === 'outcome' && state.outcome === 'orbiting' && state.orbit;
    if (state.phase !== 'launching' && state.phase !== 'coasting' && !isEscaping && !isOrbiting) {
      return;
    }

    historyRef.current.push({
      vx: velocityRef.current[0],
      vy: velocityRef.current[1],
      px: posRef.current[0],
      py: posRef.current[1],
      fuel: fuelRef.current,
      uiState: state
    });
    if (historyRef.current.length > 3600) historyRef.current.shift();

    const dt = Math.min(delta * timeScale, 0.1); // clamp delta for stable integration
    const renderDt = Math.min(delta, 0.05);
    const effectiveLaunchAngle = params.launchAngle + params.padTilt;
    const angleRad = (effectiveLaunchAngle * Math.PI) / 180;
    let [vx, vy] = velocityRef.current;
    let [px, py] = posRef.current;
    let fuel = fuelRef.current;

    if (isOrbiting && state.orbit) {
      const currentOrbit = state.orbit;
      const [axisX, axisY] = currentOrbit.axisDirection;
      const [perpX, perpY] = currentOrbit.perpendicularDirection;
      const relFocusX = px - currentOrbit.focus[0];
      const relFocusY = py - currentOrbit.focus[1];
      const focusRadius = Math.max(Math.hypot(relFocusX, relFocusY), 1);
      const orbitalRate = currentOrbit.angularSpeed * THREE.MathUtils.clamp(currentOrbit.semiMajorAxis / focusRadius, 0.75, 1.8);
      const nextAngle = currentOrbit.angle + dt * orbitalRate;
      const cosTheta = Math.cos(nextAngle);
      const sinTheta = Math.sin(nextAngle);

      px = currentOrbit.center[0] + axisX * currentOrbit.semiMajorAxis * cosTheta + perpX * currentOrbit.semiMinorAxis * sinTheta;
      py = currentOrbit.center[1] + axisY * currentOrbit.semiMajorAxis * cosTheta + perpY * currentOrbit.semiMinorAxis * sinTheta;

      vx = (-axisX * currentOrbit.semiMajorAxis * sinTheta + perpX * currentOrbit.semiMinorAxis * cosTheta) * orbitalRate;
      vy = (-axisY * currentOrbit.semiMajorAxis * sinTheta + perpY * currentOrbit.semiMinorAxis * cosTheta) * orbitalRate;

      velocityRef.current = [vx, vy];
      posRef.current = [px, py];

      const targetX = px * 2;
      const targetY = 1.2 + py * 2;
      groupRef.current.position.set(
        smoothMove(groupRef.current.position.x, targetX, 18, renderDt),
        smoothMove(groupRef.current.position.y, targetY, 18, renderDt),
        smoothMove(groupRef.current.position.z, 0, 18, renderDt),
      );
      const rocketAngle = computeRocketAngle(vx, vy);
      groupRef.current.rotation.z = smoothRotateZ(
        groupRef.current.rotation.z,
        -rocketAngle,
        Math.min(1, renderDt * 10),
      );

      onUpdateState((prev) => ({
        ...prev,
        altitude: py,
        maxAltitude: Math.max(prev.maxAltitude, py),
        velocity: [vx, vy],
        elapsed: prev.elapsed + dt,
        position: [px, py, 0],
        orbit: prev.orbit ? { ...prev.orbit, angle: nextAngle } : prev.orbit,
        trajectory: appendTrajectoryPoint(prev.trajectory, [px, py]),
      }));
      return;
    }

    if (isEscaping) {
      // Just keep flying linearly out of the camera's view, but still update the trajectory trail!
      px += vx * dt;
      py += vy * dt;
      posRef.current = [px, py];
      const targetX = px * 2;
      const targetY = 1.2 + py * 2;
      groupRef.current.position.set(
        smoothMove(groupRef.current.position.x, targetX, 16, renderDt),
        smoothMove(groupRef.current.position.y, targetY, 16, renderDt),
        smoothMove(groupRef.current.position.z, 0, 16, renderDt),
      );
      const rocketAngle = computeRocketAngle(vx, vy);
      groupRef.current.rotation.z = smoothRotateZ(
        groupRef.current.rotation.z,
        -rocketAngle,
        Math.min(1, renderDt * 9),
      );
      onUpdateState((prev) => ({
        ...prev,
        position: [px, py, 0],
        altitude: py,
        maxAltitude: Math.max(prev.maxAltitude, py),
        trajectory: appendTrajectoryPoint(prev.trajectory, [px, py]),
      }));
      return;
    }

    if (fuel > 0 && state.phase === 'launching') {
      const currentMass = params.dryMass + fuel * params.fuelMass;
      const pressureFactor = THREE.MathUtils.clamp(1.04 - (params.atmosphericPressure - 1) * 0.22, 0.78, 1.14);
      const temperatureFactor = THREE.MathUtils.clamp(1 - (params.ambientTemperature - 15) * 0.0024, 0.82, 1.08);
      const thrustEnvironmentFactor = pressureFactor * temperatureFactor;
      const thrustAcc = (params.thrustForce * thrustEnvironmentFactor) / currentMass;
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
    const shearWave = Math.sin((state.elapsed + dt) * 0.9 + py * 0.35) * params.windShear;
    const wind = params.crosswind * (1 + shearWave) * atmosphereFactor;
    vx += wind * dt * 0.0011;

    const thermalPenalty = 1 + params.thermalLoad * Math.max(0, speed - 0.3) * atmosphereFactor * 1.8;
    const dragForce = 0.5 * params.dragCoefficient * atmosphereFactor * speed * speed * 0.003 * thermalPenalty;
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
      onUpdateState((prev) => ({
        ...prev,
        phase: 'outcome',
        outcome: prev.maxAltitude > 25 ? 'suborbital' : 'crashed',
        position: [px, 0, 0],
        altitude: 0,
        orbit: null,
      }));
      return;
    }

    // Escape / orbit detection
    if (py > ORBIT_ALTITUDE_THRESHOLD) {
      const totalSpeed = Math.sqrt(vx * vx + vy * vy);
      const focusY = -params.planetRadius;
      const [radialX, radialY] = normalizeVector(px, py - focusY);
      const tangentialX = -radialY;
      const tangentialY = radialX;
      const tangentialSpeed = Math.abs(vx * tangentialX + vy * tangentialY);
      const tangentialRatio = tangentialSpeed / Math.max(totalSpeed, 0.001);

      if (tangentialRatio > 0.64 && tangentialSpeed > MIN_ORBITAL_SPEED && totalSpeed <= ESCAPE_VELOCITY) {
        const orbit = buildOrbitPath(px, py, vx, vy, params.planetRadius);
        if (orbit) {
          onUpdateState((prev) => ({
            ...prev,
            phase: 'outcome',
            outcome: 'orbiting',
            position: [px, py, 0],
            velocity: [vx, vy],
            orbit,
            trajectory: appendTrajectoryPoint(prev.trajectory, [px, py]),
          }));
          return;
        }
      }

      if (totalSpeed > ESCAPE_VELOCITY) {
        onUpdateState((prev) => ({
          ...prev,
          phase: 'outcome',
          outcome: 'escape',
          position: [px, py, 0],
          orbit: null,
        }));
        return;
      }
    }

    // Update visual position
    const targetX = px * 2;
    const targetY = 1.2 + py * 2;
    groupRef.current.position.set(
      smoothMove(groupRef.current.position.x, targetX, 16, renderDt),
      smoothMove(groupRef.current.position.y, targetY, 16, renderDt),
      smoothMove(groupRef.current.position.z, 0, 16, renderDt),
    );
    const rocketAngle = computeRocketAngle(vx, vy);
    groupRef.current.rotation.z = smoothRotateZ(
      groupRef.current.rotation.z,
      -rocketAngle,
      Math.min(1, renderDt * 12),
    );

    onUpdateState((prev) => ({
      ...prev,
      altitude: py,
      maxAltitude: Math.max(prev.maxAltitude, py),
      fuel: Math.max(fuel, 0),
      velocity: [vx, vy],
      elapsed: prev.elapsed + dt,
      position: [px, py, 0],
      orbit: null,
      trajectory: appendTrajectoryPoint(prev.trajectory, [px, py]),
    }));
  });

  const isThrusting = state.phase === 'launching' && fuelRef.current > 0;

  return (
    <group ref={groupRef} position={[0, 1.2, 0]} scale={[ROCKET_SCALE, ROCKET_SCALE, ROCKET_SCALE]}>
      {/* Rocket body */}
      <mesh position={[0, 0.8, 0]}>
        <cylinderGeometry args={[0.12, 0.18, 1.6, 12]} />
        <meshStandardMaterial color="#f5f7fa" emissive="#1f2937" emissiveIntensity={0.16} metalness={0.65} roughness={0.18} />
      </mesh>

      {/* Nose cone */}
      <mesh position={[0, 1.8, 0]}>
        <coneGeometry args={[0.12, 0.5, 12]} />
        <meshStandardMaterial color="#ff5a5a" emissive="#7f1d1d" emissiveIntensity={0.22} metalness={0.45} roughness={0.28} />
      </mesh>

      {/* Fins */}
      {[0, Math.PI / 2, Math.PI, Math.PI * 1.5].map((rot, i) => (
        <mesh key={i} position={[Math.sin(rot) * 0.18, 0.1, Math.cos(rot) * 0.18]} rotation={[0, rot, 0]}>
          <boxGeometry args={[0.02, 0.3, 0.2]} />
          <meshStandardMaterial color="#ff4d4d" emissive="#7f1d1d" emissiveIntensity={0.16} metalness={0.4} roughness={0.34} />
        </mesh>
      ))}

      {/* Engine nozzle */}
      <mesh position={[0, -0.1, 0]}>
        <cylinderGeometry args={[0.08, 0.15, 0.2, 12]} />
        <meshStandardMaterial color="#2b3442" emissive="#111827" emissiveIntensity={0.15} metalness={0.85} roughness={0.12} />
      </mesh>

      {/* Stage separator line */}
      {params.stageSeparation && (
        <mesh position={[0, 0.4, 0]}>
          <torusGeometry args={[0.19, 0.01, 8, 24]} />
          <meshStandardMaterial color="#ffd166" emissive="#ffcc00" emissiveIntensity={0.75} />
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
