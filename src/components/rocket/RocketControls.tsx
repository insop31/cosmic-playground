import { RocketParams, RocketState, LaunchOutcome } from './rocketTypes';
import { Rocket, Gauge, Flame, Wind, Globe, Layers, ChevronRight, RotateCcw, Activity, Fuel, ArrowUp, Timer } from 'lucide-react';

interface RocketControlsProps {
  params: RocketParams;
  state: RocketState;
  onParamChange: (key: keyof RocketParams, value: number | boolean) => void;
  onLaunch: () => void;
  onReset: () => void;
}

interface SliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
  disabled?: boolean;
}

const SliderRow = ({ label, value, min, max, step, unit, onChange, disabled }: SliderRowProps) => {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className={`flex flex-col gap-1.5 ${disabled ? 'opacity-30 pointer-events-none' : ''}`}>
      <div className="flex justify-between items-center text-xs">
        <span className="text-muted-foreground font-medium">{label}</span>
        <span className="font-mono text-primary text-[11px] bg-primary/10 px-1.5 py-0.5 rounded">
          {value.toFixed(step < 1 ? 1 : 0)}{unit}
        </span>
      </div>
      <div className="relative">
        <div className="absolute inset-0 h-1.5 rounded-full bg-muted/30 top-1/2 -translate-y-1/2" />
        <div
          className="absolute h-1.5 rounded-full top-1/2 -translate-y-1/2"
          style={{
            width: `${pct}%`,
            background: `linear-gradient(90deg, hsl(var(--cyan-dim)), hsl(var(--primary)))`,
          }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="slider-space relative z-10"
        />
      </div>
    </div>
  );
};

const outcomeConfig: Record<LaunchOutcome, { text: string; emoji: string; colorClass: string }> = {
  none: { text: '', emoji: '', colorClass: '' },
  orbiting: { text: 'STABLE ORBIT ACHIEVED', emoji: '🛰️', colorClass: 'text-primary border-primary/30 bg-primary/10' },
  suborbital: { text: 'SUBORBITAL TRAJECTORY', emoji: '🪂', colorClass: 'text-secondary border-secondary/30 bg-secondary/10' },
  escape: { text: 'ESCAPE VELOCITY!', emoji: '🚀', colorClass: 'text-primary border-primary/30 bg-primary/10' },
  crashed: { text: 'IMPACT', emoji: '💥', colorClass: 'text-destructive border-destructive/30 bg-destructive/10' },
  burnup: { text: 'BURN-UP', emoji: '🔥', colorClass: 'text-destructive border-destructive/30 bg-destructive/10' },
};

