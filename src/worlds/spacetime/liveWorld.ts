import { REALISTIC_G } from '@/physics/constants';
import { orbitalElements, type OrbitElements } from '@/physics/orbits';
import type { PredictSeed } from '@/physics/predict';
import {
  STATE_STRIDE,
  S_CLOSE,
  S_DOMINANT,
  S_MOTION,
  S_PINNED,
  S_RADIUS,
  S_VX,
  S_VZ,
  S_X,
  S_Z,
  type SimSnapshot,
} from '@/physics/simulation';
import { MOTION_BOUND, MOTION_CAPTURED, MOTION_ESCAPING } from '@/physics/system';
import type { CelestialBody } from '@/physics/types';

export type Motion = 'bound' | 'escaping' | 'captured';

/** Commands the HUD can send to the running simulation. */
export interface SimulationControls {
  seek: (step: number) => void;
  setPinned: (id: string, pinned: boolean) => void;
}

/** Filled in by PhysicsSimulator while the Spacetime simulation is running. */
export const simulationControls: { current: SimulationControls | null } = { current: null };

/** One body as it is right now in the running simulation. */
export interface LiveBody {
  id: string;
  type: string;
  position: { x: number; z: number };
  /** Realistic-mode units, matching CelestialBody.velocity. */
  velocity: { x: number; z: number };
  mass: number;
  radius: number;
  physicalRadius?: number;
  motion: Motion;
  /** Id of the body whose gravity dominates its motion, if any. */
  dominantId: string | null;
  pinned: boolean;
  closeApproach: boolean;
}

const MOTION: Record<number, Motion> = {
  [MOTION_BOUND]: 'bound',
  [MOTION_ESCAPING]: 'escaping',
  [MOTION_CAPTURED]: 'captured',
};

/**
 * Read-only window onto the running Spacetime simulation for code outside the
 * render loop (inspector, camera, placement preview). Refreshed by
 * PhysicsSimulator with every state the simulation worker sends back.
 */
export const liveWorld = {
  snapshot: null as SimSnapshot | null,
  bodies: [] as LiveBody[],
  realistic: true,
  find(id: string) {
    return this.bodies.find((body) => body.id === id);
  },
};

export const publishSnapshot = (snapshot: SimSnapshot, meta: ReadonlyMap<string, Pick<CelestialBody, 'type' | 'physicalRadius'>>) => {
  const { ids, data, masses } = snapshot;
  const bodies: LiveBody[] = new Array(ids.length);
  for (let i = 0; i < ids.length; i++) {
    const o = i * STATE_STRIDE;
    const d = data[o + S_DOMINANT];
    const info = meta.get(ids[i]);
    bodies[i] = {
      id: ids[i],
      type: info?.type ?? 'planet',
      position: { x: data[o + S_X], z: data[o + S_Z] },
      velocity: { x: data[o + S_VX], z: data[o + S_VZ] },
      mass: masses[i],
      radius: data[o + S_RADIUS],
      physicalRadius: info?.physicalRadius,
      motion: MOTION[data[o + S_MOTION]] ?? 'bound',
      dominantId: d >= 0 && d < ids.length ? ids[d] : null,
      pinned: data[o + S_PINNED] === 1,
      closeApproach: data[o + S_CLOSE] === 1,
    };
  }
  liveWorld.snapshot = snapshot;
  liveWorld.bodies = bodies;
  liveWorld.realistic = snapshot.realistic;
};

export const clearLiveWorld = () => {
  liveWorld.snapshot = null;
  liveWorld.bodies = [];
};

/** The live bodies as plain data for the prediction worker. */
export const predictionSeeds = (): PredictSeed[] => liveWorld.bodies.map((body) => ({
  id: body.id,
  type: body.type,
  x: body.position.x,
  z: body.position.z,
  vx: body.velocity.x,
  vz: body.velocity.z,
  mass: body.mass,
  radius: body.radius,
  physRadius: body.physicalRadius,
  pinned: body.pinned,
}));

export interface LiveOrbit {
  parentId: string;
  elements: OrbitElements;
  /** μ = G(M + m) in realistic units. */
  mu: number;
  bound: boolean;
  /** Speed for a circular orbit and to escape, at the current distance. */
  circularSpeed: number;
  escapeSpeed: number;
}

/**
 * Two-body orbit of `id` around the body that dominates its motion (the same Hill-sphere
 * rule the simulation uses). Velocities are in realistic units, so the realistic G gives
 * the orbit's true shape in either gravity mode.
 */
export const liveOrbit = (id: string): LiveOrbit | null => {
  const body = liveWorld.find(id);
  const parent = body?.dominantId ? liveWorld.find(body.dominantId) : undefined;
  if (!body || !parent) return null;
  const mu = REALISTIC_G * (parent.mass + body.mass);
  const elements = orbitalElements(
    body.position.x - parent.position.x,
    body.position.z - parent.position.z,
    body.velocity.x - parent.velocity.x,
    body.velocity.z - parent.velocity.z,
    mu,
  );
  return {
    parentId: parent.id,
    elements,
    mu,
    bound: elements.energy < 0,
    circularSpeed: Math.sqrt(mu / elements.distance),
    escapeSpeed: Math.sqrt((2 * mu) / elements.distance),
  };
};
