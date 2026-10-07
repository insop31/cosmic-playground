import { useEffect, useRef, useMemo } from 'react';
import type { RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Stars } from '@react-three/drei';
import { Html, WorldEffects } from '@/stage/World';
import { useWorldActive } from '@/stage/worldContext';
import { useEffectiveRocketParams, useRocketStore } from '@/stores/rocketStore';
import { useFlightStore } from '@/stores/flightStore';
import ForceVectors from './ForceVectors';
import { useEffectiveTimeScale } from '@/stores/timeStore';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import RocketModel from './RocketModel';
import { LaunchComplex } from './RocketVisuals';
import { createAtmosphereMaterial, createSurfaceMaterial } from '@/stage/materials';
import { OrbitPathState, RocketParams, RocketState, computeTrajectoryPreview } from './rocketTypes';
import type { WeatherConditionId } from './weatherPresets';
import { WeatherEnvironment, WeatherShakeGroup } from './WeatherEffects';
import { createLightningStrikeState } from './lightningStrike';
import { liveFlight } from './liveFlight';
import { useReducedMotion } from '@/motion/useReducedMotion';


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

/** World-y of every layer boundary, bottom to top (the shells are centred on the launch base). */
const LAYER_BOUNDARIES = [
  ...ATMO_LAYERS.map((l) => pyToWorldY(l.pyMin)),
  pyToWorldY(ATMO_LAYERS[ATMO_LAYERS.length - 1].pyMax),
];

// ─── Scene components ─────────────────────────────────────────────────────────

const PlanetSurface = () => <LaunchComplex />;

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
        <div className="scene-label flex items-center gap-1.5 whitespace-nowrap border-warn/40 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-warn">
          <span className="h-1.5 w-1.5 rounded-full bg-warn animate-pulse-dot" />
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
  const gl = useThree((state) => state.gl);
  // The globe can fill the screen, so its baked maps are larger than a Spacetime body's.
  const surface = useMemo(() => createSurfaceMaterial({ kind: 'earth', colors: ['#000', '#000', '#000'], caps: 0.82, seed: 4.2, nightGlow: 0.05 }, gl, 1024), [gl]);
  const clouds = useMemo(() => createSurfaceMaterial({ kind: 'clouds', colors: ['#fff', '#fff', '#fff'], seed: 1.9, roughness: 1, nightGlow: 0.03 }, gl, 1024), [gl]);
  const atmosphere = useMemo(
    () => createAtmosphereMaterial('#5fb0ff', THREE.MathUtils.clamp(0.8 + atmosphericDensity * 1.4, 0.8, 2.2), 2.6),
    [atmosphericDensity],
  );
  useEffect(() => () => atmosphere.dispose(), [atmosphere]);
  const globeRef = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (globeRef.current) globeRef.current.rotation.y += delta * 0.02;
    clouds.userData.uniforms.uTime.value += delta;
  });
  return (
    <group position={[0, centerY, 0]}>
      <group ref={globeRef} rotation={[0.2, 0, 0.1]}>
        <mesh scale={worldRadius} material={surface}>
          <sphereGeometry args={[1, 96, 96]} />
        </mesh>
        <mesh scale={worldRadius * 1.012} material={clouds}>
          <sphereGeometry args={[1, 72, 72]} />
        </mesh>
      </group>
      <mesh scale={worldRadius * 1.06} material={atmosphere}>
        <sphereGeometry args={[1, 72, 72]} />
      </mesh>
    </group>
  );
};

// ─── Atmospheric Layers ───────────────────────────────────────────────────────
// Keep labels away from right-side UI panels.
const TRAJECTORY_LABEL_GAP = 1.25;

interface ShellLayer {
  color: string;
  opacity: number;
}

/** One translucent shell that looks like several stacked ones ("over" blending, inner first). */
const combineShells = (layers: ShellLayer[]) => {
  const premultiplied = new THREE.Color(0, 0, 0);
  let transmitted = 1;
  for (const { color, opacity } of layers) {
    premultiplied.multiplyScalar(1 - opacity).add(new THREE.Color(color).multiplyScalar(opacity));
    transmitted *= 1 - opacity;
  }
  const opacity = 1 - transmitted;
  return { color: premultiplied.multiplyScalar(opacity > 0 ? 1 / opacity : 0), opacity };
};

/**
 * The layer boundaries as hemispherical shells around the launch base. Each layer
 * used to be three shells (fill, a brighter edge 0.15 above it, and a faint inner
 * edge), drawn on both faces: up to 30 blended layers per pixel. Shells that sit
 * on the same boundary are merged into one with the same combined colour, which
 * draws the same picture with 6 shells.
 */
