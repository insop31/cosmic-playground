import { beforeEach, describe, expect, it } from 'vitest';
import { ALL_MISSIONS, CHALLENGE_PACKS } from './challengePacks';
import { SPACETIME_TEMPLATES } from '@/worlds/spacetime/spacetimeTemplates';
import { DEFAULT_PARAMS } from '@/worlds/rocket/rocketTypes';
import { SIM_STEP, SimulationCore } from '../physics/simulation';
import { SpacetimeMissionTracker } from '../learning/spacetimeMissions';

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

describe('display preferences', () => {
  beforeEach(() => window.localStorage.clear());

  it('saves reduced motion and high contrast and marks the page for CSS', async () => {
    const { useAppStore, QUALITY_DETAIL } = await import('@/stores/appStore');
    const { reducedMotion } = await import('@/motion/preference');
    useAppStore.getState().setReduceMotion(true);
    useAppStore.getState().setHighContrast(true);
    expect(reducedMotion()).toBe(true);
    expect(document.documentElement.classList.contains('reduce-motion')).toBe(true);
    expect(document.documentElement.classList.contains('high-contrast')).toBe(true);
    expect(JSON.parse(window.localStorage.getItem('cosmic-playground.display')!)).toEqual({ reduceMotion: true, highContrast: true });
    useAppStore.getState().setReduceMotion(false);
    expect(document.documentElement.classList.contains('allow-motion')).toBe(true);
    useAppStore.getState().setReduceMotion(null);
    useAppStore.getState().setHighContrast(false);
    expect(document.documentElement.classList.contains('high-contrast')).toBe(false);
    expect(QUALITY_DETAIL.low.stars).toBeLessThan(QUALITY_DETAIL.high.stars);
    expect(QUALITY_DETAIL.low.trailPoints).toBeLessThan(QUALITY_DETAIL.high.trailPoints);
  });
});
