import { memo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { altitudeKm, escapeFraction, UNITS_NOTE } from '@/worlds/rocket/units';
import { useEffectiveRocketParams } from '@/stores/rocketStore';
import { useRocketStore } from '@/stores/rocketStore';
import { InfoTip } from './controls';

const TICK_PX = 22;

interface TapeProps {
  label: string;
  unit: string;
  value: number;
  /** Value between two labelled ticks. */
  step: number;
  digits: number;
}

/**
 * A moving-scale tape like a primary flight display: the readout stays put
 * and the scale scrolls behind it.
 */
const Tape = ({ label, unit, value, step, digits }: TapeProps) => {
  const base = Math.floor(value / step);
  const fraction = value / step - base;
  const ticks = Array.from({ length: 11 }, (_, i) => base + 5 - i);

  return (
    <div className="hud-panel relative h-[260px] w-[74px] overflow-hidden" role="meter" aria-label={label} aria-valuenow={Number(value.toFixed(digits))}>
      <p className="hud-label absolute inset-x-0 top-2 z-10 text-center text-[9.5px]">{label}</p>
      <div
        className="absolute inset-x-0 top-6 bottom-6 [mask-image:linear-gradient(transparent,#000_22%,#000_78%,transparent)]"
        aria-hidden
      >
        <div className="absolute inset-x-0 top-1/2" style={{ transform: `translateY(${fraction * TICK_PX}px)` }}>
          {ticks.map((tick, i) => (
            <div key={tick} className="absolute inset-x-0 flex items-center gap-1.5 pl-2" style={{ top: `${(i - 5) * TICK_PX}px`, transform: 'translateY(-50%)' }}>
              <span className="h-px w-2.5 bg-[hsl(var(--hud-line)/0.45)]" />
              {tick >= 0 && <span className="hud-num text-[10px] text-hud-faint">{(tick * step).toFixed(step < 1 ? 1 : 0)}</span>}
            </div>
          ))}
        </div>
      </div>
      <div className="absolute inset-x-1.5 top-1/2 z-10 -translate-y-1/2 rounded-[4px] border border-primary bg-background px-1 py-1 text-center">
        <span className="hud-num block text-[14px] leading-tight text-primary">{value.toFixed(digits)}</span>
        <span className="hud-num block text-[9.5px] text-hud-dim">{unit}</span>
      </div>
    </div>
  );
};

/** Altitude and speed tapes, shown beside the rail while flying. */
const FlightTapes = () => {
  const { phase, altitude, velocity } = useRocketStore(useShallow((state) => ({
    phase: state.flight.phase,
    altitude: state.flight.altitude,
    velocity: state.flight.velocity,
  })));
  const params = useEffectiveRocketParams();
  if (phase === 'idle') return null;
  const alt = altitudeKm(altitude);
  const speed = Math.hypot(velocity[0], velocity[1]);
  const ofEscape = escapeFraction(params, speed, altitude);

  return (
    <div className="pointer-events-auto flex flex-col gap-2">
      <div className="flex gap-2">
        <Tape label="Altitude" unit="km" value={alt} step={alt > 200 ? 50 : 10} digits={alt < 100 ? 1 : 0} />
        <Tape label="Speed" unit="u/s" value={speed} step={0.1} digits={2} />
      </div>
      <div className="hud-panel px-2 py-1.5">
        <div className="flex items-baseline justify-between">
          <span className="hud-label text-[9.5px]">Of escape speed</span>
          <span className={`hud-num text-[12px] ${ofEscape >= 1 ? 'text-primary' : 'text-foreground'}`}>{Math.round(ofEscape * 100)}%</span>
        </div>
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/[0.08]">
          <div className="h-full rounded-full bg-primary transition-[width] duration-200" style={{ width: `${Math.min(1, ofEscape) * 100}%` }} />
        </div>
      </div>
      <p className="flex items-center gap-1 px-1 text-[10.5px] text-hud-faint">
        About these units <InfoTip label="Units" side="right">{UNITS_NOTE}</InfoTip>
      </p>
    </div>
  );
};

export default memo(FlightTapes);
