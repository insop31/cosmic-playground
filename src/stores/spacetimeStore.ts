import { create } from 'zustand';
import type { CelestialBody } from '@/worlds/spacetime/types';
import { SPACETIME_TEMPLATES } from '@/worlds/spacetime/spacetimeTemplates';
import {
  deleteSpacetimeScenario,
  listSavedSpacetimeScenarios,
  saveSpacetimeScenario,
  type SavedSpacetimeScenario,
} from '@/lib/scenarioStorage';
import { isUnlocked } from '@/lib/unlocks';
import { useEventStore } from './eventStore';
import { useProgressStore } from './progressStore';
import { useTimeStore } from './timeStore';

const DEFAULT_STAR_MASS = 1.989e30;
const MASSIVE_ATTRACTOR_THRESHOLD = 1e27;
const REAL_G = 6.674e-11;
const REAL_GRAVITY_BOOST = 7.5e-20; // Must match PhysicsSimulator — G_eff * M_sun ≈ 10 at scene scale
const MIN_ORBITAL_SPEED = 0.08;
const MAX_ORBITAL_SPEED = 3.0;

export type PendingBody = Omit<CelestialBody, 'id' | 'position'>;

let nextId = 1;

const SUN: CelestialBody = { id: 'sun', name: 'Sun', type: 'star', bodyClass: 'star', position: [0, 0, 0], mass: DEFAULT_STAR_MASS, radius: 2.4, physicalRadius: 696_340_000, color: '#ffcc00', velocity: [0, 0, 0] };
const EARTH: CelestialBody = { id: 'earth', name: 'Earth', type: 'planet', bodyClass: 'rocky', position: [8, 0, 0], mass: 5.97e24, radius: 0.45, physicalRadius: 6_371_000, color: '#5b9ee8', atmosphere: true, velocity: [0, 0, 0] };
const MARS: CelestialBody = { id: 'mars', name: 'Mars', type: 'planet', bodyClass: 'rocky', position: [-5, 0, 6], mass: 6.42e23, radius: 0.35, physicalRadius: 3_389_500, color: '#dd7755', atmosphere: true, velocity: [0, 0, 0] };

/**
 * Seconds of forward simulation time that count toward mission stability
 * checks. Not React state: read once per second by the mission watchers.
 */
export const stability = { system: 0, blackHole: 0 };

/** Real seconds the universe has aged; drives the slow expansion of space. */
export const universeClock = { age: 0 };

const resetSimulationClocks = () => {
  stability.system = 0;
  stability.blackHole = 0;
  universeClock.age = 0;
  useTimeStore.getState().resetClock();
};

/** Tangential speed for a circular orbit around the heaviest body. */
export const computePlacementVelocity = (position: [number, number, number], allBodies: Pick<CelestialBody, 'position' | 'mass'>[], scale: number): [number, number, number] => {
  if (allBodies.length === 0) return [0, 0, 0];
  const attractor = allBodies.reduce((max, b) => (b.mass > max.mass ? b : max));
  const rx = position[0] - attractor.position[0];
  const rz = position[2] - attractor.position[2];
  const distance = Math.sqrt(rx * rx + rz * rz);
  if (distance < 0.01) return [0, 0, 0];
  const normalizedDistance = Math.max(distance, 0.25);
  const effectiveMass = Math.max(attractor.mass, MASSIVE_ATTRACTOR_THRESHOLD);
  const orbitalSpeedRaw = Math.sqrt((REAL_G * effectiveMass * REAL_GRAVITY_BOOST) / normalizedDistance);
  const orbitalSpeed = Math.min(MAX_ORBITAL_SPEED, Math.max(MIN_ORBITAL_SPEED, orbitalSpeedRaw));
  const tangentX = -rz / distance;
  const tangentZ = rx / distance;
  return [tangentX * orbitalSpeed * scale, 0, tangentZ * orbitalSpeed * scale];
};

