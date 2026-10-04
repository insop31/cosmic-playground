import { memo, useEffect, useRef, useState } from 'react';
import { Crosshair, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { gsap, useGSAP } from '@/motion/gsap';
import { liveWorld } from '@/sim/liveWorld';
import { orbitalElements, type OrbitalElements } from '@/sim/orbit';
import { bodyLabel, useSpacetimeStore } from '@/stores/spacetimeStore';
import { IconButton, InfoTip } from './controls';

interface Snapshot {
  name: string;
  mass: number;
  motion: 'bound' | 'escaping' | 'captured';
  parentName: string | null;
  elements: OrbitalElements | null;
}

const fmt = (value: number | null | undefined, digits = 2) =>
  value === null || value === undefined || !Number.isFinite(value) ? '—' : value.toFixed(digits);

const massFormatter = new Intl.NumberFormat('en', { notation: 'scientific', maximumFractionDigits: 2 });

const Element = ({ label, value, unit, info }: { label: string; value: string; unit?: string; info: string }) => (
  <div className="grid min-w-0 gap-0.5">
    <span className="flex items-center gap-1">
      <span className="hud-label text-[9.5px]">{label}</span>
      <InfoTip label={label} side="left">{info}</InfoTip>
    </span>
    <span className="hud-num truncate text-[13px] text-foreground">
      {value}
      {unit && value !== '—' && <span className="ml-0.5 text-[11px] text-hud-dim">{unit}</span>}
    </span>
  </div>
);

/** Live orbital readout for the selected body (polled from the running simulation). */
const BodyInspector = () => {
  const selectedId = useSpacetimeStore((state) => state.selectedBodyId);
  const follow = useSpacetimeStore((state) => state.followSelected);
  const setFollow = useSpacetimeStore((state) => state.setFollowSelected);
  const selectBody = useSpacetimeStore((state) => state.selectBody);
  const removeBody = useSpacetimeStore((state) => state.removeBody);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!selectedId) {
      setSnapshot(null);
      return undefined;
    }
    const read = () => {
      const body = liveWorld.bodies.find((b) => b.id === selectedId);
      const meta = useSpacetimeStore.getState().bodies.find((b) => b.id === selectedId);
      if (!body || !meta) {
        selectBody(null);
        return;
      }
      const elements = orbitalElements(body, liveWorld.bodies, liveWorld.effectiveG);
      const parent = elements?.parentId ? useSpacetimeStore.getState().bodies.find((b) => b.id === elements.parentId) : undefined;
      setSnapshot({
        name: bodyLabel(meta),
        mass: body.mass,
        motion: body.motionState,
        parentName: parent ? bodyLabel(parent) : null,
        elements,
      });
    };
    read();
    const id = window.setInterval(read, 250);
    return () => window.clearInterval(id);
  }, [selectBody, selectedId]);

  useGSAP(() => {
    if (selectedId) gsap.from(ref.current, { autoAlpha: 0, y: -6, duration: 0.25 });
  }, { dependencies: [selectedId] });

  if (!selectedId || !snapshot) return null;
  const e = snapshot.elements;
  const escaping = snapshot.motion === 'escaping';

  return (
    <section ref={ref} aria-label={`${snapshot.name} details`} className="hud-panel pointer-events-auto w-[300px] p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="hud-label">Selected body</p>
          <h2 className="truncate font-display text-[14px] uppercase tracking-[0.06em] text-foreground">{snapshot.name}</h2>
        </div>
        <span
          className={cn(
            'mt-1 inline-flex items-center gap-1.5 rounded-[3px] border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em]',
            escaping ? 'border-warn/40 text-warn' : 'border-ok/40 text-ok',
          )}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
          {escaping ? 'Escaping' : 'Bound'}
        </span>
        <IconButton label="Close (Esc)" size="sm" onClick={() => selectBody(null)}>
          <X size={14} />
        </IconButton>
      </div>

      <p className="mt-1 text-[12px] leading-snug text-hud-dim">
        {snapshot.parentName
          ? escaping
            ? `Moving faster than ${snapshot.parentName}'s escape speed; it will not come back.`
            : `Orbiting ${snapshot.parentName}. Values update live.`
          : 'No other body dominates its motion.'}
      </p>

      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 border-t border-[hsl(var(--hud-line)/0.1)] pt-3">
        <Element label="Distance r" value={fmt(e?.distance)} unit="u" info="Distance to the body it orbits, in scene units." />
        <Element label="Speed v" value={fmt(e?.speed)} unit="u/s" info="Speed relative to the body it orbits, per simulated second." />
        <Element label="Circular v" value={fmt(e?.circularSpeed)} unit="u/s" info="Speed a perfectly circular orbit would need at this distance: √(GM/r)." />
        <Element label="Escape v" value={fmt(e?.escapeSpeed)} unit="u/s" info="Speed needed to leave for good: √(2GM/r), about 1.41× circular speed." />
        <Element label="Semi-major a" value={fmt(e?.semiMajorAxis)} unit="u" info="Half the longest diameter of the orbit's ellipse. Undefined when the path is open (escaping)." />
        <Element label="Eccentricity e" value={fmt(e?.eccentricity, 3)} info="Shape of the orbit: 0 is a circle, between 0 and 1 an ellipse, 1 or more an open escape path." />
        <Element label="Period T" value={fmt(e?.period, 1)} unit="s" info="Time for one full orbit, from Kepler's third law: T = 2π√(a³/GM)." />
        <Element label="Mass" value={massFormatter.format(snapshot.mass).replace('E', 'e')} unit="kg" info="Mass used by the simulation. Collisions add the absorbed body's mass." />
      </div>

      <div className="mt-3 flex items-center gap-1.5 border-t border-[hsl(var(--hud-line)/0.1)] pt-2.5">
        <button
          type="button"
          onClick={() => setFollow(!follow)}
          aria-pressed={follow}
          className={cn(
            'hud-focus flex h-7 items-center gap-1.5 rounded-[4px] border px-2 text-[12px] transition-colors',
            follow ? 'border-primary/40 bg-primary/10 text-primary' : 'border-transparent text-hud-dim hover:text-foreground',
          )}
        >
          <Crosshair size={13} /> Follow
        </button>
        <button
          type="button"
          onClick={() => removeBody(selectedId)}
          className="hud-focus ml-auto flex h-7 items-center gap-1.5 rounded-[4px] px-2 text-[12px] text-hud-dim transition-colors hover:bg-danger/10 hover:text-danger"
        >
          <Trash2 size={13} /> Remove
        </button>
      </div>
    </section>
  );
};

export default memo(BodyInspector);