const LayerShells = ({ boundaries }: { boundaries: number[] }) => {
  const shells = useMemo(() => boundaries.map((radius, k) => {
    const stack: ShellLayer[] = [];
    const above = ATMO_LAYERS[k];       // this boundary is the bottom of `above`…
    const below = ATMO_LAYERS[k - 1];   // …and the top of `below`
    if (above) stack.push({ color: above.color, opacity: Math.min(above.alpha * 1.7, 0.2) * 0.35 });
    if (below) {
      stack.push({ color: below.color, opacity: Math.min(below.alpha * 1.25, 0.14) });
      stack.push({ color: below.color, opacity: Math.min(below.alpha * 1.7, 0.2) });
    }
    return { radius: Math.max(1, radius), ...combineShells(stack) };
  }), [boundaries]);

  return (
    <group>
      {shells.map((shell) => (
        <mesh key={shell.radius}>
          <sphereGeometry args={[shell.radius, 56, 36, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshBasicMaterial color={shell.color} transparent opacity={shell.opacity} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      ))}
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
  const boundaries = LAYER_BOUNDARIES;
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

      <LayerShells boundaries={boundaries} />

      {ATMO_LAYERS.map((layer) => {
        const yMax = pyToWorldY(layer.pyMax);
        const trajectoryX = THREE.MathUtils.clamp((layer.pyMax * trajectorySlope) * 2, -60, 60);
        const labelX = trajectoryX + TRAJECTORY_LABEL_GAP * trajectoryDir;

        return (
          <group key={layer.name}>
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
                className="scene-label scene-label-accent min-w-[150px] px-2.5 py-1.5"
                style={{
                  borderLeftColor: layer.color,
                  transform: `translateY(-50%) translateX(${trajectoryDir > 0 ? '0' : '-100%'})`,
                }}
              >
                <div className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: layer.borderColor }}>
                  {layer.name}
                </div>
                <div className="text-[10.5px] text-hud-dim">{layer.sublabel}</div>
                <div className="mt-1 font-mono text-[9.5px] tracking-wide text-foreground/70">{layer.altRange}</div>
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
  // Worlds always use a perspective camera (see stage/World.tsx).
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
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
      if (useFlightStore.getState().countdown !== null) {
        // Countdown: close on the engines, low and to the side.
        targetPos.current.set(0, 1.9, 0);
        targetCam.current.set(2.4, 1.3, 6.4);
      } else {
        targetPos.current.set(0, 3, 0);
        targetCam.current.set(5.5, 4.8, 13.5);
      }
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

// ─── Root ────────────────────────────────────────────────────────────────────
/** Rocket Lab world: rendered inside a <World> portal of the shared stage canvas. */
const RocketWorld = () => {
  const active = useWorldActive();
  const params = useEffectiveRocketParams();
  const state = useRocketStore((store) => store.flight);
  const onUpdateState = useRocketStore((store) => store.updateFlight);
  const activeWeather = useRocketStore((store) => store.activeWeather);
  const liveTimeScale = useEffectiveTimeScale();
  // A hidden world is paused.
  const timeScale = active ? liveTimeScale : 0;
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const lightningStrikeRef = useRef(createLightningStrikeState());
  const reduceMotion = useReducedMotion();

  // A lightning strike in the flight physics also jolts the rocket on screen.
  const strikeCount = state.events.filter((event) => event.kind === 'lightning').length;
  useEffect(() => {
    if (strikeCount === 0) return;
    lightningStrikeRef.current.impulse = 1;
    lightningStrikeRef.current.version += 1;
  }, [strikeCount]);
  const escapedPastExosphere =
    state.phase === 'outcome' && state.outcome === 'escape' && state.altitude > EXOSPHERE_LIMIT;
  const userControlled =
    state.phase === 'outcome' && state.outcome !== 'orbiting' && state.outcome !== 'escape'
    || escapedPastExosphere;
  const isOrbitingOutcome = state.phase === 'outcome' && state.outcome === 'orbiting';

  // Rocket world-space position for weather effects
  const rocketWorldX = state.position[0] * 2;
  const rocketWorldY = pyToWorldY(state.position[1]);

  return (
    <>
      <color attach="background" args={['#050a14']} />
      {/* Push fog incredibly far so zooming out from orbit isn't blocked */}
      <fog attach="fog" args={['#050a14', 2000, 8000]} />

      {/* Weather controls its own ambient; base lights provide fallback */}
      {activeWeather.size === 0 && <ambientLight intensity={0.72} />}
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

      {/* Weather environment: atmosphere overlays, particles, lightning, HUD */}
      <WeatherEnvironment
        activeWeather={activeWeather}
        rocketWorldX={rocketWorldX}
        rocketWorldY={rocketWorldY}
        altitude={state.altitude}
        phase={state.phase}
        lightningStrike={lightningStrikeRef.current}
      />

      {state.phase === 'idle' && <TrajectoryArc params={params} />}
      {state.outcome === 'orbiting' && state.orbit && <OrbitPath orbit={state.orbit} />}
      {state.outcome === 'orbiting' && (
        <OrbitRocketMarker
          position={[rocketWorldX, rocketWorldY, 0]}
        />
      )}
      {state.trajectory.length > 1 && <TrajectoryTrail trajectory={state.trajectory} />}

      {/* Weather shake wrapper around the rocket */}
      <WeatherShakeGroup
        activeWeather={activeWeather}
        altitude={state.altitude}
        phase={state.phase}
        lightningStrike={lightningStrikeRef.current}
        reduceMotion={reduceMotion}
      >
        <RocketModel params={params} state={state} onUpdateState={onUpdateState} timeScale={timeScale} activeWeather={activeWeather} flightRef={liveFlight} />
      </WeatherShakeGroup>

      <ForceVectors />

      <CinematicCamera state={state} params={params} controlsRef={controlsRef} userControlled={userControlled} />

      <OrbitControls
        ref={controlsRef}
        enabled={active && userControlled}
        enableDamping
        dampingFactor={0.05}
        minDistance={3}
        maxDistance={5000}
      />

      <WorldEffects bloomThreshold={0.9} bloomIntensity={0.65} bloomRadius={0.65} vignetteDarkness={0.5} />
    </>
  );
};

export default RocketWorld;
