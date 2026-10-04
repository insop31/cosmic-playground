import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '@/worlds/rocket/rocketTypes';
import {
  deleteRocketPreset,
  deleteSpacetimeScenario,
  listSavedRocketPresets,
  listSavedSpacetimeScenarios,
  saveRocketPreset,
  saveSpacetimeScenario,
} from './scenarioStorage';

const body = {
  id: 'earth',
  name: 'Earth',
  type: 'planet',
  position: [8, 0, 0] as [number, number, number],
  velocity: [0, 0, 1.1] as [number, number, number],
  mass: 5.97e24,
  radius: 0.45,
  color: '#5b9ee8',
};

describe('scenario storage', () => {
  beforeEach(() => window.localStorage.clear());

  it('saves, lists and deletes spacetime scenarios', () => {
    const saved = saveSpacetimeScenario({ name: '  Inner system  ', bodies: [body], placementVelocityScale: 1.2, realisticMode: false });
    expect(saved).toHaveLength(1);
    expect(saved[0].name).toBe('Inner system');
    expect(listSavedSpacetimeScenarios()[0].bodies[0].velocity).toEqual([0, 0, 1.1]);
    expect(deleteSpacetimeScenario(saved[0].id)).toHaveLength(0);
  });

  it('keeps at most 12 items, newest first', () => {
    for (let i = 0; i < 15; i++) saveRocketPreset({ name: `Preset ${i}`, params: DEFAULT_PARAMS });
    const presets = listSavedRocketPresets();
    expect(presets).toHaveLength(12);
    deleteRocketPreset(presets[0].id);
    expect(listSavedRocketPresets()).toHaveLength(11);
  });

  it('ignores corrupted storage', () => {
    window.localStorage.setItem('cosmic-playground.rocket-presets', '{not json');
    expect(listSavedRocketPresets()).toEqual([]);
  });
});
