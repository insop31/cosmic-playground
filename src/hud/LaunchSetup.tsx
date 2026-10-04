import { memo, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  AlertTriangle,
  Bookmark,
  Bot,
  ChevronRight,
  CloudFog,
  CloudLightning,
  CloudRain,
  FolderOpen,
  Lock,
  PanelLeftClose,
  Rocket,
  RotateCcw,
  Save,
  Snowflake,
  ThermometerSnowflake,
  Trash2,
  Waves,
  Wind,
  Zap,
} from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { liftoffTwr } from '@/sim/rocket';
import { useAppStore } from '@/stores/appStore';
import { useFlightStore, type RocketStep } from '@/stores/flightStore';
import { useEffectiveRocketParams, useRocketStore } from '@/stores/rocketStore';
import { AI_HINTS, deriveHintScenario } from '@/worlds/rocket/rocketHints';
import type { RocketParams } from '@/worlds/rocket/rocketTypes';
import {
  SEVERITY_BADGE,
  SEVERITY_CHIP,
  SEVERITY_DOT,
  WEATHER_PRESETS,
  buildWeatherDeltaSummary,
  type WeatherConditionId,
} from '@/worlds/rocket/weatherPresets';
import { HudSlider, HudSwitch, IconButton } from './controls';

const PARAMETER_INFO: Record<keyof RocketParams, string> = {
  launchAngle: 'Pitch at liftoff, measured from vertical. Steeper climbs out of the air faster; shallower builds the sideways speed an orbit needs.',
  thrustForce: 'How hard the engines push. Thrust must exceed the vehicle’s weight to leave the pad.',
  fuelMass: 'Propellant carried. More fuel burns for longer but makes the vehicle heavier at liftoff.',
  dryMass: 'Structure and payload: the mass left when the tanks are empty.',
  burnDuration: 'How long the engines fire. The same fuel over a shorter burn means more thrust per second.',
  dragCoefficient: 'How much the vehicle’s shape resists moving through air.',
  gravity: 'Surface gravity of the planet. Earth is 9.8 m/s².',
  planetRadius: 'Size of the planet, which sets how the orbit is drawn.',
  atmosphericDensity: 'How thick the air is. Denser air means more drag and more heating.',
  crosswind: 'Steady sideways wind at the pad, in metres per second.',
  windShear: 'How much the wind changes with height. Strong shear pushes the vehicle around as it climbs.',
  thermalLoad: 'How sensitive the vehicle is to aerodynamic heating at high speed.',
  ambientTemperature: 'Air temperature at launch. Hot air slightly reduces engine performance.',
  atmosphericPressure: 'Surface air pressure. Engines perform a little worse in thick, high-pressure air.',
  padTilt: 'How far the pad leans off vertical, which adds to the launch angle.',
  stageSeparation: 'Shows the first stage separating and falling away at burnout. (This simplified model does not change the vehicle’s mass at separation.)',
};

type SliderKey = Exclude<keyof RocketParams, 'stageSeparation'>;
interface SliderDef { key: SliderKey; label: string; min: number; max: number; step: number; unit: string }

