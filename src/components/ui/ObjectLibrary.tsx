import { CelestialBody } from '../space/SpaceScene';
import { Orbit, Sun, Circle, Hexagon, Star, Zap, Sparkles } from 'lucide-react';
import { type ReactNode } from 'react';

const OBJECT_PRESETS: { type: string; label: string; mass: number; radius: number; color: string; icon: ReactNode }[] = [
  { type: 'planet', label: 'Planet', mass: 3, radius: 0.8, color: '#4488ff', icon: <Circle size={16} /> },
  { type: 'star', label: 'Star', mass: 8, radius: 1.5, color: '#ffcc00', icon: <Sun size={16} /> },
  { type: 'blackhole', label: 'Black Hole', mass: 20, radius: 1.2, color: '#aa44ff', icon: <Hexagon size={16} /> },
  { type: 'asteroid', label: 'Asteroid', mass: 0.5, radius: 0.3, color: '#888888', icon: <Star size={16} /> },
  { type: 'neutron', label: 'Neutron Star', mass: 12, radius: 0.5, color: '#00ffcc', icon: <Zap size={16} /> },
  { type: 'comet', label: 'Comet', mass: 0.3, radius: 0.25, color: '#66ddff', icon: <Sparkles size={16} /> },
];

interface ObjectLibraryProps {
  onAddObject: (body: Omit<CelestialBody, 'id'>) => void;
  bodies: CelestialBody[];
  onRemoveAll: () => void;
}

const ObjectLibrary = ({ onAddObject, bodies, onRemoveAll }: ObjectLibraryProps) => {
  const addObject = (preset: typeof OBJECT_PRESETS[0]) => {
    const angle = Math.random() * Math.PI * 2;
    const dist = 4 + Math.random() * 8;
    const x = Math.cos(angle) * dist;
    const z = Math.sin(angle) * dist;
    // Give a perpendicular velocity for orbital motion
    const speed = 0.8 + Math.random() * 0.5;
    const vx = -Math.sin(angle) * speed;
    const vz = Math.cos(angle) * speed;

    onAddObject({
      type: preset.type,
      position: [x, 0, z],
      mass: preset.mass,
      radius: preset.radius,
      color: preset.color,
      velocity: [vx, 0, vz],
    });
  };

  return (
    <div className="glass-panel p-4 w-64 animate-fade-in">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Orbit size={16} className="text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Objects</h3>
        </div>
        <span className="text-xs font-mono text-muted-foreground">{bodies.length} active</span>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-4">
        {OBJECT_PRESETS.map((preset) => (
          <button
            key={preset.type}
            onClick={() => addObject(preset)}
            className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/30 hover:bg-muted/50 border border-transparent hover:border-primary/20 transition-all group text-left"
          >
            <span className="text-muted-foreground group-hover:text-primary transition-colors" style={{ color: preset.color }}>
              {preset.icon}
            </span>
            <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">
              {preset.label}
            </span>
          </button>
        ))}
      </div>

      {bodies.length > 0 && (
        <button
          onClick={onRemoveAll}
          className="w-full text-xs py-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
        >
          Clear All Objects
        </button>
      )}
    </div>
  );
};

export default ObjectLibrary;
