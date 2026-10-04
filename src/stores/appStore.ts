import { create } from 'zustand';
import type { AppMode } from '@/lib/challengePacks';

const isNarrow = (maxWidth: number) => typeof window !== 'undefined' && window.innerWidth < maxWidth;

interface AppState {
  mode: AppMode;
  hudHidden: boolean;
  dockCollapsed: boolean;
  missionsCollapsed: boolean;
  setMode: (mode: AppMode) => void;
  toggleMode: () => void;
  setHudHidden: (hidden: boolean) => void;
  toggleHud: () => void;
  setDockCollapsed: (collapsed: boolean) => void;
  toggleDock: () => void;
  setMissionsCollapsed: (collapsed: boolean) => void;
  toggleMissions: () => void;
}

export const useAppStore = create<AppState>()((set) => ({
  mode: 'spacetime',
  hudHidden: false,
  dockCollapsed: isNarrow(1024),
  missionsCollapsed: isNarrow(1280),
  setMode: (mode) => set({ mode }),
  toggleMode: () => set((state) => ({ mode: state.mode === 'spacetime' ? 'rocket' : 'spacetime' })),
  setHudHidden: (hudHidden) => set({ hudHidden }),
  toggleHud: () => set((state) => ({ hudHidden: !state.hudHidden })),
  setDockCollapsed: (dockCollapsed) => set({ dockCollapsed }),
  toggleDock: () => set((state) => ({ dockCollapsed: !state.dockCollapsed })),
  setMissionsCollapsed: (missionsCollapsed) => set({ missionsCollapsed }),
  toggleMissions: () => set((state) => ({ missionsCollapsed: !state.missionsCollapsed })),
}));
