import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { differingParams, type NotebookEntry } from '../../lib/notebook';
import type { LaunchOutcome, RocketParams } from './rocketTypes';

interface LabNotebookProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entries: NotebookEntry[];
  onClear: () => void;
}

const OUTCOME_LABEL: Record<LaunchOutcome, string> = {
  none: '—',
  orbiting: 'Orbit',
  suborbital: 'Fell back',
  escape: 'Escape',
  crashed: 'Crash',
  burnup: 'Burn-up',
};

const OUTCOME_CLASS: Record<LaunchOutcome, string> = {
  none: 'text-muted-foreground',
  orbiting: 'text-primary',
  escape: 'text-primary',
  suborbital: 'text-secondary',
  crashed: 'text-destructive',
  burnup: 'text-destructive',
};

const PARAM_LABEL: Record<keyof RocketParams, string> = {
  launchAngle: 'Pitch-over (deg)',
  thrustForce: 'Thrust (kN)',
  fuelMass: 'Fuel (kg)',
  dryMass: 'Dry mass (kg)',
  burnDuration: 'Burn (s)',
  dragCoefficient: 'Drag coeff',
  gravity: 'Gravity (m/s²)',
  planetRadius: 'Planet radius',
  atmosphericDensity: 'Air density',
  crosswind: 'Crosswind (m/s)',
  windShear: 'Wind shear',
  thermalLoad: 'Thermal load',
  ambientTemperature: 'Temperature (C)',
  atmosphericPressure: 'Pressure (atm)',
  padTilt: 'Pad tilt (deg)',
  stageSeparation: 'Two stages',
  stage2Thrust: 'Stage 2 thrust (kN)',
  stage2FuelShare: 'Stage 2 fuel share',
};

const formatValue = (value: number | boolean) => (
  typeof value === 'boolean' ? (value ? 'yes' : 'no') : Number.isInteger(value) ? String(value) : value.toFixed(2)
);

const TIME_FORMAT = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Every launch, newest first; pick two to see exactly which settings changed and what that did. */
const LabNotebook = ({ open, onOpenChange, entries, onClear }: LabNotebookProps) => {
  const [selected, setSelected] = useState<string[]>([]);
  const toggle = (id: string) => setSelected((prev) => (
    prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id].slice(-2)
  ));
  const pair = selected.map((id) => entries.find((e) => e.id === id)).filter((e): e is NotebookEntry => Boolean(e));
  // Show the older run first so the comparison reads "before → after".
  const [before, after] = pair.length === 2 ? [...pair].sort((a, b) => a.createdAt.localeCompare(b.createdAt)) : [null, null];
  const changed = before && after ? differingParams(before.params, after.params) : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Lab notebook</DialogTitle>
          <DialogDescription>
            Every launch is written down here. Tick two runs to compare what you changed and what it did.
          </DialogDescription>
        </DialogHeader>

        {before && after && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm" aria-label="Run comparison">
            <div className="font-semibold mb-2">
              <span className={OUTCOME_CLASS[before.outcome]}>{OUTCOME_LABEL[before.outcome]}</span>
              {' → '}
              <span className={OUTCOME_CLASS[after.outcome]}>{OUTCOME_LABEL[after.outcome]}</span>
            </div>
            <table className="w-full text-xs font-mono tabular-nums">
              <thead>
                <tr className="text-muted-foreground text-left">
                  <th className="font-normal py-0.5">Setting</th>
                  <th className="font-normal text-right">Earlier run</th>
                  <th className="font-normal text-right">Later run</th>
                </tr>
              </thead>
              <tbody>
                {changed.length === 0 && (
                  <tr><td colSpan={3} className="py-1 text-muted-foreground">Same settings: any difference came from the weather.</td></tr>
                )}
                {changed.map((key) => (
                  <tr key={key}>
                    <td className="py-0.5">{PARAM_LABEL[key]}</td>
                    <td className="text-right">{formatValue(before.params[key])}</td>
                    <td className="text-right text-primary">{formatValue(after.params[key])}</td>
                  </tr>
                ))}
                {([
                  ['Weather', before.weather.join(', ') || 'clear', after.weather.join(', ') || 'clear'],
                  ['Δv budget', before.metrics.deltaV.toFixed(2), after.metrics.deltaV.toFixed(2)],
                  ['Peak altitude', before.metrics.peakAltitude.toFixed(1), after.metrics.peakAltitude.toFixed(1)],
                  ['Max-Q', before.metrics.maxQ.toFixed(2), after.metrics.maxQ.toFixed(2)],
                  ['Peak heat', `${Math.round(before.metrics.heat * 100)}%`, `${Math.round(after.metrics.heat * 100)}%`],
                ] as const).map(([label, a, b]) => (
                  <tr key={label} className="text-muted-foreground">
                    <td className="py-0.5">{label}</td>
                    <td className="text-right">{a}</td>
                    <td className="text-right">{b}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No launches yet. Fly a rocket and it will appear here.</p>
        ) : (
          <div className="space-y-1.5">
            {entries.map((entry) => (
              <label
                key={entry.id}
                className={`flex items-start gap-3 rounded-lg border p-2.5 text-sm cursor-pointer transition-colors ${
                  selected.includes(entry.id) ? 'border-primary/50 bg-primary/10' : 'border-border/30 bg-muted/10 hover:bg-muted/20'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selected.includes(entry.id)}
                  onChange={() => toggle(entry.id)}
                  className="mt-1"
                  aria-label={`Compare run from ${TIME_FORMAT.format(new Date(entry.createdAt))}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`font-semibold ${OUTCOME_CLASS[entry.outcome]}`}>{OUTCOME_LABEL[entry.outcome]}</span>
                    <span className="text-[11px] font-mono text-muted-foreground">{TIME_FORMAT.format(new Date(entry.createdAt))}</span>
                  </div>
                  <div className="text-xs text-foreground/80">{entry.cause}</div>
                  <div className="text-[11px] font-mono text-muted-foreground mt-0.5">
                    {entry.params.thrustForce} kN · {entry.params.fuelMass} kg fuel · {entry.params.launchAngle}° · {entry.params.stageSeparation ? 'two stages' : 'one stage'}
                    {entry.weather.length > 0 && ` · ${entry.weather.join(', ')}`}
                    {entry.prediction && ` · predicted ${OUTCOME_LABEL[entry.prediction]} ${entry.prediction === entry.outcome ? '✓' : '✗'}`}
                  </div>
                </div>
              </label>
            ))}
          </div>
        )}

        {entries.length > 0 && (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => { setSelected([]); onClear(); }}
              className="rounded-md border border-destructive/40 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10"
            >
              Clear notebook
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default LabNotebook;
