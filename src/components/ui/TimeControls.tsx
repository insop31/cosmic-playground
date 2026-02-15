import { Play, Pause, Rewind, FastForward, RotateCcw } from 'lucide-react';

interface TimeControlsProps {
  timeScale: number;
  isPlaying: boolean;
  onPlay: () => void;
  onPause: () => void;
  onSpeedChange: (speed: number) => void;
  onReset: () => void;
}

const TimeControls = ({ timeScale, isPlaying, onPlay, onPause, onSpeedChange, onReset }: TimeControlsProps) => {
  const speeds = [0.25, 0.5, 1, 2, 4];

  return (
    <div className="glass-panel px-4 py-3 flex items-center gap-3">
      <button onClick={onReset} className="p-2 rounded-lg hover:bg-muted/50 transition-colors text-muted-foreground hover:text-foreground">
        <RotateCcw size={16} />
      </button>
      <button onClick={() => onSpeedChange(Math.max(0.25, timeScale / 2))} className="p-2 rounded-lg hover:bg-muted/50 transition-colors text-muted-foreground hover:text-foreground">
        <Rewind size={16} />
      </button>
      <button
        onClick={isPlaying ? onPause : onPlay}
        className="p-2.5 rounded-xl bg-primary/20 text-primary hover:bg-primary/30 transition-colors glow-border"
      >
        {isPlaying ? <Pause size={18} /> : <Play size={18} />}
      </button>
      <button onClick={() => onSpeedChange(Math.min(4, timeScale * 2))} className="p-2 rounded-lg hover:bg-muted/50 transition-colors text-muted-foreground hover:text-foreground">
        <FastForward size={16} />
      </button>
      <div className="flex items-center gap-1 ml-2">
        {speeds.map((s) => (
          <button
            key={s}
            onClick={() => onSpeedChange(s)}
            className={`px-2 py-1 text-xs font-mono rounded transition-colors ${
              timeScale === s
                ? 'bg-primary/20 text-primary glow-border'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'
            }`}
          >
            {s}x
          </button>
        ))}
      </div>
    </div>
  );
};

export default TimeControls;
