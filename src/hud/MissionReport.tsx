import { memo, useMemo, useRef } from 'react';
import { History, Minus, NotebookPen, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { buildDebrief, peakAltitude } from '@/learning/debrief';
import { formatAltitude } from '@/physics/altitude';
import { vehicleSummary } from '@/physics/rocket';
import { cn } from '@/lib/utils';
import { gsap, prefersReducedMotion, useGSAP } from '@/motion/gsap';
import { useAppStore } from '@/stores/appStore';
import { useFlightStore } from '@/stores/flightStore';
import { useProgressStore } from '@/stores/progressStore';
import { useRocketStore } from '@/stores/rocketStore';
import { useTimeStore } from '@/stores/timeStore';
import type { LaunchOutcome } from '@/worlds/rocket/rocketTypes';
import { escapeFraction } from '@/worlds/rocket/units';
import { useEffectiveRocketParams, readEffectiveRocketParams } from '@/stores/rocketStore';
import { IconButton } from './controls';

const PREDICTION_LABEL: Record<Exclude<LaunchOutcome, 'none'>, string> = {
  orbiting: 'Orbit',
  suborbital: 'Falls back',
  escape: 'Escape',
  crashed: 'Crash',
  burnup: 'Burn-up',
};

const OUTCOME: Record<Exclude<LaunchOutcome, 'none'>, { title: string; explain: string; tone: string; failed: boolean }> = {
  orbiting: {
    title: 'Stable orbit',
    explain: 'The vehicle reached enough sideways speed that it keeps falling around the planet instead of into it.',
    tone: 'text-ok',
    failed: false,
  },
  escape: {
    title: 'Escape trajectory',
    explain: 'Speed passed the planet’s escape speed. The vehicle will not come back.',
    tone: 'text-primary',
    failed: false,
  },
  suborbital: {
    title: 'Suborbital flight',
    explain: 'It reached high altitude but not enough sideways speed to stay up, so it fell back. A shallower angle builds more horizontal speed.',
    tone: 'text-warn',
    failed: true,
  },
  crashed: {
    title: 'Impact',
    explain: 'The vehicle fell back before getting far. Usually not enough thrust for its weight, or too much drag.',
    tone: 'text-danger',
    failed: true,
  },
  burnup: {
    title: 'Burn-up on ascent',
    explain: 'Aerodynamic heating exceeded what the vehicle could take. Climb out of the thick air sooner.',
    tone: 'text-danger',
    failed: true,
  },
};

const REWIND_SECONDS = 5;
const CW = 340;
const CH = 84;

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div className="grid gap-0.5">
    <span className="hud-label text-[9.5px]">{label}</span>
    <span className="hud-num text-[13px] text-foreground">{value}</span>
  </div>
);

