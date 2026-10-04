import { create } from 'zustand';
import type { CelestialBody } from '@/worlds/spacetime/types';
import { SPACETIME_TEMPLATES } from '@/worlds/spacetime/spacetimeTemplates';
import { DEFAULT_STAR_MASS } from '@/physics/constants';
import { planPlacement, type PlacementNeighbour } from '@/physics/placement';
import type { PredictedOutcome } from '@/physics/predict';
import {
  deleteSpacetimeScenario,
  listSavedSpacetimeScenarios,
  saveSpacetimeScenario,
  type SavedSpacetimeScenario,
} from '@/lib/scenarioStorage';
import { isUnlocked } from '@/lib/unlocks';
import { missionTracker } from '@/app/missionTracker';
import { liveWorld } from '@/worlds/spacetime/liveWorld';
import { useEventStore } from './eventStore';
import { useProgressStore } from './progressStore';
import { useTimeStore } from './timeStore';

export type PendingBody = Omit<CelestialBody, 'id' | 'position'>;

let nextId = 1;

// Bodies with a zero velocity are given a circular orbit around the heaviest body by the simulator.
const createDefaultBodies = (): CelestialBody[] => [
  { id: 'sun', name: 'Sun', type: 'star', bodyClass: 'star', position: [0, 0, 0], mass: DEFAULT_STAR_MASS, radius: 2.4, physicalRadius: 696_340_000, color: '#ffcc00', velocity: [0, 0, 0] },
  { id: 'earth', name: 'Earth', type: 'planet', bodyClass: 'rocky', position: [8, 0, 0], mass: 5.97e24, radius: 0.45, physicalRadius: 6_371_000, color: '#5b9ee8', atmosphere: true, velocity: [0, 0, 0] },
  { id: 'mars', name: 'Mars', type: 'planet', bodyClass: 'rocky', position: [-5, 0, 6], mass: 6.42e23, radius: 0.35, physicalRadius: 3_389_500, color: '#dd7755', atmosphere: true, velocity: [0, 0, 0] },
];

/**
 * Bodies as they are right now: positions and velocities from the running simulation
 * where it has them (React state only holds each body's starting values).
 */
export const liveBodiesFor = (bodies: CelestialBody[]): CelestialBody[] => bodies.map((body) => {
  const live = liveWorld.find(body.id);
  return live
    ? { ...body, position: [live.position.x, 0, live.position.z], velocity: [live.velocity.x, 0, live.velocity.z], mass: live.mass, radius: live.radius, pinned: live.pinned }
    : body;
});

/** Neighbours for placement: live positions and velocities. */
export const placementNeighbours = (bodies: CelestialBody[]): PlacementNeighbour[] => liveBodiesFor(bodies).map((body) => ({
  position: body.position,
  velocity: body.velocity,
  mass: body.mass,
  radius: body.radius,
}));

interface SpacetimeState {
  bodies: CelestialBody[];
  /**
   * Incremented whenever the whole system is replaced (reset, template, saved system,
   * clear), so the simulation restarts from `bodies` and clears its rewind history.
   */
  epoch: number;
  pendingPlacement: PendingBody | null;
  /** Body shown in the inspector and followed by the camera. */
  selectedBodyId: string | null;
  /** Keep the camera centred on the selected body as it moves. */
  followSelected: boolean;
  placementVelocityScale: number;
  realisticMode: boolean;
  /** Opt-in Hubble-style expansion: unbound bodies drift apart, orbits keep their size. */
  expansionEnabled: boolean;
  savedScenarios: SavedSpacetimeScenario[];

  beginPlacement: (body: Omit<CelestialBody, 'id'>) => void;
  cancelPlacement: () => void;
  /**
   * Places the pending body, pushed clear of other bodies. With an aimed velocity
   * (drag-to-aim) that velocity is used; otherwise a circular orbit around the heaviest
   * body scaled by placementVelocityScale. `predicted` is what the preview showed.
   */
  placeOnGrid: (point: [number, number, number], aimedVelocity?: [number, number, number] | null, predicted?: PredictedOutcome | null) => void;
  selectBody: (id: string | null) => void;
  setFollowSelected: (follow: boolean) => void;
  removeBody: (id: string) => void;
  /** The simulation changed a body's mass or radius (it absorbed something). */
  updateBody: (id: string, mass: number, radius: number) => void;
  /** The simulation created a body (fragment, tidal debris) or rewound one back. */
  addSimulatedBody: (body: CelestialBody) => void;
  /** The simulation removed a body itself (absorbed, or rewound to before it existed). */
  dropSimulatedBody: (id: string) => void;
  setPinned: (id: string, pinned: boolean) => void;
  removeAll: () => void;
  applyTemplate: (templateId: string) => void;
  reset: () => void;
  setVelocityScale: (value: number) => void;
  setRealisticMode: (value: boolean) => void;
  setExpansionEnabled: (value: boolean) => void;
  saveScenario: (name: string) => boolean;
  loadScenario: (scenarioId: string) => void;
  deleteScenario: (scenarioId: string) => void;
  /** Adds imported scenarios to the saved list. */
  importScenarios: (scenarios: Omit<SavedSpacetimeScenario, 'id' | 'createdAt' | 'updatedAt'>[]) => void;
}

