import { memo } from 'react';
import { BookOpen, EyeOff, Target } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/stores/appStore';
import { useProgressStore } from '@/stores/progressStore';
import { IconButton } from './controls';
import SettingsMenu from './SettingsMenu';
import { LAB_META } from './labs';

/* ─── Lab switch ───────────────────────────────────────────────────────────── */

const LabSwitch = () => {
  const mode = useAppStore((state) => state.mode);
  const setMode = useAppStore((state) => state.setMode);

  return (
    <div role="tablist" aria-label="Lab" className="flex items-center gap-0.5 rounded-md border border-[hsl(var(--hud-line)/0.12)] bg-white/[0.02] p-[3px]">
      {(['spacetime', 'rocket'] as const).map((lab) => {
        const { name, icon: Icon } = LAB_META[lab];
        const active = mode === lab;
        return (
          <button
            key={lab}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => setMode(lab)}
            className={cn(
              'hud-focus flex h-8 items-center gap-2 rounded-[4px] px-3 text-[12.5px] font-medium transition-[color,background-color,box-shadow] duration-150 ease-hud',
              active
                ? 'bg-primary/[0.13] text-primary shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.35)]'
                : 'text-hud-dim hover:text-foreground',
            )}
          >
            <Icon size={14} />
            <span className="hidden lg:inline">{name}</span>
          </button>
        );
      })}
    </div>
  );
};

/* ─── Bar ──────────────────────────────────────────────────────────────────── */

const FlightBar = () => {
  const mode = useAppStore((state) => state.mode);
  const objectivesOpen = useAppStore((state) => !state.missionsCollapsed);
  const toggleObjectives = useAppStore((state) => state.toggleMissions);
  const setHudHidden = useAppStore((state) => state.setHudHidden);
  const setMissionLogOpen = useAppStore((state) => state.setMissionLogOpen);
  const score = useProgressStore((state) => state.score);
  const lab = LAB_META[mode];

  return (
    <header className="hud-panel pointer-events-auto grid h-[52px] grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 px-2.5">
      {/* Identity */}
      <div className="flex min-w-0 items-center gap-3">
        <img src="/logo-mark.png" alt="" className="h-8 w-8 shrink-0 select-none" draggable={false} />
        <div className="hidden min-w-0 leading-tight xl:block">
          <p className="font-display text-[11.5px] tracking-[0.08em] text-foreground">COSMIC PLAYGROUND</p>
          <p className="truncate text-[11.5px] text-hud-dim">{lab.name} · {lab.subject}</p>
        </div>
        <h1 className="sr-only">Cosmic Playground · {lab.name}</h1>
      </div>

      <LabSwitch />

      {/* Global actions. Live readings sit with their instruments, not up here. */}
      <div className="flex min-w-0 items-center justify-end gap-1">
        <button
          type="button"
          onClick={() => setMissionLogOpen(true)}
          title="Mission log (M)"
          className="hud-focus flex h-8 items-center gap-1.5 rounded-md px-2 text-[12px] text-hud-dim transition-colors hover:bg-white/[0.05] hover:text-foreground"
        >
          <BookOpen size={15} />
          <span className="hud-num text-primary">{score}</span>
          <span className="hidden sm:inline">pts</span>
        </button>
        <div className="flex items-center">
          <IconButton label="Objectives (L)" onClick={toggleObjectives} active={objectivesOpen}>
            <Target size={15} />
          </IconButton>
          <SettingsMenu />
          <IconButton label="Hide interface (H)" onClick={() => setHudHidden(true)}>
            <EyeOff size={15} />
          </IconButton>
        </div>
      </div>
    </header>
  );
};

export default memo(FlightBar);
