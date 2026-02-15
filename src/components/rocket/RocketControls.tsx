import { RocketParams, RocketState, LaunchOutcome } from './rocketTypes';
import { Rocket, Gauge, Flame, Wind, Globe, Layers, ChevronRight } from 'lucide-react';

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

const SliderRow = ({ label, value, min, max, step, unit, onChange, disabled }: SliderRowProps) => (
  <div className={`flex flex-col gap-1 ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
    <div className="flex justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-primary">{value.toFixed(step < 1 ? 1 : 0)}{unit}</span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className="slider-space"
    />
  </div>
);

const outcomeLabels: Record<LaunchOutcome, { text: string; color: string }> = {
  none: { text: '', color: '' },
  orbiting: { text: '🛰️ STABLE ORBIT ACHIEVED', color: 'text-primary' },
  suborbital: { text: '🪂 SUBORBITAL TRAJECTORY', color: 'text-secondary' },
  escape: { text: '🚀 ESCAPE VELOCITY!', color: 'text-primary' },
  crashed: { text: '💥 IMPACT', color: 'text-destructive' },
  burnup: { text: '🔥 BURN-UP', color: 'text-destructive' },
};

const RocketControls = ({ params, state, onParamChange, onLaunch, onReset }: RocketControlsProps) => {
  const isActive = state.phase !== 'idle';
  const showOutcome = state.phase === 'outcome';

  return (
    <div className="glass-panel-strong p-4 w-72 max-h-[calc(100vh-120px)] overflow-y-auto animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <Rocket size={16} className="text-primary" />
        <h3 className="text-sm font-bold text-foreground tracking-wide">LAUNCH CONTROLS</h3>
      </div>

      {/* Outcome Banner */}
      {showOutcome && (
        <div className={`mb-4 p-3 rounded-lg bg-muted/30 border border-primary/20 text-center ${outcomeLabels[state.outcome].color}`}>
          <p className="text-sm font-bold">{outcomeLabels[state.outcome].text}</p>
          <p className="text-[10px] font-mono text-muted-foreground mt-1">
            Max Alt: {state.maxAltitude.toFixed(1)} · Time: {state.elapsed.toFixed(1)}s
          </p>
        </div>
      )}

      {/* Telemetry */}
      {isActive && (
        <div className="mb-4 grid grid-cols-2 gap-2">
          <div className="p-2 rounded-lg bg-muted/20">
            <p className="text-[10px] text-muted-foreground">Altitude</p>
            <p className="text-sm font-mono text-primary">{state.altitude.toFixed(1)}</p>
          </div>
          <div className="p-2 rounded-lg bg-muted/20">
            <p className="text-[10px] text-muted-foreground">Fuel</p>
            <p className="text-sm font-mono text-primary">{(state.fuel * 100).toFixed(0)}%</p>
          </div>
          <div className="p-2 rounded-lg bg-muted/20">
            <p className="text-[10px] text-muted-foreground">Vel X</p>
            <p className="text-sm font-mono text-foreground">{state.velocity[0].toFixed(2)}</p>
          </div>
          <div className="p-2 rounded-lg bg-muted/20">
            <p className="text-[10px] text-muted-foreground">Vel Y</p>
            <p className="text-sm font-mono text-foreground">{state.velocity[1].toFixed(2)}</p>
          </div>
        </div>
      )}

      {/* Sliders */}
      <div className="space-y-3">
        <div className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-1">
          <Gauge size={10} /> Propulsion
        </div>
        <SliderRow label="Launch Angle" value={params.launchAngle} min={0} max={45} step={1} unit="°" onChange={(v) => onParamChange('launchAngle', v)} disabled={isActive} />
        <SliderRow label="Thrust Force" value={params.thrustForce} min={10} max={100} step={1} unit=" kN" onChange={(v) => onParamChange('thrustForce', v)} disabled={isActive} />
        <SliderRow label="Burn Duration" value={params.burnDuration} min={3} max={30} step={0.5} unit="s" onChange={(v) => onParamChange('burnDuration', v)} disabled={isActive} />

        <div className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-1 mt-4">
          <Flame size={10} /> Mass
        </div>
        <SliderRow label="Fuel Mass" value={params.fuelMass} min={20} max={200} step={5} unit=" kg" onChange={(v) => onParamChange('fuelMass', v)} disabled={isActive} />
        <SliderRow label="Dry Mass" value={params.dryMass} min={5} max={80} step={1} unit=" kg" onChange={(v) => onParamChange('dryMass', v)} disabled={isActive} />

        <div className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-1 mt-4">
          <Wind size={10} /> Environment
        </div>
        <SliderRow label="Drag Coefficient" value={params.dragCoefficient} min={0} max={1} step={0.05} unit="" onChange={(v) => onParamChange('dragCoefficient', v)} disabled={isActive} />
        <SliderRow label="Atmo Density" value={params.atmosphericDensity} min={0} max={1} step={0.05} unit="" onChange={(v) => onParamChange('atmosphericDensity', v)} disabled={isActive} />

        <div className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-1 mt-4">
          <Globe size={10} /> Planet
        </div>
        <SliderRow label="Gravity" value={params.gravity} min={1} max={25} step={0.5} unit=" m/s²" onChange={(v) => onParamChange('gravity', v)} disabled={isActive} />
        <SliderRow label="Planet Radius" value={params.planetRadius} min={10} max={100} step={5} unit=" km" onChange={(v) => onParamChange('planetRadius', v)} disabled={isActive} />

        {/* Stage Separation Toggle */}
        <div className="flex items-center justify-between mt-3">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Layers size={12} /> Stage Separation
          </div>
          <button
            onClick={() => onParamChange('stageSeparation', !params.stageSeparation)}
            disabled={isActive}
            className={`w-10 h-5 rounded-full transition-colors ${
              params.stageSeparation ? 'bg-primary/60' : 'bg-muted'
            } ${isActive ? 'opacity-40' : ''}`}
          >
            <div className={`w-4 h-4 rounded-full bg-foreground transition-transform ${
              params.stageSeparation ? 'translate-x-5' : 'translate-x-0.5'
            }`} />
          </button>
        </div>
      </div>

      {/* Launch / Reset Button */}
      <div className="mt-5">
        {!isActive ? (
          <button
            onClick={onLaunch}
            className="w-full py-3 rounded-xl bg-primary/20 text-primary font-bold text-sm tracking-wide hover:bg-primary/30 transition-all glow-border flex items-center justify-center gap-2"
          >
            <Rocket size={16} /> LAUNCH <ChevronRight size={14} />
          </button>
        ) : (
          <button
            onClick={onReset}
            className="w-full py-3 rounded-xl bg-muted/30 text-muted-foreground font-semibold text-sm tracking-wide hover:bg-muted/50 transition-all"
          >
            RESET
          </button>
        )}
      </div>
    </div>
  );
};

export default RocketControls;
