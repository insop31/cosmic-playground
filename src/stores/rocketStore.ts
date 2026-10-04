import { useMemo } from 'react';
import { create } from 'zustand';
import { DEFAULT_PARAMS, INITIAL_STATE, normalizeRocketParams, type LaunchOutcome, type RocketParams, type RocketState } from '@/worlds/rocket/rocketTypes';
import { addNotebookEntry, clearNotebook, listNotebook, type NotebookEntry } from '@/lib/notebook';
import { applyWeatherToParams, type WeatherConditionId } from '@/worlds/rocket/weatherPresets';
import {
  deleteRocketPreset,
  listSavedRocketPresets,
  saveRocketPreset,
  type SavedRocketPreset,
} from '@/lib/scenarioStorage';
import { isUnlocked } from '@/lib/unlocks';
import { ROCKET_SCENARIOS, type RocketScenario } from '@/worlds/rocket/rocketScenarios';
import { useEventStore } from './eventStore';
import { useProgressStore } from './progressStore';

interface RocketStoreState {
  /** Vehicle and environment as configured by the user (before weather). */
  params: RocketParams;
  /** Live flight state, written every frame by RocketModel while flying. */
  flight: RocketState;
  activeWeather: Set<WeatherConditionId>;
  savedPresets: SavedRocketPreset[];
  /** The outcome the student expects from the next launch (Predict First). */
  prediction: Exclude<LaunchOutcome, 'none'> | null;
  /** Launches whose outcome was predicted correctly. */
  correctPredictions: number;
  /** Every launch, newest first (kept in this browser). */
  notebook: NotebookEntry[];

  setParam: (key: keyof RocketParams, value: number | boolean) => void;
  launch: () => void;
  resetFlight: () => void;
  updateFlight: (updater: (prev: RocketState) => RocketState) => void;
  toggleWeather: (id: WeatherConditionId) => void;
  savePreset: (name: string) => boolean;
  loadPreset: (presetId: string) => void;
  deletePreset: (presetId: string) => void;
  /** Loads a scenario's vehicle, planet and weather (if unlocked). */
  applyScenario: (id: RocketScenario['id']) => void;
  /** Starts from a teacher pack's settings: defaults plus `settings`, clear weather. */
  applyLessonSettings: (settings: Partial<RocketParams>) => void;
  setPrediction: (prediction: RocketStoreState['prediction']) => void;
  countCorrectPrediction: () => number;
  recordNotebookEntry: (entry: Omit<NotebookEntry, 'id' | 'createdAt'>) => void;
  clearNotebook: () => void;
  /** Adds imported presets to the saved list. */
  importPresets: (presets: Omit<SavedRocketPreset, 'id' | 'createdAt' | 'updatedAt'>[]) => void;
}

const progress = () => useProgressStore.getState();

export const useRocketStore = create<RocketStoreState>()((set, get) => ({
  params: DEFAULT_PARAMS,
  flight: INITIAL_STATE,
  activeWeather: new Set<WeatherConditionId>(),
  savedPresets: listSavedRocketPresets(),
  prediction: null,
  correctPredictions: 0,
  notebook: listNotebook(),

  setParam: (key, value) => {
    const next = { ...get().params, [key]: value };
    set({ params: next });
    const { registerExperiment } = progress();
    registerExperiment(`rocket:${key}:${String(value)}`);
    registerExperiment(
      `rocket-profile:${next.launchAngle}-${next.thrustForce}-${next.fuelMass}-${next.dragCoefficient}-${next.gravity}-${next.crosswind}-${next.windShear}-${next.thermalLoad}-${next.ambientTemperature}-${next.atmosphericPressure}-${next.padTilt}-${next.stageSeparation ? 1 : 0}`,
      10,
    );
  },

  launch: () => {
    progress().awardScore(15);
    // A fresh seed per launch: weather hazards differ between launches but replay exactly on rewind.
    set({ flight: { ...INITIAL_STATE, phase: 'launching', fuel: 1, seed: Math.floor(Math.random() * 2 ** 31) } });
  },

  resetFlight: () => {
    set({ flight: { ...INITIAL_STATE } });
    useEventStore.getState().clear('rocket');
  },

  updateFlight: (updater) => set((state) => ({ flight: updater(state.flight) })),

  toggleWeather: (id) => set((state) => {
    const next = new Set(state.activeWeather);
    if (next.has(id)) next.delete(id); else next.add(id);
    return { activeWeather: next };
  }),

  savePreset: (name) => {
    const trimmedName = name.trim();
    if (!trimmedName) return false;
    set({ savedPresets: saveRocketPreset({ name: trimmedName, params: get().params }) });
    return true;
  },

  loadPreset: (presetId) => {
    const preset = get().savedPresets.find((entry) => entry.id === presetId);
    if (!preset) return;
    set({ params: normalizeRocketParams(preset.params), flight: { ...INITIAL_STATE } });
    progress().registerExperiment(`saved-rocket:${preset.id}`, 16);
  },

  deletePreset: (presetId) => set({ savedPresets: deleteRocketPreset(presetId) }),

  applyLessonSettings: (settings) => {
    set({ params: normalizeRocketParams({ ...DEFAULT_PARAMS, ...settings }), activeWeather: new Set(), flight: { ...INITIAL_STATE } });
    useEventStore.getState().clear('rocket');
  },

  setPrediction: (prediction) => set({ prediction }),

  countCorrectPrediction: () => {
    const next = get().correctPredictions + 1;
    set({ correctPredictions: next });
    return next;
  },

  recordNotebookEntry: (entry) => set({ notebook: addNotebookEntry(entry) }),

  clearNotebook: () => set({ notebook: clearNotebook() }),

  importPresets: (presets) => {
    let saved = get().savedPresets;
    for (const preset of presets) saved = saveRocketPreset(preset);
    set({ savedPresets: saved });
  },

  applyScenario: (id) => {
    const scenario = ROCKET_SCENARIOS.find((entry) => entry.id === id);
    if (!scenario) return;
    if (scenario.unlock && !isUnlocked(scenario.unlock, progress().score)) return;
    set({ params: normalizeRocketParams(scenario.params), activeWeather: new Set(scenario.weather), flight: { ...INITIAL_STATE } });
    useEventStore.getState().clear('rocket');
    useEventStore.getState().log('rocket', `Loaded ${scenario.name}`);
    progress().registerExperiment(`rocket:scenario:${id}`, 20);
  },
}));

/** Params with the active weather applied: what the simulation actually flies. */
export const useEffectiveRocketParams = () => {
  const params = useRocketStore((state) => state.params);
  const activeWeather = useRocketStore((state) => state.activeWeather);
  return useMemo(() => applyWeatherToParams(params, activeWeather), [params, activeWeather]);
};

/** The params actually flown, read once (outside React's render cycle). */
export const readEffectiveRocketParams = () => {
  const { params, activeWeather } = useRocketStore.getState();
  return applyWeatherToParams(params, activeWeather);
};
