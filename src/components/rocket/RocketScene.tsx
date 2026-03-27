import { useRef, useMemo } from 'react';
import type { RefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Stars, Html } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import RocketModel from './RocketModel';
import { OrbitPathState, RocketParams, RocketState, computeTrajectoryPreview } from './rocketTypes';

interface RocketSceneProps {
  params: RocketParams;
  state: RocketState;
  onUpdateState: (updater: (prev: RocketState) => RocketState) => void;
  timeScale?: number;
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
    color: '#38bdf8',    // sky blue
    borderColor: '#7dd3fc',
    alpha: 0.12,
    pyMin: 0,
    pyMax: 8,
  },
  {
    name: 'Stratosphere',
    sublabel: 'Ozone Layer',
    icon: '🛡️',
    altRange: '12 – 50 km',
    color: '#3b82f6',    // solid blue
    borderColor: '#60a5fa',
    alpha: 0.12,
    pyMin: 8,
    pyMax: 20,
  },
  {
    name: 'Mesosphere',
    sublabel: 'Burns Meteors',
    icon: '☄️',
    altRange: '50 – 80 km',
    color: '#1d4ed8',    // deep blue
    borderColor: '#3b82f6',
    alpha: 0.15,
    pyMin: 20,
    pyMax: 33,
  },
  {
    name: 'Thermosphere',
    sublabel: 'Auroras',
    icon: '🌌',
    altRange: '80 – 600 km',
    color: '#1e3a8a',    // navy
    borderColor: '#2563eb',
    alpha: 0.18,
    pyMin: 33,
    pyMax: 45,
  },
  {
    name: 'Exosphere',
    sublabel: 'Satellites & Space',
    icon: '🛰️',
    altRange: '600 km+',
    color: '#4c1d95',    // deep violet
    borderColor: '#475569',
    alpha: 0.2,
    pyMin: 45,
    pyMax: 62,
  },
];

const EXOSPHERE_LIMIT = 62;

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

const OrbitPath = ({ orbit }: { orbit: OrbitPathState }) => {
  const line = useMemo(() => {
    const segments = 160;
    const positions = new Float32Array((segments + 1) * 3);
    const [axisX, axisY] = orbit.axisDirection;
    const [perpX, perpY] = orbit.perpendicularDirection;

    for (let i = 0; i <= segments; i++) {
      const theta = (i / segments) * Math.PI * 2;
      const cosTheta = Math.cos(theta);
      const sinTheta = Math.sin(theta);
      const px = orbit.center[0] + axisX * orbit.semiMajorAxis * cosTheta + perpX * orbit.semiMinorAxis * sinTheta;
      const py = orbit.center[1] + axisY * orbit.semiMajorAxis * cosTheta + perpY * orbit.semiMinorAxis * sinTheta;

      positions[i * 3] = px * 2;
      positions[i * 3 + 1] = pyToWorldY(py);
      positions[i * 3 + 2] = -0.35;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.LineDashedMaterial({
      color: '#7dd3fc',
      transparent: true,
      opacity: 0.78,
      dashSize: 0.8,
      gapSize: 0.42,
    });
    const orbitLine = new THREE.Line(geometry, material);
    orbitLine.computeLineDistances();
    return orbitLine;
  }, [orbit]);

  return <primitive object={line} />;
};

const OrbitRocketMarker = ({ position }: { position: [number, number, number] }) => {
  const ringRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    if (!ringRef.current) return;
    const pulse = 1 + Math.sin(state.clock.elapsedTime * 4.2) * 0.16;
    ringRef.current.scale.setScalar(pulse);
  });

  return (
    <group position={position}>
      <mesh ref={ringRef}>
        <ringGeometry args={[0.7, 1.0, 40]} />
        <meshBasicMaterial color="#facc15" transparent opacity={0.9} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <pointLight color="#fde047" intensity={1.8} distance={18} />
      <Html position={[0, 1.4, 0]} center style={{ pointerEvents: 'none', userSelect: 'none' }}>
        <div
          style={{
            fontSize: '10px',
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: '#fde047',
            background: 'rgba(0,0,0,0.55)',
            border: '1px solid rgba(250,204,21,0.45)',
            borderRadius: '6px',
            padding: '2px 6px',
            backdropFilter: 'blur(4px)',
          }}
        >
          Rocket
        </div>
      </Html>
    </group>
  );
};

