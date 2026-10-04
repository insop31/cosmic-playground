import { create } from 'zustand';
import type { AppMode } from '@/lib/challengePacks';

/** Sections of the Spacetime tool panel. */
export type LibraryTab = 'bodies' | 'systems' | 'saved';

const isNarrow = (maxWidth: number) => typeof window !== 'undefined' && window.innerWidth < maxWidth;

/**
 * Below this width the tool panel and the objectives panel can't both be open
 * without squeezing the centre column, so opening one closes the other.
 */
const SIDE_PANELS_EXCLUSIVE_BELOW = 1280;

interface AppState {
  mode: AppMode;
  hudHidden: boolean;
  dockCollapsed: boolean;
  missionsCollapsed: boolean;
  /** Section shown in the Spacetime tool panel. */
  spacetimeTab: LibraryTab;
  setMode: (mode: AppMode) => void;
  toggleMode: () => void;
  setHudHidden: (hidden: boolean) => void;
  toggleHud: () => void;
  setDockCollapsed: (collapsed: boolean) => void;
  toggleDock: () => void;
  setMissionsCollapsed: (collapsed: boolean) => void;
  toggleMissions: () => void;
  setSpacetimeTab: (tab: LibraryTab) => void;
}

export const useAppStore = create<AppState>()((set, get) => ({
  mode: 'spacetime',
  hudHidden: false,
  dockCollapsed: isNarrow(1024),
  missionsCollapsed: isNarrow(1280),
  spacetimeTab: 'bodies',
  setMode: (mode) => set({ mode }),
  toggleMode: () => set((state) => ({ mode: state.mode === 'spacetime' ? 'rocket' : 'spacetime' })),
  setHudHidden: (hudHidden) => set({ hudHidden }),
  toggleHud: () => set((state) => ({ hudHidden: !state.hudHidden })),
  setDockCollapsed: (dockCollapsed) => set((state) => ({
    dockCollapsed,
    missionsCollapsed: !dockCollapsed && isNarrow(SIDE_PANELS_EXCLUSIVE_BELOW) ? true : state.missionsCollapsed,
  })),
  toggleDock: () => get().setDockCollapsed(!get().dockCollapsed),
  setMissionsCollapsed: (missionsCollapsed) => set((state) => ({
    missionsCollapsed,
    dockCollapsed: !missionsCollapsed && isNarrow(SIDE_PANELS_EXCLUSIVE_BELOW) ? true : state.dockCollapsed,
  })),
  toggleMissions: () => get().setMissionsCollapsed(!get().missionsCollapsed),
  setSpacetimeTab: (spacetimeTab) => set({ spacetimeTab }),
}));
