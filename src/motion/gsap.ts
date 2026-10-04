import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import { CustomEase } from 'gsap/CustomEase';
import { DrawSVGPlugin } from 'gsap/DrawSVGPlugin';
import { Flip } from 'gsap/Flip';
import { ScrambleTextPlugin } from 'gsap/ScrambleTextPlugin';
import { SplitText } from 'gsap/SplitText';
import { TextPlugin } from 'gsap/TextPlugin';

// Register every plugin once, here. Components import gsap from this module
// (never from 'gsap' directly) so registration always happens first.
gsap.registerPlugin(useGSAP, CustomEase, DrawSVGPlugin, Flip, ScrambleTextPlugin, SplitText, TextPlugin);

/**
 * Named eases for the whole app. Keep motion vocabulary small:
 * - `hud`     panels and readouts settling into place
 * - `camera`  long camera flights (slow in, slow out)
 * - `snap`    small confirmations (toggles, chips)
 * - `fall`    detached objects accelerating away (stage separation)
 */
CustomEase.create('hud', '0.2, 0.8, 0.2, 1');
CustomEase.create('camera', '0.65, 0, 0.35, 1');
CustomEase.create('snap', '0.3, 1.3, 0.5, 1');
CustomEase.create('fall', '0.55, 0, 1, 0.45');

/** Shared durations in seconds, mirrored by --dur-* in index.css. */
export const DUR = {
  fast: 0.14,
  med: 0.22,
  slow: 0.6,
  camera: 1.1,
} as const;

gsap.defaults({ ease: 'hud', duration: DUR.med });

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia(REDUCED_MOTION_QUERY).matches;

/**
 * Duration helper for choreographed moments: returns 0 under reduced motion
 * so the tween resolves to its end state immediately (a cut instead of a flight).
 */
export const motionDuration = (seconds: number) => (prefersReducedMotion() ? 0 : seconds);

/**
 * Reduced motion: every GSAP tween and timeline completes (almost) instantly,
 * so camera flights become cuts and entrances simply appear. Callbacks still
 * fire, so nothing that depends on a tween finishing is skipped. Follows the
 * system setting live.
 */
if (typeof window !== 'undefined') {
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  const apply = () => gsap.globalTimeline.timeScale(query.matches ? 1000 : 1);
  apply();
  query.addEventListener('change', apply);
}

export { gsap, useGSAP, CustomEase, DrawSVGPlugin, Flip, ScrambleTextPlugin, SplitText, TextPlugin };
