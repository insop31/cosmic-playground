import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { FlameParticles, SmokeParticles } from './Particles';
import { RocketVehicle } from './RocketVisuals';
import type { RocketParams, RocketState } from './rocketTypes';
import { MAX_FRAME_DELTA, planRocketSteps } from '@/sim/schedule';
import {
  TRAJECTORY_LIMIT,
  stepAscent,
  stepEscape,
  stepOrbit,
  type AscentState,
  type AscentStep,
} from '@/sim/rocket';

interface RocketModelProps {
  params: RocketParams;
  state: RocketState;
  onUpdateState: (updater: (prev: RocketState) => RocketState) => void;
  timeScale: number;
}

const ROCKET_SCALE = 1.75;
const MAX_HISTORY = 3600;

const appendTrajectoryPoints = (trajectory: [number, number][], points: [number, number][]) => {
  if (points.length === 0) return trajectory;
  const next = trajectory.concat(points);
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

interface HistoryEntry {
  vx: number;
  vy: number;
  px: number;
  py: number;
  fuel: number;
  /** Simulated seconds this step covered; rewind pops at the same rate. */
  dt: number;
  uiState: RocketState;
}

const RocketModel = ({ params, state, onUpdateState, timeScale }: RocketModelProps) => {
  const groupRef = useRef<THREE.Group>(null);
  const velocityRef = useRef<[number, number]>([0, 0]);
  const posRef = useRef<[number, number]>([0, 0]);
  const fuelRef = useRef(1);
  const prevPhaseRef = useRef(state.phase);
  const historyRef = useRef<HistoryEntry[]>([]);
  const rewindAccumRef = useRef(0);

  const resetRefs = () => {
    velocityRef.current = [0, 0];
    posRef.current = [0, 0];
    fuelRef.current = 1;
    historyRef.current = [];
    rewindAccumRef.current = 0;
    if (groupRef.current) {
      groupRef.current.position.set(0, 1.2, 0);
      groupRef.current.rotation.set(0, 0, 0);
    }
  };

  // Reset refs when state resets to idle, or when a fresh launch starts
  if (state.phase === 'idle' && prevPhaseRef.current !== 'idle') resetRefs();
  if (state.phase === 'launching' && prevPhaseRef.current === 'idle') resetRefs();
  prevPhaseRef.current = state.phase;

  const placeVehicle = (px: number, py: number, vx: number, vy: number, renderDt: number, follow: number, turn: number) => {
    const group = groupRef.current!;
    group.position.set(
      smoothMove(group.position.x, px * 2, follow, renderDt),
      smoothMove(group.position.y, 1.2 + py * 2, follow, renderDt),
      smoothMove(group.position.z, 0, follow, renderDt),
    );
    group.rotation.z = smoothRotateZ(group.rotation.z, -computeRocketAngle(vx, vy), Math.min(1, renderDt * turn));
  };

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    if (timeScale === 0) return;

    // Rewind: pop history at the same simulated rate it was recorded
    if (timeScale < 0) {
      if (state.phase === 'idle') return;
      const history = historyRef.current;
      let owed = rewindAccumRef.current + Math.min(delta, MAX_FRAME_DELTA) * Math.abs(timeScale);
      let lastSnap: HistoryEntry | null = null;
      while (history.length > 0 && owed >= history[history.length - 1].dt) {
        const snap = history.pop()!;
        owed -= snap.dt;
        lastSnap = snap;
      }
      rewindAccumRef.current = history.length > 0 ? owed : 0;

      if (lastSnap) {
        const snap = lastSnap;
        velocityRef.current = [snap.vx, snap.vy];
        posRef.current = [snap.px, snap.py];
        fuelRef.current = snap.fuel;
        groupRef.current.position.set(snap.px * 2, 1.2 + snap.py * 2, 0);
        groupRef.current.rotation.z = -computeRocketAngle(snap.vx, snap.vy);
        onUpdateState(() => ({
          ...snap.uiState,
          position: [snap.px, snap.py, 0],
          altitude: snap.py,
          velocity: [snap.vx, snap.vy],
          fuel: snap.fuel,
        }));
      }
      return;
    }

    const isEscaping = state.phase === 'outcome' && state.outcome === 'escape';
    const isOrbiting = state.phase === 'outcome' && state.outcome === 'orbiting' && state.orbit;
    if (state.phase !== 'launching' && state.phase !== 'coasting' && !isEscaping && !isOrbiting) {
      return;
    }

    // Warp runs several ordinary steps instead of one long one (src/sim/schedule.ts)
    const { steps, dt } = planRocketSteps(delta, timeScale);
    const renderDt = Math.min(delta, 0.05);
    let sim: AscentState = {
      px: posRef.current[0],
      py: posRef.current[1],
      vx: velocityRef.current[0],
      vy: velocityRef.current[1],
      fuel: fuelRef.current,
      elapsed: state.elapsed,
      maxAltitude: state.maxAltitude,
    };
    let orbit = state.orbit;
    let launching = state.phase === 'launching';
    let cutoff = false;
    let ended: AscentStep | null = null;
    const points: [number, number][] = [];

    for (let i = 0; i < steps; i++) {
      historyRef.current.push({ vx: sim.vx, vy: sim.vy, px: sim.px, py: sim.py, fuel: sim.fuel, dt, uiState: state });
      if (historyRef.current.length > MAX_HISTORY) historyRef.current.shift();

      if (isOrbiting && orbit) {
        const result = stepOrbit(sim, orbit, dt);
        sim = result.next;
        orbit = result.orbit;
      } else if (isEscaping) {
        sim = stepEscape(sim, dt);
      } else {
        const result = stepAscent(sim, params, launching, dt);
        sim = result.next;
        if (result.cutoff) {
          cutoff = true;
          launching = false;
        }
        if (result.outcome) {
          ended = result;
          break;
        }
      }
      points.push([sim.px, sim.py]);
    }

    velocityRef.current = [sim.vx, sim.vy];
    posRef.current = [sim.px, sim.py];
    fuelRef.current = sim.fuel;

    if (ended) {
      const { outcome, orbit: endOrbit } = ended;
      const grounded = outcome === 'crashed' || outcome === 'suborbital';
      onUpdateState((prev) => ({
        ...prev,
        phase: 'outcome',
        outcome: outcome!,
        fuel: Math.max(sim.fuel, 0),
        elapsed: sim.elapsed,
        maxAltitude: sim.maxAltitude,
        position: [sim.px, grounded ? 0 : sim.py, 0],
        altitude: grounded ? 0 : prev.altitude,
        velocity: outcome === 'orbiting' ? [sim.vx, sim.vy] : prev.velocity,
        orbit: endOrbit,
        trajectory: appendTrajectoryPoints(prev.trajectory, grounded ? points : [...points, [sim.px, sim.py]]),
      }));
      return;
    }

    placeVehicle(sim.px, sim.py, sim.vx, sim.vy, renderDt, isOrbiting ? 18 : 16, isOrbiting ? 10 : isEscaping ? 9 : 12);

    onUpdateState((prev) => ({
      ...prev,
      phase: cutoff && prev.phase === 'launching' ? 'coasting' : prev.phase,
      altitude: sim.py,
      maxAltitude: sim.maxAltitude,
      fuel: Math.max(sim.fuel, 0),
      velocity: isEscaping ? prev.velocity : [sim.vx, sim.vy],
      elapsed: isEscaping ? prev.elapsed : sim.elapsed,
      position: [sim.px, sim.py, 0],
      orbit: isOrbiting ? orbit : null,
      trajectory: appendTrajectoryPoints(prev.trajectory, points),
    }));
  });

  const isThrusting = state.phase === 'launching' && fuelRef.current > 0;

  return (
    <group ref={groupRef} position={[0, 1.2, 0]} scale={[ROCKET_SCALE, ROCKET_SCALE, ROCKET_SCALE]}>
      <RocketVehicle
        thrusting={isThrusting}
        intensity={params.thrustForce / 30}
        stageSeparation={params.stageSeparation}
        separated={params.stageSeparation && (state.phase === 'coasting' || (state.phase === 'outcome' && state.fuel <= 0))}
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
