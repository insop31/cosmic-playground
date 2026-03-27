import { useEffect, useMemo, useRef, useState } from 'react';
import { RocketParams, RocketState, LaunchOutcome } from './rocketTypes';
import { Rocket, Gauge, Flame, Wind, Globe, Layers, ChevronRight, RotateCcw, Activity, Fuel, ArrowUp, Timer, Info, Bot } from 'lucide-react';
import { motion } from 'framer-motion';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import { AI_HINTS, type HintScenario, deriveHintScenario } from './rocketHints';

interface RocketControlsProps {
  params: RocketParams;
  state: RocketState;
  onParamChange: (key: keyof RocketParams, value: number | boolean) => void;
  onLaunch: () => void;
  onReset: () => void;
}

interface SliderRowProps {
  label: string;
  info: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
  disabled?: boolean;
}

const PARAMETER_INFO: Record<keyof RocketParams, string> = {
  launchAngle: 'Sets the rocket pitch at liftoff. Higher angles climb more vertically, while lower angles build horizontal speed earlier.',
  thrustForce: 'Controls how hard the engine pushes. More thrust improves acceleration and helps fight gravity and drag.',
  fuelMass: 'Defines how much propellant the rocket carries. More fuel extends powered flight but also makes the rocket heavier.',
  dryMass: 'The structural mass left after fuel is gone. A heavier dry mass makes the vehicle harder to accelerate.',
  burnDuration: 'Sets how long the engine burns. Longer burns spread thrust out over more time instead of delivering it all at once.',
  dragCoefficient: 'Represents how much aerodynamic resistance the rocket shape creates while moving through air.',
  gravity: 'Adjusts the planet gravity pulling the rocket downward. Higher gravity makes reaching orbit much harder.',
  planetRadius: 'Changes the visual size and orbital scale of the planet, which affects how the flight path is framed.',
  atmosphericDensity: 'Controls how thick the air is. Denser air increases drag and makes ascent less efficient.',
  crosswind: 'Applies a sideways wind that pushes the rocket left or right during ascent.',
  windShear: 'Adds altitude-dependent wind variation so winds can shift as the rocket climbs.',
  thermalLoad: 'Increases heating and aerodynamic penalty at high speed, making aggressive ascents riskier.',
  ambientTemperature: 'Changes launch-day temperature, slightly affecting engine efficiency and performance.',
  atmosphericPressure: 'Adjusts surface pressure, which changes how efficiently the engine performs near the ground.',
  padTilt: 'Tilts the launch pad away from perfectly upright. Small tilt changes can nudge the rocket into a different trajectory.',
  stageSeparation: 'Splits the flight into stages. When enabled, the vehicle can shed mass mid-flight for better efficiency.',
};

