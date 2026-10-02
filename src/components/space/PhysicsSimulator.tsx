import React, { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import type { RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import type { CelestialBody } from '../../physics/types';
import type { ImpactEvent } from '../../physics/nbody';
import { MOTION_ESCAPING } from '../../physics/system';
import {
  STATE_STRIDE,
  S_DOMINANT,
  S_MOTION,
  S_RADIUS,
  S_VX,
  S_VZ,
  S_X,
  S_Z,
  type Prediction,
  type SimSnapshot,
} from '../../physics/simulation';
import { REALISTIC_G } from '../../physics/constants';
import { conicPoints, orbitalElements } from '../../physics/orbits';
import { SimulationClient } from '../../physics/simulationClient';
import type { SimMessage } from '../../physics/simulationProtocol';

/** Shown as a floating message box at the impact midpoint (world space). */
export interface ImpactPopupState {
  id: string;
  title: string;
  detail: string;
  /** The conservation numbers for this impact. */
  stats?: string;
  position: [number, number, number];
}

/** Commands the rest of the app can send to the running simulation. */
export interface SimulationControls {
  seek: (step: number) => void;
  /** Fly a copy of the system with `body` added; resolves null if the run changed meanwhile. */
  predict: (body: CelestialBody, seconds?: number) => Promise<Prediction | null>;
  setPinned: (id: string, pinned: boolean) => void;
}

/** Live state of one body, published every tick for the grid and for saving scenarios. */
export interface LiveBodyState {
  id: string;
  position: [number, number, number];
  /** Realistic-mode units, matching CelestialBody.velocity. */
  velocity: [number, number, number];
  mass: number;
  radius: number;
}

const MAX_TRAIL_POINTS = 200;

interface MeshEntry {
  groupRef:  React.MutableRefObject<THREE.Group | null>;
  meshRef:   React.MutableRefObject<THREE.Mesh | null>;
  glowRef:   React.MutableRefObject<THREE.Mesh | null>;
  trailLine: THREE.Line;
  trailAttr: THREE.BufferAttribute;
}

interface TrailBuffer {
  data: Float32Array;
  head: number;
  len: number;
}

export interface PhysicsSimulatorProps {
  bodies: CelestialBody[];
  timeScale: number;
  realisticMode?: boolean;
  onBodyRemoved: (id: string) => void;
  onBodyUpdated: (id: string, mass: number, radius: number) => void;
  /** Called when rewinding brings back a body that was absorbed or removed later. */
  onBodyRestored: (body: CelestialBody) => void;
  livePhysicsRef: React.MutableRefObject<LiveBodyState[]>;
  /** Fractional expansion rate per simulated second; 0 disables expansion. */
  expansionRate?: number;
  /** Changing this value restarts the simulation from `bodies` and clears rewind history. */
  simulationEpoch?: number;
  /** Receives every new simulation state (time, history range, markers, diagnostics). */
  onSnapshot?: (snapshot: SimSnapshot) => void;
  /** Collisions, mergers and tidal disruptions from simulation steps run forward. */
  onImpacts?: (impacts: ImpactEvent[]) => void;
  /** How many recent positions each trail shows (graphics quality). */
  trailPoints?: number;
  /** Called for bodies the simulation creates (fragments, tidal debris). */
  onBodySpawned?: (body: CelestialBody) => void;
  /** Filled with the seek / predict / pin commands once the simulation is running. */
  simulationRef?: React.MutableRefObject<SimulationControls | null>;
  selectedBodyId?: string | null;
  /** Clicking a body selects it; pass undefined while placing so clicks reach the grid. */
  onSelectBody?: (id: string) => void;
  controlsRef: RefObject<OrbitControlsImpl | null>;
}

const CONIC_SEGMENTS = 160;

// Procedural canvas textures — generated once per body, never on every render
// ─────────────────────────────────────────────────────────────────────────────
function makeStarTexture(color: string): THREE.CanvasTexture {
  const S = 512;
  const cv = document.createElement('canvas');
  cv.width = S; cv.height = S;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, S, S);
  // Sunspot patches
  for (let i = 0; i < 14; i++) {
    const x = Math.random() * S, y = Math.random() * S, r = 8 + Math.random() * 22;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(0,0,0,0.55)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  // Bright granulation
  for (let i = 0; i < 50; i++) {
    const x = Math.random() * S, y = Math.random() * S, r = 3 + Math.random() * 9;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,220,0.18)');
    g.addColorStop(1, 'rgba(255,255,220,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  return new THREE.CanvasTexture(cv);
}

function makeGasBandsTexture(name: string): THREE.CanvasTexture {
  const W = 512, H = 256;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d')!;

  const jupBands: [number, number, string][] = [
    [0,    0.07, '#c88b4c'], [0.07, 0.05, '#f0e2b0'], [0.12, 0.08, '#b8703a'],
    [0.20, 0.10, '#e0c87a'], [0.30, 0.06, '#f5f0dc'], [0.36, 0.08, '#c07838'],
    [0.44, 0.06, '#e8c890'], [0.50, 0.08, '#b06030'], [0.58, 0.06, '#d4a060'],
    [0.64, 0.10, '#c07838'], [0.74, 0.08, '#e8c890'], [0.82, 0.07, '#b8703a'],
    [0.89, 0.05, '#f0e2b0'], [0.94, 0.06, '#c88b4c'],
  ];
  const satBands: [number, number, string][] = [
    [0,    0.10, '#c8a84e'], [0.10, 0.08, '#d4b862'], [0.18, 0.12, '#f0e098'],
    [0.30, 0.05, '#c09540'], [0.35, 0.15, '#f8ecca'], [0.50, 0.08, '#c09540'],
    [0.58, 0.12, '#f0e098'], [0.70, 0.08, '#d4b862'], [0.78, 0.12, '#c8a84e'],
    [0.90, 0.10, '#b89438'],
  ];
  const bands = name === 'Saturn' ? satBands : jupBands;
  for (const [pct, h, col] of bands) {
    ctx.fillStyle = col;
    ctx.fillRect(0, pct * H, W, h * H + 2);
  }
  // Wavy band edges
  for (let y = 0; y < H; y += 18) {
    for (let x = 0; x < W; x += 6) {
      const wave = Math.sin((x / W) * Math.PI * 8 + y * 0.1) * 3;
      const g = ctx.createLinearGradient(x, y + wave, x, y + wave + 5);
      g.addColorStop(0, 'rgba(0,0,0,0.04)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, y + wave, 6, 5);
    }
  }
  // Jupiter: Great Red Spot
  if (name !== 'Saturn') {
    const sx = W * 0.32, sy = H * 0.61;
    const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, 30);
    g.addColorStop(0, 'rgba(160,50,25,0.85)');
    g.addColorStop(0.5, 'rgba(190,70,35,0.45)');
    g.addColorStop(1, 'rgba(200,80,40,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(sx, sy, 30, 19, 0, 0, Math.PI * 2); ctx.fill();
  }
  return new THREE.CanvasTexture(cv);
}

function makeEarthTexture(): THREE.CanvasTexture {
  const S = 512;
  const cv = document.createElement('canvas');
  cv.width = S; cv.height = S;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#1a6fa8'; ctx.fillRect(0, 0, S, S); // ocean
  // Continents
  const lands: [number, number, number, number, number, string][] = [
    [S*.54, S*.38, 52, 95, 0.18, '#2d8a4e'],  // Africa/Europe
    [S*.24, S*.38, 46, 84, -0.1, '#3a8a50'],   // Americas
    [S*.76, S*.33, 68, 58, 0,    '#2e7a44'],   // Asia
    [S*.80, S*.66, 26, 22, 0,    '#3d9455'],   // Australia
    [S*.90, S*.55, 16, 14, 0,    '#c4a660'],   // Southeast Asia islands
  ];
  for (const [x, y, rx, ry, rot, col] of lands) {
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); ctx.fill();
  }
  // Desert patches
  ctx.fillStyle = '#c8a05a';
  ctx.beginPath(); ctx.ellipse(S*.60, S*.43, 22, 32, 0, 0, Math.PI * 2); ctx.fill();
  // Ice caps
  ctx.fillStyle = 'rgba(230,245,255,0.85)';
  ctx.fillRect(0, 0, S, S * 0.07);
  ctx.fillRect(0, S * 0.93, S, S * 0.07);
  // Cloud swirls
  for (let i = 0; i < 10; i++) {
    const x = Math.random() * S, y = Math.random() * S, r = 28 + Math.random() * 55;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  return new THREE.CanvasTexture(cv);
}

function makeRockyTexture(baseColor: string, craterCount = 18): THREE.CanvasTexture {
  const S = 512;
  const cv = document.createElement('canvas');
  cv.width = S; cv.height = S;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = baseColor; ctx.fillRect(0, 0, S, S);
  // Dark basins
  for (let i = 0; i < Math.floor(craterCount * 0.4); i++) {
    const x = Math.random() * S, y = Math.random() * S, r = 30 + Math.random() * 55;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(0,0,0,0.3)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  // Craters (dark center + bright rim)
  for (let i = 0; i < craterCount; i++) {
    const x = Math.random() * S, y = Math.random() * S, r = 4 + Math.random() * 18;
    const g = ctx.createRadialGradient(x, y, r * 0.1, x, y, r);
    g.addColorStop(0, 'rgba(0,0,0,0.55)');
    g.addColorStop(0.7, 'rgba(0,0,0,0.2)');
    g.addColorStop(0.85, 'rgba(220,210,200,0.35)');
    g.addColorStop(1, 'rgba(220,210,200,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  // Bright highland patches
  for (let i = 0; i < 7; i++) {
    const x = Math.random() * S, y = Math.random() * S, r = 20 + Math.random() * 40;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,240,220,0.20)');
    g.addColorStop(1, 'rgba(255,240,220,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  return new THREE.CanvasTexture(cv);
}

function makeMarsTexture(): THREE.CanvasTexture {
  const S = 512;
  const cv = document.createElement('canvas');
  cv.width = S; cv.height = S;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#dd7755'; ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 8; i++) {
    const x = Math.random() * S, y = Math.random() * S, r = 35 + Math.random() * 60;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(110,45,18,0.40)');
    g.addColorStop(1, 'rgba(110,45,18,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  for (let i = 0; i < 6; i++) {
    const x = Math.random() * S, y = Math.random() * S, r = 15 + Math.random() * 38;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(215,120,75,0.50)');
    g.addColorStop(1, 'rgba(215,120,75,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  // Olympus Mons region (lighter circular area)
  const g2 = ctx.createRadialGradient(S*.3, S*.35, 0, S*.3, S*.35, 45);
  g2.addColorStop(0, 'rgba(200,100,60,0.6)'); g2.addColorStop(1, 'rgba(200,100,60,0)');
  ctx.fillStyle = g2; ctx.beginPath(); ctx.arc(S*.3, S*.35, 45, 0, Math.PI * 2); ctx.fill();
  // Polar caps
  ctx.fillStyle = 'rgba(240,245,255,0.80)';
  ctx.fillRect(0, 0, S, S * 0.055); ctx.fillRect(0, S * 0.945, S, S * 0.055);
  return new THREE.CanvasTexture(cv);
}

function makeIceGiantTexture(baseColor: string, hasStorm: boolean): THREE.CanvasTexture {
  const S = 512;
  const cv = document.createElement('canvas');
  cv.width = S; cv.height = S;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = baseColor; ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 5; i++) {
    const y = S * 0.1 + Math.random() * S * 0.8, h = 12 + Math.random() * 22;
    const g = ctx.createLinearGradient(0, y - h, 0, y + h);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.14)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, y - h, S, h * 2);
  }
  if (hasStorm) {
    const sx = S * 0.42, sy = S * 0.52;
    const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, 32);
    g.addColorStop(0, 'rgba(10,30,110,0.72)');
    g.addColorStop(1, 'rgba(10,30,110,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(sx, sy, 32, 20, 0, 0, Math.PI * 2); ctx.fill();
  }
  return new THREE.CanvasTexture(cv);
}

function makeNeutronTexture(): THREE.CanvasTexture {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = S; cv.height = S;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#d0f8ff'; ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 8; i++) {
    const x = S * 0.5 + (Math.random() - 0.5) * S * 0.7, y = Math.random() * S;
    const g = ctx.createRadialGradient(x, y, 0, x, y, 18);
    g.addColorStop(0, 'rgba(0,200,255,0.55)'); g.addColorStop(1, 'rgba(0,200,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 18, 0, Math.PI * 2); ctx.fill();
  }
  return new THREE.CanvasTexture(cv);
}

function makeAsteroidTexture(): THREE.CanvasTexture {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = S; cv.height = S;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#9a9088'; ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 20; i++) {
    const x = Math.random() * S, y = Math.random() * S, r = 6 + Math.random() * 22;
    const g = ctx.createRadialGradient(x, y, r * 0.1, x, y, r);
    g.addColorStop(0, 'rgba(0,0,0,0.50)'); g.addColorStop(0.75, 'rgba(0,0,0,0.15)');
    g.addColorStop(0.88, 'rgba(160,148,136,0.30)'); g.addColorStop(1, 'rgba(160,148,136,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  for (let i = 0; i < 8; i++) {
    const x = Math.random() * S, y = Math.random() * S;
    const g = ctx.createRadialGradient(x, y, 0, x, y, 4 + Math.random() * 8);
    g.addColorStop(0, 'rgba(160,148,130,0.40)'); g.addColorStop(1, 'rgba(160,148,130,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.fill();
  }
  return new THREE.CanvasTexture(cv);
}

function makeCometTexture(): THREE.CanvasTexture {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = S; cv.height = S;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#4a5870'; ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 12; i++) {
    const x = Math.random() * S, y = Math.random() * S, r = 5 + Math.random() * 16;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(180,230,255,0.72)'); g.addColorStop(1, 'rgba(180,230,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  return new THREE.CanvasTexture(cv);
}

function createBodyTexture(body: CelestialBody): THREE.CanvasTexture | null {
  if (body.type === 'star')    return makeStarTexture(body.color);
  if (body.type === 'neutron') return makeNeutronTexture();
  if (body.type === 'asteroid') return makeAsteroidTexture();
  if (body.type === 'comet')   return makeCometTexture();
  if (body.type === 'planet') {
    if (body.bodyClass === 'gas') return makeGasBandsTexture(body.name ?? '');
    if (body.name === 'Earth')   return makeEarthTexture();
    if (body.name === 'Mars')    return makeMarsTexture();
    if (body.name === 'Venus')   return makeRockyTexture('#d9b38c', 4);
    if (body.name === 'Mercury') return makeRockyTexture('#b5aea2', 26);
    if (body.bodyClass === 'ice') {
      const isNep = body.name === 'Neptune';
      return makeIceGiantTexture(body.color, isNep);
    }
    return makeRockyTexture(body.color, 14);
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// BodyRenderer — visual-only, writes nothing to physics state
// ─────────────────────────────────────────────────────────────────────────────
interface BodyRendererProps {
  body:           CelestialBody;
  meshEntriesRef: React.MutableRefObject<Map<string, MeshEntry>>;
  onSelect?: (id: string) => void;
}

interface CameraSnapshot {
  position: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
}

const BodyRenderer: React.FC<BodyRendererProps> = ({ body, meshEntriesRef, onSelect }) => {
  const groupRef   = useRef<THREE.Group | null>(null);
  const meshRef    = useRef<THREE.Mesh  | null>(null);
  const glowRef    = useRef<THREE.Mesh  | null>(null);
  const coronaRef  = useRef<THREE.Mesh  | null>(null);
  const diskRef    = useRef<THREE.Group | null>(null);
  const beamRef    = useRef<THREE.Group | null>(null);
  const animT      = useRef(Math.random() * Math.PI * 2);

  const { trailLine, trailAttr } = useMemo(() => {
    const geo  = new THREE.BufferGeometry();
    const data = new Float32Array(MAX_TRAIL_POINTS * 3);
    const attr = new THREE.BufferAttribute(data, 3);
    geo.setAttribute('position', attr);
    geo.setDrawRange(0, 0);
    const mat = new THREE.LineBasicMaterial({ color: body.color, transparent: true, opacity: 0.35 });
    return { trailLine: new THREE.Line(geo, mat), trailAttr: attr };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = meshEntriesRef.current;
    map.set(body.id, { groupRef, meshRef, glowRef, trailLine, trailAttr });
    return () => { map.delete(body.id); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body.id]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const bodyTexture = useMemo(() => createBodyTexture(body), [body.type, body.name, body.bodyClass]);

  const isStar    = body.type === 'star';
  const isBH      = body.type === 'blackhole';
  const isNS      = body.type === 'neutron';
  const isComet   = body.type === 'comet';
  const isAst     = body.type === 'asteroid';
  const isPlanet  = body.type === 'planet';
  const isSaturn  = body.name === 'Saturn';
  const isUranus  = body.name === 'Uranus';

  useFrame((_, delta) => {
    animT.current += delta;
    const t = animT.current;

    // --- Surface rotation ---
    if (meshRef.current) {
      let spd = 0.25;
      if (isBH)   spd = 0;
      else if (isNS)  spd = 2.0;
      else if (isStar) spd = 0.06;
      else if (body.bodyClass === 'gas')  spd = 0.55;
      else if (body.bodyClass === 'ice')  spd = 0.40;
      else if (isComet) spd = 0.12;
      meshRef.current.rotation.y += delta * spd;
      if (isAst) meshRef.current.rotation.x += delta * 0.18;
    }

    // --- Star: corona pulse ---
    if (coronaRef.current) {
      const pulse = 1 + Math.sin(t * 1.4) * 0.045;
      coronaRef.current.scale.setScalar(body.radius * 1.85 * pulse);
      const mat = coronaRef.current.material as THREE.MeshBasicMaterial;
      if (mat) mat.opacity = 0.09 + Math.sin(t * 0.75) * 0.03;
    }

    // --- Black hole: accretion disk spin ---
    if (diskRef.current) diskRef.current.rotation.z += delta * 0.22;

    // --- Neutron star: magnetic beam spin ---
    if (beamRef.current) beamRef.current.rotation.y += delta * 4.2;
  });

  const r = body.radius;

  return (
    <>
      <primitive object={trailLine} />
      <group
        ref={groupRef}
        position={body.position}
        onClick={onSelect ? (e) => { e.stopPropagation(); onSelect(body.id); } : undefined}
        onPointerOver={onSelect ? () => { document.body.style.cursor = 'pointer'; } : undefined}
        onPointerOut={onSelect ? () => { document.body.style.cursor = ''; } : undefined}
      >

        {/* ── Main surface sphere ─────────────────────────────────────────── */}
        <mesh ref={meshRef} scale={r}>
          <sphereGeometry args={[1, 64, 64]} />
          <meshStandardMaterial
            color={isBH ? '#050508' : bodyTexture ? '#ffffff' : body.color}
            emissive={isBH ? '#000000' : body.color}
            emissiveIntensity={isStar ? 1.4 : isNS ? 0.65 : isBH ? 0 : isComet ? 0.55 : isAst ? 0.45 : 0.30}
            roughness={isBH ? 0.0 : isAst ? 0.92 : isStar ? 0.55 : 0.50}
            metalness={isBH ? 0.95 : isStar ? 0.05 : isAst ? 0.05 : 0.25}
            map={bodyTexture}
          />
        </mesh>

        {/* ── STAR: layered animated corona ──────────────────────────────── */}
        {isStar && <>
          <mesh ref={coronaRef} scale={r * 1.85}>
            <sphereGeometry args={[1, 16, 16]} />
            <meshBasicMaterial color={body.color} transparent opacity={0.10} side={THREE.BackSide} />
          </mesh>
          <mesh scale={r * 2.7}>
            <sphereGeometry args={[1, 12, 12]} />
            <meshBasicMaterial color={body.color} transparent opacity={0.04} side={THREE.BackSide} />
          </mesh>
          <mesh scale={r * 4.0}>
            <sphereGeometry args={[1, 8, 8]} />
            <meshBasicMaterial color={body.color} transparent opacity={0.015} side={THREE.BackSide} />
          </mesh>
          {/* glowRef — physics drives opacity to indicate motion state */}
          <mesh ref={glowRef} scale={r * 1.8}>
            <sphereGeometry args={[1, 16, 16]} />
            <meshBasicMaterial color={body.color} transparent opacity={0.08} side={THREE.BackSide} />
          </mesh>
        </>}

        {/* ── BLACK HOLE: photon sphere + animated accretion disk ─────────── */}
        {isBH && <>
          {/* Innermost stable circular orbit: closer in, no orbit can last (3 × event horizon). */}
          <mesh rotation={[-Math.PI / 2, 0, 0]} scale={r}>
            <ringGeometry args={[2.94, 3.06, 128]} />
            <meshBasicMaterial color="#e9d5ff" transparent opacity={0.35} side={THREE.DoubleSide} depthWrite={false} />
          </mesh>
          {/* Purple photon-sphere halo */}
          <mesh scale={r * 1.30}>
            <sphereGeometry args={[1, 32, 32]} />
            <meshBasicMaterial color="#cc44ff" transparent opacity={0.20} side={THREE.BackSide} />
          </mesh>
          {/* Relativistic jet glow along poles */}
          <mesh scale={r * 2.2}>
            <sphereGeometry args={[1, 8, 8]} />
            <meshBasicMaterial color="#6600cc" transparent opacity={0.06} side={THREE.BackSide} />
          </mesh>
          {/* Accretion disk — tilted ~17° from equatorial, slowly spinning */}
          <group ref={diskRef} rotation={[Math.PI / 2 - 0.30, 0, 0]}>
            {/* Inner: blue-white (extreme temp ~millions K) */}
            <mesh>
              <ringGeometry args={[r * 1.22, r * 1.60, 128]} />
              <meshBasicMaterial color="#e8f0ff" transparent opacity={0.82} side={THREE.DoubleSide} />
            </mesh>
            {/* Mid-inner: yellow-white */}
            <mesh>
              <ringGeometry args={[r * 1.60, r * 2.05, 128]} />
              <meshBasicMaterial color="#ffdd88" transparent opacity={0.65} side={THREE.DoubleSide} />
            </mesh>
            {/* Mid: orange (~10,000 K) */}
            <mesh>
              <ringGeometry args={[r * 2.05, r * 2.60, 128]} />
              <meshBasicMaterial color="#ff7722" transparent opacity={0.42} side={THREE.DoubleSide} />
            </mesh>
            {/* Outer: deep red */}
            <mesh>
              <ringGeometry args={[r * 2.60, r * 3.30, 128]} />
              <meshBasicMaterial color="#bb2200" transparent opacity={0.22} side={THREE.DoubleSide} />
            </mesh>
            {/* Outermost: faint dark haze */}
            <mesh>
              <ringGeometry args={[r * 3.30, r * 4.20, 128]} />
              <meshBasicMaterial color="#440800" transparent opacity={0.08} side={THREE.DoubleSide} />
            </mesh>
          </group>
          <mesh ref={glowRef} scale={r * 1.8}>
            <sphereGeometry args={[1, 16, 16]} />
            <meshBasicMaterial color="#cc44ff" transparent opacity={0.08} side={THREE.BackSide} />
          </mesh>
        </>}

        {/* ── NEUTRON STAR: magnetar jet beams + tight glow ───────────────── */}
        {isNS && <>
          {/* Tight X-ray glow */}
          <mesh scale={r * 2.2}>
            <sphereGeometry args={[1, 16, 16]} />
            <meshBasicMaterial color="#00ffee" transparent opacity={0.14} side={THREE.BackSide} />
          </mesh>
          {/* Rotating polar jets */}
          <group ref={beamRef}>
            <mesh position={new THREE.Vector3(0, r * 2.8, 0)}>
              <coneGeometry args={[r * 0.18, r * 5.5, 12]} />
              <meshBasicMaterial color="#44ffee" transparent opacity={0.38} />
            </mesh>
            <mesh position={new THREE.Vector3(0, -r * 2.8, 0)} rotation={[Math.PI, 0, 0]}>
              <coneGeometry args={[r * 0.18, r * 5.5, 12]} />
              <meshBasicMaterial color="#44ffee" transparent opacity={0.38} />
            </mesh>
          </group>
          <mesh ref={glowRef} scale={r * 1.8}>
            <sphereGeometry args={[1, 16, 16]} />
            <meshBasicMaterial color="#00ffcc" transparent opacity={0.08} side={THREE.BackSide} />
          </mesh>
        </>}

        {/* ── SATURN: iconic tilted multi-band ring system ─────────────────── */}
        {isSaturn && (
          <group rotation={[Math.PI / 2 - 0.455, 0, 0.18]}>
            {/* C ring (inner crepe ring — translucent) */}
            <mesh>
              <ringGeometry args={[r * 1.24, r * 1.52, 160]} />
              <meshBasicMaterial color="#cfc080" transparent opacity={0.30} side={THREE.DoubleSide} />
            </mesh>
            {/* B ring (bright & opaque) */}
            <mesh>
              <ringGeometry args={[r * 1.52, r * 1.95, 160]} />
              <meshBasicMaterial color="#f2e9b8" transparent opacity={0.78} side={THREE.DoubleSide} />
            </mesh>
            {/* Cassini division (dark gap) */}
            <mesh>
              <ringGeometry args={[r * 1.95, r * 2.02, 160]} />
              <meshBasicMaterial color="#12100a" transparent opacity={0.55} side={THREE.DoubleSide} />
            </mesh>
            {/* A ring */}
            <mesh>
              <ringGeometry args={[r * 2.02, r * 2.42, 160]} />
              <meshBasicMaterial color="#e0d5a0" transparent opacity={0.58} side={THREE.DoubleSide} />
            </mesh>
            {/* Encke gap in A ring */}
            <mesh>
              <ringGeometry args={[r * 2.30, r * 2.34, 160]} />
              <meshBasicMaterial color="#12100a" transparent opacity={0.30} side={THREE.DoubleSide} />
            </mesh>
            {/* F ring (narrow, bright) */}
            <mesh>
              <ringGeometry args={[r * 2.52, r * 2.58, 160]} />
              <meshBasicMaterial color="#f8f0cc" transparent opacity={0.45} side={THREE.DoubleSide} />
            </mesh>
            {/* E ring (wide, diffuse outer haze) */}
            <mesh>
              <ringGeometry args={[r * 2.65, r * 3.10, 160]} />
              <meshBasicMaterial color="#c8bc8a" transparent opacity={0.14} side={THREE.DoubleSide} />
            </mesh>
          </group>
        )}

        {/* ── URANUS: near-polar rings (axial tilt ~98°) ──────────────────── */}
        {isUranus && (
          <group rotation={[0, 0, Math.PI / 2 - 0.06]}>
            <mesh>
              <ringGeometry args={[r * 1.50, r * 1.58, 80]} />
              <meshBasicMaterial color="#b0e8f0" transparent opacity={0.22} side={THREE.DoubleSide} />
            </mesh>
            <mesh>
              <ringGeometry args={[r * 1.62, r * 1.68, 80]} />
              <meshBasicMaterial color="#90d8e8" transparent opacity={0.18} side={THREE.DoubleSide} />
            </mesh>
            <mesh>
              <ringGeometry args={[r * 1.72, r * 1.76, 80]} />
              <meshBasicMaterial color="#b0e8f0" transparent opacity={0.12} side={THREE.DoubleSide} />
            </mesh>
          </group>
        )}

        {/* ── PLANET: atmosphere halo ──────────────────────────────────────── */}
        {isPlanet && !isSaturn && !isUranus && (
          <mesh ref={glowRef} scale={r * 1.10}>
            <sphereGeometry args={[1, 16, 16]} />
            <meshBasicMaterial
              color={body.bodyClass === 'ice' ? '#88ddee' : body.bodyClass === 'gas' ? '#f0d890' : body.color}
              transparent
              opacity={0.07}
              side={THREE.BackSide}
            />
          </mesh>
        )}
        {/* Saturn / Uranus still get a glowRef for physics state tracking */}
        {(isSaturn || isUranus) && (
          <mesh ref={glowRef} scale={r * 1.10}>
            <sphereGeometry args={[1, 8, 8]} />
            <meshBasicMaterial color={body.color} transparent opacity={0.07} side={THREE.BackSide} />
          </mesh>
        )}

        {/* ── COMET: icy coma + directional dust/ion tail ──────────────────── */}
        {isComet && <>
          {/* Coma (fuzzy glowing head) */}
          <mesh scale={r * 4.5}>
            <sphereGeometry args={[1, 16, 16]} />
            <meshBasicMaterial color="#aaeeff" transparent opacity={0.14} side={THREE.BackSide} />
          </mesh>
          {/* Inner brighter coma */}
          <mesh scale={r * 2.2}>
            <sphereGeometry args={[1, 12, 12]} />
            <meshBasicMaterial color="#ddf4ff" transparent opacity={0.22} side={THREE.BackSide} />
          </mesh>
          {/* Dust tail (yellowish, broad) */}
          <mesh position={new THREE.Vector3(r * 6, 0, 0)} rotation={new THREE.Euler(0, 0, -Math.PI / 2)}>
            <coneGeometry args={[r * 1.2, r * 12, 20, 1, true]} />
            <meshBasicMaterial color="#ddcc88" transparent opacity={0.12} side={THREE.DoubleSide} />
          </mesh>
          {/* Ion tail (bluish, narrower, pointing radially) */}
          <mesh position={new THREE.Vector3(r * 5, 0, 0)} rotation={new THREE.Euler(0, 0, -Math.PI / 2)}>
            <coneGeometry args={[r * 0.5, r * 9, 14, 1, true]} />
            <meshBasicMaterial color="#88ccff" transparent opacity={0.16} side={THREE.DoubleSide} />
          </mesh>
          <mesh ref={glowRef} scale={r * 1.8}>
            <sphereGeometry args={[1, 12, 12]} />
            <meshBasicMaterial color="#aaeeff" transparent opacity={0.08} side={THREE.BackSide} />
          </mesh>
        </>}

        {/* ── ASTEROID: minimal glow ───────────────────────────────────────── */}
        {isAst && (
          <mesh ref={glowRef} scale={r * 1.5}>
            <sphereGeometry args={[1, 8, 8]} />
            <meshBasicMaterial color="#c8c0b4" transparent opacity={0.18} side={THREE.BackSide} />
          </mesh>
        )}

        {/* ── Generic fallback glow (unknown types) ───────────────────────── */}
        {!isStar && !isBH && !isNS && !isComet && !isAst && !isPlanet && (
          <mesh ref={glowRef} scale={r * 1.8}>
            <sphereGeometry args={[1, 16, 16]} />
            <meshBasicMaterial color={body.color} transparent opacity={0.08} side={THREE.BackSide} />
          </mesh>
        )}

      </group>
    </>
  );
};

const ImpactCameraDirector = ({
  activeImpact,
  controlsRef,
}: {
  activeImpact: ImpactPopupState | null;
  controlsRef: RefObject<OrbitControlsImpl | null>;
}) => {
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const snapshotRef = useRef<CameraSnapshot | null>(null);
  const focusTargetRef = useRef(new THREE.Vector3());
  /** True once auto framing has converged; then OrbitControls (scroll/drag) can move the camera. */
  const settledOnImpactRef = useRef(false);
  /** If the user moves the camera during the popup, do not snap back when the popup timer ends. */
  const userAdjustedDuringPopupRef = useRef(false);
  const scratchDir = useRef(new THREE.Vector3());
  const scratchDesiredPos = useRef(new THREE.Vector3());

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;

    if (activeImpact) {
      settledOnImpactRef.current = false;
      userAdjustedDuringPopupRef.current = false;
      if (!snapshotRef.current) {
        snapshotRef.current = {
          position: camera.position.clone(),
          target: controls.target.clone(),
          fov: camera.fov,
        };
      }
      focusTargetRef.current.set(...activeImpact.position);
    }
  }, [activeImpact, camera, controlsRef]);

  useFrame((_, delta) => {
    const controls = controlsRef.current;
    if (!controls) return;

    const dt = Math.min(delta, 0.05);
    const damping = 5.5;
    const minDistance = controls.minDistance ?? 8;
    const maxDistance = controls.maxDistance ?? 200;

    if (activeImpact) {
      const snapshot = snapshotRef.current;
      if (!snapshot) return;

      const direction = scratchDir.current.copy(snapshot.position).sub(snapshot.target);
      if (direction.lengthSq() < 1e-6) direction.set(0, 1, 1);
      direction.normalize();

      const desiredDistance = THREE.MathUtils.clamp(12, minDistance + 1, Math.min(maxDistance, 18));
      const desiredPosition = scratchDesiredPos.current
        .copy(focusTargetRef.current)
        .addScaledVector(direction, desiredDistance);
      const desiredFov = 42;
      const desiredCamY = desiredPosition.y + 1.25;

      if (!settledOnImpactRef.current) {
        camera.position.x = THREE.MathUtils.damp(camera.position.x, desiredPosition.x, damping, dt);
        camera.position.y = THREE.MathUtils.damp(camera.position.y, desiredCamY, damping, dt);
        camera.position.z = THREE.MathUtils.damp(camera.position.z, desiredPosition.z, damping, dt);
        controls.target.x = THREE.MathUtils.damp(controls.target.x, focusTargetRef.current.x, damping, dt);
        controls.target.y = THREE.MathUtils.damp(controls.target.y, focusTargetRef.current.y, damping, dt);
        controls.target.z = THREE.MathUtils.damp(controls.target.z, focusTargetRef.current.z, damping, dt);
        camera.fov = THREE.MathUtils.damp(camera.fov, desiredFov, 4.5, dt);
        camera.updateProjectionMatrix();
        controls.update();

        const dx = camera.position.x - desiredPosition.x;
        const dy = camera.position.y - desiredCamY;
        const dz = camera.position.z - desiredPosition.z;
        const posOk = dx * dx + dy * dy + dz * dz < 0.08;
        const targetOk = controls.target.distanceTo(focusTargetRef.current) < 0.14;
        const fovOk = Math.abs(camera.fov - desiredFov) < 0.45;
        if (posOk && targetOk && fovOk) settledOnImpactRef.current = true;
        return;
      }

      // Framing done: release camera so the user can zoom/pan while the popup stays for its time limit.
      if (!userAdjustedDuringPopupRef.current) {
        const dx2 = camera.position.x - desiredPosition.x;
        const dy2 = camera.position.y - desiredCamY;
        const dz2 = camera.position.z - desiredPosition.z;
        const stillAtImpact =
          dx2 * dx2 + dy2 * dy2 + dz2 * dz2 < 0.2
          && controls.target.distanceTo(focusTargetRef.current) < 0.22
          && Math.abs(camera.fov - desiredFov) < 0.65;
        if (!stillAtImpact) userAdjustedDuringPopupRef.current = true;
      }
      return;
    }

    const snapshot = snapshotRef.current;
    if (!snapshot) return;

    if (userAdjustedDuringPopupRef.current) {
      snapshotRef.current = null;
      userAdjustedDuringPopupRef.current = false;
      return;
    }

    camera.position.x = THREE.MathUtils.damp(camera.position.x, snapshot.position.x, damping, dt);
    camera.position.y = THREE.MathUtils.damp(camera.position.y, snapshot.position.y, damping, dt);
    camera.position.z = THREE.MathUtils.damp(camera.position.z, snapshot.position.z, damping, dt);
    controls.target.x = THREE.MathUtils.damp(controls.target.x, snapshot.target.x, damping, dt);
    controls.target.y = THREE.MathUtils.damp(controls.target.y, snapshot.target.y, damping, dt);
    controls.target.z = THREE.MathUtils.damp(controls.target.z, snapshot.target.z, damping, dt);
    camera.fov = THREE.MathUtils.damp(camera.fov, snapshot.fov, 4.5, dt);
    camera.updateProjectionMatrix();
    controls.update();

    const settled =
      camera.position.distanceTo(snapshot.position) < 0.05 &&
      controls.target.distanceTo(snapshot.target) < 0.05 &&
      Math.abs(camera.fov - snapshot.fov) < 0.1;

    if (settled) snapshotRef.current = null;
  });

  return null;
};

// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// PhysicsSimulator — renders the simulation running in a worker (or in-process)
// ─────────────────────────────────────────────────────────────────────────────
const PhysicsSimulator: React.FC<PhysicsSimulatorProps> = ({
  bodies,
  timeScale,
  realisticMode = true,
  onBodyRemoved,
  onBodyUpdated,
  onBodyRestored,
  livePhysicsRef,
  expansionRate = 0,
  simulationEpoch = 0,
  onSnapshot,
  onImpacts,
  trailPoints = MAX_TRAIL_POINTS,
  onBodySpawned,
  simulationRef,
  selectedBodyId = null,
  onSelectBody,
  controlsRef,
}) => {
  const clientRef      = useRef<SimulationClient | null>(null);
  const selectedIdRef  = useRef<string | null>(selectedBodyId);
  selectedIdRef.current = selectedBodyId;
  const predictionsRef = useRef(new Map<number, (prediction: Prediction | null) => void>());
  const predictionSeqRef = useRef(0);
  const meshEntriesRef = useRef(new Map<string, MeshEntry>());
  const trailsRef      = useRef(new Map<string, TrailBuffer>());
  const epochRef       = useRef<number | null>(null);
  // Ids the simulation has been told about this run, ids it removed itself (collisions,
  // rewinds) and ids it restored that React has not added back yet.
  const knownIdsRef      = useRef(new Set<string>());
  const coreRemovedRef   = useRef(new Set<string>());
  const prevPropIdsRef   = useRef(new Set<string>());
  const bodiesByIdRef    = useRef(new Map<string, CelestialBody>());
  const configRef        = useRef({ realisticMode, expansionRate });
  const callbacksRef     = useRef({ onBodyRemoved, onBodyUpdated, onBodyRestored, onSnapshot, onBodySpawned, onImpacts });
  const [activeImpact, setActiveImpact] = useState<ImpactPopupState | null>(null);
  const [hasPendingImpact, setHasPendingImpact] = useState(false);

  configRef.current = { realisticMode, expansionRate };
  const trailPointsRef = useRef(trailPoints);
  trailPointsRef.current = Math.min(trailPoints, MAX_TRAIL_POINTS);
  callbacksRef.current = { onBodyRemoved, onBodyUpdated, onBodyRestored, onSnapshot, onBodySpawned, onImpacts };

  // Predicted orbit of the selected body and a ring marking it; updated every snapshot.
  const conicLine = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array((CONIC_SEGMENTS + 1) * 3), 3));
    geometry.setDrawRange(0, 0);
    const material = new THREE.LineDashedMaterial({ color: '#4ade80', dashSize: 0.6, gapSize: 0.4, transparent: true, opacity: 0.85 });
    const line = new THREE.Line(geometry, material);
    line.frustumCulled = false;
    return line;
  }, []);
  const selectionRing = useMemo(() => {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.45, 1.6, 64),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.visible = false;
    return ring;
  }, []);

  /** Draw the selected body's two-body orbit around its dominant body. */
  const updateSelection = (snapshot: SimSnapshot) => {
    const id = selectedIdRef.current;
    const i = id ? snapshot.ids.indexOf(id) : -1;
    if (i < 0) {
      selectionRing.visible = false;
      conicLine.geometry.setDrawRange(0, 0);
      return;
    }
    const { data, masses } = snapshot;
    const o = i * STATE_STRIDE;
    selectionRing.visible = true;
    selectionRing.position.set(data[o + S_X], 0.05, data[o + S_Z]);
    selectionRing.scale.setScalar(Math.max(data[o + S_RADIUS], 0.3));
    const d = data[o + S_DOMINANT];
    if (d < 0 || d >= snapshot.ids.length) {
      conicLine.geometry.setDrawRange(0, 0);
      return;
    }
    const od = d * STATE_STRIDE;
    // Velocities are in realistic units, so the realistic G gives the orbit's true shape.
    const el = orbitalElements(
      data[o + S_X] - data[od + S_X],
      data[o + S_Z] - data[od + S_Z],
      data[o + S_VX] - data[od + S_VX],
      data[o + S_VZ] - data[od + S_VZ],
      REALISTIC_G * (masses[d] + masses[i]),
    );
    const points = conicPoints(el, data[od + S_X], data[od + S_Z], CONIC_SEGMENTS);
    const attr = conicLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    points.forEach(([x, z], k) => { arr[k * 3] = x; arr[k * 3 + 1] = 0.02; arr[k * 3 + 2] = z; });
    attr.needsUpdate = true;
    conicLine.geometry.setDrawRange(0, points.length);
    conicLine.computeLineDistances();
    (conicLine.material as THREE.LineDashedMaterial).color.set(el.energy < 0 ? '#4ade80' : '#fbbf24');
  };

  // Holds the most recent collision that arrived while a popup was already showing.
  // At most one item — always replaced by the newest so the queue never grows unbounded.
  const pendingImpactRef = useRef<ImpactPopupState | null>(null);
  const activeImpactRef  = useRef<ImpactPopupState | null>(null);
  const impactSeqRef     = useRef(0);

  const queueImpactPopup = useCallback((item: ImpactPopupState) => {
    if (!activeImpactRef.current) {
      activeImpactRef.current = item;
      setActiveImpact(item);
    } else {
      pendingImpactRef.current = item;
      setHasPendingImpact(true);
    }
  }, []);

  const dismissImpact = useCallback(() => {
    const next = pendingImpactRef.current;
    pendingImpactRef.current = null;
    activeImpactRef.current = next;
    setHasPendingImpact(false);
    setActiveImpact(next);
  }, []);

  const clearImpacts = useCallback(() => {
    pendingImpactRef.current = null;
    activeImpactRef.current = null;
    setActiveImpact(null);
    setHasPendingImpact(false);
  }, []);

  const appendTrail = (id: string, x: number, z: number) => {
    let trail = trailsRef.current.get(id);
    if (!trail) {
      trail = { data: new Float32Array(MAX_TRAIL_POINTS * 3), head: 0, len: 0 };
      trailsRef.current.set(id, trail);
    }
    const idx = trail.head * 3;
    trail.data[idx] = x;
    trail.data[idx + 1] = 0;
    trail.data[idx + 2] = z;
    trail.head = (trail.head + 1) % MAX_TRAIL_POINTS;
    trail.len = Math.min(trail.len + 1, MAX_TRAIL_POINTS);

    const entry = meshEntriesRef.current.get(id);
    if (!entry) return;
    // Unroll the newest `shown` points of the ring buffer into the line geometry in order.
    const arr = entry.trailAttr.array as Float32Array;
    const shown = Math.min(trail.len, trailPointsRef.current);
    for (let k = 0; k < shown; k++) {
      const src = ((trail.head - shown + k + MAX_TRAIL_POINTS) % MAX_TRAIL_POINTS) * 3;
      arr[k * 3] = trail.data[src];
      arr[k * 3 + 1] = trail.data[src + 1];
      arr[k * 3 + 2] = trail.data[src + 2];
    }
    entry.trailAttr.needsUpdate = true;
    entry.trailLine.geometry.setDrawRange(0, shown);
  };

  const clearTrails = () => {
    trailsRef.current.clear();
    for (const entry of meshEntriesRef.current.values()) entry.trailLine.geometry.setDrawRange(0, 0);
  };

  /** Move meshes to the snapshot; bodies missing from it are hidden until React drops them. */
  const applySnapshot = (snapshot: SimSnapshot, appendTrails: boolean) => {
    const { ids, data, masses } = snapshot;
    const present = new Set(ids);
    const live: LiveBodyState[] = new Array(ids.length);
    for (let i = 0; i < ids.length; i++) {
      const o = i * STATE_STRIDE;
      const x = data[o + S_X];
      const z = data[o + S_Z];
      const radius = data[o + S_RADIUS];
      live[i] = {
        id: ids[i],
        position: [x, 0, z],
        velocity: [data[o + S_VX], 0, data[o + S_VZ]],
        mass: masses[i],
        radius,
      };
      if (appendTrails) appendTrail(ids[i], x, z);
      const entry = meshEntriesRef.current.get(ids[i]);
      if (!entry) continue;
      entry.groupRef.current?.position.set(x, 0, z);
      entry.meshRef.current?.scale.setScalar(radius);
      if (entry.glowRef.current) {
        entry.glowRef.current.scale.setScalar(radius * 1.8);
        const mat = entry.glowRef.current.material as THREE.MeshBasicMaterial;
        if (mat) mat.opacity = data[o + S_MOTION] === MOTION_ESCAPING ? 0.18 : 0.08;
      }
    }
    for (const [id, entry] of meshEntriesRef.current) {
      const visible = present.has(id);
      if (entry.groupRef.current) entry.groupRef.current.visible = visible;
      entry.trailLine.visible = visible;
    }
    livePhysicsRef.current = live;
  };

  const handleMessage = (message: SimMessage) => {
    if (message.type === 'prediction') {
      const resolve = predictionsRef.current.get(message.requestId);
      predictionsRef.current.delete(message.requestId);
      resolve?.(message.epoch === epochRef.current ? message.prediction : null);
      return;
    }
    if (message.epoch !== epochRef.current) return;
    const { result, snapshot } = message;
    const callbacks = callbacksRef.current;

    for (const impact of result.impacts) {
      queueImpactPopup({
        id: `impact-${impactSeqRef.current++}`,
        title: impact.title,
        detail: impact.detail,
        stats: impact.kind === 'tidal'
          ? 'Momentum kept: 100% · Energy for the stream came from the black hole’s tides'
          : `Momentum kept: 100% · Impact energy turned to heat: ${Math.round(impact.kineticEnergyLost * 100)}%`,
        position: impact.position,
      });
    }
    for (const body of result.spawned) {
      knownIdsRef.current.add(body.id);
      callbacks.onBodySpawned?.(body);
    }
    for (const id of result.removed) {
      coreRemovedRef.current.add(id);
      callbacks.onBodyRemoved(id);
    }
    for (const body of result.restored) {
      coreRemovedRef.current.delete(body.id);
      knownIdsRef.current.add(body.id);
      callbacks.onBodyRestored(body);
    }
    for (const update of result.updated) {
      const current = bodiesByIdRef.current.get(update.id);
      if (current && (current.mass !== update.mass || current.radius !== update.radius)) {
        callbacks.onBodyUpdated(update.id, update.mass, update.radius);
      }
    }
    if (result.impacts.length > 0) callbacks.onImpacts?.(result.impacts);
    applySnapshot(snapshot, result.direction === 1 && result.stepsTaken > 0);
    updateSelection(snapshot);
    callbacks.onSnapshot?.(snapshot);
  };
  const handleMessageRef = useRef(handleMessage);
  handleMessageRef.current = handleMessage;

  useEffect(() => {
    const client = new SimulationClient((message) => handleMessageRef.current(message));
    clientRef.current = client;
    const predictions = predictionsRef.current;
    if (simulationRef) {
      simulationRef.current = {
        seek: (step) => {
          if (epochRef.current !== null) client.send({ type: 'seek', epoch: epochRef.current, step });
        },
        predict: (body, seconds = 20) => new Promise((resolve) => {
          if (epochRef.current === null) { resolve(null); return; }
          const requestId = predictionSeqRef.current++;
          predictions.set(requestId, resolve);
          client.send({ type: 'predict', epoch: epochRef.current, requestId, body, seconds });
        }),
        setPinned: (id, pinned) => {
          if (epochRef.current !== null) client.send({ type: 'pin', epoch: epochRef.current, id, pinned });
        },
      };
    }
    return () => {
      client.dispose();
      clientRef.current = null;
      epochRef.current = null;
      for (const resolve of predictions.values()) resolve(null);
      predictions.clear();
      if (simulationRef) simulationRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Keep the simulation's body list in step with React's ─────────────────
  useEffect(() => {
    const client = clientRef.current;
    if (!client) return;
    const propIds = new Set(bodies.map((b) => b.id));
    bodiesByIdRef.current = new Map(bodies.map((b) => [b.id, b]));

    if (epochRef.current !== simulationEpoch) {
      // Reset, template, saved scenario or first run: start a fresh simulation.
      epochRef.current = simulationEpoch;
      knownIdsRef.current = new Set(propIds);
      coreRemovedRef.current = new Set();
      prevPropIdsRef.current = propIds;
      clearTrails();
      clearImpacts();
      client.send({
        type: 'load',
        epoch: simulationEpoch,
        bodies,
        config: { realistic: configRef.current.realisticMode, expansionRate: configRef.current.expansionRate },
      });
      return;
    }

    for (const body of bodies) {
      if (knownIdsRef.current.has(body.id)) continue;
      knownIdsRef.current.add(body.id);
      client.send({ type: 'add', epoch: simulationEpoch, body });
    }
    for (const id of prevPropIdsRef.current) {
      if (propIds.has(id)) continue;
      if (coreRemovedRef.current.has(id)) continue; // the simulation removed it itself
      client.send({ type: 'remove', epoch: simulationEpoch, id });
      trailsRef.current.delete(id);
    }
    prevPropIdsRef.current = propIds;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bodies, simulationEpoch]);

  useEffect(() => {
    if (epochRef.current === null) return;
    clientRef.current?.send({ type: 'config', epoch: epochRef.current, config: { realistic: realisticMode } });
  }, [realisticMode]);

  useEffect(() => {
    if (epochRef.current === null) return;
    clientRef.current?.send({ type: 'config', epoch: epochRef.current, config: { expansionRate } });
  }, [expansionRate]);

  // ── Frame loop: ask the simulation to advance (or rewind) by this frame's time ──
  useFrame((_, delta) => {
    const client = clientRef.current;
    if (!client || epochRef.current === null || timeScale === 0) return;
    client.tick(epochRef.current, Math.min(delta, 0.1) * timeScale);
  });

  return (
    <>
      <ImpactCameraDirector
        activeImpact={activeImpact}
        controlsRef={controlsRef}
      />
      {activeImpact && (
        <Html
          key={activeImpact.id}
          position={activeImpact.position}
          center
          distanceFactor={18}
          style={{ pointerEvents: 'none' }}
          zIndexRange={[500, 0]}
        >
          <div
            className="rounded-2xl border-2 border-primary/40 bg-background/94 backdrop-blur-md px-6 py-5 shadow-xl min-w-[300px] max-w-[440px]"
            style={{ boxShadow: '0 0 32px rgba(0, 229, 255, 0.15)', pointerEvents: 'auto' }}
          >
            <div className="flex items-start justify-between gap-4 mb-2">
              <div className="text-lg font-bold uppercase tracking-[0.12em] text-primary">
                {activeImpact.title}
              </div>
              <button
                onClick={dismissImpact}
                className="shrink-0 mt-0.5 w-6 h-6 flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-white/10 transition-colors"
                title="Dismiss"
              >
                <svg width="12" height="12" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M11.7816 4.03157C12.0062 3.80702 12.0062 3.44295 11.7816 3.2184C11.5571 2.99385 11.193 2.99385 10.9685 3.2184L7.50005 6.68682L4.03164 3.2184C3.80708 2.99385 3.44301 2.99385 3.21846 3.2184C2.99391 3.44295 2.99391 3.80702 3.21846 4.03157L6.68688 7.50001L3.21846 10.9684C2.99391 11.193 2.99391 11.5571 3.21846 11.7816C3.44301 12.0061 3.80708 12.0061 4.03164 11.7816L7.50005 8.31319L10.9685 11.7816C11.193 12.0061 11.5571 12.0061 11.7816 11.7816C12.0062 11.5571 12.0062 11.193 11.7816 10.9684L8.31322 7.50001L11.7816 4.03157Z" fill="currentColor" fillRule="evenodd" clipRule="evenodd" />
                </svg>
              </button>
            </div>
            <div className="text-base text-foreground/90 leading-relaxed border-t border-border/50 pt-3">
              {activeImpact.detail}
            </div>
            {activeImpact.stats && (
              <div className="mt-2 text-xs font-mono text-primary/80">{activeImpact.stats}</div>
            )}
            {hasPendingImpact && (
              <div className="mt-3 text-[11px] text-primary/60 font-mono">
                +1 more collision — dismiss to view
              </div>
            )}
          </div>
        </Html>
      )}
      <primitive object={conicLine} />
      <primitive object={selectionRing} />
      {bodies.map(body => (
        <BodyRenderer key={body.id} body={body} meshEntriesRef={meshEntriesRef} onSelect={onSelectBody} />
      ))}
    </>
  );
};

export default PhysicsSimulator;