const RocketControls = ({ params, state, onParamChange, onLaunch, onReset }: RocketControlsProps) => {
  const isActive = state.phase !== 'idle';
  const showOutcome = state.phase === 'outcome';
  const outcome = outcomeConfig[state.outcome];

  return (
    <div className="glass-panel-strong p-4 w-[280px] h-[calc(100vh-140px)] flex flex-col">
      <div className="flex-1 overflow-y-auto space-y-4 pr-1 scrollbar-thin">
      {/* Header */}
      <div className="flex items-center gap-2.5 pb-3 border-b border-border/30">
        <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center">
          <Rocket size={16} className="text-primary" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-foreground tracking-wide">LAUNCH CONTROL</h3>
          <p className="text-[10px] font-mono text-muted-foreground">Configure & Deploy</p>
        </div>
      </div>

      {/* Outcome Banner */}
      {showOutcome && (
        <div className={`p-3 rounded-lg border text-center animate-fade-in ${outcome.colorClass}`}>
          <p className="text-lg mb-1">{outcome.emoji}</p>
          <p className="text-xs font-bold tracking-wide">{outcome.text}</p>
          <div className="flex justify-center gap-3 mt-2 text-[10px] font-mono text-muted-foreground">
            <span>Max Alt: {state.maxAltitude.toFixed(1)}</span>
            <span>Time: {state.elapsed.toFixed(1)}s</span>
          </div>
        </div>
      )}

      {/* Telemetry Dashboard */}
      {isActive && (
        <div className="grid grid-cols-2 gap-2">
          <div className="p-2.5 rounded-lg bg-muted/20 border border-border/20">
            <div className="flex items-center gap-1 mb-1">
              <ArrowUp size={10} className="text-primary" />
              <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Altitude</p>
            </div>
            <p className="text-sm font-mono text-primary font-bold">{state.altitude.toFixed(1)}</p>
          </div>
          <div className="p-2.5 rounded-lg bg-muted/20 border border-border/20">
            <div className="flex items-center gap-1 mb-1">
              <Fuel size={10} className="text-primary" />
              <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Fuel</p>
            </div>
            <p className={`text-sm font-mono font-bold ${state.fuel > 0.2 ? 'text-primary' : 'text-destructive'}`}>
              {(state.fuel * 100).toFixed(0)}%
            </p>
          </div>
          <div className="p-2.5 rounded-lg bg-muted/20 border border-border/20">
            <div className="flex items-center gap-1 mb-1">
              <Activity size={10} className="text-muted-foreground" />
              <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Velocity</p>
            </div>
            <p className="text-sm font-mono text-foreground font-bold">
              {Math.sqrt(state.velocity[0] ** 2 + state.velocity[1] ** 2).toFixed(2)}
            </p>
          </div>
          <div className="p-2.5 rounded-lg bg-muted/20 border border-border/20">
            <div className="flex items-center gap-1 mb-1">
              <Timer size={10} className="text-muted-foreground" />
              <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Time</p>
            </div>
            <p className="text-sm font-mono text-foreground font-bold">{state.elapsed.toFixed(1)}s</p>
          </div>
        </div>
      )}

      {/* Propulsion Section */}
      <div>
        <div className="flex items-center gap-1.5 text-[10px] font-mono text-primary/70 uppercase tracking-widest mb-2.5">
          <Gauge size={10} /> Propulsion
        </div>
        <div className="space-y-3">
          <SliderRow label="Launch Angle" value={params.launchAngle} min={0} max={45} step={1} unit="°" onChange={(v) => onParamChange('launchAngle', v)} disabled={isActive} />
          <SliderRow label="Thrust Force" value={params.thrustForce} min={10} max={100} step={1} unit=" kN" onChange={(v) => onParamChange('thrustForce', v)} disabled={isActive} />
          <SliderRow label="Burn Duration" value={params.burnDuration} min={3} max={30} step={0.5} unit="s" onChange={(v) => onParamChange('burnDuration', v)} disabled={isActive} />
        </div>
      </div>

      {/* Mass Section */}
      <div>
        <div className="flex items-center gap-1.5 text-[10px] font-mono text-primary/70 uppercase tracking-widest mb-2.5">
          <Flame size={10} /> Mass
        </div>
        <div className="space-y-3">
          <SliderRow label="Fuel Mass" value={params.fuelMass} min={20} max={200} step={5} unit=" kg" onChange={(v) => onParamChange('fuelMass', v)} disabled={isActive} />
          <SliderRow label="Dry Mass" value={params.dryMass} min={5} max={80} step={1} unit=" kg" onChange={(v) => onParamChange('dryMass', v)} disabled={isActive} />
        </div>
      </div>

      {/* Environment Section */}
      <div>
        <div className="flex items-center gap-1.5 text-[10px] font-mono text-primary/70 uppercase tracking-widest mb-2.5">
          <Wind size={10} /> Environment
        </div>
        <div className="space-y-3">
          <SliderRow label="Drag Coeff" value={params.dragCoefficient} min={0} max={1} step={0.05} unit="" onChange={(v) => onParamChange('dragCoefficient', v)} disabled={isActive} />
          <SliderRow label="Atmo Density" value={params.atmosphericDensity} min={0} max={1} step={0.05} unit="" onChange={(v) => onParamChange('atmosphericDensity', v)} disabled={isActive} />
        </div>
      </div>

      {/* Planet Section */}
      <div>
        <div className="flex items-center gap-1.5 text-[10px] font-mono text-primary/70 uppercase tracking-widest mb-2.5">
          <Globe size={10} /> Planet
        </div>
        <div className="space-y-3">
          <SliderRow label="Gravity" value={params.gravity} min={1} max={25} step={0.5} unit=" m/s²" onChange={(v) => onParamChange('gravity', v)} disabled={isActive} />
          <SliderRow label="Planet Radius" value={params.planetRadius} min={10} max={100} step={5} unit=" km" onChange={(v) => onParamChange('planetRadius', v)} disabled={isActive} />
        </div>
      </div>

      {/* Stage Separation Toggle */}
      <div className="flex items-center justify-between py-2 px-1">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Layers size={12} /> Stage Separation
        </div>
        <button
          onClick={() => onParamChange('stageSeparation', !params.stageSeparation)}
          disabled={isActive}
          className={`w-10 h-5 rounded-full transition-all relative ${
            params.stageSeparation
              ? 'bg-primary/40 shadow-[0_0_8px_hsl(var(--primary)/0.3)]'
              : 'bg-muted/50'
          } ${isActive ? 'opacity-30' : ''}`}
        >
          <div className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${
            params.stageSeparation
              ? 'left-5 bg-primary'
              : 'left-0.5 bg-muted-foreground'
          }`} />
        </button>
      </div>
    </div>

    {/* Launch / Reset Button */}
    <div className="pt-4 mt-2 border-t border-border/20 shrink-0">
        {!isActive ? (
          <button
            onClick={onLaunch}
            className="w-full py-3.5 rounded-xl font-bold text-sm tracking-widest flex items-center justify-center gap-2 transition-all
              bg-gradient-to-r from-primary/20 to-primary/10 text-primary
              hover:from-primary/30 hover:to-primary/20
              border border-primary/20 hover:border-primary/40
              shadow-[0_0_20px_-5px_hsl(var(--primary)/0.3)]
              hover:shadow-[0_0_30px_-5px_hsl(var(--primary)/0.5)]
              active:scale-[0.98]"
          >
            <Rocket size={16} /> LAUNCH <ChevronRight size={14} />
          </button>
        ) : (
          <button
            onClick={onReset}
            className="w-full py-3.5 rounded-xl font-semibold text-sm tracking-wide flex items-center justify-center gap-2 transition-all
              bg-muted/20 text-muted-foreground border border-border/30
              hover:bg-muted/30 hover:text-foreground
              active:scale-[0.98]"
          >
            <RotateCcw size={14} /> RESET
          </button>
        )}
      </div>
    </div>
  );
};

export default RocketControls;
