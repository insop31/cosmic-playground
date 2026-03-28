/**
 * WeatherEffects.tsx — Dramatic, physically-inspired weather visuals.
 * Exports: WeatherEnvironment, WeatherShakeGroup
 */
import { useRef, useMemo, useEffect, type ReactNode } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { WeatherConditionId } from './weatherPresets';

const pyToWorldY = (py: number) => 1.2 + py * 2;

// ─── Shared lightning strike state (mutated by LightningEffect, read by shake + HUD) ─
export interface LightningStrikeState {
  version: number;
  /** 0–1, decays in WeatherShakeGroup for a hard jolt */
  impulse: number;
}

export function createLightningStrikeState(): LightningStrikeState {
  return { version: 0, impulse: 0 };
}

// ─── Particle / geometry counts ──────────────────────────────────────────────
const RAIN_COUNT  = 520;   // LineSegments pairs
const WIND_COUNT  = 160;   // LineSegments pairs
const JET_COUNT   = 90;    // LineSegments pairs
const SNOW_COUNT  = 420;   // Points
const ICE_COUNT   = 300;   // Points (larger flakes)
const BOLT_PTS    = 20;    // Main bolt polyline vertices
const BOLT_BR_PTS = 7;     // Branch vertices
const LEADER_PTS  = 9;     // Ground-up leader
const SPARK_COUNT = 28;    // Short-lived impact sparks
/** Max instanced cylinder segments: main + leader + 3 branches */
const MAX_BOLT_SEGS =
  (BOLT_PTS - 1) + (LEADER_PTS - 1) + 3 * (BOLT_BR_PTS - 1);

const _V_POS_SCRATCH = new THREE.Vector3();
const _V_SCALE_SCRATCH = new THREE.Vector3();
const _UP_Y = new THREE.Vector3(0, 1, 0);
const _DIR_SEG = new THREE.Vector3();
const _QUAT_SEG = new THREE.Quaternion();
const _MAT_SEG = new THREE.Matrix4();
const _ZERO_MAT = new THREE.Matrix4().makeScale(0, 0, 0);

/** Cylinder along local Y, height 1, centered — scale.y = segment length */
function setBoltSegmentMatrix(
  out: THREE.Matrix4,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  thickness: number,
) {
  const mx = (ax + bx) * 0.5;
  const my = (ay + by) * 0.5;
  const mz = (az + bz) * 0.5;
  _DIR_SEG.set(bx - ax, by - ay, bz - az);
  const len = _DIR_SEG.length();
  if (len < 1e-4) {
    out.copy(_ZERO_MAT);
    return;
  }
  _DIR_SEG.multiplyScalar(1 / len);
  _QUAT_SEG.setFromUnitVectors(_UP_Y, _DIR_SEG);
  _V_POS_SCRATCH.set(mx, my, mz);
  _V_SCALE_SCRATCH.set(thickness, len, thickness);
  out.compose(_V_POS_SCRATCH, _QUAT_SEG, _V_SCALE_SCRATCH);
}

function clearInstances(inst: THREE.InstancedMesh, from: number, to: number) {
  for (let i = from; i < to; i++) inst.setMatrixAt(i, _ZERO_MAT);
  inst.instanceMatrix.needsUpdate = true;
}

// ─── Scene Setup (background + Three.js fog) ─────────────────────────────────
const WeatherSceneSetup = ({
  activeWeather,
  phase,
}: {
  activeWeather: Set<WeatherConditionId>;
  phase: string;
}) => {
  const { scene } = useThree();
  const inOrbit = phase === 'outcome';

  useEffect(() => {
    // Background colour
    if (activeWeather.has('lightning')) {
      scene.background = new THREE.Color('#0e0522');
    } else if (activeWeather.has('precipitation') || activeWeather.has('cloud')) {
      scene.background = new THREE.Color('#07101a');
    } else if (activeWeather.has('temperature') || activeWeather.has('ice')) {
      scene.background = new THREE.Color('#08101e');
    } else {
      scene.background = new THREE.Color('#050a14');
    }

    // Three.js built-in fog — gives real depth haze for visibility
    if (activeWeather.has('visibility') && !inOrbit) {
      scene.fog = new THREE.FogExp2('#1c2535', 0.042);
    } else if (activeWeather.has('precipitation') || activeWeather.has('cloud')) {
      scene.fog = new THREE.FogExp2('#0a1220', 0.012);
    } else {
      scene.fog = new THREE.Fog('#050a14', 2000, 8000);
    }

    return () => {
      scene.background = new THREE.Color('#050a14');
      scene.fog = new THREE.Fog('#050a14', 2000, 8000);
    };
  }, [activeWeather, inOrbit, scene]);

  return null;
};

// ─── Atmosphere Shell Overlays (coloured hemisphere shells) ──────────────────
interface ShellDef { color: string; rMax: number; opacity: number }
const SHELL_MAP: Partial<Record<WeatherConditionId, ShellDef[]>> = {
  lightning: [
    { color: '#1c0630', rMax: pyToWorldY(16), opacity: 0.65 },
    { color: '#320a52', rMax: pyToWorldY(9),  opacity: 0.48 },
  ],
  cloud: [
    { color: '#1b2535', rMax: pyToWorldY(13), opacity: 0.55 },
    { color: '#141e2c', rMax: pyToWorldY(7),  opacity: 0.38 },
  ],
  precipitation: [
    { color: '#0c1826', rMax: pyToWorldY(12), opacity: 0.60 },
    { color: '#08101c', rMax: pyToWorldY(6),  opacity: 0.40 },
  ],
  temperature: [
    { color: '#b8d8f8', rMax: pyToWorldY(12), opacity: 0.14 },
    { color: '#7ab8e8', rMax: pyToWorldY(6),  opacity: 0.20 },
  ],
  ice: [
    { color: '#9ac8f0', rMax: pyToWorldY(10), opacity: 0.22 },
    { color: '#c8e8ff', rMax: pyToWorldY(5),  opacity: 0.16 },
  ],
  upperAtmo: [
    { color: '#16105a', rMax: pyToWorldY(30), opacity: 0.55 },
    { color: '#0c0a38', rMax: pyToWorldY(50), opacity: 0.42 },
  ],
  visibility: [
    { color: '#3d4a5c', rMax: pyToWorldY(18), opacity: 0.52 },
    { color: '#2d3848', rMax: pyToWorldY(8),  opacity: 0.38 },
  ],
  wind: [
    { color: '#0e1c2c', rMax: pyToWorldY(25), opacity: 0.28 },
  ],
};

