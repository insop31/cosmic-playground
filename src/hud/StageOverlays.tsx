import { useRef } from 'react';
import { gsap, prefersReducedMotion, useGSAP } from '@/motion/gsap';
import { useAppStore } from '@/stores/appStore';
import { useTimeStore } from '@/stores/timeStore';

/**
 * Stasis field: while the simulation is paused the scene desaturates behind a
 * single expanding ring, so "paused" reads at a glance without covering
 * anything. Sits between the canvas and the HUD.
 */
export const StasisField = () => {
  const isPlaying = useTimeStore((state) => state.isPlaying);
  const veilRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    const paused = !isPlaying;
    gsap.to(veilRef.current, { autoAlpha: paused ? 1 : 0, duration: paused ? 0.5 : 0.3 });
    if (paused && !prefersReducedMotion()) {
      gsap.fromTo(
        ringRef.current,
        { scale: 0.15, autoAlpha: 0.9 },
        { scale: 1.6, autoAlpha: 0, duration: 1.1, ease: 'power2.out' },
      );
    }
  }, { dependencies: [isPlaying] });

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-[5] overflow-hidden">
      <div
        ref={veilRef}
        className="invisible absolute inset-0 opacity-0 [backdrop-filter:saturate(0.35)_brightness(0.85)] [box-shadow:inset_0_0_0_1px_hsl(var(--warn)/0.35),inset_0_0_120px_hsl(var(--warn)/0.08)]"
      />
      <div
        ref={ringRef}
        className="invisible absolute left-1/2 top-1/2 aspect-square w-[min(90vw,90vh)] -translate-x-1/2 -translate-y-1/2 rounded-full border border-warn/50 opacity-0"
      />
    </div>
  );
};

/**
 * Switching labs swaps the rendered world instantly; this veil turns that hard
 * cut into a short dip through deep space.
 */
export const LabTransition = () => {
  const mode = useAppStore((state) => state.mode);
  const veilRef = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);

  useGSAP(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (prefersReducedMotion()) return;
    gsap.fromTo(veilRef.current, { autoAlpha: 0.9 }, { autoAlpha: 0, duration: 0.6, ease: 'power2.out' });
  }, { dependencies: [mode] });

  return <div ref={veilRef} aria-hidden className="pointer-events-none invisible absolute inset-0 z-[9] bg-background opacity-0" />;
};
