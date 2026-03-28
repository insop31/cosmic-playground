import React, { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import type { RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import { CelestialBody } from './SpaceScene';

/** Shown as a floating message box at the impact midpoint (world space). */
export interface ImpactPopupState {
  id: string;
  title: string;
  detail: string;
  position: [number, number, number];
}

// ─────────────────────────────────────────────────────────────────────────────
// Physics constants
// ─────────────────────────────────────────────────────────────────────────────
export const REAL_G            = 6.674e-11;   // SI gravitational constant
export const ARCADE_G          = 0.5;          // Arcade-mode tuned constant
// Tuned so G_eff * M_sun ≈ 10 at scene scale → circular orbit speed ≈ 1 scene-unit/s at r=10.
// Old value (1.2e20) produced accelerations of ~10^38 scene/s² — a body flew 10^33 units in one substep.
const REAL_GRAVITY_BOOST       = 7.5e-20;
const SOFTENING_SQ             = 0.64;         // ε²=0.64 (ε≈0.8) — avoids singularity and smooths close-range impulses
const SPEED_OF_LIGHT           = 299_792_458;
const SCHWARZSCHILD_SCENE_SCALE = 1e-8;
const MAX_TRAIL_POINTS         = 200;
const MAX_HISTORY              = 3600;         // ~60 s rewind at 60 fps
const MIN_SPAWN_DIST           = 0.01;
const MAX_SIM_BODIES           = 180;
const FIXED_SUBSTEP            = 1 / 120;     // Physics substep (s)
const MAX_SUBSTEPS             = 8;
const CLOSE_APPROACH_FACTOR    = 3.0;

// ─────────────────────────────────────────────────────────────────────────────
// Internal types
// ─────────────────────────────────────────────────────────────────────────────
interface PhysicsBody {
  id:       string;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  force:    THREE.Vector3;    // accumulated per step, reset each step
  mass:     number;
  radius:   number;
  type:     string;
  color:    string;
  // Pre-allocated ring-buffer trail [x,0,z, x,0,z, …]
  trailData: Float32Array;
  trailHead: number;          // write index into trailData (in units of 3 floats)
  trailLen:  number;          // how many valid points are stored (max MAX_TRAIL_POINTS)
  motionState:     'bound' | 'escaping' | 'captured';
  isCloseApproach: boolean;
}

type BodyType = 'star' | 'planet' | 'asteroid' | 'blackhole' | 'neutron' | 'comet' | string;

interface WorldSnapshot {
  id: string;
  px: number; py: number; pz: number;
  vx: number; vy: number; vz: number;
}

interface MeshEntry {
  groupRef:  React.MutableRefObject<THREE.Group | null>;
  meshRef:   React.MutableRefObject<THREE.Mesh | null>;
  glowRef:   React.MutableRefObject<THREE.Mesh | null>;
  trailLine: THREE.Line;
  trailAttr: THREE.BufferAttribute;
}

export interface PhysicsSimulatorProps {
  bodies: CelestialBody[];
  timeScale: number;
  realisticMode?: boolean;
  onBodyRemoved: (id: string) => void;
  onBodyUpdated: (id: string, mass: number, radius: number) => void;
  livePhysicsRef: React.MutableRefObject<Array<{ position: [number, number, number]; mass: number }>>;
  universeScale?: number;
  gridSize?: number;
  controlsRef: RefObject<OrbitControlsImpl | null>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure physics helpers — no type rules, all behaviour from mass/distance/velocity
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Spawn-time circular orbit velocity around the most massive body present.
 * v_circ = sqrt(G·M / r). No artificial speed cap — let physics run.
 */
function spawnOrbitalVelocity(
  spawnPos:   THREE.Vector3,
  bods:       PhysicsBody[],
  effectiveG: number,
): THREE.Vector3 {
  if (bods.length === 0) return new THREE.Vector3();
  const attractor = bods.reduce((best, b) => (b.mass > best.mass ? b : best));
  const rel  = spawnPos.clone().sub(attractor.position);
  const dist = rel.length();
  if (dist < MIN_SPAWN_DIST) return new THREE.Vector3();
  const speed   = Math.sqrt(effectiveG * attractor.mass / dist);
  const radial  = rel.clone().normalize();
  const tangent = new THREE.Vector3(-radial.z, 0, radial.x);
  if (tangent.lengthSq() < 1e-10) tangent.set(1, 0, 0);
  return tangent.normalize().multiplyScalar(speed);
}

/**
 * Event horizon radius in scene units. Uses Schwarzschild formula scaled to scene,
 * floored at the visual mesh radius so absorption aligns with what the player sees.
 */
function bhEventHorizon(bh: PhysicsBody): number {
  const rsMeters = (2 * REAL_G * bh.mass) / (SPEED_OF_LIGHT * SPEED_OF_LIGHT);
  return Math.max(bh.radius, rsMeters * SCHWARZSCHILD_SCENE_SCALE);
}

/**
 * Hill sphere radius of `b` relative to its nearest more-massive neighbour.
 * r_Hill = a · cbrt(m / 3M). Returns Infinity when `b` is the dominant body.
 */
function hillSphereRadius(b: PhysicsBody, bods: PhysicsBody[]): number {
  let parentDist = Infinity;
  let parentMass = 0;
  for (const other of bods) {
    if (other === b || other.mass <= b.mass) continue;
    const d = b.position.distanceTo(other.position);
    if (d < parentDist) { parentDist = d; parentMass = other.mass; }
  }
  if (parentMass === 0) return Infinity;
  return parentDist * Math.cbrt(b.mass / (3 * parentMass));
}

/**
 * Dominant body index for body at `bodyIdx`.
 * Prefers the body whose Hill sphere contains `body` AND has the highest
 * gravitational influence score (M / d²). Falls back to pure M/d² if none.
 * Used only for energy classification — does NOT force or change motion.
 */
function dominantBodyIndex(bodyIdx: number, bods: PhysicsBody[]): number {
  const body = bods[bodyIdx];
  let bestIdx = -1, bestScore = -Infinity;

  // Pass 1 — Hill-sphere candidates only.
  for (let i = 0; i < bods.length; i++) {
    if (i === bodyIdx) continue;
    const cand  = bods[i];
    const d     = Math.max(body.position.distanceTo(cand.position), 1e-6);
    const hR    = hillSphereRadius(cand, bods);
    const score = cand.mass / (d * d);
    if (d <= hR && score > bestScore) { bestScore = score; bestIdx = i; }
  }

  // Pass 2 — fallback: no Hill-sphere candidate, pick strongest pull.
  if (bestIdx < 0) {
    for (let i = 0; i < bods.length; i++) {
      if (i === bodyIdx) continue;
      const d     = Math.max(body.position.distanceTo(bods[i].position), 1e-6);
      const score = bods[i].mass / (d * d);
      if (score > bestScore) { bestScore = score; bestIdx = i; }
    }
  }
  return bestIdx;
}

/**
 * Adaptive timestep: shortens when bodies are close to prevent numerical blow-up.
 */
function midpointBetween(a: THREE.Vector3, b: THREE.Vector3): [number, number, number] {
  return [(a.x + b.x) * 0.5, 0.75, (a.z + b.z) * 0.5];
}

function describeMergeImpact(a: PhysicsBody, b: PhysicsBody): { title: string; detail: string } {
  const ta = a.type;
  const tb = b.type;
  const has = (t: string) => ta === t || tb === t;
  const both = (t: string, u: string) => (ta === t && tb === u) || (ta === u && tb === t);

  if (has('blackhole')) {
    return { title: 'Black hole interaction', detail: 'Extreme gravity dominated this encounter.' };
  }
  if (both('star', 'star')) {
    return {
      title: 'Stellar merger',
      detail: 'Two stars collided and fused; mass and momentum combined into one body.',
    };
  }
  if (has('star') && (has('planet') || has('asteroid') || has('comet'))) {
    return {
      title: 'Stellar collision',
      detail: 'A star-scale body swept up a smaller object in a high-energy impact.',
    };
  }
  if (both('planet', 'planet')) {
    return {
      title: 'Planetary collision',
      detail: 'Two worlds merged; material mixed into a single larger planet.',
    };
  }
  if (has('neutron')) {
    return {
      title: 'Neutron-star impact',
      detail: 'Ultra-dense matter collided; the survivor carries enormous binding energy.',
    };
  }
  if (has('asteroid') || has('comet')) {
    return {
      title: 'Minor body impact',
      detail: 'A small body hit a larger one and stuck — accretion in one stroke.',
    };
  }
  return {
    title: 'Gravitational merger',
    detail: 'Two bodies collided and coalesced; linear momentum was conserved.',
  };
}

function describeBlackHoleImpact(_bh: PhysicsBody, other: PhysicsBody): { title: string; detail: string } {
  if (other.type === 'star') {
    return {
      title: 'Event horizon crossing',
      detail: 'Stellar material crossed the point of no return and joined the black hole.',
    };
  }
  if (other.type === 'planet') {
    return {
      title: 'Tidal capture',
      detail: 'A planet was pulled past the horizon; only the black hole remains visible.',
    };
  }
  return {
    title: 'Horizon crossing',
    detail: 'A small body crossed the event horizon — gravity wins over all other forces.',
  };
}

function adaptiveDt(baseDt: number, bods: PhysicsBody[]): number {
  if (bods.length < 2) return baseDt;
  let minDist = Infinity;
  for (let i = 0; i < bods.length; i++) {
    for (let j = i + 1; j < bods.length; j++) {
      const d = bods[i].position.distanceTo(bods[j].position);
      if (d < minDist) minDist = d;
    }
  }
  if (!Number.isFinite(minDist)) return baseDt;
  const factor = Math.min(1, Math.max(0.1, minDist / 4.0));
  return Math.max(1e-5, baseDt * factor);
}

function isStaticBody(body: PhysicsBody): boolean {
  return body.type === 'blackhole';
}

// ─────────────────────────────────────────────────────────────────────────────
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
}

interface CameraSnapshot {
  position: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
}

const BodyRenderer: React.FC<BodyRendererProps> = ({ body, meshEntriesRef }) => {
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
      <group ref={groupRef} position={body.position}>

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
  const { camera } = useThree();
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
// PhysicsSimulator
// ─────────────────────────────────────────────────────────────────────────────
const PhysicsSimulator: React.FC<PhysicsSimulatorProps> = ({
  bodies,
  timeScale,
  realisticMode = true,
  onBodyRemoved,
  onBodyUpdated,
  livePhysicsRef,
  universeScale = 1,
  gridSize = 120,
  controlsRef,
}) => {
  const physicsRef     = useRef<PhysicsBody[]>([]);
  const meshEntriesRef = useRef(new Map<string, MeshEntry>());
  const historyRef     = useRef<WorldSnapshot[][]>([]);
  const accumRef       = useRef(0);
  const [renderList, setRenderList] = useState<CelestialBody[]>([]);
  const [impactQueue, setImpactQueue] = useState<ImpactPopupState[]>([]);
  const [activeImpact, setActiveImpact] = useState<ImpactPopupState | null>(null);
  const popupTimeoutRef = useRef<number | null>(null);

  const queueImpactPopups = useCallback((items: ImpactPopupState[]) => {
    if (items.length === 0) return;
    setImpactQueue((prev) => [...prev, ...items]);
  }, []);

  useEffect(() => {
    if (activeImpact || impactQueue.length === 0) return;

    const [nextImpact, ...rest] = impactQueue;
    setActiveImpact(nextImpact);
    setImpactQueue(rest);
    popupTimeoutRef.current = window.setTimeout(() => {
      setActiveImpact(null);
      popupTimeoutRef.current = null;
    }, 5_000);
  }, [activeImpact, impactQueue]);

  useEffect(() => () => {
    if (popupTimeoutRef.current !== null) {
      window.clearTimeout(popupTimeoutRef.current);
    }
  }, []);

  // ── Sync incoming React bodies → physicsRef ──────────────────────────────
  useEffect(() => {
    const effectiveG  = realisticMode ? REAL_G * REAL_GRAVITY_BOOST : ARCADE_G;
    const currentIds  = new Set(physicsRef.current.map(b => b.id));
    const incomingIds = new Set(bodies.map(b => b.id));

    for (const body of bodies) {
      if (currentIds.has(body.id)) continue;
      const pos         = new THREE.Vector3(...body.position);
      const providedVel = new THREE.Vector3(...(body.velocity ?? [0, 0, 0]));
      const vel         = providedVel.lengthSq() > 1e-12
        ? providedVel.clone()
        : spawnOrbitalVelocity(pos, physicsRef.current, effectiveG);

      physicsRef.current.push({
        id:             body.id,
        position:       pos.clone(),
        velocity:       vel,
        force:          new THREE.Vector3(),
        mass:           body.mass,
        radius:         body.radius,
        type:           body.type as BodyType,
        color:          body.color,
        trailData:      new Float32Array(MAX_TRAIL_POINTS * 3),
        trailHead:      0,
        trailLen:       0,
        motionState:    'bound',
        isCloseApproach: false,
      });
    }

    physicsRef.current = physicsRef.current.filter(b => incomingIds.has(b.id));
    for (const id of currentIds) {
      if (!incomingIds.has(id)) meshEntriesRef.current.delete(id);
    }
    setRenderList([...bodies]);
  }, [bodies, realisticMode]);

  // ── Layer 1: Force accumulation ───────────────────────────────────────────
  // F = G·m₁·m₂ / (r² + ε²)  applied to ALL pairs — same law for all types.
  const accumulateForces = (bods: PhysicsBody[], effectiveG: number) => {
    for (const b of bods) b.force.set(0, 0, 0);
    for (let i = 0; i < bods.length; i++) {
      for (let j = i + 1; j < bods.length; j++) {
        const a    = bods[i];
        const b    = bods[j];
        const diff = b.position.clone().sub(a.position);
        const rSqSoft  = diff.lengthSq() + SOFTENING_SQ;
        const forceMag = effectiveG * a.mass * b.mass / rSqSoft;
        const fv       = diff.normalize().multiplyScalar(forceMag);
        a.force.add(fv);
        b.force.sub(fv);
      }
    }
  };

  // ── Layer 2: Velocity Verlet integration ──────────────────────────────────
  // x(t+dt) = x + v·dt + ½·a·dt²
  // a_new   = recompute forces at x(t+dt)
  // v(t+dt) = v + ½·(a_old + a_new)·dt
  const integrate = (bods: PhysicsBody[], effectiveG: number, dt: number) => {
    // Stage 1: compute a(t)
    accumulateForces(bods, effectiveG);
    const aOld = new Map<string, THREE.Vector3>();
    for (const b of bods) {
      aOld.set(
        b.id,
        isStaticBody(b) ? new THREE.Vector3() : b.force.clone().multiplyScalar(1 / b.mass),
      );
    }

    // Stage 2: advance positions
    for (const b of bods) {
      if (isStaticBody(b)) {
        b.velocity.set(0, 0, 0);
        b.force.set(0, 0, 0);
        continue;
      }
      const a = aOld.get(b.id)!;
      b.position.addScaledVector(b.velocity, dt);
      b.position.addScaledVector(a, 0.5 * dt * dt);
      b.position.y = 0; // keep simulation on XZ plane
    }

    // Stage 3: recompute a(t+dt) at new positions
    accumulateForces(bods, effectiveG);

    // Stage 4: update velocities with averaged acceleration — no mutation of aOld
    for (const b of bods) {
      if (isStaticBody(b)) {
        b.velocity.set(0, 0, 0);
        b.force.set(0, 0, 0);
        continue;
      }
      const a0 = aOld.get(b.id)!;
      const a1 = b.force.clone().multiplyScalar(1 / b.mass);
      const avgAcc = a0.clone().add(a1).multiplyScalar(0.5);
      b.velocity.addScaledVector(avgAcc, dt);
      b.velocity.y = 0;
    }
  };

  // ── Layer 3: Event detection & resolution (post-integration) ─────────────
  // Events are DETECTED here, never forced into the integration loop.
  const detectEvents = (
    bods:       PhysicsBody[],
    _effectiveG: number,
    toRemove:   Set<string>,
  ): ImpactPopupState[] => {
    const impacts: ImpactPopupState[] = [];
    let impactSeq = 0;
    const nextId = () => `impact-${Date.now()}-${impactSeq++}`;

    // Reset close-approach flags
    for (const b of bods) b.isCloseApproach = false;

    for (let i = 0; i < bods.length; i++) {
      for (let j = i + 1; j < bods.length; j++) {
        const a = bods[i];
        const b = bods[j];
        if (toRemove.has(a.id) || toRemove.has(b.id)) continue;

        const dist = a.position.distanceTo(b.position);

        // ── Close approach detection (flyby / slingshot zone) ──
        if (dist < (a.radius + b.radius) * CLOSE_APPROACH_FACTOR) {
          a.isCloseApproach = true;
          b.isCloseApproach = true;
        }

        // ── Black hole absorption ──────────────────────────────
        // Black hole is always treated as extremely massive. Any other body
        // crossing its event horizon (or visually overlapping) is absorbed.
        // The black hole NEVER disappears here.
        if (a.type === 'blackhole' || b.type === 'blackhole') {
          const bh    = a.type === 'blackhole' ? a : b;
          const other = bh === a ? b : a;
          const horizon = bhEventHorizon(bh);
          if (dist < horizon || dist < bh.radius + other.radius) {
            const { title, detail } = describeBlackHoleImpact(bh, other);
            impacts.push({
              id: nextId(),
              title,
              detail,
              position: midpointBetween(bh.position, other.position),
            });
            bh.mass    += other.mass;
            bh.radius   = Math.cbrt(bh.radius ** 3 + other.radius ** 3);
            other.motionState = 'captured';
            toRemove.add(other.id);
          }
          continue; // handled — skip generic collision below
        }

        // ── General collision: merge with conservation laws ────
        // Outcome depends on mass ratio and relative velocity — same rule for all.
        if (dist < a.radius + b.radius) {
          const { title, detail } = describeMergeImpact(a, b);
          impacts.push({
            id: nextId(),
            title,
            detail,
            position: midpointBetween(a.position, b.position),
          });

          const [survivor, absorbed] = a.mass >= b.mass ? [a, b] : [b, a];
          const mS  = survivor.mass;
          const mA  = absorbed.mass;
          const mT  = mS + mA;

          // Momentum conservation: v_new = (m1·v1 + m2·v2) / (m1+m2)
          const newVel = survivor.velocity.clone().multiplyScalar(mS)
            .addScaledVector(absorbed.velocity, mA)
            .divideScalar(mT);

          // Centre of mass position
          const newPos = survivor.position.clone().multiplyScalar(mS)
            .addScaledVector(absorbed.position, mA)
            .divideScalar(mT);

          // Volume-conserving radius: r_new = cbrt(r1³ + r2³)
          const rSurv = survivor.radius;
          if (isStaticBody(survivor)) {
            survivor.velocity.set(0, 0, 0);
          } else {
            survivor.velocity.copy(newVel);
            survivor.position.copy(newPos);
          }
          survivor.radius = Math.cbrt(rSurv ** 3 + absorbed.radius ** 3);
          survivor.mass   = mT;
          toRemove.add(absorbed.id);
        }
      }
    }
    return impacts;
  };

  // ── Layer 4: Energy-based bound/escape classification ─────────────────────
  // E = ½·m·v_rel² − G·M·m/r   relative to the dominant body (Hill-sphere based).
  // E < 0  → gravitationally bound  (orbit, elliptical/circular)
  // E ≥ 0  → escaping or flyby (hyperbolic)
  const classifyMotion = (bods: PhysicsBody[], effectiveG: number, toRemove: Set<string>) => {
    for (let i = 0; i < bods.length; i++) {
      const body = bods[i];
      if (toRemove.has(body.id) || body.motionState === 'captured') continue;

      const domIdx = dominantBodyIndex(i, bods);
      if (domIdx < 0) { body.motionState = 'bound'; continue; }

      const dom    = bods[domIdx];
      const relPos = body.position.clone().sub(dom.position);
      const relVel = body.velocity.clone().sub(dom.velocity);
      const r      = Math.max(relPos.length(), 1e-6);
      const v      = relVel.length();

      // Total mechanical energy in the two-body frame
      const energy = 0.5 * body.mass * v * v - (effectiveG * dom.mass * body.mass) / r;
      const vEsc   = Math.sqrt(2 * effectiveG * dom.mass / r);

      body.motionState = (energy < 0 && v < vEsc) ? 'bound' : 'escaping';
    }
  };

  // ── Layer 5: Mesh sync (bypasses React re-render every frame) ────────────
  const syncMeshes = (bods: PhysicsBody[], toRemove: Set<string>) => {
    for (const body of bods) {
      if (toRemove.has(body.id)) continue;

      // Write position to ring-buffer trail (pre-allocated — no GC pressure)
      const idx = body.trailHead * 3;
      body.trailData[idx]     = body.position.x;
      body.trailData[idx + 1] = 0;
      body.trailData[idx + 2] = body.position.z;
      body.trailHead = (body.trailHead + 1) % MAX_TRAIL_POINTS;
      body.trailLen  = Math.min(body.trailLen + 1, MAX_TRAIL_POINTS);

      const entry = meshEntriesRef.current.get(body.id);
      if (!entry) continue;

      entry.groupRef.current?.position.copy(body.position);

      if (entry.meshRef.current)
        entry.meshRef.current.scale.setScalar(body.radius);

      if (entry.glowRef.current) {
        entry.glowRef.current.scale.setScalar(body.radius * 1.8);
        const mat = entry.glowRef.current.material as THREE.MeshBasicMaterial;
        if (mat) mat.opacity = body.motionState === 'escaping' ? 0.18 : 0.08;
      }

      // Unroll ring-buffer into the LineGeometry attribute in correct order
      const arr  = entry.trailAttr.array as Float32Array;
      const len  = body.trailLen;
      const head = body.trailHead;
      for (let k = 0; k < len; k++) {
        const src = ((head - len + k + MAX_TRAIL_POINTS) % MAX_TRAIL_POINTS) * 3;
        const dst = k * 3;
        arr[dst]     = body.trailData[src];
        arr[dst + 1] = body.trailData[src + 1];
        arr[dst + 2] = body.trailData[src + 2];
      }
      entry.trailAttr.needsUpdate = true;
      entry.trailLine.geometry.setDrawRange(0, len);
    }
  };

  // ── Master physics step ───────────────────────────────────────────────────
  const stepPhysics = (bods: PhysicsBody[], dt: number) => {
    const effectiveG = realisticMode ? REAL_G * REAL_GRAVITY_BOOST : ARCADE_G;
    const toRemove   = new Set<string>();

    // Snapshot for time-rewind
    historyRef.current.push(bods.map(b => ({
      id: b.id,
      px: b.position.x, py: b.position.y, pz: b.position.z,
      vx: b.velocity.x, vy: b.velocity.y, vz: b.velocity.z,
    })));
    if (historyRef.current.length > MAX_HISTORY) historyRef.current.shift();

    // 1. Integrate motion — forces → positions & velocities
    integrate(bods, effectiveG, dt);

    // 2. Detect & resolve events (collisions, absorptions) — post-integration
    const stepImpacts = detectEvents(bods, effectiveG, toRemove);
    if (stepImpacts.length) queueImpactPopups(stepImpacts);

    // 3. Classify each body's orbital state using mechanical energy
    classifyMotion(bods, effectiveG, toRemove);

    // 4. Sync Three.js meshes and trails
    syncMeshes(bods, toRemove);

    // 5. Remove absorbed bodies from physics and React state
    if (toRemove.size > 0) {
      physicsRef.current = physicsRef.current.filter(b => !toRemove.has(b.id));
      for (const id of toRemove) meshEntriesRef.current.delete(id);
      setRenderList(prev => prev.filter(b => !toRemove.has(b.id)));
      toRemove.forEach(id => onBodyRemoved(id));
      // Notify parent of mass/radius changes on survivors (e.g. after absorbing mass)
      for (const body of physicsRef.current) {
        const orig = bodies.find(b => b.id === body.id);
        if (orig && (orig.mass !== body.mass || orig.radius !== body.radius)) {
          onBodyUpdated(body.id, body.mass, body.radius);
        }
      }
    }

    // 6. Publish live positions for SpacetimeGrid deformation
    livePhysicsRef.current = physicsRef.current.map(b => ({
      position: [b.position.x, 0, b.position.z] as [number, number, number],
      mass:     b.mass,
    }));
  };

  // ── Frame loop ────────────────────────────────────────────────────────────
  useFrame((_, delta) => {
    if (timeScale === 0) return;
    const bods = physicsRef.current.slice(0, MAX_SIM_BODIES);

    // Rewind: restore from history buffer, no integration
    if (timeScale < 0) {
      const steps = Math.max(1, Math.round(Math.abs(timeScale)));
      for (let s = 0; s < steps; s++) {
        const snap = historyRef.current.pop();
        if (!snap) break;
        for (const entry of snap) {
          const b = bods.find(x => x.id === entry.id);
          if (b) {
            b.position.set(entry.px, entry.py, entry.pz);
            b.velocity.set(entry.vx, entry.vy, entry.vz);
          }
        }
      }
      for (const body of bods) {
        const e = meshEntriesRef.current.get(body.id);
        if (e?.groupRef.current) e.groupRef.current.position.copy(body.position);
      }
      livePhysicsRef.current = physicsRef.current.map(b => ({
        position: [b.position.x, 0, b.position.z] as [number, number, number],
        mass: b.mass,
      }));
      return;
    }

    // Forward: fixed-step accumulator for frame-rate-independent simulation
    const frameDt = Math.min(delta * timeScale, 0.1);
    accumRef.current += frameDt;

    let steps = 0;
    while (accumRef.current >= FIXED_SUBSTEP && steps < MAX_SUBSTEPS) {
      const dt = adaptiveDt(FIXED_SUBSTEP, bods);
      stepPhysics(bods, dt);
      accumRef.current -= FIXED_SUBSTEP;
      steps++;
    }
    // Drain remainder if no full substep fired (e.g. first frame)
    if (steps === 0 && accumRef.current > 0) {
      const dt = adaptiveDt(accumRef.current, bods);
      stepPhysics(bods, dt);
      accumRef.current = 0;
    }
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
            style={{ boxShadow: '0 0 32px rgba(0, 229, 255, 0.15)' }}
          >
            <div className="text-lg font-bold uppercase tracking-[0.12em] text-primary mb-2">
              {activeImpact.title}
            </div>
            <div className="text-base text-foreground/90 leading-relaxed border-t border-border/50 pt-3">
              {activeImpact.detail}
            </div>
          </div>
        </Html>
      )}
      {renderList.map(body => (
        <BodyRenderer key={body.id} body={body} meshEntriesRef={meshEntriesRef} />
      ))}
    </>
  );
};

export default PhysicsSimulator;
