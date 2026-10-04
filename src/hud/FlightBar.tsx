import { memo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { EyeOff, Keyboard, Target } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/stores/appStore';
import { useProgressStore } from '@/stores/progressStore';
import { useRocketStore } from '@/stores/rocketStore';
import { useSpacetimeStore } from '@/stores/spacetimeStore';
import { useTimeStore } from '@/stores/timeStore';
import type { RocketState } from '@/worlds/rocket/rocketTypes';
import { IconButton, Kbd, Readout } from './controls';
import { LAB_META } from './labs';
import { SHORTCUTS } from './shortcuts';

const PHASE_LABEL: Record<RocketState['phase'], string> = {
  idle: 'On pad',
  launching: 'Powered',
  coasting: 'Coasting',
  outcome: 'Complete',
};

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
      <Kbd className="mx-1.5 hidden lg:inline-flex">Tab</Kbd>
    </div>
  );
};

/* ─── Telemetry ────────────────────────────────────────────────────────────── */

const formatSpeed = (timeScale: number, isPlaying: boolean) => {
  if (!isPlaying) return 'Paused';
  const magnitude = Math.abs(timeScale) === 0.5 ? '½' : String(Math.abs(timeScale));
  return timeScale < 0 ? `−${magnitude}×` : `${magnitude}×`;
};

const SpacetimeTelemetry = () => {
  const bodies = useSpacetimeStore((state) => state.bodies.length);
  const universeScale = useSpacetimeStore((state) => state.universeScale);
  const { timeScale, isPlaying } = useTimeStore(useShallow((state) => ({ timeScale: state.timeScale, isPlaying: state.isPlaying })));

  return (
    <>
      <Readout label="Bodies" value={bodies} className="hidden w-12 sm:grid" />
      <Readout
        label="Sim speed"
        value={formatSpeed(timeScale, isPlaying)}
        tone={!isPlaying ? 'default' : timeScale < 0 ? 'warn' : 'primary'}
        className="w-16"
      />
      {universeScale > 1.001 && (
        <Readout label="Expansion" value={`${universeScale.toFixed(3)}×`} className="hidden w-[72px] xl:grid" />
      )}
    </>
  );
};

const RocketTelemetry = () => {
  const { altitude, fuel, phase, velocity } = useRocketStore(useShallow((state) => ({
    altitude: state.flight.altitude,
    fuel: state.flight.fuel,
    phase: state.flight.phase,
    velocity: state.flight.velocity,
  })));
  const speed = Math.hypot(velocity[0], velocity[1]);
  const fuelPct = Math.round(fuel * 100);
  const fuelLow = fuel <= 0.2 && phase !== 'idle';

  return (
    <>
      <Readout label="Altitude" value={altitude.toFixed(1)} className="w-14" />
      <Readout label="Speed" value={speed.toFixed(2)} className="hidden w-14 xl:grid" />
      <div className="hidden w-16 gap-1 leading-tight xl:grid">
        <span className="hud-label text-[9.5px]">Fuel</span>
        <div className="flex items-center gap-1.5">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/10">
            <div
              className={cn('h-full rounded-full transition-[width] duration-200', fuelLow ? 'bg-danger' : 'bg-primary')}
              style={{ width: `${fuelPct}%` }}
            />
          </div>
          <span className={cn('hud-num text-[11px]', fuelLow ? 'text-danger' : 'text-foreground')}>{fuelPct}</span>
        </div>
      </div>
      <Readout
        label="Phase"
        value={PHASE_LABEL[phase]}
        tone={phase === 'launching' ? 'warn' : phase === 'idle' ? 'default' : 'primary'}
        className="w-[70px]"
      />
    </>
  );
};

/* ─── Bar ──────────────────────────────────────────────────────────────────── */

const FlightBar = () => {
  const mode = useAppStore((state) => state.mode);
  const objectivesOpen = useAppStore((state) => !state.missionsCollapsed);
  const toggleObjectives = useAppStore((state) => state.toggleMissions);
  const setHudHidden = useAppStore((state) => state.setHudHidden);
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

      {/* Telemetry and global actions */}
      <div className="flex min-w-0 items-center justify-end gap-4">
        <div className="flex min-w-0 items-center gap-4 overflow-hidden [&>*]:shrink-0" aria-live="off">
          {mode === 'spacetime' ? <SpacetimeTelemetry /> : <RocketTelemetry />}
        </div>
        <div className="hidden h-7 w-px bg-[hsl(var(--hud-line)/0.14)] lg:block" />
        <Readout label="Score" value={score} tone="primary" className="hidden w-12 lg:grid" />
        <div className="flex items-center">
          <IconButton label="Objectives (L)" onClick={toggleObjectives} active={objectivesOpen}>
            <Target size={15} />
          </IconButton>
          <Popover>
            <PopoverTrigger asChild>
              <IconButton label="Keyboard shortcuts (?)" data-shortcuts-trigger="">
                <Keyboard size={15} />
              </IconButton>
            </PopoverTrigger>
            <PopoverContent align="end" sideOffset={10} className="hud-panel w-80 border-0 p-3 text-foreground">
              <p className="hud-label mb-2">Keyboard shortcuts</p>
              <ul className="grid gap-1.5">
                {SHORTCUTS.map((shortcut) => (
                  <li key={shortcut.label} className="flex items-center justify-between gap-3 text-[12.5px] text-foreground/85">
                    <span>{shortcut.label}</span>
                    <span className="flex shrink-0 gap-1">{shortcut.keys.map((key) => <Kbd key={key}>{key}</Kbd>)}</span>
                  </li>
                ))}
              </ul>
            </PopoverContent>
          </Popover>
          <IconButton label="Hide interface (H)" onClick={() => setHudHidden(true)}>
            <EyeOff size={15} />
          </IconButton>
        </div>
      </div>
    </header>
  );
};

export default memo(FlightBar);
