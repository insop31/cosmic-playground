import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, ArrowUpRight, CheckCircle2, Crosshair, Lightbulb, Orbit, Pause, TrendingUp, Unlock, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { gsap, useGSAP } from '@/motion/gsap';
import { useAppStore } from '@/stores/appStore';
import { findMission, useProgressStore } from '@/stores/progressStore';
import { UNLOCKS } from '@/lib/unlocks';
import { useFlightStore } from '@/stores/flightStore';
import { useRocketStore } from '@/stores/rocketStore';
import { bodyLabel, useSpacetimeStore } from '@/stores/spacetimeStore';
import { useTimeStore } from '@/stores/timeStore';
import type { RocketState } from '@/worlds/rocket/rocketTypes';
import { IconButton, Kbd } from './controls';

const OUTCOME: Partial<Record<RocketState['outcome'], { text: string; detail: string; tone: string; icon: ReactNode }>> = {
  orbiting: { text: 'Stable orbit', detail: 'Horizontal speed now balances gravity.', tone: 'border-ok/40 text-ok', icon: <Orbit size={14} /> },
  escape: { text: 'Escape velocity', detail: 'The vehicle is leaving the planet’s gravity well.', tone: 'border-primary/40 text-primary', icon: <ArrowUpRight size={14} /> },
  suborbital: { text: 'Suborbital flight', detail: 'Not enough horizontal speed to stay up.', tone: 'border-warn/40 text-warn', icon: <TrendingUp size={14} /> },
  crashed: { text: 'Impact', detail: 'The vehicle fell back to the surface.', tone: 'border-danger/40 text-danger', icon: <AlertTriangle size={14} /> },
  burnup: { text: 'Burn-up on ascent', detail: 'Heating exceeded what the vehicle could take.', tone: 'border-danger/40 text-danger', icon: <AlertTriangle size={14} /> },
};

/** Fades and lifts its child in on mount. */
const Enter = ({ children, className, role }: { children: ReactNode; className?: string; role?: string }) => {
  const ref = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    gsap.from(ref.current, { autoAlpha: 0, y: -8, duration: 0.24 });
  }, { scope: ref });
  return <div ref={ref} className={className} role={role}>{children}</div>;
};

const NOTICE_MS = 4500;

/** Shows the latest objective completion for a few seconds. */
const ObjectiveNotice = () => {
  const lastCompleted = useProgressStore((state) => state.lastCompleted);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!lastCompleted) return undefined;
    setVisible(true);
    const id = window.setTimeout(() => setVisible(false), NOTICE_MS);
    return () => window.clearTimeout(id);
  }, [lastCompleted]);

  const mission = lastCompleted ? findMission(lastCompleted.id) : undefined;
  if (!visible || !mission) return null;
  return (
    <Enter key={lastCompleted!.at} role="status" className="hud-panel flex items-center gap-2.5 border-ok/40 px-3 py-1.5">
      <CheckCircle2 size={14} className="shrink-0 text-ok" />
      <span className="text-[12.5px] text-foreground">
        Objective complete · <span className="font-semibold">{mission.name}</span>
      </span>
      <span className="hud-num text-[11.5px] text-ok">+{mission.score}</span>
    </Enter>
  );
};

/** Announces newly unlocked content, with a way into the mission log. */
const UnlockNotice = () => {
  const lastUnlock = useProgressStore((state) => state.lastUnlock);
  const openLog = useAppStore((state) => state.setMissionLogOpen);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!lastUnlock) return undefined;
    setVisible(true);
    const id = window.setTimeout(() => setVisible(false), NOTICE_MS * 2);
    return () => window.clearTimeout(id);
  }, [lastUnlock]);

  const unlock = lastUnlock ? UNLOCKS.find((u) => u.id === lastUnlock.id) : undefined;
  if (!visible || !unlock) return null;
  return (
    <Enter key={lastUnlock!.at} role="status" className="hud-panel pointer-events-auto flex items-center gap-2.5 border-primary/45 py-1.5 pl-3 pr-1.5">
      <Unlock size={14} className="shrink-0 text-primary" />
      <span className="text-[12.5px] text-foreground">
        Unlocked · <span className="font-semibold">{unlock.name}</span>
      </span>
      <button
        type="button"
        onClick={() => { setVisible(false); openLog(true); }}
        className="hud-focus rounded-[4px] px-2 py-0.5 text-[12px] text-primary transition-colors hover:bg-primary/10"
      >
        View
      </button>
    </Enter>
  );
};

/** Top-centre zone: the one message that matters right now. */
/**
 * A single plain sentence saying what to do next, shown only when nothing
 * more important is on screen. Dismissed per lab for the rest of the visit.
 */