const WeatherAtmoOverlay = ({ activeWeather }: { activeWeather: Set<WeatherConditionId> }) => {
  const layers: (ShellDef & { id: string })[] = [];
  for (const [id, defs] of Object.entries(SHELL_MAP)) {
    if (!activeWeather.has(id as WeatherConditionId) || !defs) continue;
    defs.forEach((d, i) => layers.push({ ...d, id: `${id}_${i}` }));
  }
  if (!layers.length) return null;
  return (
    <group>
      {layers.map((l) => (
        <mesh key={l.id}>
          <sphereGeometry args={[l.rMax, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshBasicMaterial
            color={l.color} transparent opacity={l.opacity}
            depthWrite={false} side={THREE.DoubleSide}
          />
        </mesh>
      ))}
    </group>
  );
};

// ─── Cloud Formations (storm + lightning + rain) ──────────────────────────────
const CLOUD_COLORS = ['#1a2333', '#1c2a3c', '#20303f', '#181f2c', '#222e3e'];

const CloudFormations = ({ active }: { active: boolean }) => {
  // Generate cloud puffs once — they are static meshes (realistic static clouds)
  const puffs = useMemo(() => {
    if (!active) return [];
    const out: { x: number; y: number; z: number; r: number; op: number; col: string }[] = [];
    for (let c = 0; c < 18; c++) {
      const cx  = (Math.random() - 0.5) * 100;
      const cy  = pyToWorldY(1.2 + Math.random() * 8);
      const cz  = (Math.random() - 0.5) * 26;
      const n   = 4 + Math.floor(Math.random() * 4);
      const col = CLOUD_COLORS[Math.floor(Math.random() * CLOUD_COLORS.length)];
      for (let p = 0; p < n; p++) {
        out.push({
          x:   cx + (Math.random() - 0.5) * 10,
          y:   cy + (Math.random() - 0.5) * 2.2,
          z:   cz + (Math.random() - 0.5) * 5,
          r:   3.5 + Math.random() * 5.5,
          op:  0.20 + Math.random() * 0.22,
          col: col,
        });
      }
    }
    return out;
  }, [active]);

  // Slow horizontal drift for cloud clusters
  const groupRef  = useRef<THREE.Group>(null);
  const driftTime = useRef(0);
  useFrame((_, dt) => {
    if (!groupRef.current || !active) return;
    driftTime.current += dt;
    // Very slow drift, barely noticeable — gives life to the clouds
    groupRef.current.position.x = Math.sin(driftTime.current * 0.04) * 1.8;
  });

  if (!active || !puffs.length) return null;
  return (
    <group ref={groupRef}>
      {puffs.map((p, i) => (
        <mesh key={i} position={[p.x, p.y, p.z]}>
          <sphereGeometry args={[p.r, 9, 7]} />
          <meshBasicMaterial color={p.col} transparent opacity={p.op} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
};

// ─── Rain Streaks (LineSegments — realistic falling streaks) ─────────────────
const RainStreakEffect = ({
  active,
  windDrift,
}: {
  active: boolean;
  windDrift: number;
}) => {
  // Store "top-of-streak" positions separately for efficient update
  const topPos = useMemo(() => {
    const a = new Float32Array(RAIN_COUNT * 3);
    for (let i = 0; i < RAIN_COUNT; i++) {
      a[i * 3]     = (Math.random() - 0.5) * 110;
      a[i * 3 + 1] = Math.random() * 75;
      a[i * 3 + 2] = (Math.random() - 0.5) * 28;
    }
    return a;
  }, []);

  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(RAIN_COUNT * 6), 3));
    return g;
  }, []);

  const seg = useMemo(() => new THREE.LineSegments(
    geo,
    new THREE.LineBasicMaterial({ color: '#7fc8f0', transparent: true, opacity: 0.75 }),
  ), [geo]);

  useFrame((_, dt) => {
    if (!active) return;
    const arr    = geo.attributes.position.array as Float32Array;
    const STREAK = 1.3;
    for (let i = 0; i < RAIN_COUNT; i++) {
      topPos[i * 3 + 1] -= dt * 42;
      topPos[i * 3]     += windDrift * dt;
      if (topPos[i * 3 + 1] < -2) {
        topPos[i * 3]     = (Math.random() - 0.5) * 110;
        topPos[i * 3 + 1] = 72 + Math.random() * 12;
        topPos[i * 3 + 2] = (Math.random() - 0.5) * 28;
      }
      // Top vertex
      arr[i * 6]     = topPos[i * 3];
      arr[i * 6 + 1] = topPos[i * 3 + 1];
      arr[i * 6 + 2] = topPos[i * 3 + 2];
      // Bottom vertex (streak tail, slightly drifted)
      arr[i * 6 + 3] = topPos[i * 3] + windDrift * 0.032;
      arr[i * 6 + 4] = topPos[i * 3 + 1] - STREAK;
      arr[i * 6 + 5] = topPos[i * 3 + 2];
    }
    (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  });

  if (!active) return null;
  return <primitive object={seg} />;
};

// ─── Hail Chunks (large bright Points mixed with rain) ───────────────────────
const HailEffect = ({ active }: { active: boolean }) => {
  const COUNT = 120;
  const geo   = useMemo(() => {
    const g   = new THREE.BufferGeometry();
    const pos = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      pos[i * 3]     = (Math.random() - 0.5) * 80;
      pos[i * 3 + 1] = Math.random() * 60;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 22;
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return g;
  }, []);

  const mat = useMemo(() => new THREE.PointsMaterial({
    size: 0.38, color: '#e0f2fe', transparent: true, opacity: 0.85,
    depthWrite: false, sizeAttenuation: true,
  }), []);

  const pts = useMemo(() => new THREE.Points(geo, mat), [geo, mat]);

  useFrame((_, dt) => {
    if (!active) return;
    const arr = geo.attributes.position.array as Float32Array;
    for (let i = 0; i < COUNT; i++) {
      arr[i * 3 + 1] -= dt * 55;   // hail falls faster than rain
      arr[i * 3]     += dt * 3;    // slight drift
      if (arr[i * 3 + 1] < -1) {
        arr[i * 3]     = (Math.random() - 0.5) * 80;
        arr[i * 3 + 1] = 62 + Math.random() * 10;
        arr[i * 3 + 2] = (Math.random() - 0.5) * 22;
      }
    }
    (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  });

  if (!active) return null;
  return <primitive object={pts} />;
};

// ─── Snow / Frost Fall (extreme cold) ────────────────────────────────────────
const SnowFallEffect = ({ active }: { active: boolean }) => {
  const swayT = useRef(0);
  const geo   = useMemo(() => {
    const g   = new THREE.BufferGeometry();
    const pos = new Float32Array(SNOW_COUNT * 3);
    for (let i = 0; i < SNOW_COUNT; i++) {
      pos[i * 3]     = (Math.random() - 0.5) * 100;
      pos[i * 3 + 1] = Math.random() * 70;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 26;
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return g;
  }, []);

  const mat = useMemo(() => new THREE.PointsMaterial({
    size: 0.22, color: '#dbeafe', transparent: true, opacity: 0.78,
    depthWrite: false, sizeAttenuation: true,
  }), []);

  const pts = useMemo(() => new THREE.Points(geo, mat), [geo, mat]);

  useFrame((_, dt) => {
    if (!active) return;
    swayT.current += dt;
    const arr = geo.attributes.position.array as Float32Array;
    for (let i = 0; i < SNOW_COUNT; i++) {
      arr[i * 3 + 1] -= dt * 4.5;
      arr[i * 3]     += Math.sin(swayT.current * 0.7 + i * 0.1) * dt * 0.7;
      if (arr[i * 3 + 1] < 0) {
        arr[i * 3]     = (Math.random() - 0.5) * 100;
        arr[i * 3 + 1] = 68 + Math.random() * 10;
        arr[i * 3 + 2] = (Math.random() - 0.5) * 26;
      }
    }
    (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  });

  if (!active) return null;
  return <primitive object={pts} />;
};

// ─── Ice Accumulation — Large Falling Flakes ─────────────────────────────────
const IceFallEffect = ({ active }: { active: boolean }) => {
  const swayT = useRef(0);
  const geo   = useMemo(() => {
    const g   = new THREE.BufferGeometry();
    const pos = new Float32Array(ICE_COUNT * 3);
    for (let i = 0; i < ICE_COUNT; i++) {
      pos[i * 3]     = (Math.random() - 0.5) * 90;
      pos[i * 3 + 1] = Math.random() * 70;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 22;
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return g;
  }, []);

  const mat = useMemo(() => new THREE.PointsMaterial({
    size: 0.42, color: '#bfdbfe', transparent: true, opacity: 0.82,
    depthWrite: false, sizeAttenuation: true,
  }), []);

  const pts = useMemo(() => new THREE.Points(geo, mat), [geo, mat]);

  useFrame((_, dt) => {
    if (!active) return;
    swayT.current += dt;
    const arr = geo.attributes.position.array as Float32Array;
    for (let i = 0; i < ICE_COUNT; i++) {
      arr[i * 3 + 1] -= dt * 7;   // slightly faster than snow
      arr[i * 3]     += Math.sin(swayT.current * 1.1 + i * 0.15) * dt * 1.2;
      if (arr[i * 3 + 1] < 0) {
        arr[i * 3]     = (Math.random() - 0.5) * 90;
        arr[i * 3 + 1] = 68 + Math.random() * 10;
        arr[i * 3 + 2] = (Math.random() - 0.5) * 22;
      }
    }
    (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  });

  if (!active) return null;
  return <primitive object={pts} />;
};

// ─── Wind Streaks (LineSegments, fast horizontal) ────────────────────────────
const WindStreakEffect = ({
  active,
  altitude,
}: {
  active: boolean;
  altitude: number;
}) => {
  const topPos = useMemo(() => {
    const a = new Float32Array(WIND_COUNT * 3);
    for (let i = 0; i < WIND_COUNT; i++) {
      a[i * 3]     = (Math.random() - 0.5) * 100;
      a[i * 3 + 1] = Math.random() * 60;
      a[i * 3 + 2] = (Math.random() - 0.5) * 16;
    }
    return a;
  }, []);

  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(WIND_COUNT * 6), 3));
    return g;
  }, []);

  const seg = useMemo(() => new THREE.LineSegments(
    geo,
    new THREE.LineBasicMaterial({ color: '#c8dff5', transparent: true, opacity: 0.52 }),
  ), [geo]);

  useFrame((_, dt) => {
    if (!active) return;
    const arr    = geo.attributes.position.array as Float32Array;
    const speed  = 24 + altitude * 0.5;
    // Streaks are longer at higher altitude
    const STREAK = 3.5 + (altitude / 8) * 1.8;
    for (let i = 0; i < WIND_COUNT; i++) {
      topPos[i * 3] += dt * speed;
      // Slight sinusoidal undulation up-down
      topPos[i * 3 + 1] += Math.sin(topPos[i * 3] * 0.06 + i) * dt * 0.4;
      if (topPos[i * 3] > 55) {
        topPos[i * 3]     = -55;
        topPos[i * 3 + 1] = Math.random() * 60;
        topPos[i * 3 + 2] = (Math.random() - 0.5) * 16;
      }
      arr[i * 6]     = topPos[i * 3];
      arr[i * 6 + 1] = topPos[i * 3 + 1];
      arr[i * 6 + 2] = topPos[i * 3 + 2];
      arr[i * 6 + 3] = topPos[i * 3] - STREAK;
      arr[i * 6 + 4] = topPos[i * 3 + 1];
      arr[i * 6 + 5] = topPos[i * 3 + 2];
    }
    (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  });

  if (!active) return null;
  return <primitive object={seg} />;
};

// ─── Jet Stream — Fast High-Altitude Bands ───────────────────────────────────
const JetStreamBands = ({
  active,
  altitude,
}: {
  active: boolean;
  altitude: number;
}) => {
  const topPos = useMemo(() => {
    const a = new Float32Array(JET_COUNT * 3);
    for (let i = 0; i < JET_COUNT; i++) {
      a[i * 3]     = (Math.random() - 0.5) * 130;
      // Exclusively in the stratosphere/mesosphere band
      a[i * 3 + 1] = pyToWorldY(10 + Math.random() * 16);
      a[i * 3 + 2] = (Math.random() - 0.5) * 16;
    }
    return a;
  }, []);

  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(JET_COUNT * 6), 3));
    return g;
  }, []);

  // Distinct purple-blue colour to differentiate from surface wind
  const seg = useMemo(() => new THREE.LineSegments(
    geo,
    new THREE.LineBasicMaterial({ color: '#818cf8', transparent: true, opacity: 0.65 }),
  ), [geo]);

  useFrame((_, dt) => {
    if (!active) return;
    const arr    = geo.attributes.position.array as Float32Array;
    const speed  = 42 + altitude * 0.8;
    const STREAK = 6 + (altitude / 10) * 3;
    for (let i = 0; i < JET_COUNT; i++) {
      topPos[i * 3] += dt * speed;
      if (topPos[i * 3] > 70) {
        topPos[i * 3]     = -70;
        topPos[i * 3 + 1] = pyToWorldY(10 + Math.random() * 16);
        topPos[i * 3 + 2] = (Math.random() - 0.5) * 16;
      }
      arr[i * 6]     = topPos[i * 3];
      arr[i * 6 + 1] = topPos[i * 3 + 1];
      arr[i * 6 + 2] = topPos[i * 3 + 2];
      arr[i * 6 + 3] = topPos[i * 3] - STREAK;
      arr[i * 6 + 4] = topPos[i * 3 + 1];
      arr[i * 6 + 5] = topPos[i * 3 + 2];
    }
    (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  });

  if (!active) return null;

  return (
    <group>
      <primitive object={seg} />
      {/* Visible altitude label for jet stream band */}
      <Html
        position={[22, pyToWorldY(17), 0]}
        style={{ pointerEvents: 'none', userSelect: 'none' }}
        distanceFactor={22}
      >
        <div style={{
          fontFamily: 'monospace', fontSize: '9px', fontWeight: 700,
          color: '#818cf8', background: 'rgba(4,6,20,0.75)',
          border: '1px solid #818cf855', borderRadius: '5px',
          padding: '2px 7px', letterSpacing: '0.1em', textTransform: 'uppercase',
          whiteSpace: 'nowrap',
        }}>
          🌀 Jet Stream Active
        </div>
      </Html>
    </group>
  );
};

function rollStrikeImpulse(): number {
  const r = Math.random();
  if (r < 0.22) return 1.5;
  if (r < 0.55) return 1.15;
  return 0.9;
}

function fillBranch(
  out: Float32Array,
  sx: number, sy: number,
  ex: number, ey: number,
  zJitter: number,
) {
  for (let i = 0; i < BOLT_BR_PTS; i++) {
    const t = i / (BOLT_BR_PTS - 1);
    const jx = (i > 0 && i < BOLT_BR_PTS - 1) ? (Math.random() - 0.5) * 2.8 : 0;
    const jy = (i > 0 && i < BOLT_BR_PTS - 1) ? (Math.random() - 0.5) * 2.2 : 0;
    out[i * 3]     = THREE.MathUtils.lerp(sx, ex, t) + jx;
    out[i * 3 + 1] = THREE.MathUtils.lerp(sy, ey, t) + jy;
    out[i * 3 + 2] = (Math.random() - 0.5) * zJitter;
  }
}

// ─── Lightning — volumetric mesh bolts (reads clearly; no 1px GL lines) ───────
const LightningEffect = ({
  active,
  rocketWorldX,
  rocketWorldY,
  lightningStrike,
}: {
  active: boolean;
  rocketWorldX: number;
  rocketWorldY: number;
  lightningStrike: LightningStrikeState;
}) => {
  const coreGeo = useMemo(() => new THREE.CylinderGeometry(0.042, 0.042, 1, 12, 1, false), []);
  const haloGeo = useMemo(() => new THREE.CylinderGeometry(0.16, 0.16, 1, 12, 1, false), []);

  const coreMat = useMemo(() => new THREE.MeshBasicMaterial({
    color: '#ffffff',
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }), []);
  const haloMat = useMemo(() => new THREE.MeshBasicMaterial({
    color: '#7dd3fc',
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }), []);

  const coreRef = useRef<THREE.InstancedMesh>(null);
  const haloRef = useRef<THREE.InstancedMesh>(null);

  const leaderPts = useRef(new Float32Array(LEADER_PTS * 3));
  const br1Pts = useRef(new Float32Array(BOLT_BR_PTS * 3));
  const br2Pts = useRef(new Float32Array(BOLT_BR_PTS * 3));
  const br3Pts = useRef(new Float32Array(BOLT_BR_PTS * 3));

  const sparkGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPARK_COUNT * 3), 3));
    return g;
  }, []);
  const sparkMat = useMemo(() => new THREE.PointsMaterial({
    size: 0.14,
    color: '#fffef0',
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  }), []);
  const sparks = useMemo(() => new THREE.Points(sparkGeo, sparkMat), [sparkGeo, sparkMat]);
  const sparkVel = useRef(new Float32Array(SPARK_COUNT * 3));

  const flashRef = useRef<THREE.Mesh>(null);
  const coronaRef = useRef<THREE.Mesh>(null);
  const hitRef = useRef<THREE.Mesh>(null);
  const flashLtRef = useRef<THREE.PointLight>(null);
  const rimLtRef = useRef<THREE.PointLight>(null);

  const timerRef = useRef(0.8 + Math.random() * 1.2);
  const opacRef = useRef(0);
  const boltCache = useRef(new Float32Array(BOLT_PTS * 3));
  const strikeMultRef = useRef(1);
  const flickerRef = useRef(0);

  const pushSegments = (
    pts: Float32Array,
    nPts: number,
    startIdx: number,
  ) => {
    const c = coreRef.current;
    const h = haloRef.current;
    if (!c || !h) return startIdx;
    let k = startIdx;
    for (let i = 0; i < nPts - 1; i++) {
      setBoltSegmentMatrix(
        _MAT_SEG,
        pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2],
        pts[(i + 1) * 3], pts[(i + 1) * 3 + 1], pts[(i + 1) * 3 + 2],
        1,
      );
      c.setMatrixAt(k, _MAT_SEG);
      h.setMatrixAt(k, _MAT_SEG);
      k += 1;
    }
    return k;
  };

  useFrame((state, dt) => {
    const core = coreRef.current;
    const halo = haloRef.current;
    if (!active) {
      coreMat.opacity = haloMat.opacity = sparkMat.opacity = 0;
      if (flashLtRef.current) flashLtRef.current.intensity = 0;
      if (rimLtRef.current) rimLtRef.current.intensity = 0;
      if (flashRef.current) (flashRef.current.material as THREE.MeshBasicMaterial).opacity = 0;
      if (hitRef.current) (hitRef.current.material as THREE.MeshBasicMaterial).opacity = 0;
      if (coronaRef.current) (coronaRef.current.material as THREE.MeshBasicMaterial).opacity = 0;
      if (core) clearInstances(core, 0, MAX_BOLT_SEGS);
      if (halo) clearInstances(halo, 0, MAX_BOLT_SEGS);
      return;
    }

    timerRef.current -= dt;

    if (opacRef.current > 0) {
      // Snappy decay — feels like real discharge (bright core, fast afterglow)
      opacRef.current = Math.max(0, opacRef.current - dt * 19);
      flickerRef.current = Math.max(0, flickerRef.current - dt * 22);
      const o = opacRef.current * (0.88 + 0.12 * Math.sin(state.clock.elapsedTime * 80) * flickerRef.current);
      const sm = strikeMultRef.current;

      coreMat.opacity = THREE.MathUtils.clamp(o * 0.98, 0, 1);
      haloMat.opacity = THREE.MathUtils.clamp(o * 0.42, 0, 1);
      sparkMat.opacity = THREE.MathUtils.clamp(o * 0.85 * sm, 0, 1);

      const flashCore = (38 + 32 * sm) * o;
      if (flashLtRef.current) {
        flashLtRef.current.position.set(rocketWorldX, rocketWorldY + 11 + o * 4, 0);
        flashLtRef.current.intensity = flashCore;
      }
      if (rimLtRef.current) {
        rimLtRef.current.position.set(rocketWorldX, rocketWorldY + 0.8, 1.8);
        rimLtRef.current.intensity = o * (18 + 14 * sm);
      }
      if (flashRef.current) {
        (flashRef.current.material as THREE.MeshBasicMaterial).opacity = o * (0.14 + 0.08 * sm);
      }
      if (hitRef.current) {
        (hitRef.current.material as THREE.MeshBasicMaterial).opacity = o * (0.55 + 0.22 * sm);
      }
      if (coronaRef.current) {
        const cm = coronaRef.current.material as THREE.MeshBasicMaterial;
        cm.opacity = o * (0.32 + 0.12 * sm);
        coronaRef.current.rotation.z = state.clock.elapsedTime * 4.2 * o;
      }

      const sArr = sparkGeo.attributes.position.array as Float32Array;
      const vArr = sparkVel.current;
      for (let i = 0; i < SPARK_COUNT; i++) {
        sArr[i * 3]     += vArr[i * 3] * dt * 22;
        sArr[i * 3 + 1] += vArr[i * 3 + 1] * dt * 22;
        sArr[i * 3 + 2] += vArr[i * 3 + 2] * dt * 22;
        vArr[i * 3 + 1] -= dt * 3.5;
      }
      (sparkGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }

    if (timerRef.current <= 0) {
      timerRef.current = 1.1 + Math.random() * 2.4 + Math.sin(state.clock.elapsedTime) * 0.25;
      opacRef.current = 1;
      flickerRef.current = 1;

      strikeMultRef.current = rollStrikeImpulse();

      lightningStrike.version += 1;
      lightningStrike.impulse = strikeMultRef.current;

      const cloudTopY = rocketWorldY + 15 + Math.random() * 8;
      const startX = rocketWorldX + (Math.random() - 0.5) * 6;
      const b = boltCache.current;

      for (let i = 0; i < BOLT_PTS; i++) {
        const t = i / (BOLT_PTS - 1);
        const isEnd = i === BOLT_PTS - 1;
        const isStart = i === 0;
        const jit = (!isEnd && !isStart) ? (Math.random() - 0.5) * 2.6 : 0;
        const x = isEnd ? rocketWorldX : THREE.MathUtils.lerp(startX, rocketWorldX, t) + jit;
        const y = isEnd ? rocketWorldY : THREE.MathUtils.lerp(cloudTopY, rocketWorldY, t);
        const z = isEnd ? 0 : (Math.random() - 0.5) * 0.45;
        b[i * 3] = x;
        b[i * 3 + 1] = y;
        b[i * 3 + 2] = z;
      }

      const midIdx = Math.floor(BOLT_PTS * 0.34);
      const mx = b[midIdx * 3];
      const my = b[midIdx * 3 + 1];
      const l = leaderPts.current;
      const baseX = rocketWorldX + (Math.random() - 0.5) * 4;
      for (let i = 0; i < LEADER_PTS; i++) {
        const t = i / (LEADER_PTS - 1);
        const jit = (i > 0 && i < LEADER_PTS - 1) ? (Math.random() - 0.5) * 1.6 : 0;
        l[i * 3]     = THREE.MathUtils.lerp(baseX, mx, t) + jit;
        l[i * 3 + 1] = THREE.MathUtils.lerp(0.35, my, t);
        l[i * 3 + 2] = (Math.random() - 0.5) * 0.35;
      }

      const bi1 = Math.floor(BOLT_PTS * 0.30);
      fillBranch(br1Pts.current, b[bi1 * 3], b[bi1 * 3 + 1], b[bi1 * 3] + 8, b[bi1 * 3 + 1] - 5.5, 1.4);
      const bi2 = Math.floor(BOLT_PTS * 0.52);
      fillBranch(br2Pts.current, b[bi2 * 3], b[bi2 * 3 + 1], b[bi2 * 3] - 7, b[bi2 * 3 + 1] - 4.2, 1.2);
      const bi3 = Math.floor(BOLT_PTS * 0.74);
      fillBranch(br3Pts.current, b[bi3 * 3], b[bi3 * 3 + 1], b[bi3 * 3] + 4.5, b[bi3 * 3 + 1] + 3.6, 1.6);

      if (core && halo) {
        let k = pushSegments(b, BOLT_PTS, 0);
        k = pushSegments(l, LEADER_PTS, k);
        k = pushSegments(br1Pts.current, BOLT_BR_PTS, k);
        k = pushSegments(br2Pts.current, BOLT_BR_PTS, k);
        k = pushSegments(br3Pts.current, BOLT_BR_PTS, k);
        clearInstances(core, k, MAX_BOLT_SEGS);
        clearInstances(halo, k, MAX_BOLT_SEGS);
      }

      const sArr = sparkGeo.attributes.position.array as Float32Array;
      const vArr = sparkVel.current;
      for (let i = 0; i < SPARK_COUNT; i++) {
        sArr[i * 3]     = rocketWorldX + (Math.random() - 0.5) * 0.35;
        sArr[i * 3 + 1] = rocketWorldY + (Math.random() - 0.5) * 0.45;
        sArr[i * 3 + 2] = (Math.random() - 0.5) * 0.35;
        const phi = Math.random() * Math.PI * 2;
        const th = Math.random() * Math.PI * 0.48;
        const sp = (0.85 + Math.random() * 1.1) * strikeMultRef.current;
        vArr[i * 3]     = Math.cos(phi) * Math.sin(th) * sp;
        vArr[i * 3 + 1] = Math.cos(th) * sp * 0.62 + 0.4;
        vArr[i * 3 + 2] = Math.sin(phi) * Math.sin(th) * sp;
      }
      (sparkGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }
  });

  if (!active) return null;

  const rx = rocketWorldX;
  const ry = rocketWorldY;

  return (
    <group>
      <instancedMesh ref={coreRef} args={[coreGeo, coreMat, MAX_BOLT_SEGS]} frustumCulled={false} />
      <instancedMesh ref={haloRef} args={[haloGeo, haloMat, MAX_BOLT_SEGS]} frustumCulled={false} />
      <primitive object={sparks} />

      {/* Contact bloom on the stack */}
      <mesh ref={hitRef} position={[rx, ry, 0]}>
        <sphereGeometry args={[1.15, 14, 14]} />
        <meshBasicMaterial
          color="#ffffff"
          transparent
          opacity={0}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      <mesh ref={coronaRef} position={[rx, ry, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.05, 1.42, 48]} />
        <meshBasicMaterial
          color="#bae6ff"
          transparent
          opacity={0}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          side={THREE.DoubleSide}
        />
      </mesh>

      <mesh ref={flashRef} position={[rx, ry + 3, 0]}>
        <sphereGeometry args={[11, 12, 12]} />
        <meshBasicMaterial
          color="#e8f4ff"
          transparent
          opacity={0}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      <pointLight ref={flashLtRef} color="#f8fbff" intensity={0} distance={85} decay={2} />
      <pointLight ref={rimLtRef} color="#93c5fd" intensity={0} distance={28} decay={2} />
    </group>
  );
};

// ─── Ice/Cold Ground Effect ───────────────────────────────────────────────────
const IceGroundEffect = ({ active, isCold }: { active: boolean; isCold: boolean }) => {
  const lightRef = useRef<THREE.PointLight>(null);
  useFrame((state) => {
    if (!lightRef.current || !active) return;
    lightRef.current.intensity = 2.2 + Math.sin(state.clock.elapsedTime * 1.8) * 0.9;
  });

  if (!active) return null;

  return (
    <group>
      {/* Concentric ice rings on launch pad */}
      {[{ ri: 0.8, ro: 1.6 }, { ri: 2.2, ro: 3.2 }, { ri: 3.8, ro: 5.2 }].map((r, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.07 + i * 0.005, 0]}>
          <ringGeometry args={[r.ri, r.ro, 52]} />
          <meshBasicMaterial
            color={i === 0 ? '#e0f2fe' : '#bfdbfe'}
            transparent opacity={0.38 - i * 0.06} depthWrite={false}
          />
        </mesh>
      ))}

      {/* Ground frost patches scattered around pad */}
      {[-7, -5, -2, 2, 5, 7, -9, 9].map((x, i) => (
        <mesh key={`fr${i}`} rotation={[-Math.PI / 2, 0, 0]}
          position={[x, 0.06, (i % 3 === 0 ? 4 : i % 3 === 1 ? -4 : 0)]}
        >
          <circleGeometry args={[0.5 + Math.random() * 0.6, 8]} />
          <meshBasicMaterial color="#dbeafe" transparent opacity={0.32} depthWrite={false} />
        </mesh>
      ))}

      {/* Icicles on launch tower arm */}
      {[
        [-1.05, 6.3, 0, 0.40], [-1.40, 6.3, 0, 0.52], [-1.75, 6.2, 0, 0.34],
        [-0.75, 6.2, 0, 0.28], [-1.22, 6.35, 0, 0.46],
      ].map(([x, y, z, h], i) => (
        <mesh key={`ic${i}`} position={[x, (y as number) - (h as number) / 2, z as number]} rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[0.055, h as number, 5]} />
          <meshBasicMaterial color="#c8e8ff" transparent opacity={0.88} />
        </mesh>
      ))}

      {/* Mist / cold ground fog (only for temperature) */}
      {isCold && [2, 4, 6].map((y, i) => (
        <mesh key={`mist${i}`} rotation={[-Math.PI / 2, 0, 0]} position={[0, y, 0]}>
          <planeGeometry args={[80, 80]} />
          <meshBasicMaterial
            color="#c8e8ff" transparent opacity={0.07 - i * 0.015}
            depthWrite={false} side={THREE.DoubleSide}
          />
        </mesh>
      ))}

      {/* Cold blue light near ground */}
      <pointLight ref={lightRef} position={[0, 3, 0]} color="#93c5fd" intensity={2.2} distance={26} />
    </group>
  );
};

