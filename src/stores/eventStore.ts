import { create } from 'zustand';
import type { AppMode } from '@/lib/challengePacks';

export type EventTone = 'info' | 'ok' | 'warn' | 'danger';

export interface LabEvent {
  id: number;
  mode: AppMode;
  /** Wall-clock time (ms) the event happened. */
  at: number;
  label: string;
  tone: EventTone;
}

const MAX_EVENTS = 60;
let nextId = 1;

interface EventState {
  events: LabEvent[];
  log: (mode: AppMode, label: string, tone?: EventTone) => void;
  clear: (mode: AppMode) => void;
}

/** Recent notable moments in each lab, shown on the temporal HUD's event ribbon. */
export const useEventStore = create<EventState>()((set) => ({
  events: [],
  log: (mode, label, tone = 'info') => set((state) => ({
    events: [...state.events, { id: nextId++, mode, at: Date.now(), label, tone }].slice(-MAX_EVENTS),
  })),
  clear: (mode) => set((state) => ({ events: state.events.filter((event) => event.mode !== mode) })),
}));

export const logLabEvent = (mode: AppMode, label: string, tone?: EventTone) =>
  useEventStore.getState().log(mode, label, tone);
