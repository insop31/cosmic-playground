import { Play, Pause, Rewind, FastForward, RotateCcw } from 'lucide-react';
import { motion } from 'framer-motion';

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
    <div className="glass-panel-strong px-5 py-3.5 flex items-center gap-4 border border-white/10 shadow-[0_0_40px_rgba(139,92,246,0.15)] rounded-2xl">
      <motion.button
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
        onClick={onReset}
        title="Reset"
        className="p-2 rounded-xl hover:bg-white/10 transition-colors text-muted-foreground hover:text-foreground border border-transparent hover:border-white/10"
      >
        <RotateCcw size={16} strokeWidth={2} />
      </motion.button>

      <motion.button
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
        onClick={handleRewind}
        title="Rewind"
        className={`p-2 rounded-xl border transition-colors ${
          isReversing 
            ? 'text-primary glow-border bg-primary/20 border-primary/30' 
            : 'text-muted-foreground hover:text-foreground border-transparent hover:bg-white/10 hover:border-white/10'
        }`}
      >
        <Rewind size={18} fill={isReversing ? 'currentColor' : 'none'} strokeWidth={2} />
      </motion.button>

      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={isPlaying ? onPause : onPlay}
        className="p-3.5 rounded-2xl bg-gradient-to-br from-primary/30 to-primary/10 text-primary hover:from-primary/40 hover:to-primary/20 transition-all border border-primary/30 shadow-[0_0_20px_rgba(34,211,238,0.3)]"
      >
        {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
      </motion.button>

      <motion.button
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
        onClick={handleFastForward}
        title="Fast Forward"
        className={`p-2 rounded-xl border transition-colors ${
          !isReversing && timeScale > 1
            ? 'text-primary glow-border bg-primary/20 border-primary/30'
            : 'text-muted-foreground hover:text-foreground border-transparent hover:bg-white/10 hover:border-white/10'
        }`}
      >
        <FastForward size={18} fill={(!isReversing && timeScale > 1) ? 'currentColor' : 'none'} strokeWidth={2} />
      </motion.button>

      {/* Speed preset chips */}
      <div className="flex items-center gap-1.5 ml-3 pl-3 border-l border-white/10">
        {SPEED_STEPS.map((s) => (
          <motion.button
            key={s}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => { onSpeedChange(s); if (!isPlaying) onPlay(); }}
            className={`px-2.5 py-1.5 text-xs font-mono rounded-lg transition-all border ${
              timeScale === s
                ? 'bg-primary/20 text-primary border-primary/30 shadow-[inset_0_0_10px_rgba(34,211,238,0.2)]'
                : 'text-muted-foreground border-transparent hover:text-foreground hover:bg-white/5 hover:border-white/10'
            }`}
          >
            {s < 0 ? `◀${Math.abs(s)}` : `${s}x`}
          </motion.button>
        ))}
      </div>

      {/* Current speed indicator */}
      <div className={`text-[13px] font-mono font-bold tracking-widest min-w-[4rem] text-center px-3 py-1.5 rounded-lg bg-black/40 border border-white/5 ml-2 ${
        isReversing ? 'text-amber-400 drop-shadow-[0_0_8px_rgba(251,191,36,0.5)]' : 'text-primary drop-shadow-[0_0_8px_rgba(34,211,238,0.5)]'
      }`}>
        {speedLabel}
      </div>
    </div>
  );
};

export default TimeControls;
