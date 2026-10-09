import { memo, useMemo, useRef, useState } from 'react';
import { Bot, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { gsap, prefersReducedMotion, useGSAP } from '@/motion/gsap';
import { useFlightStore, type CoachLine, type Milestone } from '@/stores/flightStore';
import { useRocketStore } from '@/stores/rocketStore';
import { HudSwitch, InfoTip } from './controls';

const STEPS: { id: Milestone | 'pad' | 'end'; label: string }[] = [
  { id: 'pad', label: 'Pad' },
  { id: 'liftoff', label: 'Liftoff' },
  { id: 'maxq', label: 'Max-Q' },
  { id: 'cutoff', label: 'Cutoff' },
  { id: 'space', label: 'Space' },
  { id: 'end', label: 'Result' },
];

const TONE_TEXT: Record<CoachLine['tone'], string> = {
  info: 'text-primary',
  ok: 'text-ok',
  warn: 'text-warn',
  danger: 'text-danger',
};

const formatT = (t: number) => `T+${Math.floor(t / 60).toString().padStart(2, '0')}:${Math.floor(t % 60).toString().padStart(2, '0')}`;

/* ─── Phase stepper ────────────────────────────────────────────────────────── */

const PhaseStepper = () => {
  const milestones = useFlightStore((state) => state.milestones);
  const phase = useRocketStore((state) => state.flight.phase);
  const reached = (id: (typeof STEPS)[number]['id']) =>
    id === 'pad' ? true : id === 'end' ? phase === 'outcome' : Boolean(milestones[id]);
  const current = [...STEPS].reverse().find((s) => reached(s.id))?.id;

  return (
    <ol className="relative grid grid-cols-6" aria-label="Flight phases">
      <span aria-hidden className="absolute left-[8%] right-[8%] top-[5px] h-px bg-[hsl(var(--hud-line)/0.2)]" />
      {STEPS.map((s) => {
        const done = reached(s.id);
        const now = s.id === current && phase !== 'outcome';
        return (
          <li key={s.id} className="relative grid justify-items-center gap-1.5" aria-current={now ? 'step' : undefined}>
            <span
              className={cn(
                'h-[11px] w-[11px] rounded-full border-2',
                now ? 'border-warn bg-warn shadow-[0_0_8px_hsl(var(--warn))]' : done ? 'border-primary bg-primary' : 'border-[hsl(var(--hud-line)/0.35)] bg-[hsl(var(--hud-surface))]',
              )}
            />
            <span className={cn('font-mono text-[9.5px] uppercase tracking-[0.06em]', now ? 'text-warn' : done ? 'text-foreground/80' : 'text-hud-faint')}>{s.label}</span>
          </li>
        );
      })}
    </ol>
  );
};

/* ─── Heating ──────────────────────────────────────────────────────────────── */

const HEAT_FULL_SCALE = 1.5;

const HeatingGauge = () => {
  const latest = useFlightStore((state) => state.samples[state.samples.length - 1]);
  const peak = useFlightStore((state) => state.peakHeat);
  const heat = latest?.heat ?? 0;
  const pct = Math.min(1, heat / HEAT_FULL_SCALE) * 100;
  const peakPct = peak ? Math.min(1, peak.heat / HEAT_FULL_SCALE) * 100 : null;

  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1">
          <span className="hud-label">Aerodynamic heating</span>
          <InfoTip label="Aerodynamic heating" side="left">
            Heating grows with speed and with air density. Early in flight the air is thick but the vehicle is slow; high up it is fast but the air is thin. The peak sits in between.
          </InfoTip>
        </span>
        <span className={cn('hud-num text-[12px]', heat > 0.9 ? 'text-burn' : 'text-foreground')}>{heat.toFixed(2)}</span>
      </div>
      <div className="relative h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
        <div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-warn to-burn transition-[width] duration-200" style={{ width: `${pct}%` }} />
        {peakPct !== null && <div className="absolute inset-y-0 w-px bg-foreground/70" style={{ left: `${peakPct}%` }} />}
      </div>
      <p className="hud-num text-[10.5px] text-hud-faint">
        {peak && peak.heat > 0.01 ? `Peak ${peak.heat.toFixed(2)} at ${peak.altKm.toFixed(0)} km` : 'No significant heating yet'}
      </p>
    </div>
  );
};

/* ─── Dynamic pressure trace ───────────────────────────────────────────────── */

const W = 260;
const H = 44;

const QTrace = () => {
  const samples = useFlightStore((state) => state.samples);
  const maxQ = useFlightStore((state) => state.maxQ);
  const passed = useFlightStore((state) => state.milestones.maxq);

  const { line, area, peak } = useMemo(() => {
    if (samples.length < 2) return { line: '', area: '', peak: null as null | [number, number] };
    const tMax = Math.max(samples[samples.length - 1].t, 1);
    const qMax = Math.max(...samples.map((s) => s.q), 1e-6);
    const x = (t: number) => (t / tMax) * W;
    const y = (q: number) => H - 2 - (q / qMax) * (H - 6);
    const pts = samples.map((s) => `${x(s.t).toFixed(1)},${y(s.q).toFixed(1)}`);
    return {
      line: `M${pts.join('L')}`,
      area: `M0,${H}L${pts.join('L')}L${x(samples[samples.length - 1].t).toFixed(1)},${H}Z`,
      peak: maxQ ? [x(maxQ.t), y(maxQ.q)] as [number, number] : null,
    };
  }, [maxQ, samples]);

  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1">
          <span className="hud-label">Dynamic pressure q</span>
          <InfoTip label="Dynamic pressure" side="left">
            q = ½ρv²: how hard the air presses on the vehicle. It rises as speed builds, then falls as the air thins. Its peak is called Max-Q, the moment of greatest structural stress.
          </InfoTip>
        </span>
        <span className="hud-num text-[10.5px] text-hud-faint">{passed ? `Max-Q at ${passed.altKm.toFixed(0)} km` : 'Rising'}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-11 w-full overflow-visible" aria-hidden>
        <line x1="0" x2={W} y1={H - 0.5} y2={H - 0.5} stroke="hsl(var(--hud-line) / 0.2)" />
        {area && <path d={area} fill="hsl(var(--warn) / 0.1)" />}
        {line && <path d={line} fill="none" stroke="hsl(var(--warn))" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />}
        {peak && <circle cx={peak[0]} cy={peak[1]} r="3" fill="hsl(var(--warn))" />}
      </svg>
    </div>
  );
};