/** Shown when a flight ends: what happened, the numbers, and what to try next. */
const MissionReport = () => {
  const flight = useRocketStore((state) => state.flight);
  const { phase, outcome, elapsed } = flight;
  const prediction = useRocketStore((state) => state.prediction);
  const resetFlight = useRocketStore((state) => state.resetFlight);
  const samples = useFlightStore((state) => state.samples);
  const maxQ = useFlightStore((state) => state.milestones.maxq);
  const verdict = useFlightStore((state) => state.milestones.verdict);
  const highestQ = useFlightStore((state) => state.maxQ);
  const peakHeat = useFlightStore((state) => state.peakHeat);
  const scoreAtLaunch = useFlightStore((state) => state.scoreAtLaunch);
  const open = useFlightStore((state) => state.reportOpen);
  const setOpen = useFlightStore((state) => state.setReportOpen);
  const setRewindUntil = useFlightStore((state) => state.setRewindUntil);
  const score = useProgressStore((state) => state.score);
  const ref = useRef<HTMLElement>(null);
  const pathRef = useRef<SVGPathElement>(null);

  const visible = phase === 'outcome' && outcome !== 'none' && open;
  const info = outcome !== 'none' ? OUTCOME[outcome] : null;
  // The debrief is fixed by the moment the verdict came in; the camera coast afterwards doesn't change it.
  const debrief = useMemo(() => (visible ? buildDebrief(readEffectiveRocketParams(), flight) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visible, flight.seed]);
  // Likewise the peak (the top of the arc it is on) and the flight time stop at the verdict.
  const peak = useMemo(() => (visible ? peakAltitude(readEffectiveRocketParams(), flight) : 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visible, flight.seed]);

  const chart = useMemo(() => {
    if (samples.length < 2) return null;
    const tMax = Math.max(samples[samples.length - 1].t, 1);
    const aMax = Math.max(...samples.map((s) => s.altKm), 1);
    const pts = samples.map((s) => `${((s.t / tMax) * CW).toFixed(1)},${(CH - 4 - (s.altKm / aMax) * (CH - 14)).toFixed(1)}`);
    return { d: `M${pts.join('L')}`, tMax, aMax };
  }, [samples]);

  const params = useEffectiveRocketParams();
  const deltaV = useMemo(() => vehicleSummary(params).deltaV, [params]);
  const stats = useMemo(() => {
    let top = samples[0];
    for (const s of samples) if (s.speed > top.speed) top = s;
    return {
      maxAlt: samples.reduce((m, s) => Math.max(m, s.altKm), 0),
      topSpeed: top?.speed ?? 0,
      topOfEscape: top ? escapeFraction(params, top.speed, top.alt) : 0,
    };
  }, [params, samples]);

  useGSAP(() => {
    if (!visible) return;
    gsap.from(ref.current, { autoAlpha: 0, y: -10, duration: 0.35 });
    if (pathRef.current && !prefersReducedMotion()) {
      gsap.from(pathRef.current, { drawSVG: '0%', duration: 1.2, ease: 'power2.inOut', delay: 0.15 });
    }
  }, { dependencies: [visible] });

  if (!visible || !info) return null;

  const rewind = () => {
    setRewindUntil(Math.max(0, elapsed - REWIND_SECONDS));
    useTimeStore.getState().setTimeScale(-1);
    useTimeStore.getState().play();
  };

  return (
    <section ref={ref} aria-label="Mission report" className="hud-panel hud-scroll pointer-events-auto max-h-[calc(100vh-220px)] w-[400px] max-w-full overflow-y-auto p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="hud-label">Mission report</p>
          <h2 className={cn('mt-0.5 font-display text-[16px] uppercase tracking-[0.06em]', info.tone)}>{info.title}</h2>
        </div>
        <IconButton label="Minimise report" size="sm" onClick={() => setOpen(false)}>
          <Minus size={14} />
        </IconButton>
      </div>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-foreground/85">{debrief?.headline ?? info.explain}</p>
      {prediction && (
        <p className={cn('mt-1.5 text-[12px] font-medium', prediction === outcome ? 'text-ok' : 'text-warn')}>
          You predicted “{PREDICTION_LABEL[prediction]}”: {prediction === outcome ? 'correct!' : 'not this time.'}
        </p>
      )}
      {debrief && (
        <div className="mt-2.5 grid gap-2" aria-label="Flight debrief">
          <div>
            <p className="hud-label text-[9.5px]">Why</p>
            <ul className="mt-1 grid gap-1 pl-3 text-[12px] leading-snug text-foreground/85 [list-style:disc]">
              {debrief.causes.map((cause) => <li key={cause}>{cause}</li>)}
            </ul>
          </div>
          {debrief.suggestions.length > 0 && (
            <div>
              <p className="hud-label text-[9.5px]">Try next</p>
              <ul className="mt-1 grid gap-1 pl-3 text-[12px] leading-snug text-primary [list-style:disc]">
                {debrief.suggestions.map((suggestion) => <li key={suggestion}>{suggestion}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {chart && (
        <figure className="mt-3">
          <svg viewBox={`0 0 ${CW} ${CH}`} className="h-[84px] w-full overflow-visible" role="img" aria-label={`Altitude over time, peaking at ${stats.maxAlt.toFixed(0)} km`}>
            <line x1="0" x2={CW} y1={CH - 0.5} y2={CH - 0.5} stroke="hsl(var(--hud-line) / 0.2)" />
            <path ref={pathRef} d={chart.d} fill="none" stroke="hsl(var(--primary))" strokeWidth="1.75" vectorEffect="non-scaling-stroke" />
          </svg>
          <figcaption className="hud-num mt-1 flex justify-between text-[10px] text-hud-faint">
            <span>Altitude over time</span>
            <span>0 – {chart.tMax.toFixed(0)} s · peak {chart.aMax.toFixed(0)} km</span>
          </figcaption>
        </figure>
      )}

      <div className="mt-3 grid grid-cols-3 gap-x-3 gap-y-2.5 border-t border-[hsl(var(--hud-line)/0.1)] pt-3">
        <Stat label="Peak altitude" value={formatAltitude(peak)} />
        <Stat label="Top speed" value={`${stats.topSpeed.toFixed(2)} u/s · ${Math.round(stats.topOfEscape * 100)}% esc.`} />
        <Stat label="Flight time" value={`${(verdict?.t ?? elapsed).toFixed(1)} s`} />
        <Stat label="Δv budget" value={`${deltaV.toFixed(2)} u/s`} />
        <Stat label="Max-Q" value={maxQ ? `${highestQ ? highestQ.q.toFixed(2) : ''} at ${maxQ.altKm.toFixed(0)} km` : highestQ ? highestQ.q.toFixed(2) : '—'} />
        <Stat label="Heat shield" value={peakHeat ? `${Math.round(peakHeat.heat * 100)}%` : '—'} />
      </div>

      <p className="hud-num mt-2 text-[10.5px] text-hud-faint">+{Math.max(0, score - scoreAtLaunch)} points this flight</p>

      <div className="mt-3 flex flex-wrap gap-2">
        {info.failed && (
          <button
            type="button"
            onClick={rewind}
            className="hud-focus flex h-9 items-center gap-1.5 rounded-[5px] border border-warn/40 bg-warn/10 px-3 text-[12px] text-warn transition-colors hover:bg-warn/20"
          >
            <History size={13} /> Rewind {REWIND_SECONDS} s
          </button>
        )}
        <button
          type="button"
          onClick={() => { resetFlight(); useAppStore.getState().setDockCollapsed(false); }}
          className="hud-focus flex h-9 items-center gap-1.5 rounded-[5px] border border-[hsl(var(--hud-line)/0.16)] px-3 text-[12px] text-foreground/85 transition-colors hover:text-foreground"
        >
          <SlidersHorizontal size={13} /> Change setup
        </button>
        <button
          type="button"
          onClick={() => useAppStore.getState().setNotebookOpen(true)}
          className="hud-focus flex h-9 items-center gap-1.5 rounded-[5px] border border-[hsl(var(--hud-line)/0.16)] px-3 text-[12px] text-foreground/85 transition-colors hover:text-foreground"
        >
          <NotebookPen size={13} /> Notebook
        </button>
        <button
          type="button"
          onClick={() => { resetFlight(); useFlightStore.getState().setCountdown(3); }}
          className="hud-focus ml-auto flex h-9 items-center gap-1.5 rounded-[5px] border border-primary/45 bg-primary/15 px-3 text-[12px] text-primary transition-colors hover:bg-primary/25"
        >
          <RotateCcw size={13} /> Fly again
        </button>
      </div>
    </section>
  );
};

export default memo(MissionReport);
