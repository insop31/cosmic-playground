// Display settings: graphics quality for slow school devices, reduced motion and high
// contrast. Stored in the browser and applied as classes on <html> for the CSS side.

export type GraphicsQuality = 'low' | 'medium' | 'high';

export interface DisplaySettings {
  quality: GraphicsQuality;
  /** null follows the operating system's "reduce motion" setting. */
  reduceMotion: boolean | null;
  highContrast: boolean;
}

export interface QualityProfile {
  /** Device-pixel-ratio range handed to the WebGL canvas. */
  dpr: [number, number];
  antialias: boolean;
  gridResolution: number;
  stars: number;
  trailPoints: number;
}

export const QUALITY_PROFILES: Record<GraphicsQuality, QualityProfile> = {
  low: { dpr: [0.75, 1], antialias: false, gridResolution: 80, stars: 1000, trailPoints: 60 },
  medium: { dpr: [1, 1.5], antialias: true, gridResolution: 120, stars: 2000, trailPoints: 120 },
  high: { dpr: [1, 2], antialias: true, gridResolution: 160, stars: 3000, trailPoints: 200 },
};

const SETTINGS_KEY = 'cosmic-playground.settings';

export const DEFAULT_SETTINGS: DisplaySettings = { quality: 'high', reduceMotion: null, highContrast: false };

const isQuality = (value: unknown): value is GraphicsQuality => value === 'low' || value === 'medium' || value === 'high';

export function loadSettings(): DisplaySettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<DisplaySettings>;
    return {
      quality: isQuality(parsed.quality) ? parsed.quality : DEFAULT_SETTINGS.quality,
      reduceMotion: typeof parsed.reduceMotion === 'boolean' ? parsed.reduceMotion : null,
      highContrast: parsed.highContrast === true,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: DisplaySettings) {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage blocked: settings last for this visit only.
  }
}

export const systemPrefersReducedMotion = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Whether animations should be cut back, taking the system setting into account. */
export const motionReduced = (settings: DisplaySettings) => settings.reduceMotion ?? systemPrefersReducedMotion();

/** Reflect the settings on <html> so the stylesheet can follow them. */
export function applySettingsToDocument(settings: DisplaySettings) {
  const root = document.documentElement;
  root.classList.toggle('reduce-motion', settings.reduceMotion === true);
  // An explicit "off" overrides the system preference in CSS too.
  root.classList.toggle('allow-motion', settings.reduceMotion === false);
  root.classList.toggle('high-contrast', settings.highContrast);
}
