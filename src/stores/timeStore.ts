import { create } from 'zustand';
import { stepSpeed } from '@/hud/timeSteps';

interface TimeState {
  /** Signed simulation speed: negative rewinds (−4 … −0.5, 0.5 … 4). */
  timeScale: number;
  isPlaying: boolean;
  setTimeScale: (timeScale: number) => void;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  /** One speed step toward rewind (−1) or fast-forward (+1); also resumes playback. */
  step: (direction: -1 | 1) => void;
  /** Back to real-time playback. */
  resetClock: () => void;
}

export const useTimeStore = create<TimeState>()((set) => ({
  timeScale: 1,
  isPlaying: true,
  setTimeScale: (timeScale) => set({ timeScale }),
  play: () => set({ isPlaying: true }),
  pause: () => set({ isPlaying: false }),
  togglePlay: () => set((state) => ({ isPlaying: !state.isPlaying })),
  step: (direction) => set((state) => ({ timeScale: stepSpeed(state.timeScale, direction), isPlaying: true })),
  resetClock: () => set({ timeScale: 1, isPlaying: true }),
}));

/** Speed actually fed to the simulations: carries sign, 0 while paused. */
export const useEffectiveTimeScale = () =>
  useTimeStore((state) => (state.isPlaying ? state.timeScale : 0));
