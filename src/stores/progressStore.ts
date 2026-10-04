import { create } from 'zustand';
import { toast } from 'sonner';
import {
  ALL_MISSIONS,
  CHALLENGE_PACKS,
  type AppMode,
  type ChallengePack,
} from '@/lib/challengePacks';

export type MissionId = (typeof ALL_MISSIONS)[number]['id'];
export type MissionCard = { id: MissionId; phase: 'incomplete' | 'complete' };
type MissionQueues = Record<AppMode, MissionCard[]>;

const ACTIVE_MISSION_LIMIT = 3;
const MISSION_EXIT_DELAY_MS = 900;
const GRAVITY_MASTER_EXPERIMENTS = 8;
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

// Pending "complete card leaves the queue" timers, keyed by mission.
const removalTimers: Partial<Record<MissionId, number>> = {};

interface ProgressState {
  score: number;
  achievements: Record<MissionId, boolean>;
  activePacks: Record<AppMode, string>;
  missionQueues: MissionQueues;
  /** Distinct experiment keys seen so far; each awards points once. */
  experimentKeys: ReadonlySet<string>;
  awardScore: (points: number) => void;
  unlock: (id: MissionId) => void;
  registerExperiment: (key: string, points?: number) => void;
  setActivePack: (mode: AppMode, packId: string) => void;
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
    score: 0,
    achievements: NO_ACHIEVEMENTS,
    activePacks: DEFAULT_PACK_BY_MODE,
    missionQueues: {
      spacetime: buildMissionCards(getActivePack('spacetime', DEFAULT_PACK_BY_MODE.spacetime), NO_ACHIEVEMENTS),
      rocket: buildMissionCards(getActivePack('rocket', DEFAULT_PACK_BY_MODE.rocket), NO_ACHIEVEMENTS),
    },
    experimentKeys: new Set<string>(),

    awardScore: (points) => set((state) => ({ score: state.score + points })),

    unlock: (id) => {
      const { achievements } = get();
      if (achievements[id]) return;
      const mission = findMission(id);
      set((state) => ({
        achievements: { ...state.achievements, [id]: true },
        score: state.score + (mission?.score ?? 0),
      }));
      if (mission) {
        toast.success(`Objective complete · ${mission.name}`, { description: `+${mission.score} points` });
      }
      syncQueues();
    },

    registerExperiment: (key, points = 12) => {
      const { experimentKeys } = get();
      if (experimentKeys.has(key)) return;
      const nextKeys = new Set(experimentKeys).add(key);
      set((state) => ({ experimentKeys: nextKeys, score: state.score + points }));
      if (nextKeys.size >= GRAVITY_MASTER_EXPERIMENTS) get().unlock('gravity-master');
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
  };
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
