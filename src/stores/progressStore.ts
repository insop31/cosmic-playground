import { create } from 'zustand';
import {
  ALL_MISSIONS,
  CHALLENGE_PACKS,
  type AppMode,
  type ChallengePack,
} from '@/lib/challengePacks';
import { UNLOCKS, type UnlockId } from '@/lib/unlocks';

export type MissionId = (typeof ALL_MISSIONS)[number]['id'];
export type MissionCard = { id: MissionId; phase: 'incomplete' | 'complete' };
type MissionQueues = Record<AppMode, MissionCard[]>;

const ACTIVE_MISSION_LIMIT = 3;
const MISSION_EXIT_DELAY_MS = 900;
const MODES: AppMode[] = ['spacetime', 'rocket'];

export const PACKS_BY_MODE: Record<AppMode, ChallengePack[]> = {
  spacetime: CHALLENGE_PACKS.filter((pack) => pack.mode === 'spacetime'),
  rocket: CHALLENGE_PACKS.filter((pack) => pack.mode === 'rocket'),
};

const DEFAULT_PACK_BY_MODE: Record<AppMode, string> = {
  spacetime: PACKS_BY_MODE.spacetime[0].id,
  rocket: PACKS_BY_MODE.rocket[0].id,
};

export const findMission = (id: MissionId) => ALL_MISSIONS.find((mission) => mission.id === id);

export const getActivePack = (mode: AppMode, packId: string) => (
  PACKS_BY_MODE[mode].find((pack) => pack.id === packId) ?? PACKS_BY_MODE[mode][0]
);

const buildMissionCards = (
  pack: ChallengePack,
  achievements: Record<MissionId, boolean>,
  existing: MissionCard[] = [],
) => {
  const cards = [...existing];
  const visibleIds = new Set(cards.map((card) => card.id));
  for (const mission of pack.missions) {
    if (cards.length >= ACTIVE_MISSION_LIMIT) break;
    if (achievements[mission.id] || visibleIds.has(mission.id)) continue;
    cards.push({ id: mission.id, phase: 'incomplete' });
    visibleIds.add(mission.id);
  }
  return cards;
};

const NO_ACHIEVEMENTS = Object.fromEntries(ALL_MISSIONS.map((mission) => [mission.id, false])) as Record<MissionId, boolean>;

// ─── Saved progress (this browser only) ───
const STORAGE_KEY = 'cosmic-playground.progress';

interface SavedProgress {
  version: 1;
  score: number;
  achievements: Record<string, boolean>;
  experimentKeys: string[];
  activePacks: Record<AppMode, string>;
}

const loadProgress = (): SavedProgress | null => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedProgress;
    return parsed?.version === 1 ? parsed : null;
  } catch {
    return null;
  }
};

