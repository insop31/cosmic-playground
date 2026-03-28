import type { CelestialBody } from '../components/space/SpaceScene';
import type { RocketParams } from '../components/rocket/rocketTypes';

const SPACETIME_STORAGE_KEY = 'cosmic-playground.spacetime-scenarios';
const ROCKET_STORAGE_KEY = 'cosmic-playground.rocket-presets';
const MAX_SAVED_ITEMS = 12;

export interface SavedSpacetimeScenario {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  bodies: CelestialBody[];
  placementVelocityScale: number;
  realisticMode: boolean;
}

export interface SavedRocketPreset {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  params: RocketParams;
}

const canUseStorage = () => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

const readStoredList = <T,>(storageKey: string): T[] => {
  if (!canUseStorage()) return [];

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
};

const writeStoredList = <T,>(storageKey: string, items: T[]) => {
  if (!canUseStorage()) return;
  window.localStorage.setItem(storageKey, JSON.stringify(items));
};

const buildId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const trimAndSort = <T extends { updatedAt: string }>(items: T[]) => (
  [...items]
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, MAX_SAVED_ITEMS)
);

export const listSavedSpacetimeScenarios = () => readStoredList<SavedSpacetimeScenario>(SPACETIME_STORAGE_KEY);

export const saveSpacetimeScenario = (
  input: Omit<SavedSpacetimeScenario, 'id' | 'createdAt' | 'updatedAt'>,
) => {
  const now = new Date().toISOString();
  const nextEntry: SavedSpacetimeScenario = {
    id: buildId(),
    name: input.name.trim(),
    bodies: input.bodies,
    placementVelocityScale: input.placementVelocityScale,
    realisticMode: input.realisticMode,
    createdAt: now,
    updatedAt: now,
  };
  const nextItems = trimAndSort([nextEntry, ...listSavedSpacetimeScenarios()]);
  writeStoredList(SPACETIME_STORAGE_KEY, nextItems);
  return nextItems;
};

export const deleteSpacetimeScenario = (id: string) => {
  const nextItems = listSavedSpacetimeScenarios().filter((entry) => entry.id !== id);
  writeStoredList(SPACETIME_STORAGE_KEY, nextItems);
  return nextItems;
};

export const listSavedRocketPresets = () => readStoredList<SavedRocketPreset>(ROCKET_STORAGE_KEY);

export const saveRocketPreset = (
  input: Omit<SavedRocketPreset, 'id' | 'createdAt' | 'updatedAt'>,
) => {
  const now = new Date().toISOString();
  const nextEntry: SavedRocketPreset = {
    id: buildId(),
    name: input.name.trim(),
    params: input.params,
    createdAt: now,
    updatedAt: now,
  };
  const nextItems = trimAndSort([nextEntry, ...listSavedRocketPresets()]);
  writeStoredList(ROCKET_STORAGE_KEY, nextItems);
  return nextItems;
};

export const deleteRocketPreset = (id: string) => {
  const nextItems = listSavedRocketPresets().filter((entry) => entry.id !== id);
  writeStoredList(ROCKET_STORAGE_KEY, nextItems);
  return nextItems;
};
