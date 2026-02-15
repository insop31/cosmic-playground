import { useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Stars } from '@react-three/drei';
import * as THREE from 'three';
import RocketModel from './RocketModel';
import { RocketParams, RocketState, computeTrajectoryPreview } from './rocketTypes';

interface RocketSceneProps {
  params: RocketParams;
  state: RocketState;
  onUpdateState: (updater: (prev: RocketState) => RocketState) => void;
}

// Ground/Planet surface
const PlanetSurface = () => (
  <group>
    {/* Ground plane */}
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
      <planeGeometry args={[200, 200, 64, 64]} />
      <meshStandardMaterial color="#1a1a2e" roughness={0.9} metalness={0.1} />
    </mesh>

    {/* Surface detail - slightly raised terrain */}
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
      <planeGeometry args={[200, 200, 32, 32]} />
      <meshStandardMaterial color="#16213e" roughness={1} metalness={0} transparent opacity={0.5} wireframe />
    </mesh>

    {/* Launch pad */}
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
      <circleGeometry args={[2.5, 32]} />
      <meshStandardMaterial color="#2a2a4a" roughness={0.7} metalness={0.3} />
    </mesh>

    {/* Pad markings - inner circle */}
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]}>
      <ringGeometry args={[1.8, 2, 32]} />
      <meshStandardMaterial color="#ff4400" emissive="#ff4400" emissiveIntensity={0.3} roughness={0.5} />
    </mesh>

    {/* Pad center marking */}
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]}>
      <ringGeometry args={[0.4, 0.5, 32]} />
      <meshStandardMaterial color="#00e5ff" emissive="#00e5ff" emissiveIntensity={0.5} />
    </mesh>

    {/* Launch tower */}
    <mesh position={[-1.5, 3, 0]}>
      <boxGeometry args={[0.15, 6, 0.15]} />
      <meshStandardMaterial color="#444466" metalness={0.8} roughness={0.3} />
    </mesh>

    {/* Tower arm */}
    <mesh position={[-0.75, 4.5, 0]}>
      <boxGeometry args={[1.5, 0.08, 0.08]} />
      <meshStandardMaterial color="#444466" metalness={0.8} roughness={0.3} />
    </mesh>

    {/* Tower lights */}
    <pointLight position={[-1.5, 6, 0]} color="#ff0000" intensity={0.5} distance={5} />
    <mesh position={[-1.5, 6.1, 0]}>
      <sphereGeometry args={[0.08, 8, 8]} />
      <meshBasicMaterial color="#ff0000" />
    </mesh>
  </group>
);

// Trajectory preview arc
const TrajectoryArc = ({ params }: { params: RocketParams }) => {
  const line = useMemo(() => {
    const points = computeTrajectoryPreview(params);
    if (points.length < 2) return null;

    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(points.length * 3);
    for (let i = 0; i < points.length; i++) {
      positions[i * 3] = points[i][0] * 2;
      positions[i * 3 + 1] = 1.2 + points[i][1] * 2;
      positions[i * 3 + 2] = 0;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const mat = new THREE.LineDashedMaterial({
      color: '#00e5ff',
      transparent: true,
      opacity: 0.4,
      dashSize: 0.5,
      gapSize: 0.3,
    });

    const ln = new THREE.Line(geo, mat);
    ln.computeLineDistances();
    return ln;
  }, [params]);

  if (!line) return null;
  return <primitive object={line} />;
};

// Live trajectory trail
const TrajectoryTrail = ({ trajectory }: { trajectory: [number, number][] }) => {
  const line = useMemo(() => {
    if (trajectory.length < 2) return null;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(trajectory.length * 3);
    for (let i = 0; i < trajectory.length; i++) {
      positions[i * 3] = trajectory[i][0] * 2;
      positions[i * 3 + 1] = 1.2 + trajectory[i][1] * 2;
      positions[i * 3 + 2] = 0;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({ color: '#ff6600', transparent: true, opacity: 0.6 });
    return new THREE.Line(geo, mat);
  }, [trajectory]);

  if (!line) return null;
  return <primitive object={line} />;
};

// Atmosphere dome
const Atmosphere = ({ density }: { density: number }) => (
  <mesh position={[0, 0, 0]}>
    <sphereGeometry args={[100, 32, 32, 0, Math.PI * 2, 0, Math.PI / 2]} />
    <meshBasicMaterial
      color="#1a3a6a"
      transparent
      opacity={density * 0.08}
      side={THREE.BackSide}
    />
  </mesh>
);

const RocketScene = ({ params, state, onUpdateState }: RocketSceneProps) => {
  return (
    <Canvas
      camera={{ position: [8, 6, 12], fov: 50, near: 0.1, far: 500 }}
      gl={{ antialias: true }}
      style={{ background: '#050a14' }}
    >
      <color attach="background" args={['#050a14']} />
      <fog attach="fog" args={['#050a14', 80, 200]} />

      <ambientLight intensity={0.2} />
      <directionalLight position={[10, 20, 10]} intensity={0.6} color="#aaccff" />
      <pointLight position={[0, 10, 0]} intensity={0.3} color="#00e5ff" />

      <Stars radius={100} depth={50} count={2000} factor={4} saturation={0.3} fade speed={0.5} />

      <PlanetSurface />
      <Atmosphere density={params.atmosphericDensity} />

      {state.phase === 'idle' && <TrajectoryArc params={params} />}
      {state.trajectory.length > 1 && <TrajectoryTrail trajectory={state.trajectory} />}

      <RocketModel params={params} state={state} onUpdateState={onUpdateState} />

      <OrbitControls
        enableDamping
        dampingFactor={0.05}
        minDistance={3}
        maxDistance={60}
        target={[0, 5, 0]}
      />
    </Canvas>
  );
};

export default RocketScene;
