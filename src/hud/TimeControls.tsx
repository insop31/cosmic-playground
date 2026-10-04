import { Play, Pause, Rewind, FastForward, RotateCcw } from 'lucide-react';
import { motion } from 'framer-motion';
import { IconButton, Segmented } from './controls';
import { SPEED_STEPS, stepSpeed } from './timeSteps';

interface TimeControlsProps {
  timeScale: number;
  isPlaying: boolean;
  onPlay: () => void;
  onPause: () => void;
  onSpeedChange: (speed: number) => void;
  onReset: () => void;
}

const formatStep = (s: number) => {
  const abs = Math.abs(s) === 0.5 ? '½' : `${Math.abs(s)}`;
  return s < 0 ? `−${abs}` : `${abs}×`;
};

const TimeControls = ({ timeScale, isPlaying, onPlay, onPause, onSpeedChange, onReset }: TimeControlsProps) => {
  const isReversing = timeScale < 0;

  const handleStep = (direction: -1 | 1) => {
    onSpeedChange(stepSpeed(timeScale, direction));
    if (!isPlaying) onPlay();
  };

  return (
    <div className="hud-panel flex h-12 items-center gap-1 px-2">
      <IconButton label="Reset (R)" onClick={onReset}>
        <RotateCcw size={15} />
      </IconButton>
      <IconButton label="Slower / rewind (←)" onClick={() => handleStep(-1)} active={isReversing} tone="warn">
        <Rewind size={15} fill={isReversing ? 'currentColor' : 'none'} />
      </IconButton>

      <motion.button
        type="button"
        whileTap={{ scale: 0.92 }}
        onClick={isPlaying ? onPause : onPlay}
        aria-label={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
        title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
        className={`hud-focus mx-0.5 flex h-9 w-9 items-center justify-center rounded-lg border transition-colors duration-150 ${
          isReversing
            ? 'border-warn/40 bg-warn/15 text-warn hover:bg-warn/25'
            : 'border-primary/40 bg-primary/15 text-primary hover:bg-primary/25'
        }`}
      >
        {isPlaying ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" className="translate-x-px" />}
      </motion.button>

      <IconButton label="Faster (→)" onClick={() => handleStep(1)} active={!isReversing && timeScale > 1}>
        <FastForward size={15} fill={!isReversing && timeScale > 1 ? 'currentColor' : 'none'} />
      </IconButton>

      <div className="mx-1.5 h-6 w-px bg-white/[0.08]" />

      <Segmented
        ariaLabel="Simulation speed"
        layoutId="time-speed"
        size="sm"
        value={timeScale}
        onChange={(s) => { onSpeedChange(s); if (!isPlaying) onPlay(); }}
        options={SPEED_STEPS.map((s) => ({
          value: s,
          label: <span className="hud-num">{formatStep(s)}</span>,
          title: s < 0 ? `Rewind ${Math.abs(s)}×` : `${s}× speed`,
          tone: s < 0 ? 'warn' : 'default',
        }))}
      />

      <div
        className={`hud-num ml-1.5 flex h-8 min-w-[58px] items-center justify-center rounded-md px-2 text-[12px] font-semibold ${
          !isPlaying ? 'text-hud-dim' : isReversing ? 'text-warn' : 'text-primary'
        }`}
        aria-live="polite"
      >
        {!isPlaying ? 'PAUSED' : isReversing ? `◀ ${Math.abs(timeScale)}×` : `${timeScale}×`}
      </div>
    </div>
  );
};

export default TimeControls;
