import { memo, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { RocketParams, RocketState, LaunchOutcome } from '@/worlds/rocket/rocketTypes';
import {
  WeatherConditionId,
  WEATHER_PRESETS,
  SEVERITY_CHIP,
  SEVERITY_BADGE,
  SEVERITY_DOT,
  buildWeatherDeltaSummary,
} from '@/worlds/rocket/weatherPresets';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronRight,
  Cloud,
  CloudFog,
  CloudLightning,
  CloudRain,
  Flame,
  FolderOpen,
  Gauge,
  Globe,
  Lock,
  Orbit,
  PanelLeftClose,
  Rocket,
  RotateCcw,
  Save,
  Snowflake,
  ThermometerSnowflake,
  Trash2,
  TrendingUp,
  Waves,
  Wind,
  X,
  Zap,
  Bookmark,
  ArrowUpRight,
} from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { AI_HINTS, type HintScenario, deriveHintScenario } from '@/worlds/rocket/rocketHints';
import type { SavedRocketPreset } from '@/lib/scenarioStorage';
import { HudSection, HudSlider, HudSwitch, IconButton } from './controls';

export type RocketFlightSummary = Pick<RocketState, 'phase' | 'outcome' | 'maxAltitude' | 'elapsed'>;

interface RocketControlsProps {
  params: RocketParams;
  state: RocketFlightSummary;
  onParamChange: (key: keyof RocketParams, value: number | boolean) => void;
  onLaunch: () => void;
  onReset: () => void;
  activeWeather: Set<WeatherConditionId>;
  onWeatherChange: (id: WeatherConditionId) => void;
  savedPresets: SavedRocketPreset[];
  onSavePreset: (name: string) => boolean;
  onLoadPreset: (presetId: string) => void;
  onDeletePreset: (presetId: string) => void;
  onCollapse?: () => void;
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

type SliderKey = Exclude<keyof RocketParams, 'stageSeparation'>;
interface SliderDef { key: SliderKey; label: string; min: number; max: number; step: number; unit: string }

const PROPULSION: SliderDef[] = [
  { key: 'launchAngle',  label: 'Launch angle',  min: 0,  max: 45,  step: 1,   unit: '°' },
  { key: 'thrustForce',  label: 'Thrust force',  min: 10, max: 100, step: 1,   unit: ' kN' },
  { key: 'burnDuration', label: 'Burn duration', min: 3,  max: 30,  step: 0.5, unit: ' s' },
];
const MASS: SliderDef[] = [
  { key: 'fuelMass', label: 'Fuel mass', min: 20, max: 200, step: 5, unit: ' kg' },
  { key: 'dryMass',  label: 'Dry mass',  min: 5,  max: 80,  step: 1, unit: ' kg' },
];
const ENVIRONMENT: SliderDef[] = [
  { key: 'dragCoefficient',     label: 'Drag coefficient',     min: 0,   max: 1,   step: 0.05, unit: '' },
  { key: 'atmosphericDensity',  label: 'Atmospheric density',  min: 0,   max: 1,   step: 0.05, unit: '' },
  { key: 'crosswind',           label: 'Crosswind',            min: -60, max: 60,  step: 1,    unit: ' m/s' },
  { key: 'windShear',           label: 'Wind shear',           min: 0,   max: 1,   step: 0.05, unit: '' },
  { key: 'thermalLoad',         label: 'Thermal load',         min: 0,   max: 1,   step: 0.05, unit: '' },
  { key: 'ambientTemperature',  label: 'Ambient temperature',  min: -60, max: 60,  step: 1,    unit: ' °C' },
  { key: 'atmosphericPressure', label: 'Atmospheric pressure', min: 0.6, max: 1.4, step: 0.02, unit: ' atm' },
  { key: 'padTilt',             label: 'Pad tilt',             min: -8,  max: 8,   step: 0.5,  unit: '°' },
];
const PLANET: SliderDef[] = [
  { key: 'gravity',      label: 'Gravity',       min: 1,  max: 25,  step: 0.5, unit: ' m/s²' },
  { key: 'planetRadius', label: 'Planet radius', min: 10, max: 100, step: 5,   unit: ' km' },
];

const WEATHER_ICON: Record<WeatherConditionId, ReactNode> = {
  wind: <Wind size={14} />,
  lightning: <Zap size={14} />,
  cloud: <CloudLightning size={14} />,
  precipitation: <CloudRain size={14} />,
  temperature: <ThermometerSnowflake size={14} />,
  ice: <Snowflake size={14} />,
  upperAtmo: <Waves size={14} />,
  visibility: <CloudFog size={14} />,
};

const outcomeConfig: Record<LaunchOutcome, { text: string; icon: ReactNode; tone: string }> = {
  none:       { text: '',                      icon: null,                       tone: '' },
  orbiting:   { text: 'Stable orbit achieved', icon: <Orbit size={18} />,        tone: 'border-ok/40 bg-ok/10 text-ok' },
  suborbital: { text: 'Suborbital trajectory', icon: <TrendingUp size={18} />,   tone: 'border-warn/40 bg-warn/10 text-warn' },
  escape:     { text: 'Escape velocity!',      icon: <ArrowUpRight size={18} />, tone: 'border-primary/40 bg-primary/10 text-primary' },
  crashed:    { text: 'Impact',                icon: <AlertTriangle size={18} />, tone: 'border-danger/40 bg-danger/10 text-danger' },
  burnup:     { text: 'Burn-up',               icon: <Flame size={18} />,        tone: 'border-danger/40 bg-danger/10 text-danger' },
};

const weatherConditionList = Object.values(WEATHER_PRESETS);
const DATE_FORMATTER = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

const PresetMenu = ({
  savedPresets,
  onSavePreset,
  onLoadPreset,
  onDeletePreset,
}: Pick<RocketControlsProps, 'savedPresets' | 'onSavePreset' | 'onLoadPreset' | 'onDeletePreset'>) => {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [note, setNote] = useState<string | null>(null);

  const handleSave = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) { setNote('Name the preset first.'); return; }
    if (onSavePreset(trimmed)) {
      setName('');
      setNote(`Saved “${trimmed}”.`);
    }
  };

  return (
    <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) setNote(null); }}>
      <PopoverTrigger asChild>
        <IconButton label="Rocket presets" size="sm" active={open}>
          <Bookmark size={14} />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="hud-panel w-80 border-0 p-3 text-foreground">
        <form onSubmit={handleSave} className="grid gap-2">
          <label htmlFor="rocket-preset-name" className="hud-label">Save current setup</label>
          <div className="flex gap-1.5">
            <input
              id="rocket-preset-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Heavy lift, calm day"
              maxLength={48}
              className="hud-focus h-8 min-w-0 flex-1 rounded-md border border-white/10 bg-white/[0.04] px-2.5 text-[12.5px] text-foreground placeholder:text-hud-faint focus:border-primary/50"
            />
            <button type="submit" className="hud-focus flex h-8 items-center gap-1.5 rounded-md border border-primary/40 bg-primary/15 px-3 text-[12.5px] font-medium text-primary hover:bg-primary/25">
              <Save size={13} /> Save
            </button>
          </div>
          <p className="min-h-4 text-[11.5px] leading-snug text-hud-dim" aria-live="polite">{note ?? 'Saves all 16 launch parameters in this browser.'}</p>
        </form>
        <div className="mt-2 grid gap-1.5 border-t border-white/[0.07] pt-3">
          <span className="hud-label">Saved presets</span>
          {savedPresets.length === 0 ? (
            <p className="py-2 text-[12px] text-hud-dim">No presets yet. Up to 12 are kept.</p>
          ) : (
            <ul className="hud-scroll grid max-h-56 gap-1 overflow-y-auto">
              {savedPresets.map((preset) => (
                <li key={preset.id} className="flex items-center gap-1.5 rounded-md border border-white/[0.06] bg-white/[0.02] py-1.5 pl-2.5 pr-1">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] text-foreground">{preset.name}</p>
                    <p className="hud-num text-[10.5px] text-hud-faint">
                      {preset.params.thrustForce} kN · {preset.params.launchAngle}° · {DATE_FORMATTER.format(new Date(preset.updatedAt))}
                    </p>
                  </div>
                  <IconButton label={`Load ${preset.name}`} size="sm" onClick={() => { onLoadPreset(preset.id); setOpen(false); }}>
                    <FolderOpen size={14} />
                  </IconButton>
                  <IconButton label={`Delete ${preset.name}`} size="sm" tone="danger" onClick={() => onDeletePreset(preset.id)}>
                    <Trash2 size={13} />
                  </IconButton>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};

const RocketControls = ({
  params,
  state,
  onParamChange,
  onLaunch,
  onReset,
  activeWeather,
  onWeatherChange,
  savedPresets,
  onSavePreset,
  onLoadPreset,
  onDeletePreset,
  onCollapse,
}: RocketControlsProps) => {
  const isActive = state.phase !== 'idle';
  const inFlight = state.phase === 'launching' || state.phase === 'coasting';
  const showOutcome = state.phase === 'outcome';
  const outcome = outcomeConfig[state.outcome];
  const hintScenario = useMemo(() => deriveHintScenario(params, state), [params, state]);
  const hintIndexRef = useRef<Record<HintScenario, number>>({} as Record<HintScenario, number>);
  const [activeHint, setActiveHint] = useState(AI_HINTS[hintScenario][0]);
  const [showBriefing, setShowBriefing] = useState(false);

  const handleIgnite = () => {
    if (activeWeather.size > 0) {
      setShowBriefing(true);
    } else {
      onLaunch();
    }
  };

  const handleProceed = () => {
    setShowBriefing(false);
    onLaunch();
  };

  const activeConditions = weatherConditionList.filter((c) => activeWeather.has(c.id));
  const deltaSummary = buildWeatherDeltaSummary(activeWeather);
  const hasDanger = activeConditions.some((c) => c.severity === 'danger');
  const hasWarning = activeConditions.some((c) => c.severity === 'warning');

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
    };

    advanceHint();
    const intervalId = window.setInterval(advanceHint, 6500);
    return () => window.clearInterval(intervalId);
  }, [hintScenario]);

  useEffect(() => {
    if (!showBriefing) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setShowBriefing(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [showBriefing]);

  const renderSliders = (defs: SliderDef[]) => (
    <div className="grid gap-4">
      {defs.map((def) => (
        <HudSlider
          key={def.key}
          label={def.label}
          info={PARAMETER_INFO[def.key]}
          value={params[def.key]}
          min={def.min}
          max={def.max}
          step={def.step}
          unit={def.unit}
          disabled={isActive}
          onChange={(v) => onParamChange(def.key, v)}
        />
      ))}
    </div>
  );

  return (
    <TooltipProvider delayDuration={150}>
      <div className="hud-panel relative flex h-full max-h-full w-[340px] flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2.5 px-4 pb-2.5 pt-3.5">
          <Rocket size={17} className="text-primary" />
          <h2 className="hud-title flex-1 text-foreground">Launch Control</h2>
          <PresetMenu savedPresets={savedPresets} onSavePreset={onSavePreset} onLoadPreset={onLoadPreset} onDeletePreset={onDeletePreset} />
          {onCollapse && (
            <IconButton label="Collapse dock ([)" onClick={onCollapse} size="sm">
              <PanelLeftClose size={15} />
            </IconButton>
          )}
        </div>

        {/* AI coach ticker */}
        <div className="mx-4 mb-3 flex gap-2.5 rounded-md border border-primary/20 bg-primary/[0.06] px-3 py-2.5">
          <Bot size={15} className="mt-0.5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="hud-label text-[9.5px] text-primary/80">Launch coach · {hintScenario.replace(/-/g, ' ')}</p>
            <AnimatePresence mode="wait" initial={false}>
              <motion.p
                key={activeHint}
                initial={{ opacity: 0, y: 3 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -3 }}
                transition={{ duration: 0.2 }}
                className="mt-0.5 text-[12.5px] leading-snug text-foreground/90"
              >
                {activeHint}
              </motion.p>
            </AnimatePresence>
          </div>
        </div>

        {/* Outcome / flight status */}
        <AnimatePresence initial={false}>
          {showOutcome && (
            <motion.div
              key="outcome"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className={`mx-4 mb-3 flex items-center gap-3 rounded-md border px-3 py-2.5 ${outcome.tone}`}>
                {outcome.icon}
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold uppercase tracking-[0.08em]">{outcome.text}</p>
                  <p className="hud-num text-[11px] text-hud-dim">
                    Max alt {state.maxAltitude.toFixed(1)} · {state.elapsed.toFixed(1)} s
                  </p>
                </div>
              </div>
            </motion.div>
          )}
          {inFlight && (
            <motion.div
              key="locked"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="mx-4 mb-3 flex items-center gap-2 rounded-md border border-warn/30 bg-warn/[0.07] px-3 py-2 text-[12px] text-warn">
                <span className="h-1.5 w-1.5 rounded-full bg-warn animate-pulse-dot" />
                <Lock size={12} /> Settings locked in flight
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="hud-divider" />

        {/* Parameters */}
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div className="hud-scroll min-h-0 flex-1 overflow-y-auto px-4">
            <HudSection
              title="Weather"
              icon={<Cloud size={13} />}
              defaultOpen
              aside={activeWeather.size > 0 ? (
                <span className="hud-num rounded-full border border-warn/40 bg-warn/10 px-2 py-0.5 text-[10.5px] text-warn">{activeWeather.size} active</span>
              ) : undefined}
            >
              <div className="grid grid-cols-2 gap-1.5">
                {weatherConditionList.map((cond) => {
                  const on = activeWeather.has(cond.id);
                  return (
                    <Tooltip key={cond.id}>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          disabled={isActive}
                          aria-pressed={on}
                          onClick={() => onWeatherChange(cond.id)}
                          className={`hud-focus flex items-center gap-2 rounded-md border px-2.5 py-2 text-left text-[12px] transition-colors duration-150 disabled:pointer-events-none disabled:opacity-40 ${
                            on ? SEVERITY_CHIP[cond.severity] : 'border-white/[0.06] bg-white/[0.02] text-foreground/75 hover:border-white/15 hover:bg-white/[0.05]'
                          }`}
                        >
                          <span className={on ? '' : 'text-hud-dim'}>{WEATHER_ICON[cond.id]}</span>
                          <span className="min-w-0 flex-1 leading-tight">{cond.name}</span>
                          {on && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${SEVERITY_DOT[cond.severity]}`} />}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="right" sideOffset={10} className="hud-panel max-w-[260px] border-0 px-3 py-2 text-[12.5px] leading-relaxed text-foreground">
                        <span className={`mb-1 inline-block rounded px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-widest ${SEVERITY_BADGE[cond.severity]}`}>{cond.severity}</span>
                        <br />
                        {cond.tagline}
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
              {activeWeather.size > 0 && (
                <p className="mt-2 text-[11.5px] leading-snug text-hud-dim">
                  Active conditions change your launch parameters. Ignite to see the full weather briefing.
                </p>
              )}
            </HudSection>

            <HudSection title="Propulsion" icon={<Gauge size={13} />} defaultOpen>
              {renderSliders(PROPULSION)}
              <div className="mt-4">
                <HudSwitch
                  label="Stage separation"
                  info={PARAMETER_INFO.stageSeparation}
                  checked={params.stageSeparation}
                  disabled={isActive}
                  onCheckedChange={(checked) => onParamChange('stageSeparation', checked)}
                />
              </div>
            </HudSection>

            <HudSection title="Mass" icon={<Flame size={13} />} defaultOpen={false}>
              {renderSliders(MASS)}
            </HudSection>

            <HudSection title="Environment" icon={<Wind size={13} />} defaultOpen={false}>
              {renderSliders(ENVIRONMENT)}
            </HudSection>

            <HudSection title="Planet" icon={<Globe size={13} />} defaultOpen={false}>
              {renderSliders(PLANET)}
            </HudSection>
          </div>

          {/* Weather briefing sheet */}
          <AnimatePresence>
            {showBriefing && (
              <motion.div
                key="briefing"
                className="absolute inset-0 z-20 flex flex-col justify-end"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
              >
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label="Dismiss weather alert"
                  className="absolute inset-0 cursor-default bg-background/60 backdrop-blur-[2px]"
                  onClick={() => setShowBriefing(false)}
                />
                <motion.div
                  initial={{ y: '105%' }}
                  animate={{ y: 0 }}
                  exit={{ y: '105%' }}
                  transition={{ type: 'spring', damping: 34, stiffness: 380 }}
                  className="relative z-10 mx-2 mb-2 flex max-h-[min(520px,88%)] flex-col overflow-hidden rounded-lg border border-white/10 bg-[hsl(var(--hud-surface))] shadow-[0_-16px_48px_rgba(0,0,0,0.6)]"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="weather-alert-title"
                >
                  <div className={`h-0.5 w-full shrink-0 ${hasDanger ? 'bg-danger' : hasWarning ? 'bg-orange-400' : 'bg-warn'}`} aria-hidden />
                  <div className="flex shrink-0 items-start justify-between gap-2 border-b border-white/[0.07] px-4 py-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <AlertTriangle size={18} className={hasDanger ? 'text-danger' : hasWarning ? 'text-orange-400' : 'text-warn'} />
                      <div className="min-w-0">
                        <h3 id="weather-alert-title" className="hud-title text-[13px] text-foreground">Weather alert</h3>
                        <p className="hud-num text-[11px] text-hud-dim">
                          {activeConditions.length} active condition{activeConditions.length !== 1 ? 's' : ''}
                        </p>
                      </div>
                    </div>
                    <IconButton label="Close weather alert" size="sm" onClick={() => setShowBriefing(false)}>
                      <X size={15} />
                    </IconButton>
                  </div>

                  <div className="hud-scroll min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3">
                    {activeConditions.map((cond) => (
                      <div key={cond.id} className={`rounded-md border px-3 py-2.5 ${SEVERITY_CHIP[cond.severity]}`}>
                        <div className="mb-1 flex items-center gap-2">
                          {WEATHER_ICON[cond.id]}
                          <span className="text-[12.5px] font-semibold text-foreground">{cond.name}</span>
                          <span className={`ml-auto rounded px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-widest ${SEVERITY_BADGE[cond.severity]}`}>
                            {cond.severity}
                          </span>
                        </div>
                        <p className="text-[12px] leading-relaxed text-foreground/80">{cond.briefing}</p>
                      </div>
                    ))}

                    {deltaSummary.length > 0 && (
                      <div className="rounded-md border border-white/[0.08] bg-white/[0.02] px-3 py-2.5">
                        <p className="hud-label mb-2">Combined parameter impact</p>
                        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                          {deltaSummary.map((row) => (
                            <div key={row.label} className="flex items-center gap-2">
                              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${SEVERITY_DOT[row.severity]}`} />
                              <span className="flex-1 truncate text-[11.5px] text-hud-dim">{row.label}</span>
                              <span className="hud-num text-[11.5px] font-semibold text-foreground">{row.delta}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className={`rounded-md border px-3 py-2 text-center text-[12px] font-medium ${
                      hasDanger
                        ? 'border-danger/45 bg-danger/10 text-danger'
                        : hasWarning
                          ? 'border-orange-400/45 bg-orange-400/10 text-orange-300'
                          : 'border-warn/45 bg-warn/10 text-warn'
                    }`}>
                      {hasDanger
                        ? 'Dangerous conditions — failure risk is high'
                        : hasWarning
                          ? 'Adverse conditions — mission success may be compromised'
                          : 'Advisory — conditions are manageable; proceed with caution'}
                    </div>
                  </div>

                  <div className="flex shrink-0 gap-2 border-t border-white/[0.07] px-4 py-3">
                    <button
                      type="button"
                      onClick={() => setShowBriefing(false)}
                      className="hud-focus flex-1 rounded-md border border-white/10 bg-white/[0.03] py-2.5 text-[12px] font-semibold uppercase tracking-[0.1em] text-hud-dim transition-colors hover:bg-white/[0.07] hover:text-foreground"
                    >
                      Hold launch
                    </button>
                    <button
                      type="button"
                      onClick={handleProceed}
                      className={`hud-focus flex flex-1 items-center justify-center gap-1.5 rounded-md border py-2.5 text-[12px] font-semibold uppercase tracking-[0.1em] transition-colors ${
                        hasDanger
                          ? 'border-danger/50 bg-danger/15 text-danger hover:bg-danger/25'
                          : 'border-primary/45 bg-primary/15 text-primary hover:bg-primary/25'
                      }`}
                    >
                      <CheckCircle2 size={14} /> Proceed
                    </button>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-white/[0.07] p-3">
          {!isActive ? (
            <motion.button
              type="button"
              whileTap={{ scale: 0.98 }}
              onClick={handleIgnite}
              className="hud-focus group relative flex h-11 w-full items-center justify-center gap-2 overflow-hidden rounded-lg border border-primary/50 bg-primary/20 font-display text-[14px] font-semibold uppercase tracking-[0.18em] text-primary transition-colors hover:bg-primary/30"
            >
              <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/10 to-transparent transition-transform duration-700 ease-hud group-hover:translate-x-full" />
              {activeWeather.size > 0 && <AlertTriangle size={14} className="text-warn" />}
              <Rocket size={16} /> Ignite <ChevronRight size={16} />
            </motion.button>
          ) : (
            <motion.button
              type="button"
              whileTap={{ scale: 0.98 }}
              onClick={onReset}
              className="hud-focus flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] font-display text-[14px] font-semibold uppercase tracking-[0.14em] text-foreground/80 transition-colors hover:border-white/20 hover:bg-white/[0.07] hover:text-foreground"
            >
              <RotateCcw size={15} /> {inFlight ? 'Abort & reset' : 'Reset'}
            </motion.button>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
};

export default memo(RocketControls);
