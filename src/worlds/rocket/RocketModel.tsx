import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { FlameParticles, SmokeParticles } from './Particles';
import { RocketVehicle } from './RocketVisuals';
import type { RocketParams, RocketState } from './rocketTypes';
import type { WeatherConditionId } from './weatherPresets';
import { MAX_FRAME_DELTA, ROCKET_STEP_CAP, planForwardSteps } from '@/physics/schedule';
import {
  FLIGHT_DT,
  ORBIT_TIME_COMPRESSION,
  altitudeOf,
  initialFlightState,
  stepFlight,
  type FlightEnvironment,
  type FlightState,
  type FlightVerdict,
} from '@/physics/rocket';
import { isBurning } from './liveFlight';

interface RocketModelProps {
  params: RocketParams;
  state: RocketState;
  onUpdateState: (updater: (prev: RocketState) => RocketState) => void;
  timeScale: number;
  activeWeather: Set<WeatherConditionId>;
  /** Shared with the force arrows and the HUD, so they read the exact flight state. */
  flightRef: React.MutableRefObject<FlightState | null>;
}

const ROCKET_SCALE = 1.75;
const TRAJECTORY_LIMIT = 2400;
const MAX_HISTORY = 3600;
// After the verdict the flight keeps going for the camera; long coasts play faster.
const COAST_SPEEDUP: Partial<Record<RocketState['outcome'], number>> = {
  orbiting: ORBIT_TIME_COMPRESSION,
  suborbital: 4,
  escape: 2,
};

interface HistoryEntry {
  flight: FlightState;
  uiState: RocketState;
  /** Seconds of 1× time this frame covered; rewind pops entries at the same rate. */
  span: number;
}

const appendTrajectoryPoints = (trajectory: [number, number][], points: [number, number][]) => {
  if (points.length === 0) return trajectory;
  const next = trajectory.concat(points);
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

/**
 * The launch vehicle and its flight. Each frame runs fixed 1/60 s steps of the
 * flight model (src/physics/rocket.ts): one at 1×, 64 at 64×, so warp is exactly
 * many ordinary steps. Rewind restores recorded states at the rate they were made.
 */
const RocketModel = ({ params, state, onUpdateState, timeScale, activeWeather, flightRef }: RocketModelProps) => {
  const groupRef = useRef<THREE.Group>(null);
  const envRef = useRef<FlightEnvironment>({ lightning: false, seed: state.seed });
  const accumRef = useRef(0);
  const rewindAccumRef = useRef(0);
  const prevPhaseRef = useRef(state.phase);
  const historyRef = useRef<HistoryEntry[]>([]);
  if (!flightRef.current) flightRef.current = initialFlightState(params);

  // Start from the pad on reset and on every new launch.
  const resetFlight = () => {
    envRef.current = { lightning: activeWeather.has('lightning'), seed: state.seed };
    flightRef.current = initialFlightState(params, envRef.current);
    accumRef.current = 0;
    rewindAccumRef.current = 0;
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

  /** Telemetry fields copied from the flight into the store each frame. */
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
    const flight = flightRef.current;
    if (!group || !flight) return;
    // A burnt-up rocket is gone; everything else stays visible.
    group.visible = !(state.phase === 'outcome' && state.outcome === 'burnup');
    if (timeScale === 0) return;

    // ── Rewind: restore recorded frames at the rate they were recorded ──
    if (timeScale < 0) {
      if (state.phase === 'idle') return;
      const history = historyRef.current;
      let owed = rewindAccumRef.current + Math.min(delta, MAX_FRAME_DELTA) * Math.abs(timeScale);
      let restored: HistoryEntry | null = null;
      while (history.length > 0 && owed >= history[history.length - 1].span) {
        restored = history.pop()!;
        owed -= restored.span;
      }
      rewindAccumRef.current = history.length > 0 ? owed : 0;
      if (restored) {
        const entry = restored;
        flightRef.current = entry.flight;
        accumRef.current = 0;
        group.position.set(entry.flight.px * 2, 1.2 + entry.flight.py * 2, 0);
        group.rotation.z = -worldAxisAngle(params, entry.flight);
        onUpdateState(() => entry.uiState);
      }
      return;
    }

    const inFlight = state.phase === 'launching' || state.phase === 'coasting';
    const coastingAfterVerdict = state.phase === 'outcome' && state.outcome in COAST_SPEEDUP
      && !(state.outcome === 'suborbital' && altitudeOf(params, flight) <= 0);
    if (!inFlight && !coastingAfterVerdict) return;

    const speedup = coastingAfterVerdict ? COAST_SPEEDUP[state.outcome] ?? 1 : 1;
    const frameTime = Math.min(delta, MAX_FRAME_DELTA) * timeScale;
    const plan = planForwardSteps(accumRef.current + frameTime * speedup, FLIGHT_DT, ROCKET_STEP_CAP);
    accumRef.current = plan.carry;
    if (plan.steps > 0) {
      historyRef.current.push({ flight, uiState: state, span: (plan.steps * FLIGHT_DT) / speedup });
      if (historyRef.current.length > MAX_HISTORY) historyRef.current.shift();
    }

    const renderDt = Math.min(delta, 0.05);
    let current = flight;
    let verdict: FlightVerdict | null = null;
    const points: [number, number][] = [];
    for (let n = 0; n < plan.steps; n++) {
      const result = stepFlight(params, current, FLIGHT_DT, { env: envRef.current, coastOnly: coastingAfterVerdict });
      current = result.state;
      if (n % 4 === 3 || n === plan.steps - 1) points.push([current.px, current.py]);
      if (coastingAfterVerdict && altitudeOf(params, current) <= 0) break; // the arc reached the ground
      if (!coastingAfterVerdict && result.verdict) {
        verdict = result.verdict;
        break;
      }
    }
    flightRef.current = current;
    placeRocket(current, renderDt);
    if (plan.steps === 0) return;

    if (verdict) {
      const result = verdict;
      onUpdateState((prev) => ({
        ...prev,
        ...telemetry(current, prev),
        phase: 'outcome',
        outcome: result.outcome,
        outcomeReason: result.reason,
        orbit: result.orbit,
        trajectory: appendTrajectoryPoints(prev.trajectory, points),
      }));
      return;
    }

    onUpdateState((prev) => ({
      ...prev,
      ...telemetry(current, prev),
      phase: coastingAfterVerdict ? prev.phase : isBurning(current) ? 'launching' : 'coasting',
      trajectory: appendTrajectoryPoints(prev.trajectory, points),
    }));
  });

  const flight = flightRef.current;
  const isThrusting = (state.phase === 'launching' || state.phase === 'coasting') && isBurning(flight);

  return (
    <group ref={groupRef} position={[0, 1.2, 0]} scale={[ROCKET_SCALE, ROCKET_SCALE, ROCKET_SCALE]}>
      <RocketVehicle
        thrusting={isThrusting}
        intensity={(flight.stage === 2 ? params.stage2Thrust * 2 : params.thrustForce) / 30}
        stageSeparation={params.stageSeparation}
        separated={state.stageSeparated}
      />

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
        <pointLight position={[0, -0.4, 0]} color="#ff7a2a" intensity={4} distance={10} />
      )}
    </group>
  );
};

export default RocketModel;
