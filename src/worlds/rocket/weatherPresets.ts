import type { RocketParams } from './rocketTypes';

export type WeatherConditionId =
  | 'wind'
  | 'lightning'
  | 'cloud'
  | 'precipitation'
  | 'temperature'
  | 'ice'
  | 'upperAtmo'
  | 'visibility';

export type WeatherSeverity = 'advisory' | 'caution' | 'warning' | 'danger';

export interface WeatherCondition {
  id: WeatherConditionId;
  name: string;
  icon: string;
  severity: WeatherSeverity;
  /** One-liner shown on the toggle chip */
  tagline: string;
  /** Detailed prediction shown in the pre-launch briefing */
  briefing: string;
  /** Additive deltas applied on top of the user's base RocketParams */
  paramEffects: Partial<Pick<RocketParams,
    | 'crosswind'
    | 'windShear'
    | 'dragCoefficient'
    | 'thermalLoad'
    | 'ambientTemperature'
    | 'atmosphericPressure'
    | 'atmosphericDensity'
  >>;
}

export const WEATHER_PRESETS: Record<WeatherConditionId, WeatherCondition> = {
  wind: {
    id: 'wind',
    name: 'Strong Winds',
    icon: '💨',
    severity: 'warning',
    tagline: 'Surface & upper-level winds impose structural stress.',
    briefing:
      'Crosswind forces will push the rocket off its planned trajectory. Lateral drift and increased structural load at Max-Q are expected. Guidance system will fight to correct — at a fuel cost.',
    paramEffects: { crosswind: 38, windShear: 0.3 },
  },
  lightning: {
    id: 'lightning',
    name: 'Lightning Risk',
    icon: '⚡',
    severity: 'danger',
    tagline: 'Active storm cells with high atmospheric electricity.',
    briefing:
      'Severe electrical activity drastically raises thermal and aerodynamic stress. The vehicle can trigger lightning during ascent. Engine cutoff or avionics failure is a genuine risk. Launch is strongly inadvisable.',
    paramEffects: { thermalLoad: 0.45, atmosphericDensity: 0.12 },
  },
  cloud: {
    id: 'cloud',
    name: 'Storm Cloud Cover',
    icon: '⛅',
    severity: 'caution',
    tagline: 'Electrically charged cloud layers in the ascent path.',
    briefing:
      'Dense cloud layers increase aerodynamic drag and trigger minor electrical stress on the vehicle skin during passage. Thermal signatures may be briefly confused by ground tracking.',
    paramEffects: { atmosphericDensity: 0.22, dragCoefficient: 0.1 },
  },
  precipitation: {
    id: 'precipitation',
    name: 'Rain / Hail',
    icon: '🌧',
    severity: 'warning',
    tagline: 'Rain and hail impact the rocket at high ascent speeds.',
    briefing:
      'High-speed impact from precipitation sharply raises drag and thermal penalties. Hailstones at ascent velocity can dent heat shields and damage sensor ports. Vehicle surface damage is likely during early flight.',
    paramEffects: { dragCoefficient: 0.2, thermalLoad: 0.22, ambientTemperature: -5 },
  },
  temperature: {
    id: 'temperature',
    name: 'Extreme Cold',
    icon: '🌡️',
    severity: 'danger',
    tagline: 'Sub-zero temperatures threatening fuel lines and seals.',
    briefing:
      'Cold temperatures reduce engine efficiency and risk catastrophic O-ring and seal failure. Fuel viscosity changes alter combustion dynamics. This condition has historically caused critical launch accidents — proceed with extreme caution.',
    paramEffects: { ambientTemperature: -42, atmosphericPressure: -0.08 },
  },
  ice: {
    id: 'ice',
    name: 'Ice Accumulation',
    icon: '🧊',
    severity: 'warning',
    tagline: 'Ice forming on the launch structure and vehicle skin.',
    briefing:
      'Ice sheets can detach during liftoff and strike the vehicle at high velocity. Additional drag from ice buildup and unexpected centre-of-mass shifts are anticipated. Pre-launch ice inspection is critical.',
    paramEffects: { dragCoefficient: 0.16, windShear: 0.1 },
  },
  upperAtmo: {
    id: 'upperAtmo',
    name: 'Jet Stream Activity',
    icon: '🌀',
    severity: 'caution',
    tagline: 'Wind shear and jet stream crossing the ascent corridor.',
    briefing:
      'Altitude wind shear will destabilise the vehicle after cloud-layer passage. The jet stream imposes rapid heading corrections at high altitude. Max-Q structural loads are significantly elevated during shear crossing.',
    paramEffects: { windShear: 0.42, crosswind: 14 },
  },
  visibility: {
    id: 'visibility',
    name: 'Low Visibility',
    icon: '🌫️',
    severity: 'advisory',
    tagline: 'Ground visibility below optimal tracking thresholds.',
    briefing:
      'Tracking and range safety teams have reduced optical coverage. Radar telemetry is unaffected, but visual confirmation of early-flight anomalies will be delayed. Launch may proceed — advisory hold only.',
    paramEffects: {},
  },
};