const NextStep = () => {
  const mode = useAppStore((state) => state.mode);
  const pendingPlacement = useSpacetimeStore((state) => state.pendingPlacement);
  const selected = useSpacetimeStore((state) => state.selectedBodyId);
  const phase = useRocketStore((state) => state.flight.phase);
  const countdown = useFlightStore((state) => state.countdown);
  const [dismissed, setDismissed] = useState<Record<string, boolean>>({});

  const text = mode === 'spacetime'
    ? !pendingPlacement && !selected
      ? 'Pick a body on the left, then click the grid to place it. Click any body to see its orbit.'
      : null
    : phase === 'idle' && countdown === null
      ? 'Set up the rocket on the left (or keep the defaults), choose what you think will happen, then press Ignite.'
      : null;

  if (!text || dismissed[mode]) return null;
  return (
    <Enter key={mode} role="note" className="hud-panel pointer-events-auto flex max-w-[560px] items-center gap-2.5 py-1.5 pl-3 pr-1.5">
      <Lightbulb size={14} className="shrink-0 text-primary" />
      <span className="text-[12.5px] leading-snug text-foreground/90">{text}</span>
      <IconButton label="Hide this tip" size="sm" onClick={() => setDismissed((d) => ({ ...d, [mode]: true }))}>
        <X size={14} />
      </IconButton>
    </Enter>
  );
};

const ContextBanner = () => {
  const mode = useAppStore((state) => state.mode);
  const pendingPlacement = useSpacetimeStore((state) => state.pendingPlacement);
  const cancelPlacement = useSpacetimeStore((state) => state.cancelPlacement);
  const isPlaying = useTimeStore((state) => state.isPlaying);
  const play = useTimeStore((state) => state.play);
  const outcome = useRocketStore((state) => (state.flight.phase === 'outcome' ? state.flight.outcome : 'none'));
  const reportOpen = useFlightStore((state) => state.reportOpen);
  const setReportOpen = useFlightStore((state) => state.setReportOpen);
  const outcomeInfo = mode === 'rocket' && !reportOpen ? OUTCOME[outcome] : undefined;
  const busy = Boolean(pendingPlacement) || Boolean(outcomeInfo) || !isPlaying;

  return (
    <div className="flex flex-col items-center gap-2">
      <UnlockNotice />
      <ObjectiveNotice />
      {mode === 'spacetime' && pendingPlacement && (
        <Enter role="status" className="hud-panel pointer-events-auto flex items-center gap-2.5 border-primary/40 py-1.5 pl-3 pr-1.5">
          <Crosshair size={14} className="shrink-0 text-primary" />
          <span className="text-[12.5px] text-foreground">
            Click to place <span className="font-semibold text-primary">{bodyLabel(pendingPlacement)}</span> in orbit, or drag to aim its launch
          </span>
          <Kbd>Esc</Kbd>
          <IconButton label="Cancel placement" size="sm" onClick={cancelPlacement}>
            <X size={14} />
          </IconButton>
        </Enter>
      )}

      {outcomeInfo && (
        <Enter key={outcome} role="status" className={cn('hud-panel flex items-center gap-3 px-3.5 py-2', outcomeInfo.tone)}>
          {outcomeInfo.icon}
          <span className="font-display text-[11.5px] uppercase tracking-[0.08em]">{outcomeInfo.text}</span>
          <span className="hidden text-[12px] text-hud-dim md:inline">{outcomeInfo.detail}</span>
          <button
            type="button"
            onClick={() => setReportOpen(true)}
            className="hud-focus pointer-events-auto rounded-[4px] px-2 py-0.5 text-[12px] text-hud-dim transition-colors hover:bg-white/[0.05] hover:text-foreground"
          >
            Show report
          </button>
        </Enter>
      )}

      {!busy && <NextStep />}

      {!isPlaying && (
        <Enter role="status" className="hud-panel pointer-events-auto flex items-center gap-2.5 border-warn/40 py-1.5 pl-3 pr-1.5">
          <Pause size={13} className="shrink-0 text-warn" fill="currentColor" />
          <span className="text-[12.5px] text-foreground">Simulation paused</span>
          <button
            type="button"
            onClick={play}
            className="hud-focus flex items-center gap-1.5 rounded-[4px] px-2 py-1 text-[12px] text-hud-dim transition-colors hover:bg-white/[0.05] hover:text-foreground"
          >
            Resume <Kbd>Space</Kbd>
          </button>
        </Enter>
      )}
    </div>
  );
};

export default memo(ContextBanner);