const VEHICLE: SliderDef[] = [
  { key: 'thrustForce',  label: 'Thrust',        min: 10, max: 100, step: 1,   unit: ' kN' },
  { key: 'burnDuration', label: 'Burn duration', min: 3,  max: 30,  step: 0.5, unit: ' s' },
  { key: 'fuelMass',     label: 'Fuel mass',     min: 20, max: 200, step: 5,   unit: ' kg' },
  { key: 'dryMass',      label: 'Dry mass',      min: 5,  max: 80,  step: 1,   unit: ' kg' },
  { key: 'launchAngle',  label: 'Launch angle',  min: 0,  max: 45,  step: 1,   unit: '°' },
];
const AIR: SliderDef[] = [
  { key: 'atmosphericDensity',  label: 'Air density',      min: 0,   max: 1,   step: 0.05, unit: '' },
  { key: 'dragCoefficient',     label: 'Drag coefficient', min: 0,   max: 1,   step: 0.05, unit: '' },
  { key: 'crosswind',           label: 'Crosswind',        min: -60, max: 60,  step: 1,    unit: ' m/s' },
  { key: 'windShear',           label: 'Wind shear',       min: 0,   max: 1,   step: 0.05, unit: '' },
  { key: 'thermalLoad',         label: 'Heating sensitivity', min: 0, max: 1,  step: 0.05, unit: '' },
  { key: 'ambientTemperature',  label: 'Temperature',      min: -60, max: 60,  step: 1,    unit: ' °C' },
  { key: 'atmosphericPressure', label: 'Air pressure',     min: 0.6, max: 1.4, step: 0.02, unit: ' atm' },
];
const LAUNCH: SliderDef[] = [
  { key: 'gravity',      label: 'Surface gravity', min: 1,  max: 25,  step: 0.5, unit: ' m/s²' },
  { key: 'planetRadius', label: 'Planet radius',   min: 10, max: 100, step: 5,   unit: ' u' },
  { key: 'padTilt',      label: 'Pad tilt',        min: -8, max: 8,   step: 0.5, unit: '°' },
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

const STEPS: { id: RocketStep; label: string }[] = [
  { id: 'vehicle', label: 'Vehicle' },
  { id: 'weather', label: 'Weather' },
  { id: 'launch', label: 'Launch' },
];

const weatherConditionList = Object.values(WEATHER_PRESETS);
const DATE_FORMATTER = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/* ─── Presets ──────────────────────────────────────────────────────────────── */

const PresetMenu = () => {
  const { savedPresets, savePreset, loadPreset, deletePreset } = useRocketStore(useShallow((state) => ({
    savedPresets: state.savedPresets,
    savePreset: state.savePreset,
    loadPreset: state.loadPreset,
    deletePreset: state.deletePreset,
  })));
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [note, setNote] = useState<string | null>(null);

  const handleSave = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) { setNote('Name the preset first.'); return; }
    if (savePreset(trimmed)) {
      setName('');
      setNote(`Saved “${trimmed}”.`);
    }
  };

  return (
    <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) setNote(null); }}>
      <PopoverTrigger asChild>
        <IconButton label="Saved setups" size="sm" active={open}>
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
              className="hud-focus h-8 min-w-0 flex-1 rounded-[5px] border border-[hsl(var(--hud-line)/0.16)] bg-white/[0.03] px-2.5 text-[12.5px] text-foreground placeholder:text-hud-faint focus:border-primary/50"
            />
            <button type="submit" className="hud-focus flex h-8 items-center gap-1.5 rounded-[5px] border border-primary/40 bg-primary/15 px-3 text-[12.5px] font-medium text-primary hover:bg-primary/25">
              <Save size={13} /> Save
            </button>
          </div>
          <p className="min-h-4 text-[11.5px] leading-snug text-hud-dim" aria-live="polite">{note ?? 'Saves every launch setting in this browser.'}</p>
        </form>
        <div className="mt-2 grid gap-1.5 border-t border-[hsl(var(--hud-line)/0.1)] pt-3">
          <span className="hud-label">Saved setups</span>
          {savedPresets.length === 0 ? (
            <p className="py-2 text-[12px] text-hud-dim">Nothing saved yet. Up to 12 are kept.</p>
          ) : (
            <ul className="hud-scroll grid max-h-56 gap-1 overflow-y-auto">
              {savedPresets.map((preset) => (
                <li key={preset.id} className="flex items-center gap-1.5 rounded-[5px] border border-[hsl(var(--hud-line)/0.1)] bg-white/[0.015] py-1.5 pl-2.5 pr-1">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] text-foreground">{preset.name}</p>
                    <p className="hud-num text-[10.5px] text-hud-faint">
                      {preset.params.thrustForce} kN · {preset.params.launchAngle}° · {DATE_FORMATTER.format(new Date(preset.updatedAt))}
                    </p>
                  </div>
                  <IconButton label={`Load ${preset.name}`} size="sm" onClick={() => { loadPreset(preset.id); setOpen(false); }}>
                    <FolderOpen size={14} />
                  </IconButton>
                  <IconButton label={`Delete ${preset.name}`} size="sm" tone="danger" onClick={() => deletePreset(preset.id)}>
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

/* ─── Coach ────────────────────────────────────────────────────────────────── */

const SetupCoach = ({ params }: { params: RocketParams }) => {
  const phase = useRocketStore((state) => state.flight.phase);
  const outcome = useRocketStore((state) => state.flight.outcome);
  const scenario = useMemo(() => deriveHintScenario(params, { phase, outcome }), [outcome, params, phase]);
  const [hint, setHint] = useState(AI_HINTS[scenario][0]);
  const lastIndex = useRef(-1);

  useEffect(() => {
    const advance = () => {
      const options = AI_HINTS[scenario];
      let next = Math.floor(Math.random() * options.length);
      if (options.length > 1 && next === lastIndex.current) next = (next + 1) % options.length;
      lastIndex.current = next;
      setHint(options[next]);
    };
    advance();
    const id = window.setInterval(advance, 8000);
    return () => window.clearInterval(id);
  }, [scenario]);

  return (
    <div className="flex gap-2.5 rounded-[5px] border border-primary/20 bg-primary/[0.05] px-3 py-2.5">
      <Bot size={15} className="mt-0.5 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <p className="hud-label text-[9.5px] text-primary/80">Launch coach</p>
        <p className="mt-0.5 text-[12.5px] leading-snug text-foreground/90" aria-live="polite">{hint}</p>
      </div>
    </div>
  );
};

/* ─── Readouts ─────────────────────────────────────────────────────────────── */

const TwrReadout = ({ params }: { params: RocketParams }) => {
  const twr = liftoffTwr(params);
  const tone = twr < 1 ? 'text-danger' : twr < 1.3 ? 'text-warn' : 'text-ok';
  return (
    <div className="rounded-[5px] border border-[hsl(var(--hud-line)/0.12)] bg-white/[0.015] px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="hud-label">Thrust-to-weight at liftoff</span>
        <span className={cn('hud-num text-[15px] font-medium', tone)}>{twr.toFixed(2)}</span>
      </div>
      <p className="mt-1 text-[11.5px] leading-snug text-hud-dim">
        {twr < 1
          ? 'Below 1: the engines cannot lift the vehicle off the pad. Add thrust or remove mass.'
          : twr < 1.3
            ? 'Barely above 1: it will lift off slowly and lose a lot to gravity on the way up.'
            : 'Comfortably above 1: the vehicle accelerates off the pad.'}
      </p>
    </div>
  );
};

/* ─── Panel ────────────────────────────────────────────────────────────────── */

/** Rocket Lab tool panel: a three-step launch setup, then Ignite. */
const LaunchSetup = () => {
  const params = useEffectiveRocketParams();
  const { phase, activeWeather, setParam, toggleWeather, resetFlight } = useRocketStore(useShallow((state) => ({
    phase: state.flight.phase,
    activeWeather: state.activeWeather,
    setParam: state.setParam,
    toggleWeather: state.toggleWeather,
    resetFlight: state.resetFlight,
  })));
  const step = useFlightStore((state) => state.setupStep);
  const setStep = useFlightStore((state) => state.setSetupStep);
  const countdown = useFlightStore((state) => state.countdown);
  const setCountdown = useFlightStore((state) => state.setCountdown);
  const setDockCollapsed = useAppStore((state) => state.setDockCollapsed);

  const locked = phase !== 'idle' || countdown !== null;
  const inFlight = phase === 'launching' || phase === 'coasting';
  const activeConditions = weatherConditionList.filter((c) => activeWeather.has(c.id));
  const deltaSummary = buildWeatherDeltaSummary(activeWeather);
  const worstSeverity = activeConditions.some((c) => c.severity === 'danger')
    ? 'danger'
    : activeConditions.some((c) => c.severity === 'warning') ? 'warning' : activeConditions.length ? 'caution' : null;
  const stepIndex = STEPS.findIndex((s) => s.id === step);

  const sliders = (defs: SliderDef[]) => (
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
          disabled={locked}
          onChange={(v) => setParam(def.key, v)}
        />
      ))}
    </div>
  );

  return (
    <div className="hud-panel relative flex h-full max-h-full w-[340px] flex-col overflow-hidden">
      <div className="flex items-center gap-2.5 px-4 pb-2.5 pt-3.5">
        <Rocket size={16} className="text-primary" />
        <h2 className="hud-title flex-1 text-foreground">Launch setup</h2>
        <PresetMenu />
        <IconButton label="Close panel ([)" onClick={() => setDockCollapsed(true)} size="sm">
          <PanelLeftClose size={15} />
        </IconButton>
      </div>

      {/* Step tabs: numbered because the order is the recommended workflow */}
      <div role="tablist" aria-label="Setup steps" className="mx-4 mb-3 grid grid-cols-3 gap-1 rounded-[5px] bg-white/[0.03] p-[3px]">
        {STEPS.map((s, index) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={step === s.id}
            onClick={() => setStep(s.id)}
            className={cn(
              'hud-focus flex h-8 items-center justify-center gap-1.5 rounded-[4px] text-[12.5px] font-medium transition-colors',
              step === s.id ? 'bg-primary/15 text-primary shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.35)]' : 'text-hud-dim hover:text-foreground',
            )}
          >
            <span className="hud-num text-[10.5px] opacity-70">{index + 1}</span> {s.label}
            {s.id === 'weather' && activeWeather.size > 0 && <span className={cn('h-1.5 w-1.5 rounded-full', SEVERITY_DOT[worstSeverity === 'danger' ? 'danger' : worstSeverity === 'warning' ? 'warning' : 'caution'])} />}
          </button>
        ))}
      </div>

      {locked && (
        <div className="mx-4 mb-3 flex items-center gap-2 rounded-[5px] border border-warn/30 bg-warn/[0.06] px-3 py-2 text-[12px] text-warn">
          <Lock size={12} /> {inFlight ? 'Settings are locked during flight.' : countdown !== null ? 'Countdown in progress.' : 'Reset to change the setup.'}
        </div>
      )}

      <div className="hud-divider" />

      <div className="hud-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {step === 'vehicle' && (
          <div className="grid gap-4">
            <TwrReadout params={params} />
            {sliders(VEHICLE)}
            <HudSwitch
              label="Stage separation"
              info={PARAMETER_INFO.stageSeparation}
              checked={params.stageSeparation}
              disabled={locked}
              onCheckedChange={(checked) => setParam('stageSeparation', checked)}
            />
          </div>
        )}

        {step === 'weather' && (
          <div className="grid gap-4">
            <div>
              <p className="hud-label mb-2">Conditions</p>
              <div className="grid grid-cols-2 gap-1.5">
                {weatherConditionList.map((cond) => {
                  const on = activeWeather.has(cond.id);
                  return (
                    <Tooltip key={cond.id}>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          disabled={locked}
                          aria-pressed={on}
                          onClick={() => toggleWeather(cond.id)}
                          className={cn(
                            'hud-focus flex items-center gap-2 rounded-[5px] border px-2.5 py-2 text-left text-[12px] transition-colors duration-150 disabled:pointer-events-none disabled:opacity-40',
                            on ? SEVERITY_CHIP[cond.severity] : 'border-[hsl(var(--hud-line)/0.1)] bg-white/[0.015] text-foreground/75 hover:border-[hsl(var(--hud-line)/0.25)]',
                          )}
                        >
                          <span className={on ? '' : 'text-hud-dim'}>{WEATHER_ICON[cond.id]}</span>
                          <span className="min-w-0 flex-1 leading-tight">{cond.name}</span>
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
            </div>

            {activeConditions.length > 0 && (
              <div className="grid gap-2 rounded-[5px] border border-[hsl(var(--hud-line)/0.12)] bg-white/[0.015] p-3">
                <p className="hud-label">Weather briefing</p>
                {activeConditions.map((cond) => (
                  <p key={cond.id} className="text-[12px] leading-relaxed text-foreground/85">
                    <span className="font-medium text-foreground">{cond.name}.</span> {cond.briefing}
                  </p>
                ))}
                {deltaSummary.length > 0 && (
                  <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 border-t border-[hsl(var(--hud-line)/0.1)] pt-2">
                    {deltaSummary.map((row) => (
                      <div key={row.label} className="flex items-center gap-2">
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${SEVERITY_DOT[row.severity]}`} />
                        <span className="flex-1 truncate text-[11.5px] text-hud-dim">{row.label}</span>
                        <span className="hud-num text-[11.5px] text-foreground">{row.delta}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div>
              <p className="hud-label mb-3">Air</p>
              {sliders(AIR)}
            </div>
          </div>
        )}

        {step === 'launch' && (
          <div className="grid gap-4">
            <SetupCoach params={params} />
            {sliders(LAUNCH)}
            <div className="grid grid-cols-3 gap-2 rounded-[5px] border border-[hsl(var(--hud-line)/0.12)] bg-white/[0.015] p-3">
              <div><p className="hud-label text-[9.5px]">Thrust</p><p className="hud-num text-[13px]">{params.thrustForce} kN</p></div>
              <div><p className="hud-label text-[9.5px]">Angle</p><p className="hud-num text-[13px]">{(params.launchAngle + params.padTilt).toFixed(1)}°</p></div>
              <div><p className="hud-label text-[9.5px]">Weather</p><p className="hud-num text-[13px]">{activeWeather.size ? `${activeWeather.size} active` : 'Clear'}</p></div>
            </div>
          </div>
        )}
      </div>

      <div className="flex shrink-0 gap-2 border-t border-[hsl(var(--hud-line)/0.1)] p-3">
        {!locked && stepIndex < STEPS.length - 1 && (
          <button
            type="button"
            onClick={() => setStep(STEPS[stepIndex + 1].id)}
            className="hud-focus flex h-11 items-center gap-1 rounded-[5px] border border-[hsl(var(--hud-line)/0.16)] px-3 text-[12.5px] text-hud-dim transition-colors hover:text-foreground"
          >
            Next <ChevronRight size={14} />
          </button>
        )}
        {phase === 'idle' && countdown === null ? (
          <button
            type="button"
            onClick={() => setCountdown(3)}
            className="hud-focus flex h-11 flex-1 items-center justify-center gap-2 rounded-[5px] border border-primary/50 bg-primary/15 font-display text-[12.5px] uppercase tracking-[0.14em] text-primary transition-colors hover:bg-primary/25"
          >
            {worstSeverity && <AlertTriangle size={14} className={worstSeverity === 'danger' ? 'text-danger' : 'text-warn'} />}
            Ignite
          </button>
        ) : (
          <button
            type="button"
            onClick={() => { setCountdown(null); resetFlight(); }}
            className="hud-focus flex h-11 flex-1 items-center justify-center gap-2 rounded-[5px] border border-[hsl(var(--hud-line)/0.16)] text-[12.5px] font-medium uppercase tracking-[0.1em] text-foreground/80 transition-colors hover:border-[hsl(var(--hud-line)/0.3)] hover:text-foreground"
          >
            <RotateCcw size={14} /> {inFlight || countdown !== null ? 'Abort and reset' : 'Reset'}
          </button>
        )}
      </div>
    </div>
  );
};

export default memo(LaunchSetup);
