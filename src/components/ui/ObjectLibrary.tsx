import { CelestialBody } from '../space/SpaceScene';
import { Orbit, Sun, Circle, Hexagon, Star, Zap, Sparkles } from 'lucide-react';
import { type ReactNode } from 'react';

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
            onClick={() => onSelectType(selectedType === preset.type ? null : preset.type)}
            className={`flex items-center gap-2 p-2.5 rounded-lg border transition-all group text-left hover-lift ${
              selectedType === preset.type
                ? 'bg-primary/15 border-primary/50'
                : 'bg-muted/30 hover:bg-muted/50 border-transparent hover:border-primary/30'
            }`}
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

      {selectedType && (
        <div className="text-[11px] text-primary/90 bg-primary/10 border border-primary/20 rounded-lg px-2.5 py-2 mb-3">
          Placement mode active. Click or drag on the grid to place {OBJECT_PRESETS.find((p) => p.type === selectedType)?.label}.
        </div>
      )}

      {bodies.length > 0 && (
        <div className="border-t border-border/20 pt-4 mt-2">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Active Bodies</span>
          </div>
          <div className="space-y-1.5 max-h-32 overflow-y-auto scrollbar-thin pr-1 mb-3">
            {bodies.map((body) => {
              const preset = OBJECT_PRESETS.find(p => p.type === body.type) || OBJECT_PRESETS[0];
              return (
                <div key={body.id} className="flex items-center gap-2 justify-between p-1.5 rounded bg-muted/20 hover:bg-muted/30 transition-colors group">
                  <div className="flex items-center gap-2 overflow-hidden">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: body.color }} />
                    <span className="text-[11px] text-muted-foreground truncate group-hover:text-foreground">
                      {preset.label}
                    </span>
                    <span className="text-[10px] text-muted-foreground/50 font-mono shrink-0">
                      {body.mass}M
                    </span>
                  </div>
                  <button
                    onClick={() => onRemoveBody(body.id)}
                    className="text-muted-foreground hover:text-destructive p-1 rounded hover:bg-destructive/10 transition-colors opacity-0 group-hover:opacity-100"
                    title="Remove"
                  >
                    <svg width="10" height="10" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M11.7816 4.03157C12.0062 3.80702 12.0062 3.44295 11.7816 3.2184C11.5571 2.99385 11.193 2.99385 10.9685 3.2184L7.50005 6.68682L4.03164 3.2184C3.80708 2.99385 3.44301 2.99385 3.21846 3.2184C2.99391 3.44295 2.99391 3.80702 3.21846 4.03157L6.68688 7.50001L3.21846 10.9684C2.99391 11.193 2.99391 11.5571 3.21846 11.7816C3.44301 12.0061 3.80708 12.0061 4.03164 11.7816L7.50005 8.31319L10.9685 11.7816C11.193 12.0061 11.5571 12.0061 11.7816 11.7816C12.0062 11.5571 12.0062 11.193 11.7816 10.9684L8.31322 7.50001L11.7816 4.03157Z" fill="currentColor" fillRule="evenodd" clipRule="evenodd"></path></svg>
                  </button>
                </div>
              );
            })}
          </div>
          <button
            onClick={onRemoveAll}
            className="w-full text-xs py-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
          >
            Clear All Objects
          </button>
        </div>
      )}
    </div>
  );
};

export default ObjectLibrary;
