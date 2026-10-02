import { History } from 'lucide-react';
import { SIM_STEP, type TimelineMarker } from '../../physics/simulation';
import { formatDuration, simSecondsToDays } from '../../physics/units';

export interface TimelineState {
  step: number;
  historyStart: number;
  historyEnd: number;
  markers: TimelineMarker[];
  simTime: number;
}

interface TimelineBarProps {
  timeline: TimelineState;
  onScrubStart: () => void;
  onSeek: (step: number) => void;
}

const MARKER_COLOR: Record<TimelineMarker['kind'], string> = {
  merge: '#f87171',
  absorb: '#c084fc',
  bounce: '#fbbf24',
  fragment: '#fb923c',
  tidal: '#e879f9',
};

/** Scrub through recorded history; collisions appear as marks on the track. */
const TimelineBar = ({ timeline, onScrubStart, onSeek }: TimelineBarProps) => {
  const { step, historyStart, historyEnd, markers, simTime } = timeline;
  const span = Math.max(historyEnd - historyStart, 1);
  const behind = (historyEnd - step) * SIM_STEP;
  const pct = (s: number) => ((s - historyStart) / span) * 100;

  return (
    <div className="glass-panel px-4 py-2.5 w-[560px] max-w-[calc(100vw-2rem)]">
      <div className="flex items-center justify-between text-xs font-mono text-muted-foreground mb-1.5">
        <span className="flex items-center gap-1.5"><History size={12} /> Time elapsed: {formatDuration(simSecondsToDays(simTime))}</span>
        <span className={behind > 0.01 ? 'text-amber-300' : ''}>
          {behind > 0.01 ? `${behind.toFixed(1)} s before the latest moment` : 'Live'}
        </span>
      </div>
      <div className="relative h-6">
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-white/15" />
        <div
          className="absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-primary/50"
          style={{ width: `${pct(Math.min(Math.max(step, historyStart), historyEnd))}%` }}
        />
        {markers.map((marker) => (
          <span
            key={`${marker.step}-${marker.title}`}
            title={`${marker.title} · ${((historyEnd - marker.step) * SIM_STEP).toFixed(1)} s ago`}
            className="absolute top-1/2 h-3.5 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{ left: `${pct(marker.step)}%`, background: MARKER_COLOR[marker.kind] }}
          />
        ))}
        <input
          id="timeline-scrubber"
          type="range"
          aria-label="Rewind timeline"
          min={historyStart}
          max={historyEnd}
          step={1}
          value={Math.min(Math.max(step, historyStart), historyEnd)}
          onPointerDown={onScrubStart}
          onKeyDown={onScrubStart}
          onChange={(e) => onSeek(Number(e.target.value))}
          className="slider-space absolute inset-x-0 top-1/2 -translate-y-1/2"
        />
      </div>
    </div>
  );
};

export default TimelineBar;
