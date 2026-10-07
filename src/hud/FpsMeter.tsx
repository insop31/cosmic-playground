import { memo, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { useAppStore, useQualityTier } from '@/stores/appStore';

const SAMPLE_MS = 500;

const TONE = {
  ok: 'text-ok',
  warn: 'text-warn',
  danger: 'text-danger',
} as const;

const toneFor = (fps: number): keyof typeof TONE => (fps >= 50 ? 'ok' : fps >= 30 ? 'warn' : 'danger');

const TIER_LABEL = { high: 'High', medium: 'Medium', low: 'Low' } as const;
const TIER_SHORT = { high: 'Hi', medium: 'Med', low: 'Lo' } as const;

/**
 * Frames per second, counted from the browser's own animation frames (so it shows
 * what the screen actually gets, GPU included). It writes to the DOM directly twice
 * a second instead of re-rendering, so measuring costs nothing noticeable.
 */
const FpsMeter = () => {
  const valueRef = useRef<HTMLSpanElement>(null);
  const tier = useQualityTier();
  const auto = useAppStore((state) => state.quality === 'auto');

  useEffect(() => {
    let frames = 0;
    let start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      frames += 1;
      const elapsed = now - start;
      if (elapsed >= SAMPLE_MS) {
        const fps = Math.round((frames * 1000) / elapsed);
        const el = valueRef.current;
        if (el) {
          el.textContent = String(fps);
          el.className = cn('hud-num text-[13px] font-medium', TONE[toneFor(fps)]);
        }
        frames = 0;
        start = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    // A hidden tab gets no frames; start a fresh window when it comes back.
    const onVisibility = () => {
      frames = 0;
      start = performance.now();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return (
    <div
      className="grid w-11 min-w-0 leading-tight"
      title={`Frames per second. Graphics quality: ${TIER_LABEL[tier]}${auto ? ' (auto)' : ''}. Change it in Help and settings.`}
      data-testid="fps-meter"
    >
      <span className="hud-label text-[9.5px]">FPS</span>
      <span className="truncate whitespace-nowrap">
        <span ref={valueRef} className="hud-num text-[13px] font-medium text-foreground" aria-label="Frames per second">–</span>
        <span className="ml-0.5 font-mono text-[9.5px] uppercase text-hud-dim">{TIER_SHORT[tier]}</span>
      </span>
    </div>
  );
};

export default memo(FpsMeter);
