import type { AppMode } from './challengePacks';

export type UnlockId = 'gravity-slingshot' | 'mars-storm-ascent';

export interface UnlockDefinition {
  id: UnlockId;
  name: string;
  mode: AppMode;
  /** Difficulty tier from the course design: Master or Expert. */
  tier: 'Master' | 'Expert';
  /** Exploration score needed. */
  threshold: number;
  summary: string;
  /** What it adds once unlocked. */
  reward: string;
}

/** Content earned with exploration score (thresholds from the project brief). */
export const UNLOCKS: UnlockDefinition[] = [
  {
    id: 'gravity-slingshot',
    name: 'Gravity Slingshot',
    mode: 'spacetime',
    tier: 'Master',
    threshold: 500,
    summary: 'A comet passes just behind a giant planet and borrows some of its orbital momentum, leaving faster than it arrived.',
    reward: 'New Spacetime system template',
  },
  {
    id: 'mars-storm-ascent',
    name: 'Mars Dust-Storm Ascent',
    mode: 'rocket',
    tier: 'Expert',
    threshold: 750,
    summary: 'Launch from Mars: a third of Earth’s gravity and very thin air, but a dust storm with strong, shifting winds.',
    reward: 'New Rocket Lab scenario',
  },
];

export const isUnlocked = (id: UnlockId, score: number) =>
  score >= (UNLOCKS.find((u) => u.id === id)?.threshold ?? Infinity);