/** Pushes a spawn point out of every existing body's safety radius. */
export const resolveSpawnPosition = (position: [number, number, number], radius: number, existingBodies: Pick<CelestialBody, 'position' | 'radius'>[]) => {
  let spawnPos: [number, number, number] = [...position];
  for (const existing of existingBodies) {
    const dx = spawnPos[0] - existing.position[0];
    const dz = spawnPos[2] - existing.position[2];
    const dist = Math.sqrt(dx * dx + dz * dz);
    // Buffer: sum of radii × 2.5 + 2.0 extra units of breathing room
    const minSafe = (existing.radius + radius) * 2.5 + 2.0;
    if (dist < minSafe) {
      const ux = dist > 1e-6 ? dx / dist : 1;
      const uz = dist > 1e-6 ? dz / dist : 0;
      spawnPos = [existing.position[0] + ux * minSafe, 0, existing.position[2] + uz * minSafe];
    }
  }
  return spawnPos;
};

interface SpacetimeState {
  bodies: CelestialBody[];
  pendingPlacement: PendingBody | null;
  /** Body shown in the inspector and followed by the camera. */
  selectedBodyId: string | null;
  /** Keep the camera centred on the selected body as it moves. */
  followSelected: boolean;
  placementVelocityScale: number;
  realisticMode: boolean;
  universeScale: number;
  savedScenarios: SavedSpacetimeScenario[];

  beginPlacement: (body: Omit<CelestialBody, 'id'>) => void;
  cancelPlacement: () => void;
  /**
   * Places the pending body. With an explicit velocity (drag-to-aim) the
   * position is taken as final; otherwise it is pushed clear of other bodies
   * and given a circular-orbit velocity scaled by placementVelocityScale.
   */
  placeOnGrid: (position: [number, number, number], velocity?: [number, number, number]) => void;
  selectBody: (id: string | null) => void;
  setFollowSelected: (follow: boolean) => void;
  removeBody: (id: string) => void;
  updateBody: (id: string, mass: number, radius: number) => void;
  removeAll: () => void;
  applyTemplate: (templateId: string) => void;
  reset: () => void;
  setVelocityScale: (value: number) => void;
  setRealisticMode: (value: boolean) => void;
  setUniverseScale: (value: number) => void;
  saveScenario: (name: string) => boolean;
  loadScenario: (scenarioId: string) => void;
  deleteScenario: (scenarioId: string) => void;
}

const progress = () => useProgressStore.getState();
const events = () => useEventStore.getState();

/** Human-readable name for a body, e.g. "Earth" or "black hole". */
export const bodyLabel = (body: Pick<CelestialBody, 'name' | 'type'>) =>
  body.name ?? ({ blackhole: 'black hole', neutron: 'neutron star' } as Record<string, string>)[body.type] ?? body.type;

