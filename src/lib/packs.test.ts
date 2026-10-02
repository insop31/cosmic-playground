import { beforeEach, describe, expect, it } from 'vitest';
import { ALL_MISSIONS, CHALLENGE_PACKS } from './challengePacks';
import { SPACETIME_TEMPLATES } from '../components/space/spacetimeTemplates';
import { DEFAULT_PARAMS } from '../components/rocket/rocketTypes';
import { SIM_STEP, SimulationCore } from '../physics/simulation';
import { SpacetimeMissionTracker } from '../learning/spacetimeMissions';
import { DEFAULT_SETTINGS, QUALITY_PROFILES, applySettingsToDocument, loadSettings, saveSettings } from './settings';

describe('challenge and teacher packs', () => {
  it('give every mission one definition and point teacher packs at real setups', () => {
    const ids = ALL_MISSIONS.map((mission) => mission.id);
    expect(new Set(ids).size).toBe(ids.length);
    const teacherPacks = CHALLENGE_PACKS.filter((pack) => pack.teacher);
    expect(teacherPacks.length).toBeGreaterThanOrEqual(4);
    for (const pack of teacherPacks) {
      expect(pack.teacher!.notes.length).toBeGreaterThan(40);
      if (pack.mode === 'spacetime') {
        expect(SPACETIME_TEMPLATES.some((template) => template.id === pack.teacher!.templateId)).toBe(true);
      } else {
        for (const key of Object.keys(pack.teacher!.rocketSettings ?? {})) expect(key in DEFAULT_PARAMS).toBe(true);
      }
      for (const mission of pack.missions) expect(mission.mode).toBe(pack.mode);
    }
  });

  it('Slingshot Lab sets up a flyby that earns Slingshot Expert', () => {
    const template = SPACETIME_TEMPLATES.find((entry) => entry.id === 'slingshot-lab')!;
    const core = new SimulationCore();
    core.load(template.createBodies().map((body, i) => ({ ...body, id: `b${i}` })), { realistic: true, expansionRate: 0 });
    const tracker = new SpacetimeMissionTracker();
    const typeOf = (id: string) => core.sys.types[core.sys.indexOf(id)];
    const unlocked = new Set<string>();
    while (core.snapshot().simTime < 20) {
      const result = core.tick(SIM_STEP * 8);
      tracker.noteImpacts(result.impacts).forEach((m) => unlocked.add(m));
      tracker.update(core.snapshot(), typeOf).forEach((m) => unlocked.add(m));
    }
    expect(unlocked.has('slingshot-expert')).toBe(true);
  });
});

describe('display settings', () => {
  beforeEach(() => window.localStorage.clear());

  it('round-trips through storage and ignores bad values', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    saveSettings({ quality: 'low', reduceMotion: true, highContrast: true });
    expect(loadSettings()).toEqual({ quality: 'low', reduceMotion: true, highContrast: true });
    window.localStorage.setItem('cosmic-playground.settings', JSON.stringify({ quality: 'ultra', reduceMotion: 'yes' }));
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('lowers the cost of drawing at lower quality and marks the page for CSS', () => {
    expect(QUALITY_PROFILES.low.stars).toBeLessThan(QUALITY_PROFILES.high.stars);
    expect(QUALITY_PROFILES.low.gridResolution).toBeLessThan(QUALITY_PROFILES.high.gridResolution);
    applySettingsToDocument({ quality: 'low', reduceMotion: true, highContrast: true });
    expect(document.documentElement.classList.contains('reduce-motion')).toBe(true);
    expect(document.documentElement.classList.contains('high-contrast')).toBe(true);
    applySettingsToDocument(DEFAULT_SETTINGS);
    expect(document.documentElement.classList.contains('high-contrast')).toBe(false);
  });
});
