/**
 * Reduced motion: follows the operating system's setting unless the user
 * overrides it in Help and settings. Read by the GSAP setup, the 3D scenes
 * (camera shake, star twinkle) and mirrored as classes on <html> for CSS.
 */
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

let override: boolean | null = null;
const listeners = new Set<() => void>();

export const systemPrefersReducedMotion = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_MOTION_QUERY).matches;

/** Whether motion should be cut back right now. */
export const reducedMotion = () => override ?? systemPrefersReducedMotion();

const notify = () => {
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    root.classList.toggle('reduce-motion', override === true);
    // An explicit "off" overrides the system preference in CSS too.
    root.classList.toggle('allow-motion', override === false);
  }
  listeners.forEach((fn) => fn());
};

/** null follows the system; true or false overrides it. */
export const setMotionOverride = (value: boolean | null) => {
  override = value;
  notify();
};

export const onMotionChange = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  window.matchMedia(REDUCED_MOTION_QUERY).addEventListener?.('change', notify);
}
