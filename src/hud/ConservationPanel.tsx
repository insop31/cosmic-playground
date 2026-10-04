import { memo } from 'react';
import { Activity, ChevronUp } from 'lucide-react';
import { SIM_STEP } from '@/physics/simulation';
import { useAppStore } from '@/stores/appStore';
import { useSimStore, type ConservationSample } from '@/stores/simStore';
import { useSpacetimeStore } from '@/stores/spacetimeStore';
import { IconButton, InfoTip } from './controls';

const WIDTH = 260;
const HEIGHT = 40;

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
    <div className="grid gap-0.5">
      <div className="flex items-baseline justify-between">
        <span className="hud-label text-[9.5px]">{series.label}</span>
        <span className="hud-num text-[11.5px]" style={{ color: series.color }}>
          {latest >= 0 ? '+' : ''}{latest.toFixed(latest !== 0 && Math.abs(latest) < 0.01 ? 4 : 2)}%
        </span>
      </div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-10 w-full" role="img" aria-label={`${series.label}: ${latest.toFixed(3)}% change`}>
        <line x1={0} x2={WIDTH} y1={HEIGHT / 2} y2={HEIGHT / 2} stroke="hsl(var(--hud-line) / 0.2)" strokeDasharray="3 3" />
        {impactTimes.filter((t) => t >= t0 && t <= t1).map((t) => (
          <line key={t} x1={x(t)} x2={x(t)} y1={2} y2={HEIGHT - 2} stroke="hsl(var(--danger))" strokeOpacity={0.6} />
        ))}
        {series.values.length > 1 && <polyline points={points} fill="none" stroke={series.color} strokeWidth={1.6} vectorEffect="non-scaling-stroke" />}
      </svg>
    </div>
  );
};

/**
 * Energy, momentum and angular momentum of the whole system over the last minute of
 * simulated time: flat while only gravity acts, stepping at collisions.
 */
const ConservationPanel = () => {
  const open = useAppStore((state) => state.conservationOpen);
  const toggle = useAppStore((state) => state.toggleConservation);
  const samples = useSimStore((state) => state.conservation);
  const markers = useSimStore((state) => state.timeline.markers);
  const realisticMode = useSpacetimeStore((state) => state.realisticMode);
  const expansionEnabled = useSpacetimeStore((state) => state.expansionEnabled);

  if (!open) {
    return (
      <button
        type="button"
        onClick={toggle}
        title="Show conservation graphs"
        className="hud-panel hud-focus pointer-events-auto flex items-center gap-2 px-3 py-2 text-left text-[12px] text-hud-dim transition-colors hover:border-primary/40 hover:text-foreground"
      >
        <Activity size={13} className="text-primary" /> Conservation
      </button>
    );
  }

  const times = samples.map((s) => s.time);
  const series: Series[] = [
    { label: 'Total energy', color: 'hsl(190 90% 60%)', values: relative(samples, (s) => s.energy, (s) => s.energyScale) },
    { label: 'Total momentum', color: 'hsl(255 92% 76%)', values: relative(samples, (s) => Math.hypot(s.momentumX, s.momentumZ), (s) => s.momentumScale) },
    { label: 'Angular momentum', color: 'hsl(142 69% 58%)', values: relative(samples, (s) => s.angularMomentum, (s) => s.angularMomentumScale) },
  ];
  const impactTimes = markers.map((marker) => marker.step * SIM_STEP);

  return (
    <section aria-label="Conservation" className="hud-panel pointer-events-auto grid w-[300px] gap-2.5 p-3">
      <div className="flex items-center gap-2">
        <Activity size={14} className="text-primary" />
        <p className="hud-label flex-1">Conservation</p>
        <InfoTip label="Conservation" side="left">
          Gravity on its own never changes these totals. Collisions (red lines) turn kinetic energy into heat, so energy drops, but momentum stays the same.
        </InfoTip>
        <IconButton label="Hide conservation graphs" size="sm" onClick={toggle}>
          <ChevronUp size={14} />
        </IconButton>
      </div>
      <p className="hud-num text-[10.5px] text-hud-faint">
        Change over the last {Math.round((times[times.length - 1] ?? 0) - (times[0] ?? 0))} s of simulated time
      </p>
      {samples.length < 2 ? (
        <p className="text-[12px] text-hud-dim">Press play to start recording.</p>
      ) : (
        series.map((s) => <Sparkline key={s.label} series={s} times={times} impactTimes={impactTimes} />)
      )}
      {(!realisticMode || expansionEnabled) && (
        <p className="text-[11.5px] leading-snug text-warn">
          {!realisticMode && 'Arcade gravity caps speeds, which removes energy and momentum. '}
          {expansionEnabled && 'Universe expansion moves bodies apart without a force, so the totals drift.'}
        </p>
      )}
    </section>
  );
};

export default memo(ConservationPanel);
