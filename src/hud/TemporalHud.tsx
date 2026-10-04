import { memo, useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { FastForward, Pause, Play, Rewind, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { gsap, useGSAP } from '@/motion/gsap';
import { useAppStore } from '@/stores/appStore';
import { useEventStore, type EventTone, type LabEvent } from '@/stores/eventStore';
import { useRocketStore } from '@/stores/rocketStore';
import { useTimeStore } from '@/stores/timeStore';
import { IconButton } from './controls';
import { SPEED_CHIPS } from './timeSteps';
import { simTelemetry } from '@/physics/schedule';
import { SIM_STEP, type TimelineMarker } from '@/physics/simulation';
import { formatDuration, simSecondsToDays } from '@/physics/units';
import { useSimStore } from '@/stores/simStore';
import { useUnlockTimeBender } from './useUnlockTimeBender';
import { simulationControls } from '@/worlds/spacetime/liveWorld';
import { resetActiveLab } from './useKeyboardShortcuts';

const RIBBON_WINDOW_MS = 60_000;

const TONE_CLASS: Record<EventTone, string> = {
  info: 'bg-primary',
  ok: 'bg-ok',
  warn: 'bg-warn',
  danger: 'bg-danger',
};

const TONE_TEXT: Record<EventTone, string> = {
  info: 'text-foreground/85',
  ok: 'text-ok',
  warn: 'text-warn',
  danger: 'text-danger',
};

const formatStep = (step: number) => {
  const magnitude = Math.abs(step) === 0.5 ? '½' : `${Math.abs(step)}`;
  return step < 0 ? `−${magnitude}` : `${magnitude}×`;
};

const formatClock = (seconds: number) => {
  const whole = Math.max(0, Math.floor(seconds));
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

/** Re-renders on an interval; used for clocks and the sliding ribbon. */
const useNow = (intervalMs: number) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
};

/* ─── Clock ────────────────────────────────────────────────────────────────── */

const MissionClock = () => {
  const mode = useAppStore((state) => state.mode);
  const elapsed = useRocketStore((state) => state.flight.elapsed);
  const simTime = useSimStore((state) => state.timeline.simTime);
  const isRocket = mode === 'rocket';

  return (
    <div className="grid shrink-0 leading-tight">
      <span className="hud-label text-[9.5px]">{isRocket ? 'Mission time' : 'Time elapsed'}</span>
      <span className="hud-num text-[13px] text-foreground" title={isRocket ? undefined : 'Simulated time: one year is one orbit at 1 AU.'}>
        {isRocket ? `T+${formatClock(elapsed)}` : formatDuration(simSecondsToDays(simTime))}
      </span>
    </div>
  );
};

/**
 * Crowded systems can't always run at full warp; say so instead of silently
 * running slower than the selected speed.
 */
const WarpLimitNote = () => {
  const mode = useAppStore((state) => state.mode);
  const timeScale = useTimeStore((state) => state.timeScale);
  const isPlaying = useTimeStore((state) => state.isPlaying);
  useNow(1000);
  const t = simTelemetry.spacetime;
  if (mode !== 'spacetime' || !isPlaying || timeScale <= 4 || !t.limited) return null;
  return (
    <span className="hud-num shrink-0 text-[11px] text-warn" title="Large systems need more computation per step, so warp is capped to keep the view smooth.">
      ≈{Math.round(t.achievedScale)}× max
    </span>
  );
};

/* ─── Event ribbon ─────────────────────────────────────────────────────────── */

const RibbonMarker = ({ event, now }: { event: LabEvent; now: number }) => {
  const ref = useRef<HTMLSpanElement>(null);
  useGSAP(() => {
    gsap.from(ref.current, { scale: 0, duration: 0.4, ease: 'snap' });
  }, { scope: ref });
  const age = now - event.at;
  const fromRight = Math.min(1, age / RIBBON_WINDOW_MS);

  return (
    <span
      ref={ref}
      title={`${event.label} · ${Math.round(age / 1000)} s ago`}
      className={cn('absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-[hsl(var(--hud-surface))] transition-[left] duration-1000 ease-linear', TONE_CLASS[event.tone])}
      style={{ left: `${(1 - fromRight) * 100}%` }}
    />
  );
};

const EventRibbon = () => {
  const mode = useAppStore((state) => state.mode);
  const events = useEventStore((state) => state.events);
  const now = useNow(1000);
  const visible = events.filter((event) => event.mode === mode && now - event.at <= RIBBON_WINDOW_MS);
  const latest = visible[visible.length - 1];

  return (
    <div className="temporal-ribbon grid min-w-0 gap-1">
      <div className="flex min-w-0 items-baseline justify-between gap-3">
        <span className="hud-label shrink-0 text-[9.5px]">Last 60 s</span>
        <span className={cn('min-w-0 truncate text-right text-[11.5px]', latest ? TONE_TEXT[latest.tone] : 'text-hud-faint')} aria-live="polite">
          {latest ? latest.label : 'No events yet'}
        </span>
      </div>
      <div className="relative h-3" role="img" aria-label={`${visible.length} events in the last minute`}>
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-[hsl(var(--hud-line)/0.18)]" />
        <div className="absolute inset-y-0 right-0 w-px bg-primary/70" />
        {visible.map((event) => <RibbonMarker key={event.id} event={event} now={now} />)}
      </div>
    </div>
  );
};

/* ─── Spacetime history (scrub to rewind) ──────────────────────────────────── */

const MARKER_CLASS: Record<TimelineMarker['kind'], string> = {
  merge: 'bg-danger',
  absorb: 'bg-[#c084fc]',
  bounce: 'bg-warn',
  fragment: 'bg-burn',
  tidal: 'bg-[#e879f9]',
};

const HistoryTrack = () => {
  const { step, historyStart, historyEnd, markers } = useSimStore((state) => state.timeline);
  const events = useEventStore((state) => state.events);
  const latest = [...events].reverse().find((event) => event.mode === 'spacetime');
  const unlockTimeBender = useUnlockTimeBender();
  const span = Math.max(historyEnd - historyStart, 1);
  const behind = (historyEnd - step) * SIM_STEP;
  const clamped = Math.min(Math.max(step, historyStart), historyEnd);
  const pct = (s: number) => ((s - historyStart) / span) * 100;

  const seek = (target: number) => {
    simulationControls.current?.seek(target);
    if (target < step) unlockTimeBender();
  };

  return (
    <div className="temporal-ribbon grid min-w-0 gap-1">
      <div className="flex min-w-0 items-baseline justify-between gap-3">
        <span className="hud-label shrink-0 text-[9.5px]">
          {behind > 0.01 ? <span className="text-warn">{behind.toFixed(1)} s before now</span> : `History · last ${Math.round(span * SIM_STEP)} s`}
        </span>
        <span className={cn('min-w-0 truncate text-right text-[11.5px]', latest ? TONE_TEXT[latest.tone] : 'text-hud-faint')} aria-live="polite">
          {latest ? latest.label : 'No events yet'}
        </span>
      </div>
      <div className="relative h-3">
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-[hsl(var(--hud-line)/0.18)]" />
        <div className="absolute left-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-primary/50" style={{ width: `${pct(clamped)}%` }} />
        {markers.map((marker) => (
          <span
            key={`${marker.step}-${marker.title}`}
            title={`${marker.title} · ${((historyEnd - marker.step) * SIM_STEP).toFixed(1)} s ago`}
            className={cn('absolute top-1/2 h-2.5 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full', MARKER_CLASS[marker.kind])}
            style={{ left: `${pct(marker.step)}%` }}
          />
        ))}
        <input
          type="range"
          aria-label="Rewind through history"
          min={historyStart}
          max={Math.max(historyEnd, historyStart + 1)}
          step={1}
          value={clamped}
          onPointerDown={() => useTimeStore.getState().pause()}
          onKeyDown={() => useTimeStore.getState().pause()}
          onChange={(e) => seek(Number(e.target.value))}
          className="history-scrub absolute inset-x-0 top-1/2 -translate-y-1/2"
        />
      </div>
    </div>
  );
};

/* ─── Transport ────────────────────────────────────────────────────────────── */

const TemporalHud = () => {
  const { timeScale, isPlaying, togglePlay, step, setTimeScale, play } = useTimeStore(useShallow((state) => ({
    timeScale: state.timeScale,
    isPlaying: state.isPlaying,
    togglePlay: state.togglePlay,
    step: state.step,
    setTimeScale: state.setTimeScale,
    play: state.play,
  })));
  const rewinding = isPlaying && timeScale < 0;
  const mode = useAppStore((state) => state.mode);

  return (
    <div className="temporal hud-panel pointer-events-auto grid w-full gap-2 px-3 pb-2.5 pt-2">
      {mode === 'spacetime' ? <HistoryTrack /> : <EventRibbon />}

      <div className="flex min-w-0 items-center gap-3">
        <div className="flex shrink-0 items-center gap-0.5">
          <IconButton label="Reset lab (R)" onClick={resetActiveLab} className="temporal-reset">
            <RotateCcw size={15} />
          </IconButton>
          <IconButton label="Slower or rewind (←)" onClick={() => step(-1)} active={rewinding} tone="warn">
            <Rewind size={15} fill={rewinding ? 'currentColor' : 'none'} />
          </IconButton>
          <button
            type="button"
            onClick={togglePlay}
            aria-label={isPlaying ? 'Pause (Space)' : 'Resume (Space)'}
            title={isPlaying ? 'Pause (Space)' : 'Resume (Space)'}
            className={cn(
              'hud-focus mx-0.5 flex h-9 w-9 items-center justify-center rounded-full border transition-colors duration-150 active:scale-95',
              isPlaying ? 'border-primary/50 bg-primary/15 text-primary hover:bg-primary/25' : 'border-warn/50 bg-warn/15 text-warn hover:bg-warn/25',
            )}
          >
            {isPlaying ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" className="translate-x-px" />}
          </button>
          <IconButton label="Faster (→)" onClick={() => step(1)}>
            <FastForward size={15} />
          </IconButton>
        </div>

        <div className="h-6 w-px shrink-0 bg-[hsl(var(--hud-line)/0.14)]" />

        {/* Full speed chips; collapses to a single readout in narrow layouts. */}
        <div role="radiogroup" aria-label="Simulation speed" className="temporal-chips flex min-w-0 items-center gap-0.5">
          {SPEED_CHIPS.map((speed) => {
            const active = timeScale === speed;
            const reverse = speed < 0;
            return (
              <button
                key={speed}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => { setTimeScale(speed); play(); }}
                className={cn(
                  'hud-focus hud-num h-7 min-w-[34px] rounded-[4px] px-1.5 text-[11.5px] transition-[color,background-color,box-shadow] duration-150',
                  active
                    ? reverse
                      ? 'bg-warn/15 text-warn shadow-[inset_0_0_0_1px_hsl(var(--warn)/0.35)]'
                      : 'bg-primary/15 text-primary shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.35)]'
                    : 'text-hud-dim hover:text-foreground',
                )}
              >
                {formatStep(speed)}
              </button>
            );
          })}
        </div>
        <span className={cn('temporal-speed hud-num hidden text-[13px]', rewinding ? 'text-warn' : 'text-primary')}>
          {isPlaying ? formatStep(timeScale).replace(/^(−?[\d½]+)$/, '$1×') : 'Paused'}
        </span>

        <WarpLimitNote />
        <div className="temporal-clock ml-auto flex shrink-0 items-center gap-3">
          <div className="h-6 w-px bg-[hsl(var(--hud-line)/0.14)]" />
          <MissionClock />
        </div>
      </div>
    </div>
  );
};

export default memo(TemporalHud);
