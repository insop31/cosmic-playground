import { useRef, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Stars, Html } from '@react-three/drei';
import * as THREE from 'three';
import RocketModel from './RocketModel';
import { RocketParams, RocketState, computeTrajectoryPreview } from './rocketTypes';

interface RocketSceneProps {
  params: RocketParams;
  state: RocketState;
  onUpdateState: (updater: (prev: RocketState) => RocketState) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
// Simulation altitude (py) → Three.js world Y
const pyToWorldY = (py: number) => 1.2 + py * 2;

// ─── Atmospheric layer definitions ───────────────────────────────────────────
// pyMin / pyMax are simulation altitude units (same scale as state.altitude)
// Real-world analogy: escape happens at py ≈ 50, so each py unit ≈ ~12 km
const ATMO_LAYERS = [
  {
    name: 'Troposphere',
    sublabel: 'Weather & Clouds',
    icon: '🌧️',
    altRange: '0 – 12 km',
    color: '#4FC3F7',
    borderColor: '#81D4FA',
    alpha: 0.08,
    pyMin: 0,
    pyMax: 8,
  },
  {
    name: 'Stratosphere',
    sublabel: 'Ozone Layer',
    icon: '🛡️',
    altRange: '12 – 50 km',
    color: '#CE93D8',
    borderColor: '#E040FB',
    alpha: 0.09,
    pyMin: 8,
    pyMax: 20,
  },
  {
    name: 'Mesosphere',
    sublabel: 'Burns Meteors',
    icon: '☄️',
    altRange: '50 – 80 km',
    color: '#42A5F5',
    borderColor: '#64B5F6',
    alpha: 0.10,
    pyMin: 20,
    pyMax: 33,
  },
  {
    name: 'Thermosphere',
    sublabel: 'Auroras',
    icon: '🌌',
    altRange: '80 – 600 km',
    color: '#FF7043',
    borderColor: '#FF8A65',
    alpha: 0.09,
    pyMin: 33,
    pyMax: 45,
  },
  {
    name: 'Exosphere',
    sublabel: 'Satellites & Space',
    icon: '🛰️',
    altRange: '600 km+',
    color: '#CE93D8',
    borderColor: '#E040FB',
    alpha: 0.05,
    pyMin: 45,
    pyMax: 62,
  },
];

// ─── Scene components ─────────────────────────────────────────────────────────

const PlanetSurface = () => (
  <group>
    {/* Base terrain */}
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
      <planeGeometry args={[200, 200, 64, 64]} />
      <meshStandardMaterial color="#2d3748" roughness={0.8} metalness={0.1} />
    </mesh>
    {/* Grid */}
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
      <planeGeometry args={[200, 200, 32, 32]} />
      <meshStandardMaterial color="#4a5568" roughness={1} metalness={0} transparent opacity={0.6} wireframe />
    </mesh>
    {/* Launch pad base */}
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
      <circleGeometry args={[4, 32]} />
      <meshStandardMaterial color="#cbd5e1" roughness={0.9} metalness={0.1} />
    </mesh>
    {/* Outer warning ring */}
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]}>
      <ringGeometry args={[2.8, 3.2, 32]} />
      <meshStandardMaterial color="#f59e0b" emissive="#f59e0b" emissiveIntensity={0.5} roughness={0.5} />
    </mesh>
    {/* Inner glow ring */}
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]}>
      <ringGeometry args={[0.8, 1.2, 32]} />
      <meshStandardMaterial color="#38bdf8" emissive="#38bdf8" emissiveIntensity={0.8} />
    </mesh>

    {/* Launch tower */}
    <mesh position={[-2.5, 4, 0]}>
      <boxGeometry args={[0.4, 8, 0.4]} />
      <meshStandardMaterial color="#cbd5e1" metalness={0.5} roughness={0.5} />
    </mesh>
    <mesh position={[-1.25, 6.5, 0]}>
      <boxGeometry args={[2.5, 0.15, 0.15]} />
      <meshStandardMaterial color="#cbd5e1" metalness={0.5} roughness={0.5} />
    </mesh>

    {/* Tower lights */}
    <pointLight position={[-2.5, 8, 0]} color="#ef4444" intensity={2} distance={10} />
    <mesh position={[-2.5, 8.1, 0]}>
      <sphereGeometry args={[0.15, 8, 8]} />
      <meshBasicMaterial color="#ef4444" />
    </mesh>

    {/* Pad fill lights */}
    <pointLight position={[3, 2, 3]} color="#ffffff" intensity={4} distance={15} />
    <pointLight position={[-3, 2, -3]} color="#ffffff" intensity={4} distance={15} />
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