const SliderRow = ({ label, info, value, min, max, step, unit, onChange, disabled }: SliderRowProps) => {
  const pct = ((value - min) / (max - min)) * 100;

  return (
    <div className={`flex flex-col gap-1.5 ${disabled ? 'opacity-30 pointer-events-none' : ''}`}>
      <div className="flex justify-between items-center text-sm">
        <span className="text-muted-foreground font-medium flex items-center gap-1.5">
          {label}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="inline-flex items-center justify-center text-muted-foreground/70 hover:text-primary transition-colors"
                aria-label={`Explain ${label}`}
              >
                <Info size={12} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={10} className="max-w-[280px] text-sm leading-relaxed">
              {info}
            </TooltipContent>
          </Tooltip>
        </span>
        <span className="font-mono text-sm text-primary bg-primary/10 px-2 py-0.5 rounded">
          {value.toFixed(step < 1 ? 1 : 0)}{unit}
        </span>
      </div>
      <div className="relative">
        <div className="absolute inset-0 h-1.5 rounded-full bg-muted/30 top-1/2 -translate-y-1/2" />
        <div
          className="absolute h-1.5 rounded-full top-1/2 -translate-y-1/2"
          style={{
            width: `${pct}%`,
            background: 'linear-gradient(90deg, hsl(var(--cyan-dim)), hsl(var(--primary)))',
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
  orbiting: { text: 'STABLE ORBIT ACHIEVED', emoji: 'Orbit', colorClass: 'text-primary border-primary/30 bg-primary/10' },
  suborbital: { text: 'SUBORBITAL TRAJECTORY', emoji: 'Arc', colorClass: 'text-secondary border-secondary/30 bg-secondary/10' },
  escape: { text: 'ESCAPE VELOCITY!', emoji: 'Escape', colorClass: 'text-primary border-primary/30 bg-primary/10' },
  crashed: { text: 'IMPACT', emoji: 'Impact', colorClass: 'text-destructive border-destructive/30 bg-destructive/10' },
  burnup: { text: 'BURN-UP', emoji: 'Heat', colorClass: 'text-destructive border-destructive/30 bg-destructive/10' },
};

const RocketControls = ({ params, state, onParamChange, onLaunch, onReset }: RocketControlsProps) => {
  const isActive = state.phase !== 'idle';
  const showOutcome = state.phase === 'outcome';
  const outcome = outcomeConfig[state.outcome];
  const hintScenario = useMemo(() => deriveHintScenario(params, state), [params, state]);
  const hintIndexRef = useRef<Record<HintScenario, number>>({} as Record<HintScenario, number>);
  const [activeHint, setActiveHint] = useState(AI_HINTS[hintScenario][0]);
  const [hintTick, setHintTick] = useState(0);

  const planetTheme = {
    '--primary': '216 64% 57%',
    '--secondary': '216 64% 75%',
    '--cyan-dim': '216 64% 30%',
  } as React.CSSProperties;

  useEffect(() => {
    const advanceHint = () => {
      const options = AI_HINTS[hintScenario];
      const previousIndex = hintIndexRef.current[hintScenario] ?? -1;
      let nextIndex = 0;
      if (options.length > 1) {
        nextIndex = Math.floor(Math.random() * options.length);
        while (nextIndex === previousIndex) {
          nextIndex = Math.floor(Math.random() * options.length);
        }
      }
      hintIndexRef.current[hintScenario] = nextIndex;
      setActiveHint(options[nextIndex]);
      setHintTick((tick) => tick + 1);
    };

    advanceHint();
    const intervalId = window.setInterval(advanceHint, 6500);
    return () => window.clearInterval(intervalId);
  }, [hintScenario]);

  return (
    <TooltipProvider delayDuration={150}>
      <div style={planetTheme} className="glass-panel-strong p-7 w-[440px] h-[calc(100vh-140px)] flex flex-col border border-white/10 shadow-[0_0_30px_rgba(45,55,72,0.5)] overflow-visible">
        <div className="sticky top-0 z-20 rounded-2xl border border-primary/45 bg-[linear-gradient(135deg,rgba(96,165,250,0.28),rgba(148,163,184,0.14))] px-5 py-4 mb-5 shadow-[0_0_32px_rgba(96,165,250,0.22)] backdrop-blur-xl shrink-0">
          <div className="flex items-center gap-2 mb-2">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-xl bg-primary/18 border border-primary/35 flex items-center justify-center shadow-[0_0_18px_rgba(96,165,250,0.24)]">
                <Bot size={18} className="text-primary" />
              </div>
              <div>
                <div className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">AI Launch Coach</div>
                <div className="text-[11px] font-mono uppercase tracking-[0.2em] text-secondary/85">Always-on guidance</div>
              </div>
            </div>
          </div>
          <div className="text-xs font-mono uppercase tracking-[0.18em] text-secondary mb-2">
            Scenario: {hintScenario.replaceAll('-', ' ')}
          </div>
          <p className="text-[15px] text-foreground leading-relaxed font-medium">{activeHint}</p>
        </div>

        <div className="flex-1 overflow-y-auto space-y-5 pr-2 scrollbar-thin">
          <div className="flex items-center gap-3 pb-4 border-b border-white/10">
            <div className="w-12 h-12 rounded-xl bg-secondary/20 flex items-center justify-center glow-border border border-secondary/30">
              <Rocket size={22} className="text-secondary" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-foreground tracking-widest leading-tight uppercase">LAUNCH CONTROL</h3>
              <p className="text-sm font-mono text-secondary tracking-wider">SYSTEM CONFIG</p>
            </div>
          </div>

          {showOutcome && (
            <div className={`p-3 rounded-lg border text-center animate-fade-in ${outcome.colorClass}`}>
              <p className="text-xl mb-1">{outcome.emoji}</p>
              <p className="text-base font-bold tracking-wide">{outcome.text}</p>
              <div className="flex justify-center gap-3 mt-2 text-sm font-mono text-muted-foreground">
                <span>Max Alt: {state.maxAltitude.toFixed(1)}</span>
                <span>Time: {state.elapsed.toFixed(1)}s</span>
              </div>
            </div>
          )}

          {isActive && (
            <div className="grid grid-cols-2 gap-2">
              <div className="p-3 rounded-lg glass-panel bg-muted/10 border-border/30 shadow-inner">
                <div className="flex items-center gap-1 mb-1">
                  <ArrowUp size={10} className="text-primary" />
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Altitude</p>
                </div>
                <p className="text-xl font-mono text-primary font-bold">{state.altitude.toFixed(1)}</p>
              </div>
              <div className="p-3 rounded-lg glass-panel bg-muted/10 border-border/30 shadow-inner">
                <div className="flex items-center gap-1 mb-1">
                  <Fuel size={10} className="text-primary" />
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Fuel</p>
                </div>
                <p className={`text-xl font-mono font-bold ${state.fuel > 0.2 ? 'text-primary' : 'text-destructive'}`}>
                  {(state.fuel * 100).toFixed(0)}%
                </p>
              </div>
              <div className="p-3 rounded-lg glass-panel bg-muted/10 border-border/30 shadow-inner">
                <div className="flex items-center gap-1 mb-1">
                  <Activity size={10} className="text-muted-foreground" />
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Velocity</p>
                </div>
                <p className="text-xl font-mono text-foreground font-bold">
                  {Math.sqrt(state.velocity[0] ** 2 + state.velocity[1] ** 2).toFixed(2)}
                </p>
              </div>
              <div className="p-3 rounded-lg glass-panel bg-muted/10 border-border/30 shadow-inner">
                <div className="flex items-center gap-1 mb-1">
                  <Timer size={10} className="text-muted-foreground" />
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Time</p>
                </div>
                <p className="text-xl font-mono text-foreground font-bold">{state.elapsed.toFixed(1)}s</p>
              </div>
            </div>
          )}

          <div>
            <div className="flex items-center gap-1.5 text-sm font-mono text-primary/70 uppercase tracking-widest mb-2.5">
              <Gauge size={10} /> Propulsion
            </div>
            <div className="space-y-3">
              <SliderRow label="Launch Angle" info={PARAMETER_INFO.launchAngle} value={params.launchAngle} min={0} max={45} step={1} unit=" deg" onChange={(v) => onParamChange('launchAngle', v)} disabled={isActive} />
              <SliderRow label="Thrust Force" info={PARAMETER_INFO.thrustForce} value={params.thrustForce} min={10} max={100} step={1} unit=" kN" onChange={(v) => onParamChange('thrustForce', v)} disabled={isActive} />
              <SliderRow label="Burn Duration" info={PARAMETER_INFO.burnDuration} value={params.burnDuration} min={3} max={30} step={0.5} unit=" s" onChange={(v) => onParamChange('burnDuration', v)} disabled={isActive} />
            </div>
          </div>

          <div>
            <div className="flex items-center gap-1.5 text-sm font-mono text-primary/70 uppercase tracking-widest mb-2.5">
              <Flame size={10} /> Mass
            </div>
            <div className="space-y-3">
              <SliderRow label="Fuel Mass" info={PARAMETER_INFO.fuelMass} value={params.fuelMass} min={20} max={200} step={5} unit=" kg" onChange={(v) => onParamChange('fuelMass', v)} disabled={isActive} />
              <SliderRow label="Dry Mass" info={PARAMETER_INFO.dryMass} value={params.dryMass} min={5} max={80} step={1} unit=" kg" onChange={(v) => onParamChange('dryMass', v)} disabled={isActive} />
            </div>
          </div>

          <div>
            <div className="flex items-center gap-1.5 text-sm font-mono text-primary/70 uppercase tracking-widest mb-2.5">
              <Wind size={10} /> Environment
            </div>
            <div className="space-y-3">
              <SliderRow label="Drag Coeff" info={PARAMETER_INFO.dragCoefficient} value={params.dragCoefficient} min={0} max={1} step={0.05} unit="" onChange={(v) => onParamChange('dragCoefficient', v)} disabled={isActive} />
              <SliderRow label="Atmo Density" info={PARAMETER_INFO.atmosphericDensity} value={params.atmosphericDensity} min={0} max={1} step={0.05} unit="" onChange={(v) => onParamChange('atmosphericDensity', v)} disabled={isActive} />
              <SliderRow label="Crosswind" info={PARAMETER_INFO.crosswind} value={params.crosswind} min={-60} max={60} step={1} unit=" m/s" onChange={(v) => onParamChange('crosswind', v)} disabled={isActive} />
              <SliderRow label="Wind Shear" info={PARAMETER_INFO.windShear} value={params.windShear} min={0} max={1} step={0.05} unit="" onChange={(v) => onParamChange('windShear', v)} disabled={isActive} />
              <SliderRow label="Thermal Load" info={PARAMETER_INFO.thermalLoad} value={params.thermalLoad} min={0} max={1} step={0.05} unit="" onChange={(v) => onParamChange('thermalLoad', v)} disabled={isActive} />
              <SliderRow label="Ambient Temp" info={PARAMETER_INFO.ambientTemperature} value={params.ambientTemperature} min={-60} max={60} step={1} unit=" C" onChange={(v) => onParamChange('ambientTemperature', v)} disabled={isActive} />
              <SliderRow label="Atmo Pressure" info={PARAMETER_INFO.atmosphericPressure} value={params.atmosphericPressure} min={0.6} max={1.4} step={0.02} unit=" atm" onChange={(v) => onParamChange('atmosphericPressure', v)} disabled={isActive} />
              <SliderRow label="Pad Tilt" info={PARAMETER_INFO.padTilt} value={params.padTilt} min={-8} max={8} step={0.5} unit=" deg" onChange={(v) => onParamChange('padTilt', v)} disabled={isActive} />
            </div>
          </div>

          <div>
            <div className="flex items-center gap-1.5 text-sm font-mono text-primary/70 uppercase tracking-widest mb-2.5">
              <Globe size={10} /> Planet
            </div>
            <div className="space-y-3">
              <SliderRow label="Gravity" info={PARAMETER_INFO.gravity} value={params.gravity} min={1} max={25} step={0.5} unit=" m/s2" onChange={(v) => onParamChange('gravity', v)} disabled={isActive} />
              <SliderRow label="Planet Radius" info={PARAMETER_INFO.planetRadius} value={params.planetRadius} min={10} max={100} step={5} unit=" km" onChange={(v) => onParamChange('planetRadius', v)} disabled={isActive} />
            </div>
          </div>

          <div className="flex items-center justify-between py-2 px-1">
            <div className="flex items-center gap-1.5 text-base text-muted-foreground">
              <Layers size={12} /> Stage Separation
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex items-center justify-center text-muted-foreground/70 hover:text-primary transition-colors"
                    aria-label="Explain Stage Separation"
                  >
                    <Info size={12} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={10} className="max-w-[280px] text-sm leading-relaxed">
                  {PARAMETER_INFO.stageSeparation}
                </TooltipContent>
              </Tooltip>
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

        <div className="pt-5 mt-2 border-t border-white/10 shrink-0">
          {!isActive ? (
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={onLaunch}
              className="w-full py-3.5 rounded-xl font-bold text-base tracking-widest flex items-center justify-center gap-2 transition-all
                bg-gradient-to-r from-secondary/30 to-secondary/10 text-secondary
                hover:from-secondary/40 hover:to-secondary/20
                border border-secondary/30 hover:border-secondary/50
                shadow-[0_0_20px_rgba(45,55,72,0.4)] hover:shadow-[0_0_30px_rgba(45,55,72,0.6)]
                relative overflow-hidden group"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-[100%] group-hover:animate-[shimmer_1.5s_infinite]" />
              <Rocket size={16} /> IGNITE <ChevronRight size={16} />
            </motion.button>
          ) : (
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={onReset}
              className="w-full py-3.5 rounded-xl font-bold text-base tracking-widest flex items-center justify-center gap-2 transition-all
                bg-black/30 text-muted-foreground border border-white/10
                hover:bg-white/5 hover:text-foreground hover:border-white/20"
            >
              <RotateCcw size={16} /> ABORT & RESET
            </motion.button>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
};

export default RocketControls;
