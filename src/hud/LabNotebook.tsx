import { memo, useState } from 'react';
import { NotebookPen, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { differingParams, type NotebookEntry } from '@/lib/notebook';
import { useAppStore } from '@/stores/appStore';
import { useRocketStore } from '@/stores/rocketStore';
import type { LaunchOutcome, RocketParams } from '@/worlds/rocket/rocketTypes';

const OUTCOME_LABEL: Record<LaunchOutcome, string> = {
  none: '—',
  orbiting: 'Orbit',
  suborbital: 'Fell back',
  escape: 'Escape',
  crashed: 'Crash',
  burnup: 'Burn-up',
};

const OUTCOME_TONE: Record<LaunchOutcome, string> = {
  none: 'text-hud-dim',
  orbiting: 'text-ok',
  escape: 'text-primary',
  suborbital: 'text-warn',
  crashed: 'text-danger',
  burnup: 'text-danger',
};

const PARAM_LABEL: Record<keyof RocketParams, string> = {
  launchAngle: 'Pitch-over (°)',
  thrustForce: 'Thrust (kN)',
  fuelMass: 'Fuel (kg)',
  dryMass: 'Dry mass (kg)',
  burnDuration: 'Burn (s)',
  dragCoefficient: 'Drag coefficient',
  gravity: 'Gravity (m/s²)',
  planetRadius: 'Planet radius',
  atmosphericDensity: 'Air density',
  crosswind: 'Crosswind (m/s)',
  windShear: 'Wind shear',
  thermalLoad: 'Heating sensitivity',
  ambientTemperature: 'Temperature (°C)',
  atmosphericPressure: 'Pressure (atm)',
  padTilt: 'Pad tilt (°)',
  stageSeparation: 'Two stages',
  stage2Thrust: 'Stage 2 thrust (kN)',
  stage2FuelShare: 'Stage 2 fuel share',
};

const formatValue = (value: number | boolean) => (
  typeof value === 'boolean' ? (value ? 'yes' : 'no') : Number.isInteger(value) ? String(value) : value.toFixed(2)
);

const TIME_FORMAT = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

const Comparison = ({ before, after }: { before: NotebookEntry; after: NotebookEntry }) => {
  const changed = differingParams(before.params, after.params);
  const rows: [string, string, string][] = [
    ['Weather', before.weather.join(', ') || 'clear', after.weather.join(', ') || 'clear'],
    ['Δv budget', before.metrics.deltaV.toFixed(2), after.metrics.deltaV.toFixed(2)],
    ['Peak altitude', before.metrics.peakAltitude.toFixed(1), after.metrics.peakAltitude.toFixed(1)],
    ['Max-Q', before.metrics.maxQ.toFixed(2), after.metrics.maxQ.toFixed(2)],
    ['Peak heat', `${Math.round(before.metrics.heat * 100)}%`, `${Math.round(after.metrics.heat * 100)}%`],
  ];
  return (
    <section aria-label="Run comparison" className="rounded-[6px] border border-primary/30 bg-primary/[0.05] p-3">
      <p className="font-display text-[13px] uppercase tracking-[0.06em]">
        <span className={OUTCOME_TONE[before.outcome]}>{OUTCOME_LABEL[before.outcome]}</span>
        <span className="text-hud-dim"> → </span>
        <span className={OUTCOME_TONE[after.outcome]}>{OUTCOME_LABEL[after.outcome]}</span>
      </p>
      <table className="mt-2 w-full text-[12px]">
        <thead>
          <tr className="text-left">
            <th className="hud-label py-1 font-normal">Setting</th>
            <th className="hud-label py-1 text-right font-normal">Earlier run</th>
            <th className="hud-label py-1 text-right font-normal">Later run</th>
          </tr>
        </thead>
        <tbody className="hud-num">
          {changed.length === 0 && (
            <tr><td colSpan={3} className="py-1 text-hud-dim">Same settings: any difference came from the weather.</td></tr>
          )}
          {changed.map((key) => (
            <tr key={key} className="border-t border-[hsl(var(--hud-line)/0.08)]">
              <td className="py-1 font-sans text-foreground/85">{PARAM_LABEL[key]}</td>
              <td className="py-1 text-right">{formatValue(before.params[key])}</td>
              <td className="py-1 text-right text-primary">{formatValue(after.params[key])}</td>
            </tr>
          ))}
          {rows.map(([label, a, b]) => (
            <tr key={label} className="border-t border-[hsl(var(--hud-line)/0.08)] text-hud-dim">
              <td className="py-1 font-sans">{label}</td>
              <td className="py-1 text-right">{a}</td>
              <td className="py-1 text-right">{b}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
};

/** Every launch, newest first; pick two to see exactly which settings changed and what that did. */
const LabNotebook = () => {
  const open = useAppStore((state) => state.notebookOpen);
  const setOpen = useAppStore((state) => state.setNotebookOpen);
  const entries = useRocketStore((state) => state.notebook);
  const clear = useRocketStore((state) => state.clearNotebook);
  const [selected, setSelected] = useState<string[]>([]);

  const toggle = (id: string) => setSelected((prev) => (
    prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id].slice(-2)
  ));
  const pair = selected.map((id) => entries.find((e) => e.id === id)).filter((e): e is NotebookEntry => Boolean(e));
  // Show the older run first so the comparison reads "before → after".
  const [before, after] = pair.length === 2 ? [...pair].sort((a, b) => a.createdAt.localeCompare(b.createdAt)) : [null, null];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="hud-panel max-w-3xl gap-0 overflow-hidden border-white/10 bg-[hsl(var(--hud-surface)/0.96)] p-0 text-foreground sm:rounded-xl">
        <div className="border-b border-white/[0.07] px-6 py-5">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-display text-xl tracking-wide text-foreground">
              <NotebookPen size={18} className="text-primary" /> Lab notebook
            </DialogTitle>
            <DialogDescription className="text-[13px] text-hud-dim">
              Every launch is written down here. Tick two runs to compare what you changed and what it did.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="hud-scroll grid max-h-[70vh] gap-3 overflow-y-auto p-5">
          {before && after && <Comparison before={before} after={after} />}

          {entries.length === 0 ? (
            <p className="py-8 text-center text-[13px] text-hud-dim">No launches yet. Fly a rocket and it will appear here.</p>
          ) : (
            <ul className="grid gap-1.5">
              {entries.map((entry) => {
                const ticked = selected.includes(entry.id);
                return (
                  <li key={entry.id}>
                    <label
                      className={cn(
                        'flex cursor-pointer items-start gap-3 rounded-[6px] border p-2.5 transition-colors',
                        ticked ? 'border-primary/50 bg-primary/10' : 'border-[hsl(var(--hud-line)/0.12)] bg-white/[0.015] hover:border-[hsl(var(--hud-line)/0.25)]',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={ticked}
                        onChange={() => toggle(entry.id)}
                        className="mt-1 accent-[hsl(var(--primary))]"
                        aria-label={`Compare run from ${TIME_FORMAT.format(new Date(entry.createdAt))}`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className={cn('font-display text-[13px] uppercase tracking-[0.06em]', OUTCOME_TONE[entry.outcome])}>{OUTCOME_LABEL[entry.outcome]}</span>
                          <span className="hud-num text-[10.5px] text-hud-faint">{TIME_FORMAT.format(new Date(entry.createdAt))}</span>
                        </div>
                        <p className="text-[12.5px] leading-snug text-foreground/85">{entry.cause}</p>
                        <p className="hud-num mt-0.5 text-[10.5px] text-hud-faint">
                          {entry.params.thrustForce} kN · {entry.params.fuelMass} kg fuel · {entry.params.launchAngle}° · {entry.params.stageSeparation ? 'two stages' : 'one stage'}
                          {entry.weather.length > 0 && ` · ${entry.weather.join(', ')}`}
                          {entry.prediction && ` · predicted ${OUTCOME_LABEL[entry.prediction]} ${entry.prediction === entry.outcome ? '✓' : '✗'}`}
                        </p>
                      </div>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {entries.length > 0 && (
          <div className="flex justify-end border-t border-white/[0.07] px-5 py-3">
            <button
              type="button"
              onClick={() => { setSelected([]); clear(); }}
              className="hud-focus flex h-8 items-center gap-1.5 rounded-[5px] border border-danger/40 px-3 text-[12px] text-danger transition-colors hover:bg-danger/10"
            >
              <Trash2 size={13} /> Clear notebook
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default memo(LabNotebook);