const Atmosphere = ({ density }: { density: number }) => (
  <mesh position={[0, 0, 0]}>
    <sphereGeometry args={[100, 32, 32, 0, Math.PI * 2, 0, Math.PI / 2]} />
    <meshBasicMaterial color="#1a3a6a" transparent opacity={density * 0.08} side={THREE.BackSide} />
  </mesh>
);

const PlanetGlobe = ({ planetRadius, atmosphericDensity }: { planetRadius: number; atmosphericDensity: number }) => {
  const worldRadius = planetRadius * 2;
  const centerY = pyToWorldY(-planetRadius);
  return (
    <group>
      <mesh position={[0, centerY, 0]}>
        <sphereGeometry args={[worldRadius, 72, 72]} />
        <meshStandardMaterial color="#173c68" roughness={0.9} metalness={0.06} />
      </mesh>
      <mesh position={[0, centerY, 0]}>
        <sphereGeometry args={[worldRadius * 1.04, 64, 64]} />
        <meshBasicMaterial
          color="#4fb5ff"
          transparent
          opacity={THREE.MathUtils.clamp(atmosphericDensity * 0.18, 0.05, 0.24)}
          side={THREE.BackSide}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
};

// ─── Atmospheric Layers ───────────────────────────────────────────────────────
// Keep labels away from right-side UI panels.
const TRAJECTORY_LABEL_GAP = 1.25;

const LayerBand = ({
  color,
  opacity,
  yMin,
  yMax,
  planetCenterY,
}: {
  color: string;
  opacity: number;
  yMin: number;
  yMax: number;
  planetCenterY: number;
}) => {
  const radiusMin = Math.max(1, yMin - planetCenterY);
  const radiusMax = Math.max(radiusMin + 0.01, yMax - planetCenterY);
  const shellOpacity = Math.min(opacity * 1.25, 0.14);
  const edgeOpacity = Math.min(opacity * 1.7, 0.2);

  return (
    <group>
      {/* Subtle spherical layer fill */}
      <mesh position={[0, planetCenterY, 0]}>
        <sphereGeometry args={[radiusMax, 56, 36, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshBasicMaterial color={color} transparent opacity={shellOpacity} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>

      {/* Thin outer boundary arc */}
      <mesh position={[0, planetCenterY, 0]}>
        <sphereGeometry args={[radiusMax + 0.15, 56, 36, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshBasicMaterial color={color} transparent opacity={edgeOpacity} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>

      {/* Very faint inner boundary for layer separation */}
      <mesh position={[0, planetCenterY, 0]}>
        <sphereGeometry args={[radiusMin, 48, 28, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshBasicMaterial color={color} transparent opacity={edgeOpacity * 0.35} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
};

const AtmosphericLayers = ({
  planetRadius,
  params,
}: {
  planetRadius: number;
  params: RocketParams;
}) => {
  void planetRadius;
  // Precompute all boundary world-Y values
  const boundaries = [
    ...ATMO_LAYERS.map((l) => pyToWorldY(l.pyMin)),
    pyToWorldY(ATMO_LAYERS[ATMO_LAYERS.length - 1].pyMax),
  ];
  // Keep hemisphere base aligned with the launch base.
  const hemisphereBaseY = 0;
  const rulerBottom = boundaries[0];
  const rulerTop = boundaries[boundaries.length - 1];
  const rulerHeight = rulerTop - rulerBottom;
  const effectiveLaunchAngle = params.launchAngle + params.padTilt;
  const angleRad = (effectiveLaunchAngle * Math.PI) / 180;
  const trajectoryDir = Math.sign(Math.sin(angleRad)) || 1;
  const trajectorySlope = Math.tan(angleRad);

  return (
    <group>
      <mesh position={[0, rulerBottom + rulerHeight / 2, -0.7]}>
        <boxGeometry args={[0.04, rulerHeight, 0.04]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.12} />
      </mesh>

      {ATMO_LAYERS.map((layer, i) => {
        const yMin = pyToWorldY(layer.pyMin);
        const yMax = pyToWorldY(layer.pyMax);
        const trajectoryX = THREE.MathUtils.clamp((layer.pyMax * trajectorySlope) * 2, -60, 60);
        const labelX = trajectoryX + TRAJECTORY_LABEL_GAP * trajectoryDir;

        return (
          <group key={layer.name}>
            {/* ── Seamless Shader Gradient Band ── */}
            <LayerBand color={layer.color} opacity={layer.alpha} yMin={yMin} yMax={yMax} planetCenterY={hemisphereBaseY} />

            {/* Trajectory anchor marker */}
            <mesh position={[trajectoryX, yMax, 0]}>
              <sphereGeometry args={[0.07, 10, 10]} />
              <meshBasicMaterial color={layer.borderColor} />
            </mesh>

            {/* Connector line from trajectory to label card */}
            <mesh position={[(trajectoryX + labelX) / 2, yMax, 0.7]}>
              <boxGeometry args={[Math.max(0.2, Math.abs(labelX - trajectoryX)), 0.05, 0.05]} />
              <meshBasicMaterial color={layer.color} transparent opacity={0.45} />
            </mesh>

            {/* ── Html label card anchored near trajectory ── */}
            <Html
              position={[labelX, yMax, 1.3]}
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
                  transform: `translateY(-50%) translateX(${trajectoryDir > 0 ? '0' : '-100%'})`,
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
  params,
  controlsRef,
  userControlled,
}: {
  state: RocketState;
  params: RocketParams;
  controlsRef: RefObject<OrbitControlsImpl | null>;
  userControlled: boolean;
}) => {
  const { camera } = useThree();
  const targetPos = useRef(new THREE.Vector3(0, 5, 0));
  const targetCam = useRef(new THREE.Vector3(8, 6, 20));
  const orbitBlendRef = useRef(0);
  const exosphereLockRef = useRef<{ target: THREE.Vector3; camera: THREE.Vector3 } | null>(null);

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
      exosphereLockRef.current = null;
      orbitBlendRef.current = THREE.MathUtils.damp(orbitBlendRef.current, 0, 6, delta);
      targetPos.current.set(0, 3, 0);
      targetCam.current.set(5.5, 4.8, 13.5);
    } else if (phase === 'launching' || phase === 'coasting' || (phase === 'outcome' && state.outcome === 'escape')) {
      orbitBlendRef.current = THREE.MathUtils.damp(orbitBlendRef.current, 0, 6, delta);

      // Stop advancing the chase framing once the rocket exceeds the exosphere.
      if (alt > EXOSPHERE_LIMIT && exosphereLockRef.current) {
        targetPos.current.copy(exosphereLockRef.current.target);
        targetCam.current.copy(exosphereLockRef.current.camera);
      } else {
        // Always centre on the rocket until the exosphere cap is reached.
        targetPos.current.set(rocketWorldX, rocketWorldY, 0);

        const layerSpan = EXOSPHERE_LIMIT;
        const t = THREE.MathUtils.clamp(alt / layerSpan, 0, 1);
        const escapeBoost = phase === 'outcome' && state.outcome === 'escape' ? 1.2 : 1;
        const offsetX = THREE.MathUtils.lerp(3.2, 9.5, t) * escapeBoost;
        const offsetY = THREE.MathUtils.lerp(1.8, 7.2, t) * escapeBoost;
        const offsetZ = THREE.MathUtils.lerp(13.5, 34, t) * escapeBoost;
        targetCam.current.set(rocketWorldX + offsetX, rocketWorldY + offsetY, offsetZ);

        if (alt >= EXOSPHERE_LIMIT) {
          exosphereLockRef.current = {
            target: targetPos.current.clone(),
            camera: targetCam.current.clone(),
          };
        }
      }
    } else if (phase === 'outcome' && state.outcome === 'orbiting') {
      exosphereLockRef.current = null;
      // Orbit cinematic: frame the whole planet and keep the rocket visibly circling it.
      orbitBlendRef.current = THREE.MathUtils.damp(orbitBlendRef.current, 1, 2.6, delta);
      const planetCenterY = pyToWorldY(-params.planetRadius);
      const worldRadius = params.planetRadius * 2;
      const toRocket = new THREE.Vector3(rocketWorldX, rocketWorldY - planetCenterY, 0);
      if (toRocket.lengthSq() < 1e-6) toRocket.set(1, 0, 0);
      toRocket.normalize();
      const tangent = new THREE.Vector3(-toRocket.y, toRocket.x, 0).normalize();

      const launchTarget = new THREE.Vector3(rocketWorldX, rocketWorldY, 0);
      const launchCam = new THREE.Vector3(rocketWorldX + 9.0, rocketWorldY + 6.4, 30.0);
      // Lock the view around the rocket while retaining enough radial distance
      // to keep the planet in frame.
      const orbitTarget = new THREE.Vector3(
        rocketWorldX * 0.9,
        rocketWorldY * 0.9 + planetCenterY * 0.1,
        0,
      );
      const orbitCam = new THREE.Vector3(
        rocketWorldX + toRocket.x * worldRadius * 1.45 + tangent.x * worldRadius * 0.65,
        rocketWorldY + toRocket.y * worldRadius * 1.45 + tangent.y * worldRadius * 0.65,
        worldRadius * 1.95,
      );

      targetPos.current.copy(launchTarget).lerp(orbitTarget, orbitBlendRef.current);
      targetCam.current.copy(launchCam).lerp(orbitCam, orbitBlendRef.current);
    } else {
      exosphereLockRef.current = null;
    }

    // Time-based damping keeps camera motion smooth and framerate independent.
    const damping = 6.5;
    const dt = Math.min(delta, 0.05);
    const targetFov =
      phase === 'outcome' && state.outcome === 'orbiting'
        ? 66
        : phase === 'outcome' && state.outcome === 'escape'
          ? 52
          : 42;
    camera.fov = THREE.MathUtils.damp(camera.fov, targetFov, 4.5, dt);
    camera.updateProjectionMatrix();
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
const RocketScene = ({ params, state, onUpdateState, timeScale = 1 }: RocketSceneProps) => {
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const escapedPastExosphere =
    state.phase === 'outcome' && state.outcome === 'escape' && state.altitude > EXOSPHERE_LIMIT;
  const userControlled =
    state.phase === 'outcome' && state.outcome !== 'orbiting' && state.outcome !== 'escape'
    || escapedPastExosphere;
  const isOrbitingOutcome = state.phase === 'outcome' && state.outcome === 'orbiting';

  return (
    <Canvas
      camera={{ position: [5.5, 4.8, 13.5], fov: 42, near: 0.1, far: 20000 }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      style={{ background: '#050a14' }}
    >
      <color attach="background" args={['#050a14']} />
      {/* Push fog incredibly far so zooming out from orbit isn't blocked */}
      <fog attach="fog" args={['#050a14', 2000, 8000]} />

      <ambientLight intensity={0.72} />
      <directionalLight position={[10, 20, 10]} intensity={1.05} color="#dbeafe" />
      <pointLight position={[0, 10, 0]} intensity={0.7} color="#8be9fd" />

      <Stars radius={150} depth={60} count={3000} factor={4} saturation={0.3} fade speed={0.5} />

      {isOrbitingOutcome ? (
        <PlanetGlobe planetRadius={params.planetRadius} atmosphericDensity={params.atmosphericDensity} />
      ) : (
        <>
          <PlanetSurface />
          <AtmosphericLayers planetRadius={params.planetRadius} params={params} />
          <Atmosphere density={params.atmosphericDensity} />
        </>
      )}

      {state.phase === 'idle' && <TrajectoryArc params={params} />}
      {state.outcome === 'orbiting' && state.orbit && <OrbitPath orbit={state.orbit} />}
      {state.outcome === 'orbiting' && (
        <OrbitRocketMarker
          position={[state.position[0] * 2, pyToWorldY(state.position[1]), 0]}
        />
      )}
      {state.trajectory.length > 1 && <TrajectoryTrail trajectory={state.trajectory} />}

      <RocketModel params={params} state={state} onUpdateState={onUpdateState} timeScale={timeScale} />

      <CinematicCamera state={state} params={params} controlsRef={controlsRef} userControlled={userControlled} />

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
