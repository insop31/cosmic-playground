import { create } from 'zustand';
import type { AppMode } from '@/lib/challengePacks';
import { setMotionOverride } from '@/motion/preference';

export type QualityTier = 'high' | 'medium' | 'low';
export type QualitySetting = 'auto' | QualityTier;
const QUALITY_KEY = 'cosmic-playground.quality';
/** The tier Auto settled on last time, so the next visit starts there. */
const AUTO_TIER_KEY = 'cosmic-playground.autoTier';

/** Sections of the Spacetime tool panel. */
export type LibraryTab = 'bodies' | 'systems' | 'saved';

const INTRO_KEY = 'cosmic-playground.intro-seen';
const DISPLAY_KEY = 'cosmic-playground.display';
const LAST_LAB_KEY = 'cosmic-playground.last-lab';

const readStorage = (key: string) => {
  try {
    return typeof window !== 'undefined' ? window.localStorage.getItem(key) : null;
  } catch {
    return null;
  }
};
const writeStorage = (key: string, value: string) => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage blocked: the intro simply shows again next time.
  }
};

interface DisplayPreferences {
  /** null follows the system's "reduce motion" setting. */
  reduceMotion: boolean | null;
  highContrast: boolean;
}

const readDisplay = (): DisplayPreferences => {
  try {
    const parsed = JSON.parse(readStorage(DISPLAY_KEY) ?? '{}') as Partial<DisplayPreferences>;
    return {
      reduceMotion: typeof parsed.reduceMotion === 'boolean' ? parsed.reduceMotion : null,
      highContrast: parsed.highContrast === true,
    };
  } catch {
    return { reduceMotion: null, highContrast: false };
  }
};

/** Mirror display preferences on <html> (CSS) and in the motion setting (GSAP, 3D). */
const applyDisplay = (display: DisplayPreferences) => {
  setMotionOverride(display.reduceMotion);
  if (typeof document !== 'undefined') document.documentElement.classList.toggle('high-contrast', display.highContrast);
};

const INITIAL_DISPLAY = readDisplay();
applyDisplay(INITIAL_DISPLAY);

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
  missionLogOpen: boolean;
  /** Spacetime conservation graphs expanded. */
  conservationOpen: boolean;
  /** Lab notebook dialog open. */
  notebookOpen: boolean;
  /** Showing the opening sequence (first visit, or replayed). */
  booting: boolean;
  /** Timestamps (ms since page load) of real start-up milestones, for the boot log. */
  readiness: { stage?: number; physics?: number; mesh?: number };
  /** Graphics quality chosen by the user; 'auto' follows measured frame rate. */
  quality: QualitySetting;
  /** Tier picked automatically from frame rate (used when quality is 'auto'). */
  autoTier: QualityTier;
  /** null follows the system's "reduce motion" setting. */
  reduceMotion: boolean | null;
  highContrast: boolean;
  setMode: (mode: AppMode) => void;
  toggleMode: () => void;
  setHudHidden: (hidden: boolean) => void;
  toggleHud: () => void;
  setDockCollapsed: (collapsed: boolean) => void;
  toggleDock: () => void;
  setMissionsCollapsed: (collapsed: boolean) => void;
  toggleMissions: () => void;
  setSpacetimeTab: (tab: LibraryTab) => void;
  setMissionLogOpen: (open: boolean) => void;
  toggleMissionLog: () => void;
  toggleConservation: () => void;
  setNotebookOpen: (open: boolean) => void;
  markReady: (milestone: keyof AppState['readiness']) => void;
  /** Leaves the opening sequence into the chosen lab. */
  finishBoot: (mode: AppMode) => void;
  replayIntro: () => void;
  setQuality: (quality: QualitySetting) => void;
  setAutoTier: (tier: QualityTier) => void;
  setReduceMotion: (value: boolean | null) => void;
  setHighContrast: (value: boolean) => void;
}

export const useAppStore = create<AppState>()((set, get) => ({
  mode: readStorage(LAST_LAB_KEY) === 'rocket' ? 'rocket' : 'spacetime',
  hudHidden: false,
  dockCollapsed: isNarrow(1024),
  missionsCollapsed: isNarrow(1280),
  spacetimeTab: 'bodies',
  missionLogOpen: false,
  conservationOpen: false,
  notebookOpen: false,
  booting: readStorage(INTRO_KEY) !== '1',
  readiness: {},
  quality: (['high', 'medium', 'low'] as const).find((q) => q === readStorage(QUALITY_KEY)) ?? 'auto',
  // Unknown hardware starts on medium; fast machines step up to high within seconds.
  autoTier: (['high', 'medium', 'low'] as const).find((q) => q === readStorage(AUTO_TIER_KEY)) ?? 'medium',
  reduceMotion: INITIAL_DISPLAY.reduceMotion,
  highContrast: INITIAL_DISPLAY.highContrast,
  setMode: (mode) => {
    writeStorage(LAST_LAB_KEY, mode);
    set({ mode });
  },
  toggleMode: () => get().setMode(get().mode === 'spacetime' ? 'rocket' : 'spacetime'),
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
  setMissionLogOpen: (missionLogOpen) => set({ missionLogOpen }),
  toggleMissionLog: () => set((state) => ({ missionLogOpen: !state.missionLogOpen })),
  toggleConservation: () => set((state) => ({ conservationOpen: !state.conservationOpen })),
  setNotebookOpen: (notebookOpen) => set({ notebookOpen }),
  markReady: (milestone) => set((state) => (
    state.readiness[milestone] ? state : { readiness: { ...state.readiness, [milestone]: Math.round(performance.now()) } }
  )),
  finishBoot: (mode) => {
    writeStorage(INTRO_KEY, '1');
    get().setMode(mode);
    set({ booting: false });
  },
  replayIntro: () => set({ booting: true, missionLogOpen: false }),
  setQuality: (quality) => {
    writeStorage(QUALITY_KEY, quality);
    set({ quality });
  },
  setAutoTier: (autoTier) => {
    writeStorage(AUTO_TIER_KEY, autoTier);
    set({ autoTier });
  },
  setReduceMotion: (reduceMotion) => {
    const display = { reduceMotion, highContrast: get().highContrast };
    writeStorage(DISPLAY_KEY, JSON.stringify(display));
    applyDisplay(display);
    set({ reduceMotion });
  },
  setHighContrast: (highContrast) => {
    const display = { reduceMotion: get().reduceMotion, highContrast };
    writeStorage(DISPLAY_KEY, JSON.stringify(display));
    applyDisplay(display);
    set({ highContrast });
  },
}));

/** Scene detail per quality tier (resolution and glow are set in StageCanvas and World). */
export const QUALITY_DETAIL: Record<QualityTier, { stars: number; gridResolution: number; trailPoints: number }> = {
  high: { stars: 4200, gridResolution: 200, trailPoints: 200 },
  medium: { stars: 2800, gridResolution: 160, trailPoints: 140 },
  low: { stars: 1500, gridResolution: 120, trailPoints: 80 },
};

/** The quality tier actually in effect. */
export const useQualityTier = () =>
  useAppStore((state) => (state.quality === 'auto' ? state.autoTier : state.quality));
