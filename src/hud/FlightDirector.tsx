import { memo, useMemo, useRef } from 'react';
import { Bot } from 'lucide-react';
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

/* ─── Coach feed ───────────────────────────────────────────────────────────── */

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

const CoachFeed = () => {
  const coach = useFlightStore((state) => state.coach);
  const recent = coach.slice(-3);
  return (
    <div className="grid gap-2">
      <span className="flex items-center gap-1.5">
        <Bot size={13} className="text-primary" />
        <span className="hud-label">Launch coach</span>
      </span>
      <ol className="grid gap-2" aria-live="polite">
        {recent.length === 0 && <li className="text-[12px] text-hud-dim">Waiting for liftoff.</li>}
        {recent.map((line, index) => <CoachEntry key={line.id} line={line} latest={index === recent.length - 1} />)}
      </ol>
    </div>
  );
};

/* ─── Panel ────────────────────────────────────────────────────────────────── */

/** Right-hand zone during a flight: where the vehicle is in its ascent and why. */
const FlightDirector = () => {
  const phase = useRocketStore((state) => state.flight.phase);
  const elapsed = useRocketStore((state) => state.flight.elapsed);
  const showForces = useFlightStore((state) => state.showForces);
  const setShowForces = useFlightStore((state) => state.setShowForces);
  const ref = useRef<HTMLElement>(null);

  useGSAP(() => {
    gsap.from(ref.current, { autoAlpha: 0, y: -6, duration: 0.3 });
  }, { scope: ref });

  if (phase === 'idle') return null;

  return (
    <section ref={ref} aria-label="Flight director" className="hud-panel pointer-events-auto grid w-[300px] gap-3.5 p-3">
      <div className="flex items-baseline justify-between">
        <p className="hud-label">Flight director</p>
        <span className="hud-num text-[12px] text-foreground">{formatT(elapsed)}</span>
      </div>
      <PhaseStepper />
      <div className="grid gap-3.5 border-t border-[hsl(var(--hud-line)/0.1)] pt-3">
        <HeatingGauge />
        <QTrace />
      </div>
      <div className="border-t border-[hsl(var(--hud-line)/0.1)] pt-3">
        <CoachFeed />
      </div>
      <div className="border-t border-[hsl(var(--hud-line)/0.1)] pt-2.5">
        <HudSwitch
          label="Show forces on the vehicle"
          checked={showForces}
          onCheckedChange={setShowForces}
          hint="Thrust, gravity, drag and wind. Longer arrows are stronger forces."
        />
      </div>
    </section>
  );
};

export default memo(FlightDirector);
