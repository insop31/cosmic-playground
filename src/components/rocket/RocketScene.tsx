import { useRef, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Stars } from '@react-three/drei';
import * as THREE from 'three';
import RocketModel from './RocketModel';
import { RocketParams, RocketState, computeTrajectoryPreview } from './rocketTypes';

interface RocketSceneProps {
  params: RocketParams;
  state: RocketState;
  onUpdateState: (updater: (prev: RocketState) => RocketState) => void;
}

const PlanetSurface = () => (
  <group>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
      <planeGeometry args={[200, 200, 64, 64]} />
      <meshStandardMaterial color="#1a1a2e" roughness={0.9} metalness={0.1} />
    </mesh>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
      <planeGeometry args={[200, 200, 32, 32]} />
      <meshStandardMaterial color="#16213e" roughness={1} metalness={0} transparent opacity={0.5} wireframe />
    </mesh>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
      <circleGeometry args={[2.5, 32]} />
      <meshStandardMaterial color="#2a2a4a" roughness={0.7} metalness={0.3} />
    </mesh>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]}>
      <ringGeometry args={[1.8, 2, 32]} />
      <meshStandardMaterial color="#ff4400" emissive="#ff4400" emissiveIntensity={0.3} roughness={0.5} />
    </mesh>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]}>
      <ringGeometry args={[0.4, 0.5, 32]} />
      <meshStandardMaterial color="#00e5ff" emissive="#00e5ff" emissiveIntensity={0.5} />
    </mesh>
    <mesh position={[-1.5, 3, 0]}>
      <boxGeometry args={[0.15, 6, 0.15]} />
      <meshStandardMaterial color="#444466" metalness={0.8} roughness={0.3} />
    </mesh>
    <mesh position={[-0.75, 4.5, 0]}>
      <boxGeometry args={[1.5, 0.08, 0.08]} />
      <meshStandardMaterial color="#444466" metalness={0.8} roughness={0.3} />
    </mesh>
    <pointLight position={[-1.5, 6, 0]} color="#ff0000" intensity={0.5} distance={5} />
    <mesh position={[-1.5, 6.1, 0]}>
      <sphereGeometry args={[0.08, 8, 8]} />
      <meshBasicMaterial color="#ff0000" />
    </mesh>
  </group>
);

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

const Atmosphere = ({ density }: { density: number }) => (
  <mesh position={[0, 0, 0]}>
    <sphereGeometry args={[100, 32, 32, 0, Math.PI * 2, 0, Math.PI / 2]} />
    <meshBasicMaterial color="#1a3a6a" transparent opacity={density * 0.08} side={THREE.BackSide} />
  </mesh>
);

// Cinematic camera controller
const CinematicCamera = ({ state, controlsRef }: { state: RocketState; controlsRef: React.RefObject<any> }) => {
  const { camera } = useThree();
  const targetPos = useRef(new THREE.Vector3(0, 5, 0));
  const targetCam = useRef(new THREE.Vector3(8, 6, 12));
  const smoothing = 0.03; // lower = smoother/slower transitions

  useFrame(() => {
    const controls = controlsRef.current;
    if (!controls) return;

    const [px, py] = state.position;
    const rocketWorldX = px * 2;
    const rocketWorldY = 1.2 + py * 2;
    const phase = state.phase;
    const altitude = state.altitude;

    if (phase === 'idle') {
      // Ground-level cinematic view of the pad
      targetPos.current.set(0, 3, 0);
      targetCam.current.set(8, 4, 10);
    } else if (phase === 'launching' || phase === 'coasting') {
      if (altitude < 3) {
        // Close ground launch view — dramatic low angle
        targetPos.current.set(rocketWorldX, rocketWorldY, 0);
        targetCam.current.set(rocketWorldX + 5, rocketWorldY + 1, 8);
      } else if (altitude < 15) {
        // Chase cam — pulls back and rises with rocket
        targetPos.current.set(rocketWorldX, rocketWorldY, 0);
        targetCam.current.set(rocketWorldX + 6, rocketWorldY + 2, 12);
      } else if (altitude < 35) {
        // Wide tracking shot — zooms out to show trajectory
        targetPos.current.set(rocketWorldX * 0.5, rocketWorldY * 0.6, 0);
        targetCam.current.set(rocketWorldX * 0.3 + 10, rocketWorldY * 0.5 + 5, 20);
      } else {
        // Orbital pull-back — very wide to show scale
        targetPos.current.set(rocketWorldX * 0.3, rocketWorldY * 0.4, 0);
        targetCam.current.set(rocketWorldX * 0.2 + 15, rocketWorldY * 0.3 + 10, 30);
      }
    } else if (phase === 'outcome') {
      // Hold position, slight drift back
      targetCam.current.lerp(
        new THREE.Vector3(targetCam.current.x + 0.5, targetCam.current.y + 0.2, targetCam.current.z + 0.3),
        0.001
      );
    }

    // Smooth interpolation
    camera.position.lerp(targetCam.current, smoothing);
    controls.target.lerp(targetPos.current, smoothing);
    controls.update();
  });

  return null;
};

const RocketScene = ({ params, state, onUpdateState }: RocketSceneProps) => {
  const controlsRef = useRef<any>(null);

  return (
    <Canvas
      camera={{ position: [8, 4, 10], fov: 50, near: 0.1, far: 500 }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      style={{ background: '#050a14' }}
    >
      <color attach="background" args={['#050a14']} />
      <fog attach="fog" args={['#050a14', 80, 200]} />

      <ambientLight intensity={0.3} />
      <directionalLight position={[10, 20, 10]} intensity={0.8} color="#aaccff" />
      <pointLight position={[0, 10, 0]} intensity={0.4} color="#00e5ff" />

      <Stars radius={100} depth={50} count={2000} factor={4} saturation={0.3} fade speed={0.5} />

      <PlanetSurface />
      <Atmosphere density={params.atmosphericDensity} />

      {state.phase === 'idle' && <TrajectoryArc params={params} />}
      {state.trajectory.length > 1 && <TrajectoryTrail trajectory={state.trajectory} />}

      <RocketModel params={params} state={state} onUpdateState={onUpdateState} />

      <CinematicCamera state={state} controlsRef={controlsRef} />

      <OrbitControls
        ref={controlsRef}
        enableDamping
        dampingFactor={0.05}
        minDistance={3}
        maxDistance={80}
        target={[0, 3, 0]}
      />
    </Canvas>
  );
};

export default RocketScene;
