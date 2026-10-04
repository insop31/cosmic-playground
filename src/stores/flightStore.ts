import { create } from 'zustand';

export interface FlightSample {
  /** Simulated seconds since ignition. */
  t: number;
  altKm: number;
  /** Speed in scene units per second. */
  speed: number;
  /** Dynamic pressure proxy q = ½ρv² (scene units). */
  q: number;
  /** Aerodynamic heating index: 0 none, ~1 severe. */
  heat: number;
}

export type Milestone = 'liftoff' | 'maxq' | 'cutoff' | 'separation' | 'space';

export interface CoachLine {
  id: number;
  t: number;
  text: string;
  tone: 'info' | 'ok' | 'warn' | 'danger';
}

export type RocketStep = 'vehicle' | 'weather' | 'launch';

interface FlightStore {
  /** Seconds left in the pre-launch countdown; null when not counting down. */
  countdown: number | null;
  samples: FlightSample[];
  milestones: Partial<Record<Milestone, { t: number; altKm: number }>>;
  maxQ: { q: number; t: number; altKm: number } | null;
  peakHeat: { heat: number; altKm: number } | null;
  coach: CoachLine[];
  scoreAtLaunch: number;
  showForces: boolean;
  reportOpen: boolean;
  setupStep: RocketStep;
  /** When rewinding to a point, pause once flight time drops to this. */
  rewindUntil: number | null;

  setCountdown: (value: number | null) => void;
  beginFlight: (score: number) => void;
  clear: () => void;
  record: (sample: FlightSample) => void;
  truncateAfter: (t: number) => void;
  markMilestone: (name: Milestone, t: number, altKm: number) => void;
  setMaxQ: (value: FlightStore['maxQ']) => void;
  setPeakHeat: (value: FlightStore['peakHeat']) => void;
  say: (t: number, text: string, tone?: CoachLine['tone']) => void;
  setShowForces: (show: boolean) => void;
  setReportOpen: (open: boolean) => void;
  setSetupStep: (step: RocketStep) => void;
  setRewindUntil: (t: number | null) => void;
}

const MAX_SAMPLES = 1800;
const MAX_COACH_LINES = 12;
let nextCoachId = 1;

/** Everything recorded about the current flight, for the flight director and report. */
export const useFlightStore = create<FlightStore>()((set) => ({
  countdown: null,
  samples: [],
  milestones: {},
  maxQ: null,
  peakHeat: null,
  coach: [],
  scoreAtLaunch: 0,
  showForces: true,
  reportOpen: true,
  setupStep: 'vehicle',
  rewindUntil: null,

  setCountdown: (countdown) => set({ countdown }),
  beginFlight: (scoreAtLaunch) => set({
    samples: [], milestones: {}, maxQ: null, peakHeat: null, coach: [], scoreAtLaunch, reportOpen: true, rewindUntil: null,
  }),
  clear: () => set({ samples: [], milestones: {}, maxQ: null, peakHeat: null, coach: [], countdown: null, rewindUntil: null }),
  record: (sample) => set((state) => {
    const samples = state.samples.length >= MAX_SAMPLES ? state.samples.slice(1) : state.samples.slice();
    samples.push(sample);
    return { samples };
  }),
  truncateAfter: (t) => set((state) => ({
    samples: state.samples.filter((s) => s.t <= t),
    milestones: Object.fromEntries(Object.entries(state.milestones).filter(([, m]) => m!.t <= t)),
    maxQ: state.maxQ && state.maxQ.t <= t ? state.maxQ : null,
    coach: state.coach.filter((line) => line.t <= t),
  })),
  markMilestone: (name, t, altKm) => set((state) => (
    state.milestones[name] ? state : { milestones: { ...state.milestones, [name]: { t, altKm } } }
  )),
  setMaxQ: (maxQ) => set({ maxQ }),
  setPeakHeat: (peakHeat) => set({ peakHeat }),
  say: (t, text, tone = 'info') => set((state) => ({
    coach: [...state.coach, { id: nextCoachId++, t, text, tone }].slice(-MAX_COACH_LINES),
  })),
  setShowForces: (showForces) => set({ showForces }),
  setReportOpen: (reportOpen) => set({ reportOpen }),
  setSetupStep: (setupStep) => set({ setupStep }),
  setRewindUntil: (rewindUntil) => set({ rewindUntil }),
}));
