import { Activity } from 'lucide-react';

export interface ConservationSample {
  time: number;
  energy: number;
  energyScale: number;
  momentumX: number;
  momentumZ: number;
  momentumScale: number;
  angularMomentum: number;
  angularMomentumScale: number;
}

interface ConservationPanelProps {
  samples: ConservationSample[];
  /** Simulated times of collisions in the window. */
  impactTimes: number[];
  realisticMode: boolean;
  expansionEnabled: boolean;
}

const WIDTH = 380;
const HEIGHT = 56;

interface Series {
  label: string;
  values: number[];
  color: string;
}

/** Change from the first sample, as a percentage of the quantity's size. */
const relative = (samples: ConservationSample[], pick: (s: ConservationSample) => number, scale: (s: ConservationSample) => number) => {
  if (samples.length === 0) return [];
  const base = pick(samples[0]);
  const size = Math.max(scale(samples[0]), 1e-300);
  return samples.map((s) => ((pick(s) - base) / size) * 100);
};

const Sparkline = ({ series, times, impactTimes }: { series: Series; times: number[]; impactTimes: number[] }) => {
  const t0 = times[0] ?? 0;
  const t1 = times[times.length - 1] ?? 1;
  const span = Math.max(t1 - t0, 1e-6);
  const maxAbs = Math.max(1e-4, ...series.values.map((v) => Math.abs(v)));
  const x = (t: number) => ((t - t0) / span) * WIDTH;
  const y = (v: number) => HEIGHT / 2 - (v / maxAbs) * (HEIGHT / 2 - 4);
  const points = series.values.map((v, k) => `${x(times[k]).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const latest = series.values[series.values.length - 1] ?? 0;
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-muted-foreground">{series.label}</span>
        <span className="font-mono tabular-nums" style={{ color: series.color }}>
          {latest >= 0 ? '+' : ''}{latest.toFixed(latest !== 0 && Math.abs(latest) < 0.01 ? 4 : 2)}%
        </span>
      </div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full h-14" role="img" aria-label={`${series.label}: ${latest.toFixed(3)}% change`}>
        <line x1={0} x2={WIDTH} y1={HEIGHT / 2} y2={HEIGHT / 2} stroke="currentColor" className="text-border" strokeDasharray="3 3" />
        {impactTimes.filter((t) => t >= t0 && t <= t1).map((t) => (
          <line key={t} x1={x(t)} x2={x(t)} y1={2} y2={HEIGHT - 2} stroke="#f87171" strokeOpacity={0.6} />
        ))}
        {series.values.length > 1 && <polyline points={points} fill="none" stroke={series.color} strokeWidth={1.8} />}
      </svg>
    </div>
  );
};

const ConservationPanel = ({ samples, impactTimes, realisticMode, expansionEnabled }: ConservationPanelProps) => {
  const times = samples.map((s) => s.time);
  const series: Series[] = [
    { label: 'Total energy', color: '#22d3ee', values: relative(samples, (s) => s.energy, (s) => s.energyScale) },
    {
      label: 'Total momentum',
      color: '#a78bfa',
      values: relative(samples, (s) => Math.hypot(s.momentumX, s.momentumZ), (s) => s.momentumScale),
    },
    { label: 'Angular momentum', color: '#4ade80', values: relative(samples, (s) => s.angularMomentum, (s) => s.angularMomentumScale) },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Activity size={14} className="text-primary" />
        Change since the start of the last {Math.round((times[times.length - 1] ?? 0) - (times[0] ?? 0))} s
      </div>
      {samples.length < 2 ? (
        <p className="text-sm text-muted-foreground">Press play to start recording.</p>
      ) : (
        series.map((s) => <Sparkline key={s.label} series={s} times={times} impactTimes={impactTimes} />)
      )}
      <p className="text-sm text-muted-foreground leading-snug">
        Gravity on its own never changes these totals. Collisions (red lines) turn kinetic energy into heat, so energy
        drops, but momentum stays the same.
      </p>
      {(!realisticMode || expansionEnabled) && (
        <p className="text-sm text-amber-300/90 leading-snug">
          {!realisticMode && 'Arcade mode caps speeds, which removes energy and momentum. '}
          {expansionEnabled && 'Universe expansion moves bodies apart without a force, so totals drift.'}
        </p>
      )}
    </div>
  );
};

export default ConservationPanel;
