import { useCallback, useEffect, useRef, useState } from 'react';
import { gsap, prefersReducedMotion, useGSAP } from '@/motion/gsap';
import { useAppStore } from '@/stores/appStore';
import { useFlightStore } from '@/stores/flightStore';
import { useRocketStore } from '@/stores/rocketStore';
import { useTimeStore } from '@/stores/timeStore';
import { Kbd } from './controls';

/**
 * Pre-launch countdown. The camera frames the engines meanwhile
 * (CinematicCamera reads the countdown); at zero the flight starts and the
 * setup panel tucks away so the view is clear. Enter or a click skips ahead.
 */
const Countdown = () => {
  const countdown = useFlightStore((state) => state.countdown);
  const setCountdown = useFlightStore((state) => state.setCountdown);
  const [shown, setShown] = useState<number | null>(null);
  const digitRef = useRef<HTMLDivElement>(null);

  const liftoff = useCallback(() => {
    setCountdown(null);
    setShown(null);
    useTimeStore.getState().resetClock();
    useRocketStore.getState().launch();
    useAppStore.getState().setDockCollapsed(true);
  }, [setCountdown]);

  useEffect(() => {
    if (countdown === null) {
      setShown(null);
      return undefined;
    }
    // Plain timers, not GSAP: the countdown is timing, so it must not be
    // shortened by the reduced-motion setting.
    let n = countdown;
    setShown(n);
    const id = window.setInterval(() => {
      n -= 1;
      if (n <= 0) {
        window.clearInterval(id);
        liftoff();
      } else {
        setShown(n);
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [countdown, liftoff]);

  useGSAP(() => {
    if (shown === null || !digitRef.current || prefersReducedMotion()) return;
    gsap.fromTo(digitRef.current, { scale: 1.25, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.35, ease: 'power3.out' });
  }, { dependencies: [shown] });

  useEffect(() => {
    if (countdown === null) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Enter') { event.preventDefault(); liftoff(); }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setCountdown(null); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [countdown, liftoff, setCountdown]);

  if (countdown === null || shown === null) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
      <button
        type="button"
        onClick={liftoff}
        className="pointer-events-auto grid place-items-center gap-2 rounded-lg px-10 py-6 text-center focus-visible:outline-none"
        aria-label={`Launch in ${shown}. Activate to launch now.`}
      >
        <span className="hud-label text-[11px] text-hud-dim">T minus</span>
        <div ref={digitRef} className="hud-num font-display text-[88px] leading-none text-foreground [text-shadow:0_0_40px_hsl(var(--primary)/0.35)]" aria-live="assertive">
          {shown}
        </div>
        <span className="flex items-center gap-1.5 text-[12px] text-hud-dim">
          <Kbd>Enter</Kbd> launch now · <Kbd>Esc</Kbd> hold
        </span>
      </button>
    </div>
  );
};

export default Countdown;
