import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Html } from '@/stage/World';
import { ascentForces } from '@/sim/rocket';
import { useFlightStore } from '@/stores/flightStore';
import { useRocketStore } from '@/stores/rocketStore';
import { applyWeatherToParams } from './weatherPresets';

const FORCES = [
  { key: 'thrust', label: 'Thrust', color: '#ff7a3d' },
  { key: 'gravity', label: 'Gravity', color: '#e4ebf5' },
  { key: 'drag', label: 'Drag', color: '#ff5c6c' },
  { key: 'wind', label: 'Wind', color: '#3fd8f5' },
] as const;

type ForceKey = (typeof FORCES)[number]['key'];

/** Arrow length for an acceleration: square-root scaled so small forces stay visible. */
const arrowLength = (magnitude: number) => (magnitude < 1e-5 ? 0 : THREE.MathUtils.clamp(Math.sqrt(magnitude) * 5.5, 0.35, 5));

/**
 * The forces acting on the vehicle right now, drawn from its centre in world
 * space (so gravity always points down, whatever the rocket's attitude).
 */
const ForceVectors = () => {
  const show = useFlightStore((state) => state.showForces);
  const phase = useRocketStore((state) => state.flight.phase);
  const groupRef = useRef<THREE.Group>(null);
  const labelRefs = useRef<Partial<Record<ForceKey, HTMLDivElement | null>>>({});
  const labelAnchors = useRef<Partial<Record<ForceKey, THREE.Group | null>>>({});

  const arrows = useMemo(() => {
    const map = {} as Record<ForceKey, THREE.ArrowHelper>;
    for (const force of FORCES) {
      const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 1, force.color, 0.32, 0.18);
      (arrow.line.material as THREE.LineBasicMaterial).depthTest = false;
      (arrow.cone.material as THREE.MeshBasicMaterial).depthTest = false;
      arrow.renderOrder = 10;
      map[force.key] = arrow;
    }
    return map;
  }, []);

  useEffect(() => () => {
    Object.values(arrows).forEach((arrow) => arrow.dispose());
  }, [arrows]);

  const active = show && (phase === 'launching' || phase === 'coasting');
  const dir = useRef(new THREE.Vector3());

  useFrame(() => {
    const group = groupRef.current;
    if (!group || !active) return;
    const { flight, params, activeWeather } = useRocketStore.getState();
    const effective = applyWeatherToParams(params, activeWeather);
    const [px, py] = flight.position;
    group.position.set(px * 2, 1.2 + py * 2 + 1.4, 0);

    const forces = ascentForces(
      { px, py, vx: flight.velocity[0], vy: flight.velocity[1], fuel: flight.fuel, elapsed: flight.elapsed, maxAltitude: flight.maxAltitude },
      effective,
      flight.phase === 'launching',
    );
    for (const { key } of FORCES) {
      const [ax, ay] = forces[key];
      const magnitude = Math.hypot(ax, ay);
      const length = arrowLength(magnitude);
      const arrow = arrows[key];
      arrow.visible = length > 0;
      const label = labelRefs.current[key];
      if (label) label.style.opacity = length > 0 ? '1' : '0';
      if (!length) continue;
      dir.current.set(ax / magnitude, ay / magnitude, 0);
      arrow.setDirection(dir.current);
      arrow.setLength(length, Math.min(0.32, length * 0.4), 0.18);
      labelAnchors.current[key]?.position.copy(dir.current).multiplyScalar(length + 0.45);
    }
  });

  if (!active) return null;

  return (
    <group ref={groupRef}>
      {FORCES.map((force) => (
        <group key={force.key}>
          <primitive object={arrows[force.key]} />
          <group ref={(el) => { labelAnchors.current[force.key] = el; }}>
            <Html center style={{ pointerEvents: 'none' }} zIndexRange={[30, 0]}>
              <div
                ref={(el) => { labelRefs.current[force.key] = el; }}
                className="whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.08em]"
                style={{ color: force.color, textShadow: '0 0 6px rgba(5,7,13,0.9)' }}
              >
                {force.label}
              </div>
            </Html>
          </group>
        </group>
      ))}
    </group>
  );
};

export default ForceVectors;
