import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { FlameParticles, SmokeParticles } from './Particles';
import { RocketParams, RocketState } from './rocketTypes';
import {
  FLIGHT_DT,
  ORBIT_TIME_COMPRESSION,
  initialFlightState,
  stepFlight,
  type FlightState,
  type FlightVerdict,
} from '../../physics/rocket';

interface RocketModelProps {
  params: RocketParams;
  state: RocketState;
  onUpdateState: (updater: (prev: RocketState) => RocketState) => void;
  timeScale: number;
}

const ROCKET_SCALE = 1.75;
const TRAJECTORY_LIMIT = 2400;
const MAX_FLIGHT_STEPS_PER_FRAME = 32;
const MAX_HISTORY = 3600;

interface FlightSnapshot {
  flight: FlightState;
  uiState: RocketState;
}

const appendTrajectoryPoint = (trajectory: [number, number][], point: [number, number]) => {
  const next = [...trajectory, point];
  return next.length > TRAJECTORY_LIMIT ? next.slice(next.length - TRAJECTORY_LIMIT) : next;
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

const RocketModel = ({ params, state, onUpdateState, timeScale }: RocketModelProps) => {
  const groupRef = useRef<THREE.Group>(null);
  const flightRef = useRef<FlightState>(initialFlightState());
  const accumRef = useRef(0);
  const prevPhaseRef = useRef(state.phase);
  const historyRef = useRef<FlightSnapshot[]>([]);

  // Start from the pad on reset and on every new launch.
  const resetFlight = () => {
    flightRef.current = initialFlightState();
    accumRef.current = 0;
    historyRef.current = [];
    if (groupRef.current) {
      groupRef.current.position.set(0, 1.2, 0);
      groupRef.current.rotation.set(0, 0, 0);
      groupRef.current.visible = true;
    }
  };
  if (state.phase === 'idle' && prevPhaseRef.current !== 'idle') resetFlight();
  if (state.phase === 'launching' && prevPhaseRef.current === 'idle') resetFlight();
  prevPhaseRef.current = state.phase;

  const placeRocket = (px: number, py: number, vx: number, vy: number, renderDt: number, follow = 16, turn = 12) => {
    const group = groupRef.current;
    if (!group) return;
    group.position.set(
      smoothMove(group.position.x, px * 2, follow, renderDt),
      smoothMove(group.position.y, 1.2 + py * 2, follow, renderDt),
      smoothMove(group.position.z, 0, follow, renderDt),
    );
    group.rotation.z = smoothRotateZ(group.rotation.z, -computeRocketAngle(vx, vy), Math.min(1, renderDt * turn));
  };

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) return;
    // A burnt-up rocket is gone; everything else stays visible.
    group.visible = !(state.phase === 'outcome' && state.outcome === 'burnup');
    if (timeScale === 0) return;

    // ── Rewind ──
    if (timeScale < 0) {
      if (state.phase === 'idle') return;
      const steps = Math.max(1, Math.round(Math.abs(timeScale)));
      let lastSnap: FlightSnapshot | null = null;
      for (let s = 0; s < steps; s++) {
        const snap = historyRef.current.pop();
        if (!snap) break;
        lastSnap = snap;
      }
      if (lastSnap) {
        const restored = lastSnap;
        flightRef.current = { ...restored.flight };
        accumRef.current = 0;
        group.position.set(restored.flight.px * 2, 1.2 + restored.flight.py * 2, 0);
        group.rotation.z = -computeRocketAngle(restored.flight.vx, restored.flight.vy);
        onUpdateState(() => restored.uiState);
      }
      return;
    }

    const isEscaping = state.phase === 'outcome' && state.outcome === 'escape';
    const isOrbiting = state.phase === 'outcome' && state.outcome === 'orbiting' && state.orbit;
    if (state.phase !== 'launching' && state.phase !== 'coasting' && !isEscaping && !isOrbiting) {
      return;
    }

    historyRef.current.push({ flight: { ...flightRef.current }, uiState: state });
    if (historyRef.current.length > MAX_HISTORY) historyRef.current.shift();

    const dt = Math.min(delta, 0.1) * timeScale;
    const renderDt = Math.min(delta, 0.05);
    const flight = flightRef.current;

    // ── In orbit: follow the orbit ellipse (Kepler's equation, time-compressed) ──
    if (isOrbiting && state.orbit) {
      const orbit = state.orbit;
      const [axisX, axisY] = orbit.axisDirection;
      const [perpX, perpY] = orbit.perpendicularDirection;
      // dE/dt = n / (1 − e·cos E): faster near periapsis, slower near apoapsis.
      const rate = orbit.angularSpeed / (1 - orbit.eccentricity * Math.cos(orbit.angle));
      const nextAngle = orbit.angle + dt * rate;
      const cosE = Math.cos(nextAngle);
      const sinE = Math.sin(nextAngle);
      const px = orbit.center[0] + axisX * orbit.semiMajorAxis * cosE + perpX * orbit.semiMinorAxis * sinE;
      const py = orbit.center[1] + axisY * orbit.semiMajorAxis * cosE + perpY * orbit.semiMinorAxis * sinE;
      // Real orbital velocity: the playback rate is time-compressed, the reported speed is not.
      const vx = ((-axisX * orbit.semiMajorAxis * sinE + perpX * orbit.semiMinorAxis * cosE) * rate) / ORBIT_TIME_COMPRESSION;
      const vy = ((-axisY * orbit.semiMajorAxis * sinE + perpY * orbit.semiMinorAxis * cosE) * rate) / ORBIT_TIME_COMPRESSION;
      flightRef.current = { ...flight, px, py, vx, vy, elapsed: flight.elapsed + dt };
      placeRocket(px, py, vx, vy, renderDt, 18, 10);
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

    // ── Escaped: coast straight out of view while extending the trail ──
    if (isEscaping) {
      const px = flight.px + flight.vx * dt;
      const py = flight.py + flight.vy * dt;
      flightRef.current = { ...flight, px, py, elapsed: flight.elapsed + dt };
      placeRocket(px, py, flight.vx, flight.vy, renderDt, 16, 9);
      onUpdateState((prev) => ({
        ...prev,
        position: [px, py, 0],
        altitude: py,
        maxAltitude: Math.max(prev.maxAltitude, py),
        trajectory: appendTrajectoryPoint(prev.trajectory, [px, py]),
      }));
      return;
    }

    // ── Powered flight and coasting: fixed steps of the shared flight model ──
    accumRef.current += dt;
    let current = flightRef.current;
    let verdict: FlightVerdict | null = null;
    let steps = 0;
    while (accumRef.current >= FLIGHT_DT && steps < MAX_FLIGHT_STEPS_PER_FRAME) {
      const result = stepFlight(params, current, FLIGHT_DT);
      current = result.state;
      accumRef.current -= FLIGHT_DT;
      steps++;
      if (result.verdict) {
        verdict = result.verdict;
        break;
      }
    }
    // On an overloaded frame drop the backlog instead of letting it grow.
    if (accumRef.current > FLIGHT_DT) accumRef.current = FLIGHT_DT;
    flightRef.current = current;

    const groundY = Math.max(current.py, 0);
    const flightFields = {
      fuel: current.fuel,
      heat: current.heat,
      stageSeparated: current.stageSeparated,
      elapsed: current.elapsed,
      maxAltitude: current.maxAltitude,
      velocity: [current.vx, current.vy] as [number, number],
    };

    if (verdict) {
      const endedOnGround = verdict.outcome === 'crashed' || verdict.outcome === 'suborbital';
      const finalY = endedOnGround ? 0 : groundY;
      placeRocket(current.px, finalY, current.vx, current.vy, renderDt);
      const result = verdict;
      onUpdateState((prev) => ({
        ...prev,
        ...flightFields,
        phase: 'outcome',
        outcome: result.outcome,
        outcomeReason: result.reason,
        position: [current.px, finalY, 0],
        altitude: finalY,
        orbit: result.orbit,
        trajectory: appendTrajectoryPoint(prev.trajectory, [current.px, finalY]),
      }));
      return;
    }

    placeRocket(current.px, groundY, current.vx, current.vy, renderDt);
    onUpdateState((prev) => ({
      ...prev,
      ...flightFields,
      phase: current.fuel > 0 ? 'launching' : 'coasting',
      altitude: groundY,
      position: [current.px, groundY, 0],
      orbit: null,
      trajectory: steps > 0 ? appendTrajectoryPoint(prev.trajectory, [current.px, groundY]) : prev.trajectory,
    }));
  });

  const isThrusting = state.phase === 'launching' && state.fuel > 0;
  const showStageRing = params.stageSeparation && !state.stageSeparated;

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

      {/* Stage separator line (gone once stage 1 has been dropped) */}
      {showStageRing && (
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
