import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { FlameParticles, SmokeParticles } from './Particles';
import { RocketParams, RocketState } from './rocketTypes';
import type { WeatherConditionId } from './weatherPresets';
import {
  FLIGHT_DT,
  ORBIT_TIME_COMPRESSION,
  altitudeOf,
  initialFlightState,
  stepFlight,
  type FlightEnvironment,
  type FlightState,
  type FlightVerdict,
} from '../../physics/rocket';

interface RocketModelProps {
  params: RocketParams;
  state: RocketState;
  onUpdateState: (updater: (prev: RocketState) => RocketState) => void;
  timeScale: number;
  activeWeather?: Set<WeatherConditionId>;
}

const ROCKET_SCALE = 1.75;
const TRAJECTORY_LIMIT = 2400;
const MAX_FLIGHT_STEPS_PER_FRAME = 64;
const MAX_HISTORY = 3600;
// After the verdict the flight keeps going for the camera; long coasts play faster.
const COAST_SPEEDUP: Partial<Record<RocketState['outcome'], number>> = {
  orbiting: ORBIT_TIME_COMPRESSION,
  suborbital: 4,
  escape: 2,
};

interface FlightSnapshot {
  flight: FlightState;
  uiState: RocketState;
}

const appendTrajectoryPoint = (trajectory: [number, number][], point: [number, number]) => {
  const next = [...trajectory, point];
  return next.length > TRAJECTORY_LIMIT ? next.slice(next.length - TRAJECTORY_LIMIT) : next;
};

const smoothRotateZ = (current: number, target: number, factor: number) => {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + delta * factor;
};

const smoothMove = (current: number, target: number, smoothing: number, dt: number) =>
  THREE.MathUtils.damp(current, target, smoothing, dt);

/** World rotation of the rocket's axis: its attitude is measured from the local vertical. */
const worldAxisAngle = (params: RocketParams, flight: FlightState) => {
  const rx = flight.px;
  const ry = flight.py + params.planetRadius;
  const r = Math.hypot(rx, ry) || 1;
  const upX = rx / r;
  const upY = ry / r;
  const bx = Math.cos(flight.attitude) * upX + Math.sin(flight.attitude) * upY;
  const by = Math.cos(flight.attitude) * upY - Math.sin(flight.attitude) * upX;
  return Math.atan2(bx, by);
};

const isBurning = (flight: FlightState) =>
  !flight.engineOut && ((flight.stage === 1 && flight.fuel1 > 0) || (flight.stage === 2 && flight.stage2Lit && flight.fuel2 > 0));

const RocketModel = ({ params, state, onUpdateState, timeScale, activeWeather }: RocketModelProps) => {
  const groupRef = useRef<THREE.Group>(null);
  const flightRef = useRef<FlightState>(initialFlightState(params));
  const envRef = useRef<FlightEnvironment>({ lightning: false, seed: state.seed });
  const accumRef = useRef(0);
  const prevPhaseRef = useRef(state.phase);
  const historyRef = useRef<FlightSnapshot[]>([]);

  // Start from the pad on reset and on every new launch.
  const resetFlight = () => {
    envRef.current = { lightning: activeWeather?.has('lightning') ?? false, seed: state.seed };
    flightRef.current = initialFlightState(params, envRef.current);
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

  const placeRocket = (flight: FlightState, renderDt: number, follow = 16, turn = 12) => {
    const group = groupRef.current;
    if (!group) return;
    group.position.set(
      smoothMove(group.position.x, flight.px * 2, follow, renderDt),
      smoothMove(group.position.y, 1.2 + Math.max(flight.py, -1000) * 2, follow, renderDt),
      smoothMove(group.position.z, 0, follow, renderDt),
    );
    group.rotation.z = smoothRotateZ(group.rotation.z, -worldAxisAngle(params, flight), Math.min(1, renderDt * turn));
  };

  /** Telemetry fields copied from the flight into React state each frame. */
  const telemetry = (flight: FlightState, prev: RocketState): Partial<RocketState> => {
    const altitude = Math.max(altitudeOf(params, flight), 0);
    return {
      altitude,
      maxAltitude: Math.max(prev.maxAltitude, altitude),
      fuel: params.fuelMass > 0 ? (flight.fuel1 + flight.fuel2) / params.fuelMass : 0,
      velocity: [flight.vx, flight.vy],
      elapsed: flight.elapsed,
      position: [flight.px, flight.py, 0],
      heat: flight.heat,
      stageSeparated: flight.stageSeparated,
      dynamicPressure: flight.q,
      maxDynamicPressure: flight.maxQ,
      events: flight.events.length !== prev.events.length ? flight.events : prev.events,
    };
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
        flightRef.current = restored.flight;
        accumRef.current = 0;
        group.position.set(restored.flight.px * 2, 1.2 + restored.flight.py * 2, 0);
        group.rotation.z = -worldAxisAngle(params, restored.flight);
        onUpdateState(() => restored.uiState);
      }
      return;
    }

    const inFlight = state.phase === 'launching' || state.phase === 'coasting';
    const coastingAfterVerdict = state.phase === 'outcome' && state.outcome in COAST_SPEEDUP
      && !(state.outcome === 'suborbital' && altitudeOf(params, flightRef.current) <= 0);
    if (!inFlight && !coastingAfterVerdict) return;

    historyRef.current.push({ flight: flightRef.current, uiState: state });
    if (historyRef.current.length > MAX_HISTORY) historyRef.current.shift();

    const renderDt = Math.min(delta, 0.05);
    const speedup = coastingAfterVerdict ? COAST_SPEEDUP[state.outcome] ?? 1 : 1;
    accumRef.current += Math.min(delta, 0.1) * timeScale * speedup;

    let current = flightRef.current;
    let verdict: FlightVerdict | null = null;
    let steps = 0;
    while (accumRef.current >= FLIGHT_DT && steps < MAX_FLIGHT_STEPS_PER_FRAME) {
      const result = stepFlight(params, current, FLIGHT_DT, { env: envRef.current, coastOnly: coastingAfterVerdict });
      current = result.state;
      accumRef.current -= FLIGHT_DT;
      steps++;
      if (coastingAfterVerdict && altitudeOf(params, current) <= 0) break; // the arc reached the ground
      if (!coastingAfterVerdict && result.verdict) {
        verdict = result.verdict;
        break;
      }
    }
    // On an overloaded frame drop the backlog instead of letting it grow.
    if (accumRef.current > FLIGHT_DT) accumRef.current = FLIGHT_DT;
    flightRef.current = current;
    placeRocket(current, renderDt);

    const point: [number, number] = [current.px, current.py];
    if (verdict) {
      const result = verdict;
      onUpdateState((prev) => ({
        ...prev,
        ...telemetry(current, prev),
        phase: 'outcome',
        outcome: result.outcome,
        outcomeReason: result.reason,
        orbit: result.orbit,
        trajectory: appendTrajectoryPoint(prev.trajectory, point),
      }));
      return;
    }

    onUpdateState((prev) => ({
      ...prev,
      ...telemetry(current, prev),
      phase: coastingAfterVerdict ? prev.phase : isBurning(current) ? 'launching' : 'coasting',
      trajectory: steps > 0 ? appendTrajectoryPoint(prev.trajectory, point) : prev.trajectory,
    }));
  });

  const isThrusting = state.phase === 'launching' && isBurning(flightRef.current);
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
