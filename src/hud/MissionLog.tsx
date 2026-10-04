import { memo, useRef, useState } from 'react';
import { CheckCircle2, Circle, Lock, Unlock } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { CHALLENGE_PACKS, type AppMode } from '@/lib/challengePacks';
import { UNLOCKS, type UnlockDefinition } from '@/lib/unlocks';
import { cn } from '@/lib/utils';
import { gsap, prefersReducedMotion, useGSAP } from '@/motion/gsap';
import { useAppStore } from '@/stores/appStore';
import { useFlightStore } from '@/stores/flightStore';
import { useProgressStore } from '@/stores/progressStore';
import { useRocketStore } from '@/stores/rocketStore';
import { useSpacetimeStore } from '@/stores/spacetimeStore';
import { LAB_META } from './labs';

const UnlockCard = ({ unlock, score }: { unlock: UnlockDefinition; score: number }) => {
  const barRef = useRef<HTMLDivElement>(null);
  const unlocked = score >= unlock.threshold;
  const pct = Math.min(1, score / unlock.threshold) * 100;

  useGSAP(() => {
    if (prefersReducedMotion()) return;
    gsap.from(barRef.current, { width: '0%', duration: 0.9, ease: 'power2.out', delay: 0.15 });
  }, { scope: barRef });

  const open = () => {
    const app = useAppStore.getState();
    if (unlock.mode === 'spacetime') {
      useSpacetimeStore.getState().applyTemplate('gravity-slingshot');
    } else {
      useRocketStore.getState().applyScenario('mars-storm-ascent');
      useFlightStore.getState().setSetupStep('launch');
      app.setDockCollapsed(false);
    }
    app.setMode(unlock.mode);
    app.setMissionLogOpen(false);
  };

  return (
    <article className={cn('grid gap-3 rounded-md border p-4', unlocked ? 'border-primary/35 bg-primary/[0.04]' : 'border-[hsl(var(--hud-line)/0.14)] bg-white/[0.015]')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="hud-label">{LAB_META[unlock.mode].name} · {unlock.reward}</p>
          <h3 className="mt-1 font-display text-[14px] uppercase tracking-[0.05em] text-foreground">{unlock.name}</h3>
        </div>
        <span className={cn('shrink-0 rounded-[3px] border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em]', unlock.tier === 'Master' ? 'border-primary/40 text-primary' : 'border-warn/40 text-warn')}>
          {unlock.tier}
        </span>
      </div>
      <p className="text-[12.5px] leading-relaxed text-hud-dim">{unlock.summary}</p>
      <div className="grid gap-1.5">
        <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
          <div ref={barRef} className={cn('h-full rounded-full', unlocked ? 'bg-ok' : 'bg-primary')} style={{ width: `${pct}%` }} />
        </div>
        <div className="hud-num flex justify-between text-[11px] text-hud-dim">
          <span>{Math.min(score, unlock.threshold)} / {unlock.threshold} pts</span>
          <span>{unlocked ? 'Unlocked' : `${unlock.threshold - score} to go`}</span>
        </div>
      </div>
      {unlocked ? (
        <button
          type="button"
          onClick={open}
          className="hud-focus flex h-9 items-center justify-center gap-1.5 rounded-[5px] border border-primary/45 bg-primary/15 text-[12.5px] text-primary transition-colors hover:bg-primary/25"
        >
          <Unlock size={13} /> Open {unlock.mode === 'spacetime' ? 'template' : 'scenario'}
        </button>
      ) : (
        <p className="flex items-center gap-1.5 text-[12px] text-hud-faint"><Lock size={12} /> Earn points by completing objectives and trying new setups.</p>
      )}
    </article>
  );
};

const ObjectiveColumn = ({ mode }: { mode: AppMode }) => {
  const achievements = useProgressStore((state) => state.achievements);
  const packs = CHALLENGE_PACKS.filter((pack) => pack.mode === mode);
  return (
    <section aria-labelledby={`log-${mode}`} className="grid content-start gap-3">
      <h3 id={`log-${mode}`} className="hud-label text-foreground/80">{LAB_META[mode].name}</h3>
      {packs.map((pack) => (
        <div key={pack.id} className="grid gap-1.5">
          <p className="text-[12.5px] font-medium text-foreground">{pack.name}</p>
          <ul className="grid gap-1">
            {pack.missions.map((mission) => {
              const done = achievements[mission.id];
              return (
                <li key={mission.id} className="grid grid-cols-[auto_1fr_auto] items-start gap-2 rounded-[5px] px-2 py-1.5 hover:bg-white/[0.02]">
                  {done ? <CheckCircle2 size={14} className="mt-0.5 text-ok" /> : <Circle size={14} className="mt-0.5 text-hud-faint" />}
                  <span className="min-w-0">
                    <span className={cn('block text-[12.5px]', done ? 'text-foreground' : 'text-foreground/80')}>{mission.name}</span>
                    <span className="block text-[11.5px] leading-snug text-hud-dim">{mission.description}</span>
                  </span>
                  <span className={cn('hud-num text-[11px]', done ? 'text-ok' : 'text-hud-faint')}>+{mission.score}</span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
};

/** Full record of progress: score, unlockable content and every objective. */
const MissionLog = () => {
  const open = useAppStore((state) => state.missionLogOpen);
  const setOpen = useAppStore((state) => state.setMissionLogOpen);
  const score = useProgressStore((state) => state.score);
  const achievements = useProgressStore((state) => state.achievements);
  const resetProgress = useProgressStore((state) => state.resetProgress);
  const [confirmReset, setConfirmReset] = useState(false);
  const scoreRef = useRef<HTMLSpanElement>(null);
  const completed = Object.values(achievements).filter(Boolean).length;
  const total = Object.keys(achievements).length;

  useGSAP(() => {
    if (!open || !scoreRef.current || prefersReducedMotion()) return;
    const counter = { value: 0 };
    gsap.to(counter, {
      value: score,
      duration: 0.8,
      ease: 'power2.out',
      onUpdate: () => { if (scoreRef.current) scoreRef.current.textContent = String(Math.round(counter.value)); },
    });
  }, { dependencies: [open] });

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) setConfirmReset(false); }}>
      <DialogContent className="hud-panel max-h-[88vh] max-w-4xl gap-0 overflow-hidden border-[hsl(var(--hud-line)/0.16)] bg-[hsl(var(--hud-surface)/0.97)] p-0 text-foreground sm:rounded-lg">
        <div className="flex items-end justify-between gap-6 border-b border-[hsl(var(--hud-line)/0.1)] px-6 pb-4 pt-5">
          <div>
            <p className="hud-label">Operations</p>
            <DialogTitle className="mt-1 font-display text-[22px] font-normal uppercase tracking-[0.06em]">Mission log</DialogTitle>
            <DialogDescription className="mt-1 text-[12.5px] text-hud-dim">
              {completed} of {total} objectives complete · progress is saved in this browser
            </DialogDescription>
          </div>
          <div className="text-right">
            <span ref={scoreRef} className="hud-num block text-[36px] leading-none text-primary">{score}</span>
            <span className="hud-label text-[10px]">Exploration score</span>
          </div>
        </div>

        <div className="hud-scroll max-h-[calc(88vh-120px)] overflow-y-auto px-6 py-5">
          <div className="grid gap-4 md:grid-cols-2">
            {UNLOCKS.map((unlock) => <UnlockCard key={unlock.id} unlock={unlock} score={score} />)}
          </div>

          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <ObjectiveColumn mode="spacetime" />
            <ObjectiveColumn mode="rocket" />
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-[hsl(var(--hud-line)/0.1)] pt-4">
            <p className="max-w-[46ch] text-[12px] leading-relaxed text-hud-dim">
              Points come from completing objectives and from trying setups you haven’t tried before; each new combination counts once.
            </p>
            {confirmReset ? (
              <span className="flex items-center gap-2 text-[12px]">
                <span className="text-foreground">Clear all progress?</span>
                <button type="button" onClick={() => { resetProgress(); setConfirmReset(false); }} className="hud-focus rounded-[5px] border border-danger/45 bg-danger/10 px-2.5 py-1 text-danger hover:bg-danger/20">Clear</button>
                <button type="button" onClick={() => setConfirmReset(false)} className="hud-focus rounded-[5px] px-2.5 py-1 text-hud-dim hover:text-foreground">Keep</button>
              </span>
            ) : (
              <button type="button" onClick={() => setConfirmReset(true)} className="hud-focus rounded-[5px] px-2.5 py-1 text-[12px] text-hud-faint transition-colors hover:text-danger">
                Reset progress
              </button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default memo(MissionLog);
