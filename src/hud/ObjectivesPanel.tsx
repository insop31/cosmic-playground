import { memo, useMemo, useRef } from 'react';
import { BookOpen, CheckCircle2, ChevronUp, Circle, Target } from 'lucide-react';
import { cn } from '@/lib/utils';
import { gsap, useGSAP } from '@/motion/gsap';
import { useAppStore } from '@/stores/appStore';
import {
  PACKS_BY_MODE,
  findMission,
  getActivePack,
  useExperimentCount,
  useProgressStore,
  type MissionCard,
} from '@/stores/progressStore';
import { HudSelect, IconButton } from './controls';
import { useRocketStore } from '@/stores/rocketStore';
import { useSpacetimeStore } from '@/stores/spacetimeStore';
import type { ChallengePack } from '@/lib/challengePacks';
import { LAB_META } from './labs';

const ProgressRing = ({ value, total, size = 36 }: { value: number; total: number; size?: number }) => {
  const circleRef = useRef<SVGCircleElement>(null);
  const r = (size - 5) / 2;
  const c = 2 * Math.PI * r;
  const pct = total > 0 ? value / total : 0;

  useGSAP(() => {
    gsap.to(circleRef.current, { strokeDashoffset: c * (1 - pct), duration: 0.6 });
  }, { dependencies: [pct, c] });

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0 -rotate-90" aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--hud-line) / 0.14)" strokeWidth={3} />
      <circle
        ref={circleRef}
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={pct >= 1 ? 'hsl(var(--ok))' : 'hsl(var(--primary))'}
        strokeWidth={3}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c}
      />
    </svg>
  );
};

const ObjectiveItem = ({ card }: { card: MissionCard }) => {
  const ref = useRef<HTMLLIElement>(null);
  const mission = findMission(card.id);
  const done = card.phase === 'complete';

  useGSAP(() => {
    gsap.from(ref.current, { autoAlpha: 0, y: 8, duration: 0.3 });
  }, { scope: ref });

  // Completion: a brief highlight so the change registers, then the card is
  // replaced by the next objective (timed by the progress store).
  useGSAP(() => {
    if (!done) return;
    // GSAP can't read CSS variables inside a colour, so resolve the token first.
    const [h, s, l] = getComputedStyle(document.documentElement).getPropertyValue('--ok').trim().split(/\s+/);
    const ok = (alpha: number) => `0 0 0 1px hsla(${h}, ${s}, ${l}, ${alpha})`;
    gsap.fromTo(ref.current, { boxShadow: ok(0.6) }, { boxShadow: ok(0), duration: 0.9, ease: 'power2.out' });
  }, { dependencies: [done], scope: ref });

  if (!mission) return null;

  return (
    <li
      ref={ref}
      className={cn(
        'flex gap-2.5 rounded-[5px] border px-2.5 py-2 transition-colors duration-300',
        done ? 'border-ok/30 bg-ok/[0.06]' : 'border-[hsl(var(--hud-line)/0.1)] bg-white/[0.015]',
      )}
    >
      {done
        ? <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-ok" />
        : <Circle size={15} className="mt-0.5 shrink-0 text-hud-faint" />}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className={cn('text-[13px] font-medium', done ? 'text-ok' : 'text-foreground')}>{mission.name}</span>
          <span className="hud-num shrink-0 text-[10.5px] text-hud-faint">+{mission.score}</span>
        </div>
        <p className="text-[12px] leading-snug text-hud-dim">{mission.description}</p>
      </div>
    </li>
  );
};

/** A teacher pack's notes and the button that sets up its lesson. */
const TeacherNotes = ({ pack }: { pack: ChallengePack }) => {
  const flying = useRocketStore((state) => state.flight.phase === 'launching' || state.flight.phase === 'coasting');
  const guide = pack.teacher!;
  const load = () => {
    if (guide.templateId) useSpacetimeStore.getState().applyTemplate(guide.templateId);
    if (guide.rocketSettings) useRocketStore.getState().applyLessonSettings(guide.rocketSettings);
  };
  return (
    <div aria-label="Teacher notes" className="grid gap-2 rounded-[5px] border border-[hsl(var(--violet)/0.35)] bg-[hsl(var(--violet)/0.06)] p-2.5">
      <p className="hud-label flex items-center gap-1.5 text-[9.5px] text-[hsl(var(--violet))]"><BookOpen size={12} /> Teacher notes</p>
      <p className="text-[12px] leading-snug text-foreground/90">{guide.notes}</p>
      <button
        type="button"
        onClick={load}
        disabled={pack.mode === 'rocket' && flying}
        className="hud-focus justify-self-start rounded-[4px] border border-[hsl(var(--violet)/0.45)] px-2.5 py-1 text-[12px] text-[hsl(var(--violet))] transition-colors hover:bg-[hsl(var(--violet)/0.12)] disabled:opacity-40"
      >
        Load lesson setup
      </button>
    </div>
  );
};