// ─── Atmospheric Layers ───────────────────────────────────────────────────────
const RULER_X = 12; // world-X of the altitude ruler line

const LayerBand = ({ color, opacity, yMin, yMax }: { color: string; opacity: number; yMin: number; yMax: number }) => {
  const height = yMax - yMin;
  const centerY = (yMin + yMax) / 2;
  const bandOpacity = Math.min(opacity * 4.2, 0.42);
  const capOpacity = Math.min(opacity * 2.4, 0.24);
  
  return (
    <group>
      {/* Main volumetric band wall */}
      <mesh position={[0, centerY, 0]}>
        <cylinderGeometry args={[250, 250, height, 256, 1, true]} />
        <meshBasicMaterial 
          color={color} 
          transparent 
          opacity={bandOpacity}
          depthWrite={false} 
          depthTest={false}
          side={THREE.BackSide}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      
      {/* Top cap */}
      <mesh position={[0, yMax, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[250, 192]} />
        <meshBasicMaterial 
          color={color} 
          transparent 
          opacity={capOpacity}
          depthTest={false}
          depthWrite={false} 
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      {/* Bottom cap - completes upper layers visually */}
      <mesh position={[0, yMin, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[250, 192]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={capOpacity * 0.9}
          depthTest={false}
          depthWrite={false}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  );
};

const AtmosphericLayers = () => {
  // Precompute all boundary world-Y values
  const boundaries = [
    ...ATMO_LAYERS.map((l) => pyToWorldY(l.pyMin)),
    pyToWorldY(ATMO_LAYERS[ATMO_LAYERS.length - 1].pyMax),
  ];
  const rulerBottom = boundaries[0];
  const rulerTop = boundaries[boundaries.length - 1];
  const rulerHeight = rulerTop - rulerBottom;

  return (
    <group>
      {/* ── Vertical altitude ruler ── */}
      <mesh position={[RULER_X, rulerBottom + rulerHeight / 2, 2]}>
        <boxGeometry args={[0.08, rulerHeight, 0.08]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.25} />
      </mesh>

      {ATMO_LAYERS.map((layer, i) => {
        const yMin = pyToWorldY(layer.pyMin);
        const yMax = pyToWorldY(layer.pyMax);
        const height = yMax - yMin;
        const centerY = (yMin + yMax) / 2;

        return (
          <group key={layer.name}>
            {/* ── Seamless Shader Gradient Band ── */}
            <LayerBand color={layer.color} opacity={layer.alpha} yMin={yMin} yMax={yMax} />

            {/* ── Ruler tick at boundary ── */}
            <mesh position={[RULER_X, yMax, 2]}>
              <boxGeometry args={[1.2, 0.1, 0.1]} />
              <meshBasicMaterial color={layer.borderColor} transparent opacity={0.8} />
            </mesh>

            {/* ── Connector line from ruler to label card ── */}
            <mesh position={[RULER_X + 2.5, yMax, 2]}>
              <boxGeometry args={[4, 0.06, 0.06]} />
              <meshBasicMaterial color={layer.color} transparent opacity={0.45} />
            </mesh>

            {/* ── Html label card anchored at top boundary ── */}
            <Html
              position={[RULER_X + 4.5, yMax, 2]}
              center={false}
              style={{ pointerEvents: 'none', userSelect: 'none' }}
            >
              <div
                style={{
                  position: 'relative',
                  background: 'rgba(4, 8, 18, 0.82)',
                  border: `1px solid ${layer.color}55`,
                  borderLeft: `3px solid ${layer.color}`,
                  borderRadius: '7px',
                  padding: '5px 10px 5px 8px',
                  minWidth: '152px',
                  fontFamily: "'Inter', 'Segoe UI', monospace",
                  backdropFilter: 'blur(10px)',
                  WebkitBackdropFilter: 'blur(10px)',
                  boxShadow: `0 0 14px ${layer.color}25, 0 2px 8px rgba(0,0,0,0.6)`,
                  transform: 'translateY(-50%)',
                }}
              >
                {/* Row 1: icon + name */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <span style={{ fontSize: '12px' }}>{layer.icon}</span>
                  <span
                    style={{
                      color: layer.color,
                      fontWeight: 700,
                      fontSize: '11px',
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                    }}
                  >
                    {layer.name}
                  </span>
                </div>
                {/* Row 2: sublabel */}
                <div
                  style={{
                    color: 'rgba(200,210,230,0.75)',
                    fontSize: '9.5px',
                    marginTop: '2px',
                    letterSpacing: '0.03em',
                  }}
                >
                  {layer.sublabel}
                </div>
                {/* Row 3: altitude range badge */}
                <div
                  style={{
                    display: 'inline-block',
                    marginTop: '4px',
                    background: `${layer.color}22`,
                    border: `1px solid ${layer.color}44`,
                    borderRadius: '4px',
                    padding: '1px 5px',
                    color: `${layer.color}cc`,
                    fontSize: '8.5px',
                    fontFamily: 'monospace',
                    letterSpacing: '0.04em',
                  }}
                >
                  {layer.altRange}
                </div>
              </div>
            </Html>
          </group>
        );
      })}
    </group>
  );
};

// ─── Cinematic Camera ─────────────────────────────────────────────────────────
const CinematicCamera = ({
  state,
  controlsRef,
  userControlled,
}: {
  state: RocketState;
  controlsRef: React.RefObject<any>;
  userControlled: boolean;
}) => {
  const { camera } = useThree();
  const targetPos = useRef(new THREE.Vector3(0, 5, 0));
  const targetCam = useRef(new THREE.Vector3(8, 6, 20));

  useFrame((_, delta) => {
    const controls = controlsRef.current;
    if (!controls) return;

    // Once launch is done, hand full control to OrbitControls
    if (userControlled) return;

    const [px, py] = state.position;
    const rocketWorldX = px * 2;
    const rocketWorldY = pyToWorldY(py);
    const phase = state.phase;
    const alt = state.altitude; // same value as py

    if (phase === 'idle') {
      targetPos.current.set(0, 3, 0);
      targetCam.current.set(8, 5, 20);
    } else if (phase === 'launching' || phase === 'coasting') {
      // Always centre on the rocket
      targetPos.current.set(rocketWorldX, rocketWorldY, 0);

      // Smoothly blend camera offsets by normalized altitude to avoid jumps at layer edges.
      const t = THREE.MathUtils.clamp(alt / 62, 0, 1);
      const offsetX = THREE.MathUtils.lerp(4, 11, t);
      const offsetY = THREE.MathUtils.lerp(2, 8, t);
      const offsetZ = THREE.MathUtils.lerp(20, 44, t);
      targetCam.current.set(rocketWorldX + offsetX, rocketWorldY + offsetY, offsetZ);
    }

    // Time-based damping keeps camera motion smooth and framerate independent.
    const damping = 6.5;
    const dt = Math.min(delta, 0.05);
    camera.position.x = THREE.MathUtils.damp(camera.position.x, targetCam.current.x, damping, dt);
    camera.position.y = THREE.MathUtils.damp(camera.position.y, targetCam.current.y, damping, dt);
    camera.position.z = THREE.MathUtils.damp(camera.position.z, targetCam.current.z, damping, dt);
    controls.target.x = THREE.MathUtils.damp(controls.target.x, targetPos.current.x, damping, dt);
    controls.target.y = THREE.MathUtils.damp(controls.target.y, targetPos.current.y, damping, dt);
    controls.target.z = THREE.MathUtils.damp(controls.target.z, targetPos.current.z, damping, dt);
    controls.update();
  });

  return null;
};

// ─── Root Scene ──────────────────────────────────────────────────────────────
const RocketScene = ({ params, state, onUpdateState }: RocketSceneProps) => {
  const controlsRef = useRef<any>(null);
  const userControlled = state.phase === 'outcome';

  return (
    <Canvas
      camera={{ position: [8, 5, 20], fov: 50, near: 0.1, far: 20000 }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      style={{ background: '#050a14' }}
    >
      <color attach="background" args={['#050a14']} />
      {/* Push fog incredibly far so zooming out from orbit isn't blocked */}
      <fog attach="fog" args={['#050a14', 2000, 8000]} />

      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 20, 10]} intensity={0.8} color="#aaccff" />
      <pointLight position={[0, 10, 0]} intensity={0.4} color="#00e5ff" />

      <Stars radius={150} depth={60} count={3000} factor={4} saturation={0.3} fade speed={0.5} />

      <PlanetSurface />
      <AtmosphericLayers />
      <Atmosphere density={params.atmosphericDensity} />

      {state.phase === 'idle' && <TrajectoryArc params={params} />}
      {state.trajectory.length > 1 && <TrajectoryTrail trajectory={state.trajectory} />}

      <RocketModel params={params} state={state} onUpdateState={onUpdateState} />

      <CinematicCamera state={state} controlsRef={controlsRef} userControlled={userControlled} />

      <OrbitControls
        ref={controlsRef}
        enabled={userControlled}
        enableDamping
        dampingFactor={0.05}
        minDistance={3}
        maxDistance={5000}
      />
    </Canvas>
  );
};

export default RocketScene;
