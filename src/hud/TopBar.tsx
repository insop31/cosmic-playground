import { memo } from 'react';
import { EyeOff, Keyboard, Orbit, Rocket } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { AppMode } from '@/lib/challengePacks';
import type { RocketState } from '@/worlds/rocket/rocketTypes';
import { IconButton, Kbd, Readout, Segmented } from './controls';
import { SHORTCUTS } from './shortcuts';

interface TopBarProps {
  mode: AppMode;
  onModeChange: (mode: AppMode) => void;
  onHideHud: () => void;
  score: number;
  spacetime: { bodies: number; timeScale: number; isPlaying: boolean; universeScale: number };
  rocket: Pick<RocketState, 'altitude' | 'fuel' | 'phase' | 'velocity'>;
}

const PHASE_LABEL: Record<RocketState['phase'], string> = {
  idle: 'On pad',
  launching: 'Powered',
  coasting: 'Coasting',
  outcome: 'Complete',
};

const TopBar = ({ mode, onModeChange, onHideHud, score, spacetime, rocket }: TopBarProps) => {
  const speed = Math.hypot(rocket.velocity[0], rocket.velocity[1]);
  const fuelPct = Math.round(rocket.fuel * 100);
  const fuelLow = rocket.fuel <= 0.2 && rocket.phase !== 'idle';

  return (
    <div className="pointer-events-none relative flex items-start justify-between gap-3">
      {/* Brand */}
      <div className="hud-panel pointer-events-auto flex h-12 shrink-0 items-center gap-2.5 pl-2 pr-4">
        <img src="/logo-mark.png" alt="" className="h-9 w-9 select-none" draggable={false} />
        <div className="leading-tight">
          <h1 className="font-display text-[13px] font-semibold tracking-[0.1em] text-foreground">COSMIC PLAYGROUND</h1>
          <p className="hud-label text-[9.5px]">{mode === 'spacetime' ? 'Gravity sandbox' : 'Rocket simulator'}</p>
        </div>
      </div>

      {/* Mode switch */}
      <div className="hud-panel pointer-events-auto absolute left-1/2 top-0 -translate-x-1/2 p-1">
        <Segmented<AppMode>
          ariaLabel="Lab mode"
          layoutId="mode-switch"
          value={mode}
          onChange={onModeChange}
          options={[
            { value: 'spacetime', label: <><Orbit size={14} /> Spacetime <Kbd className="ml-0.5 hidden h-4 min-w-4 text-[9px] xl:inline-flex">1</Kbd></>, title: 'Spacetime lab (1)' },
            { value: 'rocket', label: <><Rocket size={14} /> Rocket <Kbd className="ml-0.5 hidden h-4 min-w-4 text-[9px] xl:inline-flex">2</Kbd></>, title: 'Rocket lab (2)' },
          ]}
        />
      </div>

      {/* Telemetry */}
      <div className="hud-panel pointer-events-auto flex h-12 shrink-0 items-center gap-5 pl-4 pr-1.5">
        {mode === 'spacetime' ? (
          <>
            <Readout label="Bodies" value={spacetime.bodies} className="w-12" />
            <Readout
              label="Time"
              value={!spacetime.isPlaying ? 'Paused' : spacetime.timeScale < 0 ? `◀ ${Math.abs(spacetime.timeScale)}×` : `${spacetime.timeScale}×`}
              tone={!spacetime.isPlaying ? 'default' : spacetime.timeScale < 0 ? 'warn' : 'primary'}
              className="w-14"
            />
            {spacetime.universeScale > 1.001 && (
              <Readout label="Expansion" value={`${spacetime.universeScale.toFixed(3)}×`} tone="violet" className="w-[68px]" />
            )}
          </>
        ) : (
          <>
            <Readout label="Altitude" value={rocket.altitude.toFixed(1)} className="w-14" />
            <Readout label="Velocity" value={speed.toFixed(2)} className="w-14" />
            <div className="grid w-16 gap-1 leading-tight">
              <span className="hud-label text-[9.5px]">Fuel</span>
              <div className="flex items-center gap-1.5">
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/10">
                  <div
                    className={`h-full rounded-full transition-[width] duration-200 ${fuelLow ? 'bg-danger' : 'bg-primary'}`}
                    style={{ width: `${fuelPct}%` }}
                  />
                </div>
                <span className={`hud-num text-[11px] ${fuelLow ? 'text-danger' : 'text-foreground'}`}>{fuelPct}</span>
              </div>
            </div>
            <Readout label="Phase" value={PHASE_LABEL[rocket.phase]} tone={rocket.phase === 'launching' ? 'warn' : rocket.phase === 'idle' ? 'default' : 'primary'} className="w-[70px]" />
          </>
        )}
        <div className="h-7 w-px bg-white/[0.08]" />
        <Readout label="Score" value={score} tone="primary" className="w-12" />
        <div className="flex items-center">
          <Popover>
            <PopoverTrigger asChild>
              <IconButton label="Keyboard shortcuts">
                <Keyboard size={15} />
              </IconButton>
            </PopoverTrigger>
            <PopoverContent align="end" sideOffset={10} className="hud-panel w-72 border-0 p-3 text-foreground">
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
          <IconButton label="Hide HUD (H)" onClick={onHideHud}>
            <EyeOff size={15} />
          </IconButton>
        </div>
      </div>
    </div>
  );
};

export default memo(TopBar);