/* ─── Coach ────────────────────────────────────────────────────────────────── */

const CoachEntry = ({ line, latest }: { line: CoachLine; latest: boolean }) => {
  const textRef = useRef<HTMLSpanElement>(null);
  // Only the newest line types out; once it isn't newest the tween is reverted,
  // which restores the full text even if typing hadn't finished.
  useGSAP(() => {
    if (!latest || !textRef.current || prefersReducedMotion()) return;
    gsap.from(textRef.current, { text: '', duration: Math.min(1.6, line.text.length * 0.018), ease: 'none' });
  }, { dependencies: [line.id, latest], revertOnUpdate: true });

  return (
    <li className={cn('grid grid-cols-[auto_1fr] gap-x-2 text-[12px] leading-snug', latest ? 'text-foreground' : 'text-hud-dim')}>
      <span className={cn('hud-num text-[10.5px]', latest ? TONE_TEXT[line.tone] : 'text-hud-faint')}>{formatT(line.t)}</span>
      <span ref={textRef}>{line.text}</span>
    </li>
  );
};

/** The coach's latest message, in plain words; earlier ones are under "details". */
const CoachNow = () => {
  const latest = useFlightStore((state) => state.coach[state.coach.length - 1]);
  return (
    <div className="flex gap-2.5 rounded-[5px] border border-primary/20 bg-primary/[0.05] px-3 py-2.5" aria-live="polite">
      <Bot size={15} className="mt-0.5 shrink-0 text-primary" />
      <ol className="min-w-0 flex-1">
        {latest
          ? <CoachEntry key={latest.id} line={latest} latest />
          : <li className="text-[12.5px] text-hud-dim">Waiting for liftoff.</li>}
      </ol>
    </div>
  );
};

const CoachHistory = () => {
  const coach = useFlightStore((state) => state.coach);
  const earlier = coach.slice(-4, -1);
  if (earlier.length === 0) return null;
  return (
    <div className="grid gap-1.5">
      <span className="hud-label">Earlier</span>
      <ol className="grid gap-1.5">
        {earlier.map((line) => <CoachEntry key={line.id} line={line} latest={false} />)}
      </ol>
    </div>
  );
};

/* ─── Panel ────────────────────────────────────────────────────────────────── */

const STATUS: Record<'launching' | 'coasting' | 'outcome', { title: string; detail: string }> = {
  launching: { title: 'Engines firing', detail: 'Thrust is pushing the rocket up and sideways.' },
  coasting: { title: 'Coasting', detail: 'Engines are off; gravity and air decide the rest.' },
  outcome: { title: 'Flight over', detail: 'See the report for what happened and why.' },
};

/**
 * Right-hand zone during a flight. By default it answers one question, "what
 * is happening now?"; gauges, charts and earlier messages are one click away.
 */
const FlightDirector = () => {
  const phase = useRocketStore((state) => state.flight.phase);
  const elapsed = useRocketStore((state) => state.flight.elapsed);
  const showForces = useFlightStore((state) => state.showForces);
  const setShowForces = useFlightStore((state) => state.setShowForces);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const ref = useRef<HTMLElement>(null);

  useGSAP(() => {
    gsap.from(ref.current, { autoAlpha: 0, y: -6, duration: 0.3 });
  }, { scope: ref });

  if (phase === 'idle') return null;
  const status = STATUS[phase];

  return (
    <section ref={ref} aria-label="Flight status" className="hud-panel pointer-events-auto grid w-[300px] gap-3 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-[13px] uppercase tracking-[0.06em] text-foreground">{status.title}</p>
          <p className="mt-0.5 text-[12px] leading-snug text-hud-dim">{status.detail}</p>
        </div>
        <span className="hud-num shrink-0 text-[12px] text-foreground">{formatT(elapsed)}</span>
      </div>
      <PhaseStepper />
      <CoachNow />

      <div className="grid gap-2.5 border-t border-[hsl(var(--hud-line)/0.1)] pt-2.5">
        <HudSwitch label="Show forces on the rocket" checked={showForces} onCheckedChange={setShowForces} />
        <button
          type="button"
          onClick={() => setDetailsOpen((open) => !open)}
          aria-expanded={detailsOpen}
          className="hud-focus flex items-center gap-1 justify-self-start rounded-[4px] text-[12px] text-hud-dim transition-colors hover:text-foreground"
        >
          <ChevronDown size={13} className={cn('transition-transform duration-200', detailsOpen && 'rotate-180')} />
          {detailsOpen ? 'Hide details' : 'Show details: heating, air pressure'}
        </button>
        {detailsOpen && (
          <div className="grid gap-3.5">
            <HeatingGauge />
            <QTrace />
            <CoachHistory />
          </div>
        )}
      </div>
    </section>
  );
};

export default memo(FlightDirector);
