import { memo, useEffect, useRef, useState } from 'react';
import { ChevronDown, Crosshair, Pin, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { gsap, useGSAP } from '@/motion/gsap';
import { missionTracker } from '@/app/missionTracker';
import {
  DAYS_PER_YEAR,
  formatDuration,
  formatMass,
  simSecondsToDays,
  toAU,
  toKmPerSecond,
  toSolarMasses,
} from '@/physics/units';
import { useProgressStore } from '@/stores/progressStore';
import { bodyLabel, useSpacetimeStore } from '@/stores/spacetimeStore';
import { liveOrbit, liveWorld, simulationControls, type LiveOrbit, type Motion } from '@/worlds/spacetime/liveWorld';
import { IconButton, InfoTip } from './controls';

interface Snapshot {
  name: string;
  mass: number;
  speed: number;
  motion: Motion;
  pinned: boolean;
  parentName: string | null;
  parentMass: number;
  orbit: LiveOrbit | null;
}

const fmt = (value: number | null | undefined, digits = 2) =>
  value === null || value === undefined || !Number.isFinite(value) ? '—' : value.toFixed(digits);

const describeShape = (e: number) => {
  if (e < 0.05) return 'nearly circular';
  if (e < 0.3) return 'slightly oval';
  if (e < 0.7) return 'oval';
  if (e < 1) return 'very stretched';
  return 'open path';
};

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

/** Live orbital readout for the selected body, in real units (polled from the running simulation). */
const BodyInspector = () => {
  const selectedId = useSpacetimeStore((state) => state.selectedBodyId);
  const follow = useSpacetimeStore((state) => state.followSelected);
  const setFollow = useSpacetimeStore((state) => state.setFollowSelected);
  const selectBody = useSpacetimeStore((state) => state.selectBody);
  const removeBody = useSpacetimeStore((state) => state.removeBody);
  const setPinned = useSpacetimeStore((state) => state.setPinned);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!selectedId) {
      setSnapshot(null);
      return undefined;
    }
    // Looking at a body counts toward Kepler's Check (two bodies around the same parent).
    if (liveWorld.snapshot) missionTracker.noteInspection(selectedId, liveWorld.snapshot).forEach(useProgressStore.getState().unlock);
    const read = () => {
      const body = liveWorld.find(selectedId);
      const meta = useSpacetimeStore.getState().bodies.find((b) => b.id === selectedId);
      if (!body || !meta) {
        if (!meta) selectBody(null);
        return;
      }
      const orbit = liveOrbit(selectedId);
      const parent = orbit ? useSpacetimeStore.getState().bodies.find((b) => b.id === orbit.parentId) : undefined;
      setSnapshot({
        name: bodyLabel(meta),
        mass: body.mass,
        speed: Math.hypot(body.velocity.x, body.velocity.z),
        motion: body.motion,
        pinned: body.pinned,
        parentName: parent ? bodyLabel(parent) : null,
        parentMass: orbit ? liveWorld.find(orbit.parentId)?.mass ?? 0 : 0,
        orbit,
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
  const orbit = snapshot.orbit;
  const e = orbit?.elements;
  const bound = orbit?.bound ?? true;
  const aAU = e && bound ? toAU(e.semiMajorAxis) : null;
  const periodYears = e && bound ? simSecondsToDays(e.period) / DAYS_PER_YEAR : null;
  const kepler = aAU && periodYears ? (periodYears * periodYears) / (aAU ** 3) : null;

  const togglePin = () => {
    simulationControls.current?.setPinned(selectedId, !snapshot.pinned);
    setPinned(selectedId, !snapshot.pinned);
  };

  return (
    <section ref={ref} aria-label={`${snapshot.name} details`} className="hud-panel pointer-events-auto w-[300px] p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="hud-label">Selected body</p>
          <h2 className="truncate font-display text-[14px] uppercase tracking-[0.06em] text-foreground">{snapshot.name}</h2>
          <p className="hud-num text-[11px] text-hud-dim">{formatMass(snapshot.mass)} · {toKmPerSecond(snapshot.speed).toFixed(1)} km/s</p>
        </div>
        <span
          className={cn(
            'mt-1 inline-flex items-center gap-1.5 rounded-[3px] border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em]',
            bound ? 'border-ok/40 text-ok' : 'border-warn/40 text-warn',
          )}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
          {bound ? 'Bound' : 'Escaping'}
        </span>
        <IconButton label="Close (Esc)" size="sm" onClick={() => selectBody(null)}>
          <X size={14} />
        </IconButton>
      </div>

      <p className="mt-1.5 text-[12px] leading-snug text-hud-dim">
        {snapshot.parentName && orbit
          ? bound
            ? `Orbiting ${snapshot.parentName}: gravity keeps it in orbit. Values update live.`
            : `Faster than ${snapshot.parentName}'s escape speed here (${toKmPerSecond(orbit.escapeSpeed).toFixed(1)} km/s); it will not come back.`
          : 'No other body dominates its motion.'}
      </p>

      {orbit && e && (
        <>
          {/* The three numbers that tell the story; everything else is one click away. */}
          <div className="mt-3 grid grid-cols-3 gap-x-3 border-t border-[hsl(var(--hud-line)/0.1)] pt-3">
            <Element label="Distance" value={fmt(toAU(e.distance))} unit="AU" info={`Distance from ${snapshot.parentName}. 1 AU is the Earth–Sun distance; 8 grid squares.`} />
            <Element label="Speed" value={fmt(toKmPerSecond(e.speed), 1)} unit="km/s" info={`Speed relative to ${snapshot.parentName}.`} />
            {bound
              ? <Element label="One orbit" value={formatDuration(simSecondsToDays(e.period))} info="Time for one full orbit, from Kepler's third law: T = 2π√(a³/GM)." />
              : <Element label="Closest" value={fmt(toAU(e.periapsisDistance))} unit="AU" info="The nearest it gets on its open path." />}
          </div>

          <button
            type="button"
            onClick={() => setDetailsOpen((open) => !open)}
            aria-expanded={detailsOpen}
            className="hud-focus mt-2.5 flex items-center gap-1 rounded-[4px] text-[12px] text-hud-dim transition-colors hover:text-foreground"
          >
            <ChevronDown size={13} className={cn('transition-transform duration-200', detailsOpen && 'rotate-180')} />
            {detailsOpen ? 'Less detail' : 'More detail: orbit shape, escape speed, Kepler’s law'}
          </button>

          {detailsOpen && (
            <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-2.5">
              <Element label="Circular v" value={fmt(toKmPerSecond(orbit.circularSpeed), 1)} unit="km/s" info="Speed a perfectly circular orbit would need at this distance: √(GM/r)." />
              <Element label="Escape v" value={fmt(toKmPerSecond(orbit.escapeSpeed), 1)} unit="km/s" info="Speed needed to leave for good: √(2GM/r), about 1.41× circular speed." />
              {bound && (
                <>
                  <Element label="Semi-major a" value={fmt(aAU)} unit="AU" info="Half the longest diameter of the orbit's ellipse." />
                  <Element label="Eccentricity e" value={fmt(e.eccentricity, 3)} info={`Shape of the orbit: 0 is a circle, between 0 and 1 an ellipse. This one is ${describeShape(e.eccentricity)}.`} />
                  <Element label="Closest · farthest" value={`${fmt(toAU(e.periapsisDistance))} · ${fmt(toAU(e.apoapsisDistance))}`} unit="AU" info="Periapsis and apoapsis: the nearest and farthest points of the orbit." />
                  <Element
                    label="Kepler: T² ÷ a³"
                    value={fmt(kepler, 3)}
                    unit="yr²/AU³"
                    info={`Kepler's third law: every body orbiting the same parent shares this value, equal to 1 ÷ (the masses in solar masses) = ${(1 / toSolarMasses(snapshot.parentMass + snapshot.mass)).toFixed(3)}. Inspect a second body to compare.`}
                  />
                </>
              )}
              <p className="col-span-2 text-[11px] leading-snug text-hud-faint">
                The dashed line on the sheet is this orbit if nothing else interferes: green while bound, amber when escaping.
              </p>
            </div>
          )}
        </>
      )}

      <div className="mt-2.5 flex items-center gap-1.5 border-t border-[hsl(var(--hud-line)/0.1)] pt-2.5">
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
          onClick={togglePin}
          aria-pressed={snapshot.pinned}
          title="A pinned body still pulls on everything else but does not move itself."
          className={cn(
            'hud-focus flex h-7 items-center gap-1.5 rounded-[4px] border px-2 text-[12px] transition-colors',
            snapshot.pinned ? 'border-primary/40 bg-primary/10 text-primary' : 'border-transparent text-hud-dim hover:text-foreground',
          )}
        >
          <Pin size={13} /> Pin
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
