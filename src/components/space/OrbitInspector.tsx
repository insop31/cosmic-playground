import { Crosshair, Pin, X } from 'lucide-react';
import type { CelestialBody } from '../../physics/types';
import { REALISTIC_G } from '../../physics/constants';
import { orbitalElements } from '../../physics/orbits';
import {
  STATE_STRIDE,
  S_DOMINANT,
  S_PINNED,
  S_VX,
  S_VZ,
  S_X,
  S_Z,
  type SimSnapshot,
} from '../../physics/simulation';
import {
  DAYS_PER_YEAR,
  formatDuration,
  formatMass,
  simSecondsToDays,
  toAU,
  toKmPerSecond,
  toSolarMasses,
} from '../../physics/units';

interface OrbitInspectorProps {
  snapshot: SimSnapshot | null;
  bodies: CelestialBody[];
  selectedId: string | null;
  onClear: () => void;
  onPin: (id: string, pinned: boolean) => void;
}

const describeShape = (e: number) => {
  if (e < 0.05) return 'nearly circular';
  if (e < 0.3) return 'slightly oval';
  if (e < 0.7) return 'oval';
  return 'very stretched';
};

const Row = ({ label, value, hint }: { label: string; value: string; hint?: string }) => (
  <div className="flex items-baseline justify-between gap-3 border-b border-border/20 py-1.5">
    <span className="text-sm text-muted-foreground" title={hint}>{label}</span>
    <span className="font-mono text-sm text-foreground tabular-nums">{value}</span>
  </div>
);

const OrbitInspector = ({ snapshot, bodies, selectedId, onClear, onPin }: OrbitInspectorProps) => {
  const nameOf = (id: string) => {
    const body = bodies.find((b) => b.id === id);
    return body?.name ?? (body ? body.type.charAt(0).toUpperCase() + body.type.slice(1) : 'Unknown');
  };

  const i = snapshot && selectedId ? snapshot.ids.indexOf(selectedId) : -1;
  if (!snapshot || !selectedId || i < 0) {
    return (
      <div className="rounded-xl border border-border/30 bg-muted/15 p-4 text-sm text-muted-foreground">
        <div className="flex items-center gap-2 text-foreground mb-1"><Crosshair size={14} /> No body selected</div>
        Click any body in the scene, or in the Active Bodies list, to see its orbit in real units.
      </div>
    );
  }

  const { data, masses } = snapshot;
  const o = i * STATE_STRIDE;
  const mass = masses[i];
  const speed = Math.hypot(data[o + S_VX], data[o + S_VZ]);
  const pinned = data[o + S_PINNED] === 1;
  const d = data[o + S_DOMINANT];
  const hasParent = d >= 0 && d < snapshot.ids.length;

  let parentRows = null;
  if (hasParent) {
    const od = d * STATE_STRIDE;
    const mu = REALISTIC_G * (masses[d] + mass);
    const el = orbitalElements(
      data[o + S_X] - data[od + S_X],
      data[o + S_Z] - data[od + S_Z],
      data[o + S_VX] - data[od + S_VX],
      data[o + S_VZ] - data[od + S_VZ],
      mu,
    );
    const bound = el.energy < 0;
    const escapeSpeed = Math.sqrt((2 * mu) / el.distance);
    const parentName = nameOf(snapshot.ids[d]);
    const aAU = toAU(el.semiMajorAxis);
    const periodYears = simSecondsToDays(el.period) / DAYS_PER_YEAR;
    parentRows = (
      <>
        <div className={`mt-3 rounded-lg border px-3 py-2 text-sm ${bound ? 'border-emerald-400/40 text-emerald-300' : 'border-amber-400/40 text-amber-300'}`}>
          {bound
            ? `Bound to ${parentName}: gravity keeps it in orbit.`
            : `Escaping ${parentName}: it is faster than the escape speed here (${toKmPerSecond(escapeSpeed).toFixed(1)} km/s).`}
        </div>
        <div className="mt-2">
          <Row label={`Distance from ${parentName}`} value={`${toAU(el.distance).toFixed(2)} AU`} />
          <Row label="Speed relative to it" value={`${toKmPerSecond(el.speed).toFixed(1)} km/s`} />
          {bound ? (
            <>
              <Row label="Orbit size (semi-major axis)" value={`${aAU.toFixed(2)} AU`} />
              <Row label="Shape (eccentricity)" value={`${el.eccentricity.toFixed(3)} · ${describeShape(el.eccentricity)}`} />
              <Row label="One orbit takes" value={formatDuration(simSecondsToDays(el.period))} />
              <Row label="Closest approach" value={`${toAU(el.periapsisDistance).toFixed(2)} AU`} />
              <Row label="Farthest point" value={`${toAU(el.apoapsisDistance).toFixed(2)} AU`} />
              <Row
                label="Kepler: T² ÷ a³"
                value={`${((periodYears * periodYears) / (aAU ** 3)).toFixed(3)} yr²/AU³`}
                hint={`Kepler's third law: every body orbiting the same parent shares this value, equal to 1 ÷ (its mass in solar masses) = ${(1 / toSolarMasses(masses[d] + mass)).toFixed(3)}.`}
              />
            </>
          ) : (
            <Row label="Closest approach" value={`${toAU(el.periapsisDistance).toFixed(2)} AU`} />
          )}
        </div>
      </>
    );
  }

  return (
    <div className="rounded-xl border border-border/30 bg-muted/15 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-lg font-semibold text-foreground">{nameOf(selectedId)}</div>
          <div className="text-sm text-muted-foreground">{formatMass(mass)} · {toKmPerSecond(speed).toFixed(1)} km/s</div>
        </div>
        <button type="button" onClick={onClear} className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-white/10" aria-label="Close inspector">
          <X size={14} />
        </button>
      </div>
      {parentRows ?? <p className="mt-3 text-sm text-muted-foreground">Nothing else is pulling on it.</p>}
      <label className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
        <span className="flex items-center gap-1.5"><Pin size={12} /> Pin in place</span>
        <input id="pin-body" type="checkbox" checked={pinned} onChange={(e) => onPin(selectedId, e.target.checked)} />
      </label>
      <p className="mt-1 text-xs text-muted-foreground/80">A pinned body still pulls on everything else but does not move itself.</p>
      <p className="mt-3 text-xs text-muted-foreground/80">The dashed line in the scene is this orbit if nothing else interferes: green while bound, amber when escaping.</p>
    </div>
  );
};

export default OrbitInspector;