const saveProgress = (state: Pick<ProgressState, 'score' | 'achievements' | 'experimentKeys' | 'activePacks'>) => {
  try {
    const data: SavedProgress = {
      version: 1,
      score: state.score,
      achievements: state.achievements,
      experimentKeys: [...state.experimentKeys],
      activePacks: state.activePacks,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Storage full or blocked: progress simply isn't kept between visits.
  }
};

const saved = typeof window !== 'undefined' ? loadProgress() : null;
const INITIAL_ACHIEVEMENTS = { ...NO_ACHIEVEMENTS, ...(saved?.achievements ?? {}) } as Record<MissionId, boolean>;
const INITIAL_PACKS = { ...DEFAULT_PACK_BY_MODE, ...(saved?.activePacks ?? {}) };

// Pending "complete card leaves the queue" timers, keyed by mission.
const removalTimers: Partial<Record<MissionId, number>> = {};

interface ProgressState {
  score: number;
  achievements: Record<MissionId, boolean>;
  activePacks: Record<AppMode, string>;
  missionQueues: MissionQueues;
  /** Distinct experiment keys seen so far; each awards points once. */
  experimentKeys: ReadonlySet<string>;
  /** Most recent objective completion, shown briefly in the context banner. */
  lastCompleted: { id: MissionId; at: number } | null;
  /** Most recent content unlock (score crossed a threshold). */
  lastUnlock: { id: UnlockId; at: number } | null;
  awardScore: (points: number) => void;
  unlock: (id: MissionId) => void;
  registerExperiment: (key: string, points?: number) => void;
  setActivePack: (mode: AppMode, packId: string) => void;
  /** Clears score, objectives and experiments (here and in saved progress). */
  resetProgress: () => void;
}

export const useProgressStore = create<ProgressState>()((set, get) => {
  /**
   * Keeps each mode's visible mission cards in step with achievements: newly
   * completed cards flip to 'complete', then leave after a short delay so the
   * completion is visible, and the next mission in the pack takes their place.
   */
  const syncQueues = () => {
    const { activePacks, achievements, missionQueues } = get();
    const next = { ...missionQueues };
    for (const mode of MODES) {
      next[mode] = buildMissionCards(getActivePack(mode, activePacks[mode]), achievements, missionQueues[mode])
        .map((card) => {
          if (!achievements[card.id] || card.phase === 'complete') return card;
          if (!removalTimers[card.id]) {
            removalTimers[card.id] = window.setTimeout(() => {
              delete removalTimers[card.id];
              const current = get();
              set({
                missionQueues: {
                  ...current.missionQueues,
                  [mode]: buildMissionCards(
                    getActivePack(mode, current.activePacks[mode]),
                    current.achievements,
                    current.missionQueues[mode].filter((entry) => entry.id !== card.id),
                  ),
                },
              });
            }, MISSION_EXIT_DELAY_MS);
          }
          return { ...card, phase: 'complete' as const };
        });
    }
    set({ missionQueues: next });
  };

  return {
    score: saved?.score ?? 0,
    achievements: INITIAL_ACHIEVEMENTS,
    activePacks: INITIAL_PACKS,
    missionQueues: {
      spacetime: buildMissionCards(getActivePack('spacetime', INITIAL_PACKS.spacetime), INITIAL_ACHIEVEMENTS),
      rocket: buildMissionCards(getActivePack('rocket', INITIAL_PACKS.rocket), INITIAL_ACHIEVEMENTS),
    },
    experimentKeys: new Set<string>(saved?.experimentKeys ?? []),
    lastCompleted: null,
    lastUnlock: null,

    awardScore: (points) => set((state) => ({ score: state.score + points })),

    unlock: (id) => {
      const { achievements } = get();
      if (achievements[id]) return;
      const mission = findMission(id);
      set((state) => ({
        achievements: { ...state.achievements, [id]: true },
        score: state.score + (mission?.score ?? 0),
        lastCompleted: { id, at: Date.now() },
      }));
      syncQueues();
    },

    registerExperiment: (key, points = 12) => {
      const { experimentKeys } = get();
      if (experimentKeys.has(key)) return;
      const nextKeys = new Set(experimentKeys).add(key);
      set((state) => ({ experimentKeys: nextKeys, score: state.score + points }));
    },

    setActivePack: (mode, packId) => {
      set((state) => ({
        activePacks: { ...state.activePacks, [mode]: packId },
        missionQueues: {
          ...state.missionQueues,
          [mode]: buildMissionCards(getActivePack(mode, packId), state.achievements),
        },
      }));
      syncQueues();
    },

    resetProgress: () => {
      Object.values(removalTimers).forEach((timer) => window.clearTimeout(timer));
      for (const key of Object.keys(removalTimers)) delete removalTimers[key as MissionId];
      set((state) => ({
        score: 0,
        achievements: NO_ACHIEVEMENTS,
        experimentKeys: new Set<string>(),
        lastCompleted: null,
        lastUnlock: null,
        missionQueues: {
          spacetime: buildMissionCards(getActivePack('spacetime', state.activePacks.spacetime), NO_ACHIEVEMENTS),
          rocket: buildMissionCards(getActivePack('rocket', state.activePacks.rocket), NO_ACHIEVEMENTS),
        },
      }));
    },
  };
});

// Save progress whenever it changes, and announce unlocks as the score crosses thresholds.
useProgressStore.subscribe((state, prev) => {
  if (state.score !== prev.score || state.achievements !== prev.achievements
    || state.experimentKeys !== prev.experimentKeys || state.activePacks !== prev.activePacks) {
    saveProgress(state);
  }
  if (state.score > prev.score) {
    const crossed = UNLOCKS.find((u) => prev.score < u.threshold && state.score >= u.threshold);
    if (crossed) useProgressStore.setState({ lastUnlock: { id: crossed.id, at: Date.now() } });
  }
});

const isRocketExperiment = (key: string) => key.startsWith('rocket:') || key.startsWith('rocket-profile:');

/** Number of distinct experiments run in the given lab. */
export const useExperimentCount = (mode: AppMode) =>
  useProgressStore((state) => {
    let count = 0;
    state.experimentKeys.forEach((key) => {
      if (isRocketExperiment(key) === (mode === 'rocket')) count += 1;
    });
    return count;
  });
