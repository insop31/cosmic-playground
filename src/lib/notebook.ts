// Lab notebook: every rocket launch is written down with its settings, outcome and cause,
// so students can compare runs side by side. Stored in the browser; newest first.
import type { LaunchOutcome, RocketParams } from '../components/rocket/rocketTypes';

const NOTEBOOK_KEY = 'cosmic-playground.notebook';
export const MAX_NOTEBOOK_ENTRIES = 50;

export interface NotebookEntry {
  id: string;
  createdAt: string;
  outcome: Exclude<LaunchOutcome, 'none'>;
  /** What the student expected before launching, if they made a prediction. */
  prediction: LaunchOutcome | null;
  params: RocketParams;
  weather: string[];
  metrics: {
    deltaV: number;
    peakAltitude: number;
    maxQ: number;
    heat: number;
    flightTime: number;
  };
  /** The debrief's main cause, in one sentence. */
  cause: string;
}

const canUseStorage = () => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

export function listNotebook(): NotebookEntry[] {
  if (!canUseStorage()) return [];
  try {
    const raw = window.localStorage.getItem(NOTEBOOK_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const write = (entries: NotebookEntry[]) => {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(NOTEBOOK_KEY, JSON.stringify(entries));
  } catch {
    // Storage full or blocked: the notebook just isn't kept between visits.
  }
};

export function addNotebookEntry(entry: Omit<NotebookEntry, 'id' | 'createdAt'>): NotebookEntry[] {
  const full: NotebookEntry = {
    ...entry,
    id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    createdAt: new Date().toISOString(),
  };
  const next = [full, ...listNotebook()].slice(0, MAX_NOTEBOOK_ENTRIES);
  write(next);
  return next;
}

export function clearNotebook(): NotebookEntry[] {
  write([]);
  return [];
}

/** Settings that differ between two runs, for the comparison view. */
export function differingParams(a: RocketParams, b: RocketParams): (keyof RocketParams)[] {
  return (Object.keys(a) as (keyof RocketParams)[]).filter((key) => a[key] !== b[key]);
}
