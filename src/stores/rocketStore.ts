import { useMemo } from 'react';
import { create } from 'zustand';
import { DEFAULT_PARAMS, INITIAL_STATE, type RocketParams, type RocketState } from '@/worlds/rocket/rocketTypes';
import { applyWeatherToParams, type WeatherConditionId } from '@/worlds/rocket/weatherPresets';
import {
  deleteRocketPreset,
  listSavedRocketPresets,
  saveRocketPreset,
  type SavedRocketPreset,
} from '@/lib/scenarioStorage';
import { useEventStore } from './eventStore';
import { useProgressStore } from './progressStore';

interface RocketStoreState {
  /** Vehicle and environment as configured by the user (before weather). */
  params: RocketParams;
  /** Live flight state, written every frame by RocketModel while flying. */
  flight: RocketState;
  activeWeather: Set<WeatherConditionId>;
  savedPresets: SavedRocketPreset[];

  setParam: (key: keyof RocketParams, value: number | boolean) => void;
  launch: () => void;
  resetFlight: () => void;
  updateFlight: (updater: (prev: RocketState) => RocketState) => void;
  toggleWeather: (id: WeatherConditionId) => void;
  savePreset: (name: string) => boolean;
  loadPreset: (presetId: string) => void;
  deletePreset: (presetId: string) => void;
}

const progress = () => useProgressStore.getState();

export const useRocketStore = create<RocketStoreState>()((set, get) => ({
  params: DEFAULT_PARAMS,
  flight: INITIAL_STATE,
  activeWeather: new Set<WeatherConditionId>(),
  savedPresets: listSavedRocketPresets(),

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
    set({ flight: { ...INITIAL_STATE, phase: 'launching', fuel: 1 } });
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
    set({ params: preset.params, flight: { ...INITIAL_STATE } });
    progress().registerExperiment(`saved-rocket:${preset.id}`, 16);
  },

  deletePreset: (presetId) => set({ savedPresets: deleteRocketPreset(presetId) }),
}));

/** Params with the active weather applied: what the simulation actually flies. */
export const useEffectiveRocketParams = () => {
  const params = useRocketStore((state) => state.params);
  const activeWeather = useRocketStore((state) => state.activeWeather);
  return useMemo(() => applyWeatherToParams(params, activeWeather), [params, activeWeather]);
};