/** Right-hand zone: the current lab's objectives, grouped by course. */
const ObjectivesPanel = () => {
  const mode = useAppStore((state) => state.mode);
  const collapsed = useAppStore((state) => state.missionsCollapsed);
  const toggle = useAppStore((state) => state.toggleMissions);
  const setMissionLogOpen = useAppStore((state) => state.setMissionLogOpen);
  const activePackId = useProgressStore((state) => state.activePacks[mode]);
  const achievements = useProgressStore((state) => state.achievements);
  const queue = useProgressStore((state) => state.missionQueues[mode]);
  const setActivePack = useProgressStore((state) => state.setActivePack);
  const experimentCount = useExperimentCount(mode);
  const bodyRef = useRef<HTMLDivElement>(null);

  const activePack = getActivePack(mode, activePackId);
  const total = activePack.missions.length;
  const completed = useMemo(
    () => activePack.missions.filter((mission) => achievements[mission.id]).length,
    [achievements, activePack],
  );

  useGSAP(() => {
    if (!collapsed) gsap.from(bodyRef.current, { autoAlpha: 0, y: -6, duration: 0.25 });
  }, { dependencies: [collapsed] });

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-label={`Objectives: ${completed} of ${total} complete. Show objectives (L)`}
        title="Show objectives (L)"
        className="hud-panel hud-focus pointer-events-auto flex items-center gap-2.5 py-1.5 pl-1.5 pr-3 text-left transition-colors hover:border-primary/40"
      >
        <span className="relative">
          <ProgressRing value={completed} total={total} size={32} />
          <Target size={12} className="absolute inset-0 m-auto text-hud-dim" />
        </span>
        <span className="objectives-chip-text leading-tight">
          <span className="hud-label block text-[9.5px]">Objectives</span>
          <span className="hud-num text-[12.5px] text-foreground">{completed}<span className="text-hud-dim"> / {total}</span></span>
        </span>
      </button>
    );
  }

  return (
    <section aria-label="Objectives" className="hud-panel pointer-events-auto flex max-h-full w-[300px] flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-3 p-3">
        <div className="relative">
          <ProgressRing value={completed} total={total} />
          <Target size={13} className="absolute inset-0 m-auto text-hud-dim" />
        </div>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="hud-label">{LAB_META[mode].name} objectives</p>
          <p className="hud-num mt-0.5 text-[13px] text-foreground">
            {completed}<span className="text-hud-dim"> / {total} complete</span>
          </p>
        </div>
        <IconButton label="Hide objectives (L)" onClick={toggle} size="sm">
          <ChevronUp size={15} />
        </IconButton>
      </div>

      <div ref={bodyRef} className="hud-scroll grid min-h-0 gap-3 overflow-y-auto border-t border-[hsl(var(--hud-line)/0.1)] p-3">
        <div className="grid gap-1.5">
          <HudSelect
            ariaLabel={`${LAB_META[mode].name} course`}
            value={activePack.id}
            onChange={(packId) => setActivePack(mode, packId)}
            className="w-full"
            options={PACKS_BY_MODE[mode].map((pack) => ({ value: pack.id, label: pack.name, hint: pack.teacher ? 'Teacher' : `${pack.missions.length}` }))}
          />
          <p className="text-[12px] leading-snug text-hud-dim">{activePack.description}</p>
          {activePack.teacher && <TeacherNotes pack={activePack} />}
          <p className="hud-num text-[11px] text-hud-faint">
            {mode === 'spacetime' ? 'Experiments run' : 'Flight tests'}: <span className="text-foreground/80">{experimentCount}</span>
          </p>
        </div>

        <ul className="grid gap-1.5">
          {queue.map((card) => <ObjectiveItem key={card.id} card={card} />)}
          {queue.length === 0 && (
            <li className="rounded-[5px] border border-ok/30 bg-ok/[0.06] px-3 py-3 text-center">
              <p className="text-[13px] font-medium text-ok">Course complete</p>
              <p className="text-[12px] text-hud-dim">Every objective in this course is done. Pick another course above.</p>
            </li>
          )}
        </ul>
        <button
          type="button"
          onClick={() => setMissionLogOpen(true)}
          className="hud-focus justify-self-start rounded-[4px] px-1 text-[12px] text-hud-dim transition-colors hover:text-primary"
        >
          Open mission log <span className="hud-num text-hud-faint">(M)</span>
        </button>
      </div>
    </section>
  );
};

export default memo(ObjectivesPanel);