export const useSpacetimeStore = create<SpacetimeState>()((set, get) => ({
  bodies: [SUN, EARTH, MARS],
  pendingPlacement: null,
  selectedBodyId: null,
  followSelected: true,
  placementVelocityScale: 1,
  realisticMode: true,
  universeScale: 1,
  savedScenarios: listSavedSpacetimeScenarios(),

  beginPlacement: (body) => {
    const { position: _ignored, ...withoutPosition } = body;
    set({ pendingPlacement: withoutPosition, selectedBodyId: null });
    progress().registerExperiment(`prep:${body.type}:${Math.round(body.mass).toExponential(1)}`);
  },

  cancelPlacement: () => set({ pendingPlacement: null }),

  placeOnGrid: (position, aimedVelocity) => {
    const { pendingPlacement, bodies, placementVelocityScale, realisticMode } = get();
    if (!pendingPlacement) return;

    const spawnPos = aimedVelocity ? position : resolveSpawnPosition(position, pendingPlacement.radius ?? 0.3, bodies);
    const velocity = aimedVelocity ?? computePlacementVelocity(spawnPos, bodies, placementVelocityScale);
    // How fast the launch was relative to a circular orbit at that spot.
    const circular = Math.hypot(...computePlacementVelocity(spawnPos, bodies, 1));
    const speedRatio = circular > 0 ? Math.hypot(...velocity) / circular : placementVelocityScale;
    const hasHeavyAnchor = bodies.some((body) => body.mass >= 1e27);
    if ((pendingPlacement.type === 'comet' || pendingPlacement.type === 'asteroid') && speedRatio >= 1.5 && hasHeavyAnchor) {
      progress().unlock('slingshot-expert');
    }
    progress().registerExperiment(`place:${pendingPlacement.type}:${spawnPos[0].toFixed(1)}:${spawnPos[2].toFixed(1)}:${speedRatio.toFixed(2)}:${realisticMode ? 'real' : 'arcade'}`, 18);

    set({
      bodies: [...bodies, { ...pendingPlacement, id: `obj_${nextId++}`, position: spawnPos, velocity }],
      pendingPlacement: null,
    });
    events().log('spacetime', `Placed ${bodyLabel(pendingPlacement)}`);
  },

  selectBody: (selectedBodyId) => set({ selectedBodyId }),

  setFollowSelected: (followSelected) => set({ followSelected }),

  removeBody: (id) => set((state) => ({
    bodies: state.bodies.filter((b) => b.id !== id),
    selectedBodyId: state.selectedBodyId === id ? null : state.selectedBodyId,
  })),

  updateBody: (id, mass, radius) => set((state) => ({
    bodies: state.bodies.map((b) => (b.id === id ? { ...b, mass, radius } : b)),
  })),

  removeAll: () => {
    stability.system = 0;
    stability.blackHole = 0;
    set({ bodies: [], selectedBodyId: null });
    events().log('spacetime', 'Removed every body');
  },

  applyTemplate: (templateId) => {
    const template = SPACETIME_TEMPLATES.find((entry) => entry.id === templateId);
    if (!template) return;
    if (template.unlock && !isUnlocked(template.unlock, progress().score)) return;
    const bodies = template.createBodies().map((body, index) => ({
      ...body,
      id: `template_${templateId}_${nextId++}_${index}`,
    }));
    resetSimulationClocks();
    set({ bodies, pendingPlacement: null, selectedBodyId: null, universeScale: 1 });
    events().clear('spacetime');
    events().log('spacetime', `Loaded ${template.name}`);
    progress().registerExperiment(`template:${templateId}`, 24);
  },

  reset: () => {
    resetSimulationClocks();
    set({ bodies: [SUN, EARTH], pendingPlacement: null, selectedBodyId: null, universeScale: 1 });
    events().clear('spacetime');
    events().log('spacetime', 'Lab reset');
  },

  setVelocityScale: (value) => {
    set({ placementVelocityScale: value });
    progress().registerExperiment(`velocity-scale:${value.toFixed(2)}`);
  },

  setRealisticMode: (value) => {
    set({ realisticMode: value });
    progress().registerExperiment(`physics-mode:${value ? 'realistic' : 'arcade'}`);
  },

  setUniverseScale: (universeScale) => set({ universeScale }),

  saveScenario: (name) => {
    const trimmedName = name.trim();
    if (!trimmedName) return false;
    const { bodies, placementVelocityScale, realisticMode } = get();
    set({ savedScenarios: saveSpacetimeScenario({ name: trimmedName, bodies, placementVelocityScale, realisticMode }) });
    return true;
  },

  loadScenario: (scenarioId) => {
    const scenario = get().savedScenarios.find((entry) => entry.id === scenarioId);
    if (!scenario) return;
    resetSimulationClocks();
    set({
      bodies: scenario.bodies.map((body, index) => ({ ...body, id: `saved_${nextId++}_${index}` })),
      placementVelocityScale: scenario.placementVelocityScale,
      realisticMode: scenario.realisticMode,
      pendingPlacement: null,
      selectedBodyId: null,
      universeScale: 1,
    });
    events().clear('spacetime');
    events().log('spacetime', `Loaded ${scenario.name}`);
    progress().registerExperiment(`saved-scenario:${scenario.id}`, 20);
  },

  deleteScenario: (scenarioId) => set({ savedScenarios: deleteSpacetimeScenario(scenarioId) }),
}));
