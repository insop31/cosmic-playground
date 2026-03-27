import { Play, Pause, Rewind, FastForward, RotateCcw } from 'lucide-react';

interface TimeControlsProps {
  timeScale: number;
  isPlaying: boolean;
  onPlay: () => void;
  onPause: () => void;
  onSpeedChange: (speed: number) => void;
  onReset: () => void;
}

// Ordered steps covering rewind → forward
const SPEED_STEPS = [-4, -2, -1, -0.5, 0.5, 1, 2, 4];

const TimeControls = ({ timeScale, isPlaying, onPlay, onPause, onSpeedChange, onReset }: TimeControlsProps) => {
  const currentIdx = SPEED_STEPS.indexOf(timeScale);

  const handleRewind = () => {
    // Step one index lower (more negative)
    const nextIdx = Math.max(0, currentIdx === -1 ? SPEED_STEPS.indexOf(-1) : currentIdx - 1);
    onSpeedChange(SPEED_STEPS[nextIdx]);
    // If paused, start playing when changing direction
    if (!isPlaying) onPlay();
  };

  const handleFastForward = () => {
    // Step one index higher (more positive)
    const nextIdx = Math.min(SPEED_STEPS.length - 1, currentIdx === -1 ? SPEED_STEPS.indexOf(1) : currentIdx + 1);
    onSpeedChange(SPEED_STEPS[nextIdx]);
    if (!isPlaying) onPlay();
  };

  const speedLabel = timeScale < 0
    ? `◀ ${Math.abs(timeScale)}x`
    : `${timeScale}x`;

  const isReversing = timeScale < 0;

  return (
    <div className="glass-panel-strong px-5 py-3.5 flex items-center gap-4 hover-lift shadow-2xl">
      <button
        onClick={onReset}
        title="Reset"
        className="p-2 rounded-lg hover:bg-muted/50 transition-colors text-muted-foreground hover:text-foreground"
      >
        <RotateCcw size={16} />
      </button>

      <button
        onClick={handleRewind}
        title="Rewind"
        className={`p-2 rounded-lg hover:bg-muted/50 transition-colors ${
          isReversing ? 'text-primary glow-border bg-primary/10' : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        <Rewind size={16} />
      </button>

      <button
        onClick={isPlaying ? onPause : onPlay}
        className="p-3 rounded-xl bg-primary/20 text-primary hover:bg-primary/30 transition-colors glow-border hover-lift shadow-[0_0_15px_-3px_hsl(var(--primary)/0.3)] hover:shadow-[0_0_25px_-3px_hsl(var(--primary)/0.5)]"
      >
        {isPlaying ? <Pause size={18} /> : <Play size={18} />}
      </button>

      <button
        onClick={handleFastForward}
        title="Fast Forward"
        className={`p-2 rounded-lg hover:bg-muted/50 transition-colors ${
          !isReversing && timeScale > 1
            ? 'text-primary glow-border bg-primary/10'
            : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        <FastForward size={16} />
      </button>

      {/* Speed preset chips */}
      <div className="flex items-center gap-1 ml-2">
        {SPEED_STEPS.map((s) => (
          <button
            key={s}
            onClick={() => { onSpeedChange(s); if (!isPlaying) onPlay(); }}
            className={`px-2 py-1 text-xs font-mono rounded transition-colors ${
              timeScale === s
                ? 'bg-primary/20 text-primary glow-border'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'
            }`}
          >
            {s < 0 ? `◀${Math.abs(s)}x` : `${s}x`}
          </button>
        ))}
      </div>

      {/* Current speed indicator */}
      <div className={`text-xs font-mono min-w-[3.5rem] text-center px-2 py-1 rounded ${
        isReversing ? 'text-amber-400' : 'text-primary'
      }`}>
        {speedLabel}
      </div>
    </div>
  );
};

export default TimeControls;