// ─── Fog Layers (Low Visibility) ──────────────────────────────────────────────
const FogLayerEffect = ({
  active,
  phase,
}: {
  active: boolean;
  phase: string;
}) => {
  if (!active || phase === 'outcome') return null;

  return (
    <group>
      {/* Dense horizontal fog discs at ascending heights */}
      {[1.2, 2.5, 4.2, 6.5, 9.5, 13.5, 18].map((y, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[0, y, 0]}>
          <planeGeometry args={[220, 220]} />
          <meshBasicMaterial
            color="#3a4a5c"
            transparent
            opacity={Math.max(0.04, 0.28 - i * 0.035)}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
      {/* Thick fog sphere filling the lower atmosphere */}
      <mesh>
        <sphereGeometry args={[pyToWorldY(10), 36, 22, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshBasicMaterial
          color="#3a4a5c" transparent opacity={0.22}
          depthWrite={false} side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
};

// ─── Ambient Light Tinting ────────────────────────────────────────────────────
const WeatherAmbientLight = ({ activeWeather }: { activeWeather: Set<WeatherConditionId> }) => {
  const lightRef = useRef<THREE.AmbientLight>(null);

  useFrame((state, dt) => {
    if (!lightRef.current) return;
    const tgt = new THREE.Color();
    let intensity = 0.72;

    if (activeWeather.has('lightning')) {
      const flicker = 1 + Math.sin(state.clock.elapsedTime * 6.5) * 0.32;
      tgt.set('#5b0fa0');
      intensity = 0.44 * flicker;
    } else if (activeWeather.has('precipitation')) {
      tgt.set('#1a354e'); intensity = 0.42;
    } else if (activeWeather.has('cloud')) {
      tgt.set('#252d38'); intensity = 0.48;
    } else if (activeWeather.has('ice')) {
      tgt.set('#4a90c0'); intensity = 0.58;
    } else if (activeWeather.has('temperature')) {
      tgt.set('#3a7ab8'); intensity = 0.55;
    } else if (activeWeather.has('visibility')) {
      tgt.set('#5a6575'); intensity = 0.40;
    } else if (activeWeather.has('upperAtmo')) {
      tgt.set('#2a2570'); intensity = 0.52;
    } else {
      tgt.set('#b8c8d8'); intensity = 0.72;
    }

    lightRef.current.color.lerp(tgt, Math.min(1, dt * 3.5));
    lightRef.current.intensity = THREE.MathUtils.damp(
      lightRef.current.intensity, intensity, 3, dt,
    );
  });

  return <ambientLight ref={lightRef} intensity={0.72} />;
};

// ─── In-flight Impact HUD ─────────────────────────────────────────────────────
interface ImpactMsg {
  condition: WeatherConditionId;
  altMin: number; altMax: number;
  icon: string; title: string; detail: string;
  color: string; critical: boolean;
}

const FLIGHT_IMPACTS: ImpactMsg[] = [
  {
    condition: 'lightning', altMin: 0, altMax: 14,
    icon: '⚡', title: 'ELECTRIFIED ASCENT',
    detail: 'Vehicle is a lightning rod — leader can attach to metal skin / exhaust plume',
    color: '#a855f7', critical: true,
  },
  {
    condition: 'wind', altMin: 0, altMax: 25,
    icon: '💨', title: 'STRUCTURAL STRESS',
    detail: 'Crosswind forcing lateral deviation — Max-Q load elevated',
    color: '#fb923c', critical: false,
  },
  {
    condition: 'precipitation', altMin: 0, altMax: 9,
    icon: '🌧', title: 'HAIL IMPACT DETECTED',
    detail: 'Supersonic hailstone strikes increasing drag — surface damage likely',
    color: '#60a5fa', critical: false,
  },
  {
    condition: 'temperature', altMin: 0, altMax: 60,
    icon: '🌡️', title: 'ENGINE FAILURE RISK',
    detail: 'O-ring seals brittle at −42°C — thrust loss is imminent',
    color: '#93c5fd', critical: true,
  },
  {
    condition: 'ice', altMin: 0, altMax: 5,
    icon: '🧊', title: 'ICE SHEET RELEASE',
    detail: 'Frozen debris detaching from vehicle skin — impact damage to fins',
    color: '#bfdbfe', critical: true,
  },
  {
    condition: 'cloud', altMin: 0, altMax: 12,
    icon: '⛅', title: 'CLOUD PASSAGE',
    detail: 'Static charge buildup and drag increase through dense cloud layer',
    color: '#94a3b8', critical: false,
  },
  {
    condition: 'upperAtmo', altMin: 9, altMax: 28,
    icon: '🌀', title: 'JET STREAM SHEAR',
    detail: 'Rapid attitude corrections required — structural load at design limit',
    color: '#818cf8', critical: true,
  },
  {
    condition: 'visibility', altMin: 0, altMax: 20,
    icon: '🌫️', title: 'TRACKING BLACKOUT',
    detail: 'Range safety has lost optical contact — telemetry only',
    color: '#94a3b8', critical: false,
  },
];

const WeatherImpactHUD = ({
  activeWeather,
  rocketWorldX,
  rocketWorldY,
  altitude,
  phase,
}: {
  activeWeather: Set<WeatherConditionId>;
  rocketWorldX: number;
  rocketWorldY: number;
  altitude: number;
  phase: string;
}) => {
  if (phase !== 'launching' && phase !== 'coasting') return null;

  const visible = FLIGHT_IMPACTS.filter(
    (m) => activeWeather.has(m.condition) && altitude >= m.altMin && altitude <= m.altMax,
  );
  if (!visible.length) return null;

  return (
    <>
      {visible.map((msg, idx) => (
        <Html
          key={msg.condition}
          position={[rocketWorldX + 4, rocketWorldY - idx * 3.6, 0]}
          style={{ pointerEvents: 'none', userSelect: 'none' }}
          distanceFactor={15}
          zIndexRange={[400, 0]}
        >
          <div style={{
            fontFamily: "'Inter','Segoe UI',monospace",
            background: 'rgba(4,8,18,0.90)',
            border: `1px solid ${msg.color}55`,
            borderLeft: `3px solid ${msg.color}`,
            borderRadius: '7px',
            padding: '5px 10px 5px 8px',
            minWidth: '210px',
            backdropFilter: 'blur(12px)',
            boxShadow: `0 0 20px ${msg.color}40`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '13px' }}>{msg.icon}</span>
              <span style={{
                color: msg.color, fontWeight: 700, fontSize: '10px',
                letterSpacing: '0.1em', textTransform: 'uppercase',
              }}>
                {msg.title}
              </span>
              {msg.critical && (
                <span style={{
                  marginLeft: 'auto', background: `${msg.color}30`,
                  color: msg.color, fontSize: '7.5px', fontWeight: 800,
                  letterSpacing: '0.12em', padding: '1px 5px',
                  borderRadius: '4px', border: `1px solid ${msg.color}50`,
                  textTransform: 'uppercase',
                }}>⚠ CRITICAL</span>
              )}
            </div>
            <div style={{
              color: 'rgba(190,205,225,0.76)', fontSize: '9.5px',
              marginTop: '3px', lineHeight: '1.45',
            }}>
              {msg.detail}
            </div>
          </div>
        </Html>
      ))}
    </>
  );
};

// ─── WeatherShakeGroup ────────────────────────────────────────────────────────
export const WeatherShakeGroup = ({
  activeWeather,
  altitude,
  phase,
  lightningStrike,
  children,
}: {
  activeWeather: Set<WeatherConditionId>;
  altitude: number;
  phase: string;
  lightningStrike?: LightningStrikeState;
  children: ReactNode;
}) => {
  const groupRef  = useRef<THREE.Group>(null);
  const shakeTime = useRef(0);

  useFrame((_, dt) => {
    if (!groupRef.current) return;

    if (lightningStrike && lightningStrike.impulse > 0) {
      lightningStrike.impulse = Math.max(0, lightningStrike.impulse - dt * 4.2);
    }

    if (phase === 'idle' || phase === 'outcome') {
      groupRef.current.position.x = THREE.MathUtils.damp(groupRef.current.position.x, 0, 10, dt);
      groupRef.current.rotation.z = THREE.MathUtils.damp(groupRef.current.rotation.z, 0, 10, dt);
      return;
    }

    shakeTime.current += dt;

    const windMag      = (activeWeather.has('wind')      ? 1.1 : 0)
                       + (activeWeather.has('upperAtmo') ? 0.7 : 0);
    const lightningMag = activeWeather.has('lightning') ? 0.65 : 0;
    const iceMag       = (activeWeather.has('ice') && altitude < 4) ? 0.5 : 0;
    const hailMag      = (activeWeather.has('precipitation') && altitude < 10) ? 0.35 : 0;
    const strikeJolt   = lightningStrike?.impulse ?? 0;
    const total        = windMag + lightningMag + iceMag + hailMag + strikeJolt * 1.35;

    if (total === 0) {
      groupRef.current.position.x = THREE.MathUtils.damp(groupRef.current.position.x, 0, 9, dt);
      groupRef.current.rotation.z = THREE.MathUtils.damp(groupRef.current.rotation.z, 0, 9, dt);
      return;
    }

    const altFade = altitude < 28 ? 1 - altitude / 28 : 0;
    const amt     = total * altFade * 0.16;
    const joltX   = strikeJolt > 0.05
      ? (Math.random() - 0.5) * strikeJolt * 0.55
      : 0;
    const joltZ   = strikeJolt > 0.05
      ? (Math.random() - 0.5) * strikeJolt * 0.12
      : 0;

    groupRef.current.position.x =
      Math.sin(shakeTime.current * 1.5) * amt +
      Math.sin(shakeTime.current * 3.4) * amt * 0.45 + joltX;
    groupRef.current.rotation.z =
      Math.sin(shakeTime.current * 1.0) * amt * 0.08 + joltZ;
  });

  return <group ref={groupRef}>{children}</group>;
};

// ─── WeatherEnvironment — Main Export ────────────────────────────────────────
export const WeatherEnvironment = ({
  activeWeather,
  rocketWorldX,
  rocketWorldY,
  altitude,
  phase,
  lightningStrike,
}: {
  activeWeather: Set<WeatherConditionId>;
  rocketWorldX: number;
  rocketWorldY: number;
  altitude: number;
  phase: string;
  lightningStrike: LightningStrikeState;
}) => {
  if (activeWeather.size === 0) return null;

  const hasRain    = activeWeather.has('precipitation');
  const hasCloud   = activeWeather.has('cloud');
  const hasLight   = activeWeather.has('lightning');
  const hasWind    = activeWeather.has('wind');
  const hasJet     = activeWeather.has('upperAtmo');
  const hasCold    = activeWeather.has('temperature');
  const hasIce     = activeWeather.has('ice');
  const hasVis     = activeWeather.has('visibility');

  // Wind drift value for rain/snow
  const windDrift  = hasWind ? 16 : hasJet ? 8 : 0;

  return (
    <group>
      {/* Scene-level setup: background colour + Three.js fog */}
      <WeatherSceneSetup activeWeather={activeWeather} phase={phase} />

      {/* Dynamic ambient light tint */}
      <WeatherAmbientLight activeWeather={activeWeather} />

      {/* Atmosphere hemisphere overlays */}
      <WeatherAtmoOverlay activeWeather={activeWeather} />

      {/* ── Storm / cloud formations ── */}
      <CloudFormations active={hasCloud || hasLight || hasRain} />

      {/* ── Rain streaks ── */}
      {hasRain && <RainStreakEffect active windDrift={windDrift} />}
      {/* Hail only with precipitation */}
      {hasRain && <HailEffect active />}

      {/* ── Snow / frost for extreme cold ── */}
      {hasCold && <SnowFallEffect active />}

      {/* ── Ice flakes falling for ice accumulation ── */}
      {hasIce && <IceFallEffect active />}

      {/* ── Wind streaks ── */}
      {hasWind && <WindStreakEffect active altitude={altitude} />}

      {/* ── Jet stream bands at high altitude ── */}
      {hasJet && <JetStreamBands active altitude={altitude} />}

      {/* ── Lightning bolt (active only in troposphere) ── */}
      {hasLight && (
        <LightningEffect
          active={altitude < 15}
          rocketWorldX={rocketWorldX}
          rocketWorldY={rocketWorldY}
          lightningStrike={lightningStrike}
        />
      )}

      {/* ── Ice / cold ground effects ── */}
      {(hasIce || hasCold) && <IceGroundEffect active isCold={hasCold} />}

      {/* ── Thick fog layers for visibility ── */}
      {hasVis && <FogLayerEffect active phase={phase} />}

      {/* ── In-flight impact HUD ── */}
      <WeatherImpactHUD
        activeWeather={activeWeather}
        rocketWorldX={rocketWorldX}
        rocketWorldY={rocketWorldY}
        altitude={altitude}
        phase={phase}
      />
    </group>
  );
};