/** Tailwind classes for each severity, used on the toggle chip border/text */
export const SEVERITY_CHIP: Record<WeatherSeverity, string> = {
  advisory: 'border-blue-400/50  text-blue-300  bg-blue-400/10',
  caution:  'border-amber-400/50 text-amber-300 bg-amber-400/10',
  warning:  'border-orange-400/50 text-orange-300 bg-orange-400/10',
  danger:   'border-red-400/55   text-red-300   bg-red-400/12',
};

/** Tailwind classes for the severity badge pill */
export const SEVERITY_BADGE: Record<WeatherSeverity, string> = {
  advisory: 'bg-blue-400/20  text-blue-200',
  caution:  'bg-amber-400/20 text-amber-200',
  warning:  'bg-orange-400/20 text-orange-200',
  danger:   'bg-red-500/20   text-red-200',
};

/** Dot/accent colour for briefing rows */
export const SEVERITY_DOT: Record<WeatherSeverity, string> = {
  advisory: 'bg-blue-400',
  caution:  'bg-amber-400',
  warning:  'bg-orange-400',
  danger:   'bg-red-400',
};

/**
 * Returns a copy of `base` with all active weather condition effects applied.
 * Each numeric delta is clamped to its valid range so the simulation stays stable.
 */
export function applyWeatherToParams(
  base: RocketParams,
  active: Set<WeatherConditionId>,
): RocketParams {
  if (active.size === 0) return base;
  const r = { ...base };
  for (const id of active) {
    const fx = WEATHER_PRESETS[id].paramEffects;
    if (fx.crosswind !== undefined)
      r.crosswind = Math.max(-60, Math.min(60, r.crosswind + fx.crosswind));
    if (fx.windShear !== undefined)
      r.windShear = Math.min(1, r.windShear + fx.windShear);
    if (fx.dragCoefficient !== undefined)
      r.dragCoefficient = Math.min(1, r.dragCoefficient + fx.dragCoefficient);
    if (fx.thermalLoad !== undefined)
      r.thermalLoad = Math.min(1, r.thermalLoad + fx.thermalLoad);
    if (fx.ambientTemperature !== undefined)
      r.ambientTemperature = Math.max(-60, Math.min(60, r.ambientTemperature + fx.ambientTemperature));
    if (fx.atmosphericPressure !== undefined)
      r.atmosphericPressure = Math.max(0.6, Math.min(1.4, r.atmosphericPressure + fx.atmosphericPressure));
    if (fx.atmosphericDensity !== undefined)
      r.atmosphericDensity = Math.min(1, r.atmosphericDensity + fx.atmosphericDensity);
  }
  return r;
}

/** Human-readable summary of combined parameter deltas (non-zero deltas only) */
export function buildWeatherDeltaSummary(
  active: Set<WeatherConditionId>,
): { label: string; delta: string; severity: WeatherSeverity }[] {
  const totals: Record<string, number> = {};
  let maxSev: WeatherSeverity = 'advisory';

  const sevOrder: WeatherSeverity[] = ['advisory', 'caution', 'warning', 'danger'];
  const rankOf = (s: WeatherSeverity) => sevOrder.indexOf(s);

  for (const id of active) {
    const cond = WEATHER_PRESETS[id];
    if (rankOf(cond.severity) > rankOf(maxSev)) maxSev = cond.severity;
    for (const [k, v] of Object.entries(cond.paramEffects)) {
      totals[k] = (totals[k] ?? 0) + (v as number);
    }
  }

  const fmt = (v: number, unit: string, pos = true) =>
    `${pos && v > 0 ? '+' : ''}${v.toFixed(1)} ${unit}`.trim();

  const rows: { label: string; delta: string; severity: WeatherSeverity }[] = [];

  if (totals.crosswind)
    rows.push({ label: 'Crosswind', delta: fmt(totals.crosswind, 'm/s'), severity: maxSev });
  if (totals.windShear)
    rows.push({ label: 'Wind Shear', delta: fmt(totals.windShear, ''), severity: maxSev });
  if (totals.dragCoefficient)
    rows.push({ label: 'Drag Coeff', delta: fmt(totals.dragCoefficient, ''), severity: maxSev });
  if (totals.thermalLoad)
    rows.push({ label: 'Thermal Load', delta: fmt(totals.thermalLoad, ''), severity: maxSev });
  if (totals.ambientTemperature)
    rows.push({ label: 'Temperature', delta: fmt(totals.ambientTemperature, '°C'), severity: maxSev });
  if (totals.atmosphericPressure)
    rows.push({ label: 'Atmo Pressure', delta: fmt(totals.atmosphericPressure, 'atm'), severity: maxSev });
  if (totals.atmosphericDensity)
    rows.push({ label: 'Atmo Density', delta: fmt(totals.atmosphericDensity, ''), severity: maxSev });

  return rows;
}
