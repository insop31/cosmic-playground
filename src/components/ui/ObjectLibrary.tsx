import { CelestialBody } from '../space/SpaceScene';
import { Orbit, Sun, Circle, Hexagon, Star, Zap, Sparkles, X } from 'lucide-react';
import { type ReactNode } from 'react';
import { motion } from 'framer-motion';

// Must match the G constant in PhysicsSimulator.tsx
const G = 0.5;

export interface ObjectPreset {
  type: string;
  label: string;
  mass: number;
  radius: number;
  color: string;
  icon: ReactNode;
}

export const OBJECT_PRESETS: ObjectPreset[] = [
  { type: 'planet', label: 'Planet', mass: 3, radius: 0.8, color: '#4488ff', icon: <Circle size={16} /> },
  { type: 'star', label: 'Star', mass: 8, radius: 1.5, color: '#ffcc00', icon: <Sun size={16} /> },
  { type: 'blackhole', label: 'Black Hole', mass: 20, radius: 1.2, color: '#aa44ff', icon: <Hexagon size={16} /> },
  { type: 'asteroid', label: 'Asteroid', mass: 0.5, radius: 0.3, color: '#888888', icon: <Star size={16} /> },
  { type: 'neutron', label: 'Neutron Star', mass: 12, radius: 0.5, color: '#00ffcc', icon: <Zap size={16} /> },
  { type: 'comet', label: 'Comet', mass: 0.3, radius: 0.25, color: '#66ddff', icon: <Sparkles size={16} /> },
];

export const createBodyFromPreset = (
  preset: ObjectPreset,
  bodies: CelestialBody[],
  position: [number, number, number]
): Omit<CelestialBody, 'id'> => {
  // Physics-accurate circular orbit: v = sqrt(G * M_attractor / r)
  // Tangent direction: normalize(R) × UP  →  [nx, 0, nz] × [0,1,0] = [-nz, 0, nx]
  let vx = 0;
  let vz = 0;
  if (bodies.length > 0) {
    const attractor = bodies.reduce((max, b) => (b.mass > max.mass ? b : max));
    const rx = position[0] - attractor.position[0];
    const rz = position[2] - attractor.position[2];
    const orbDist = Math.sqrt(rx * rx + rz * rz);
    if (orbDist > 0.01) {
      const speed = Math.sqrt(G * attractor.mass / orbDist);
      const nx = rx / orbDist;
      const nz = rz / orbDist;
      vx = -nz * speed;
      vz = nx * speed;
    }
  }

  return {
    type: preset.type,
    position,
    mass: preset.mass,
    radius: preset.radius,
    color: preset.color,
    velocity: [vx, 0, vz],
  };
};

interface ObjectLibraryProps {
  bodies: CelestialBody[];
  onRemoveBody: (id: string) => void;
  onRemoveAll: () => void;
  selectedType: string | null;
  onSelectType: (type: string | null) => void;
}

const ObjectLibrary = ({ bodies, onRemoveBody, onRemoveAll, selectedType, onSelectType }: ObjectLibraryProps) => {
  return (
    <div className="glass-panel-strong p-5 w-[280px] flex flex-col h-full border border-white/10 shadow-[0_0_30px_rgba(139,92,246,0.15)]">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6 pb-4 border-b border-white/10">
        <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center glow-border">
          <Orbit size={18} className="text-primary" strokeWidth={1.5} />
        </div>
        <div>
          <h3 className="text-sm font-bold text-foreground tracking-widest uppercase">Object Library</h3>
          <p className="text-[10px] font-mono text-muted-foreground">{bodies.length} ACTIVE BODIES</p>
        </div>
      </div>

      {/* Preset Buttons Grid */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        {OBJECT_PRESETS.map((preset) => (
          <motion.button
            key={preset.type}
            onClick={() => onSelectType(selectedType === preset.type ? null : preset.type)}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            className={`flex flex-col items-center justify-center gap-2 p-3 rounded-xl transition-all group overflow-hidden relative border ${
              selectedType === preset.type
                ? 'bg-primary/15 border-primary/50 shadow-[0_0_15px_rgba(34,211,238,0.2)]'
                : 'bg-white/5 border-white/5 hover:bg-white/10 hover:border-primary/30'
            }`}
          >
            {/* Subtle glow background on hover */}
            <div className="absolute inset-0 bg-gradient-to-b from-primary/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            
            <span className="relative z-10 text-muted-foreground group-hover:text-primary transition-colors drop-shadow-lg" style={{ color: preset.color }}>
              {preset.icon}
            </span>
            <span className="relative z-10 text-[11px] font-medium tracking-wide text-muted-foreground group-hover:text-foreground transition-colors">
              {preset.label}
            </span>
          </motion.button>
        ))}
      </div>

      {selectedType && (
        <div className="text-[11px] text-primary/90 bg-primary/10 border border-primary/20 rounded-lg px-2.5 py-2 mb-3">
          Placement mode active. Click or drag on the grid to place {OBJECT_PRESETS.find((p) => p.type === selectedType)?.label}.
        </div>
      )}

      {/* Active Bodies List */}
      {bodies.length > 0 && (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex items-center justify-between mb-3 px-1">
            <span className="text-[10px] font-mono font-semibold text-primary/70 uppercase tracking-widest">Active System</span>
          </div>
          
          <div className="flex-1 overflow-y-auto space-y-2 pr-2 scrollbar-thin mb-4">
            {bodies.map((body) => {
              const preset = OBJECT_PRESETS.find(p => p.type === body.type) || OBJECT_PRESETS[0];
              return (
                <motion.div 
                  key={body.id} 
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                  className="flex items-center justify-between p-2 rounded-lg bg-black/20 border border-white/5 hover:bg-white/5 hover:border-white/10 transition-all group"
                >
                  <div className="flex items-center gap-3 overflow-hidden">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0 shadow-[0_0_8px_currentColor]" style={{ backgroundColor: body.color, color: body.color }} />
                    <div className="flex flex-col">
                      <span className="text-xs text-foreground truncate font-medium">
                        {preset.label}
                      </span>
                      <span className="text-[9px] text-muted-foreground font-mono">
                        {body.mass}M • {body.type}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => onRemoveBody(body.id)}
                    className="text-muted-foreground hover:text-destructive p-1.5 rounded-md hover:bg-destructive/20 transition-colors opacity-0 group-hover:opacity-100"
                    title="Remove Object"
                  >
                    <X size={14} strokeWidth={2} />
                  </button>
                </motion.div>
              );
            })}
          </div>
          
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onRemoveAll}
            className="w-full shrink-0 flex items-center justify-center gap-2 text-xs py-3 rounded-xl font-semibold tracking-wide border border-destructive/30 text-destructive/90 hover:text-destructive hover:bg-destructive/20 hover:border-destructive/50 transition-all shadow-[inset_0_0_15px_rgba(239,68,68,0.05)] hover:shadow-[inset_0_0_20px_rgba(239,68,68,0.15)]"
          >
            <X size={14} /> PURGE SYSTEM
          </motion.button>
        </div>
      )}
    </div>
  );
};

export default ObjectLibrary;