const progress = () => useProgressStore.getState();
const events = () => useEventStore.getState();

/** Human-readable name for a body, e.g. "Earth" or "black hole". */
export const bodyLabel = (body: Pick<CelestialBody, 'name' | 'type'>) =>
  body.name ?? ({ blackhole: 'black hole', neutron: 'neutron star' } as Record<string, string>)[body.type] ?? body.type;

/** A fresh run: new epoch, clock back to 1×, tracker and selection cleared. */
const freshRun = (state: SpacetimeState) => {
  useTimeStore.getState().resetClock();
  missionTracker.reset();
  return { epoch: state.epoch + 1, pendingPlacement: null, selectedBodyId: null };
};

export const useSpacetimeStore = create<SpacetimeState>()((set, get) => ({
  bodies: createDefaultBodies(),
  epoch: 0,
  pendingPlacement: null,
  selectedBodyId: null,
  followSelected: true,
  placementVelocityScale: 1,
  realisticMode: true,
  expansionEnabled: false,
  savedScenarios: listSavedSpacetimeScenarios(),

  beginPlacement: (body) => {
    const { position: _ignored, ...withoutPosition } = body;
    set({ pendingPlacement: withoutPosition, selectedBodyId: null });
    progress().registerExperiment(`prep:${body.type}:${Math.round(body.mass).toExponential(1)}`);
  },

  cancelPlacement: () => set({ pendingPlacement: null }),

  placeOnGrid: (point, aimedVelocity, predicted = null) => {
    const { pendingPlacement, bodies, placementVelocityScale, realisticMode } = get();
    if (!pendingPlacement) return;
    const plan = planPlacement(point, pendingPlacement.radius ?? 0.3, placementNeighbours(bodies), placementVelocityScale, aimedVelocity);
    const id = `obj_${nextId++}`;
    progress().registerExperiment(`place:${pendingPlacement.type}:${plan.position[0].toFixed(1)}:${plan.position[2].toFixed(1)}:${aimedVelocity ? 'aimed' : placementVelocityScale.toFixed(2)}:${realisticMode ? 'real' : 'arcade'}`, 18);
    missionTracker.notePlacement(id, Boolean(aimedVelocity), liveWorld.snapshot?.simTime ?? 0, predicted);
    set({
      bodies: [...bodies, { ...pendingPlacement, id, position: plan.position, velocity: plan.velocity }],
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

  addSimulatedBody: (body) => set((state) => (
    state.bodies.some((b) => b.id === body.id) ? state : { bodies: [...state.bodies, body] }
  )),

  dropSimulatedBody: (id) => set((state) => ({
    bodies: state.bodies.filter((b) => b.id !== id),
    selectedBodyId: state.selectedBodyId === id ? null : state.selectedBodyId,
  })),

  setPinned: (id, pinned) => set((state) => ({
    bodies: state.bodies.map((b) => (b.id === id ? { ...b, pinned } : b)),
  })),

  removeAll: () => {
    set((state) => ({ ...freshRun(state), bodies: [] }));
    events().clear('spacetime');
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
    set((state) => ({ ...freshRun(state), bodies }));
    events().clear('spacetime');
    events().log('spacetime', `Loaded ${template.name}`);
    progress().registerExperiment(`template:${templateId}`, 24);
  },

  reset: () => {
    set((state) => ({ ...freshRun(state), bodies: createDefaultBodies() }));
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

  setExpansionEnabled: (value) => {
    set({ expansionEnabled: value });
    if (value) progress().registerExperiment('universe-expansion');
  },

  saveScenario: (name) => {
    const trimmedName = name.trim();
    if (!trimmedName) return false;
    const { bodies, placementVelocityScale, realisticMode } = get();
    set({ savedScenarios: saveSpacetimeScenario({ name: trimmedName, bodies: liveBodiesFor(bodies), placementVelocityScale, realisticMode }) });
    return true;
  },

  loadScenario: (scenarioId) => {
    const scenario = get().savedScenarios.find((entry) => entry.id === scenarioId);
    if (!scenario) return;
    set((state) => ({
      ...freshRun(state),
      bodies: scenario.bodies.map((body, index) => ({ ...body, id: `saved_${nextId++}_${index}` })),
      placementVelocityScale: scenario.placementVelocityScale,
      realisticMode: scenario.realisticMode,
    }));
    events().clear('spacetime');
    events().log('spacetime', `Loaded ${scenario.name}`);
    progress().registerExperiment(`saved-scenario:${scenario.id}`, 20);
  },

  deleteScenario: (scenarioId) => set({ savedScenarios: deleteSpacetimeScenario(scenarioId) }),

  importScenarios: (scenarios) => {
    let saved = get().savedScenarios;
    for (const scenario of scenarios) saved = saveSpacetimeScenario(scenario);
    set({ savedScenarios: saved });
  },
}));
