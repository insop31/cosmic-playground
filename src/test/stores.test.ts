import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '@/stores/appStore';
import { useEventStore } from '@/stores/eventStore';
import { useProgressStore } from '@/stores/progressStore';
import { useSpacetimeStore } from '@/stores/spacetimeStore';
import { useTimeStore } from '@/stores/timeStore';

const initial = {
  app: useAppStore.getState(),
  progress: useProgressStore.getState(),
  spacetime: useSpacetimeStore.getState(),
  time: useTimeStore.getState(),
};

const setWindowWidth = (width: number) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
};

// Objective cards leave the queue on a timer; fake timers keep tests isolated.
beforeEach(() => {
  vi.useFakeTimers();
  useAppStore.setState(initial.app, true);
  useProgressStore.setState(initial.progress, true);
  useSpacetimeStore.setState(initial.spacetime, true);
  useTimeStore.setState(initial.time, true);
  useEventStore.setState({ events: [] });
  setWindowWidth(1440);
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe('progress store', () => {
  it('awards each distinct experiment once', () => {
    const { registerExperiment } = useProgressStore.getState();
    registerExperiment('a', 12);
    registerExperiment('a', 12);
    registerExperiment('b', 5);
    expect(useProgressStore.getState().score).toBe(17);
    expect(useProgressStore.getState().experimentKeys.size).toBe(2);
  });

  it('unlocks Gravity Master after eight distinct experiments', () => {
    const { registerExperiment } = useProgressStore.getState();
    for (let i = 0; i < 8; i += 1) registerExperiment(`exp-${i}`, 0);
    expect(useProgressStore.getState().achievements['gravity-master']).toBe(true);
    expect(useProgressStore.getState().score).toBe(140);
  });

  it('scores an objective only the first time it is unlocked', () => {
    const { unlock } = useProgressStore.getState();
    unlock('time-bender');
    unlock('time-bender');
    expect(useProgressStore.getState().score).toBe(90);
  });

  it('replaces a completed objective card with the next one after a delay', () => {
    useProgressStore.getState().unlock('gravity-master');
    const queue = () => useProgressStore.getState().missionQueues.spacetime;
    expect(queue().find((card) => card.id === 'gravity-master')?.phase).toBe('complete');
    vi.advanceTimersByTime(1000);
    expect(queue().some((card) => card.id === 'gravity-master')).toBe(false);
    expect(queue().map((card) => card.id)).toContain('mode-shifter');
  });
});

describe('spacetime store', () => {
  it('pushes a new body out of an existing body’s safety radius', () => {
    const store = useSpacetimeStore.getState();
    store.beginPlacement({ type: 'planet', name: 'Test', position: [0, 0, 0], mass: 1e24, radius: 0.4, color: '#fff' });
    store.placeOnGrid([0.5, 0, 0]); // right on top of the Sun
    const placed = useSpacetimeStore.getState().bodies.at(-1)!;
    const sun = useSpacetimeStore.getState().bodies.find((body) => body.id === 'sun')!;
    const distance = Math.hypot(placed.position[0] - sun.position[0], placed.position[2] - sun.position[2]);
    expect(distance).toBeGreaterThanOrEqual((sun.radius + 0.4) * 2.5 + 2 - 1e-9);
    expect(useSpacetimeStore.getState().pendingPlacement).toBeNull();
  });

  it('gives a placed body a tangential (orbital) velocity', () => {
    const store = useSpacetimeStore.getState();
    store.beginPlacement({ type: 'planet', name: 'Test', position: [0, 0, 0], mass: 1e24, radius: 0.3, color: '#fff' });
    store.placeOnGrid([20, 0, 0]);
    const placed = useSpacetimeStore.getState().bodies.at(-1)!;
    const [vx, , vz] = placed.velocity!;
    // Radial direction is +x, so the velocity must be (almost) purely along z.
    expect(Math.abs(vx)).toBeLessThan(1e-9);
    expect(Math.abs(vz)).toBeGreaterThan(0);
  });

  it('logs placement on the event ribbon', () => {
    const store = useSpacetimeStore.getState();
    store.beginPlacement({ type: 'comet', position: [0, 0, 0], mass: 1e13, radius: 0.2, color: '#fff' });
    store.placeOnGrid([30, 0, 0]);
    expect(useEventStore.getState().events.at(-1)?.label).toBe('Placed comet');
  });

  it('resets the clock when a template is applied', () => {
    useTimeStore.setState({ timeScale: -2, isPlaying: false });
    useSpacetimeStore.getState().applyTemplate('binary-waltz');
    expect(useTimeStore.getState()).toMatchObject({ timeScale: 1, isPlaying: true });
  });
});

describe('app store layout rules', () => {
  it('keeps both side panels open on wide screens', () => {
    useAppStore.setState({ dockCollapsed: true, missionsCollapsed: true });
    useAppStore.getState().setDockCollapsed(false);
    useAppStore.getState().setMissionsCollapsed(false);
    expect(useAppStore.getState()).toMatchObject({ dockCollapsed: false, missionsCollapsed: false });
  });

  it('lets only one side panel be open below 1280px', () => {
    setWindowWidth(1024);
    useAppStore.setState({ dockCollapsed: false, missionsCollapsed: true });
    useAppStore.getState().toggleMissions();
    expect(useAppStore.getState()).toMatchObject({ dockCollapsed: true, missionsCollapsed: false });
    useAppStore.getState().toggleDock();
    expect(useAppStore.getState()).toMatchObject({ dockCollapsed: false, missionsCollapsed: true });
  });
});

describe('progress persistence and unlocks', () => {
  it('saves score and objectives to this browser', () => {
    useProgressStore.getState().unlock('time-bender');
    const saved = JSON.parse(window.localStorage.getItem('cosmic-playground.progress')!);
    expect(saved.score).toBe(90);
    expect(saved.achievements['time-bender']).toBe(true);
  });

  it('announces an unlock when the score crosses its threshold', () => {
    useProgressStore.setState({ score: 480, lastUnlock: null });
    useProgressStore.getState().awardScore(30);
    expect(useProgressStore.getState().lastUnlock?.id).toBe('gravity-slingshot');
  });

  it('refuses a locked template until the score allows it', () => {
    useProgressStore.setState({ score: 0 });
    const before = useSpacetimeStore.getState().bodies;
    useSpacetimeStore.getState().applyTemplate('gravity-slingshot');
    expect(useSpacetimeStore.getState().bodies).toBe(before);
    useProgressStore.setState({ score: 500 });
    useSpacetimeStore.getState().applyTemplate('gravity-slingshot');
    expect(useSpacetimeStore.getState().bodies.map((b) => b.name)).toEqual(['Sun', 'Goliath', 'Comet']);
  });

  it('clears everything on reset', () => {
    useProgressStore.getState().unlock('time-bender');
    useProgressStore.getState().resetProgress();
    expect(useProgressStore.getState().score).toBe(0);
    expect(useProgressStore.getState().achievements['time-bender']).toBe(false);
  });
});
