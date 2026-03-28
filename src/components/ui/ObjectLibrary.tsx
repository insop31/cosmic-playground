import { type ReactNode, useMemo, useState } from 'react';
import { Orbit, Sun, Circle, Hexagon, Star, Zap, Sparkles, LayoutTemplate } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './dialog';
import { SPACETIME_TEMPLATES } from '../space/spacetimeTemplates';
import type { CelestialBody } from '../space/SpaceScene';

interface PlanetPreset {
  name: string;
  mass: number;
  physicalRadius: number;
  bodyClass: 'rocky' | 'gas' | 'ice';
  color: string;
  atmosphere: boolean;
}

const PLANET_PRESETS: PlanetPreset[] = [
  { name: 'Mercury', mass: 3.30e23, physicalRadius: 2_439_700, bodyClass: 'rocky', color: '#c8c2b6', atmosphere: false },
  { name: 'Venus',   mass: 4.87e24, physicalRadius: 6_051_800, bodyClass: 'rocky', color: '#e8c898', atmosphere: true },
  { name: 'Earth',   mass: 5.97e24, physicalRadius: 6_371_000, bodyClass: 'rocky', color: '#5b9ee8', atmosphere: true },
  { name: 'Mars',    mass: 6.42e23, physicalRadius: 3_389_500, bodyClass: 'rocky', color: '#dd7755', atmosphere: true },
  { name: 'Jupiter', mass: 1.90e27, physicalRadius: 69_911_000, bodyClass: 'gas',  color: '#e0c090', atmosphere: true },
  { name: 'Saturn',  mass: 5.68e26, physicalRadius: 58_232_000, bodyClass: 'gas',  color: '#f0d898', atmosphere: true },
  { name: 'Uranus',  mass: 8.68e25, physicalRadius: 25_362_000, bodyClass: 'ice',  color: '#88dde4', atmosphere: true },
  { name: 'Neptune', mass: 1.02e26, physicalRadius: 24_622_000, bodyClass: 'ice',  color: '#6699ff', atmosphere: true },
];

const OTHER_PRESETS: { type: string; label: string; mass: number; radius: number; color: string; icon: ReactNode }[] = [
  { type: 'star',      label: 'Star',         mass: 1.989e30, radius: 2.4,  color: '#ffcc00', icon: <Sun size={16} /> },
  { type: 'blackhole', label: 'Black Hole',   mass: 5.0e30,   radius: 1.4,  color: '#cc66ff', icon: <Hexagon size={16} /> },
  { type: 'asteroid',  label: 'Asteroid',     mass: 1.0e16,   radius: 0.28, color: '#b0a898', icon: <Star size={16} /> },
  { type: 'neutron',   label: 'Neutron Star', mass: 2.8e30,   radius: 0.7,  color: '#00ffcc', icon: <Zap size={16} /> },
  { type: 'comet',     label: 'Comet',        mass: 2.0e14,   radius: 0.22, color: '#88eeff', icon: <Sparkles size={16} /> },
];

const MASS_FORMATTER = new Intl.NumberFormat('en-US', { notation: 'scientific', maximumFractionDigits: 2 });
const PLANET_RENDER_RADIUS_SCALE = 4e7;

interface ObjectLibraryProps {
  onBeginPlacement: (body: Omit<CelestialBody, 'id'>) => void;
  onApplyTemplate: (templateId: string) => void;
  bodies: CelestialBody[];
  onRemoveBody: (id: string) => void;
  onRemoveAll: () => void;
  placementActive: boolean;
  onVelocityScaleChange: (value: number) => void;
  velocityScale: number;
  realisticMode: boolean;
  onRealisticModeChange: (value: boolean) => void;
}

const TemplatePreview = ({ templateId }: { templateId: string }) => {
  const template = SPACETIME_TEMPLATES.find((entry) => entry.id === templateId);
  if (!template) return null;

  return (
    <div className="relative h-36 rounded-2xl border border-primary/15 bg-[radial-gradient(circle_at_center,rgba(96,165,250,0.16),rgba(15,23,42,0.9)_62%)] overflow-hidden">
      <svg viewBox="0 0 100 100" className="w-full h-full">
        {template.preview.orbits.map((orbit, index) => (
          <circle
            key={`${template.id}-orbit-${index}`}
            cx="50"
            cy="50"
            r={orbit.radius}
            fill="none"
            stroke={orbit.stroke}
            strokeWidth="1.3"
            strokeOpacity="0.75"
            strokeDasharray={orbit.dashed ? '3 3' : undefined}
          />
        ))}
        {template.preview.bodies.map((body, index) => (
          <circle
            key={`${template.id}-body-${index}`}
            cx={body.x}
            cy={body.y}
            r={body.radius}
            fill={body.color}
          />
        ))}
      </svg>
    </div>
  );
};

const ObjectLibrary = ({
  onBeginPlacement,
  onApplyTemplate,
  bodies,
  onRemoveBody,
  onRemoveAll,
  placementActive,
  onVelocityScaleChange,
  velocityScale,
  realisticMode,
  onRealisticModeChange,
}: ObjectLibraryProps) => {
  const [selectedPlanetName, setSelectedPlanetName] = useState('Earth');
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const selectedPlanet = useMemo(
    () => PLANET_PRESETS.find((planet) => planet.name === selectedPlanetName) ?? PLANET_PRESETS[2],
    [selectedPlanetName],
  );

  const beginPlanetPlacement = () => {
    onBeginPlacement({
      name: selectedPlanet.name,
      type: 'planet',
      bodyClass: selectedPlanet.bodyClass,
      position: [0, 0, 0],
      mass: selectedPlanet.mass,
      radius: Math.max(0.35, selectedPlanet.physicalRadius / PLANET_RENDER_RADIUS_SCALE),
      physicalRadius: selectedPlanet.physicalRadius,
      color: selectedPlanet.color,
      atmosphere: selectedPlanet.atmosphere,
      velocity: [0, 0, 0],
    });
  };

  const beginPlacementFromPreset = (preset: typeof OTHER_PRESETS[0]) => {
    onBeginPlacement({
      type: preset.type,
      bodyClass: preset.type === 'star' ? 'star' : preset.type === 'blackhole' ? 'blackhole' : 'asteroid',
      position: [0, 0, 0],
      mass: preset.mass,
      radius: preset.radius,
      color: preset.color,
      velocity: [0, 0, 0],
      eventHorizonRadius: preset.type === 'blackhole' ? preset.radius * 2.2 : undefined,
    });
  };

  const handleTemplateSelect = (templateId: string) => {
    onApplyTemplate(templateId);
    setTemplatesOpen(false);
  };

  return (
    <>
      <div className="glass-panel p-6 w-[400px] animate-fade-in">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Orbit size={20} className="text-primary" />
            <h3 className="text-xl font-semibold text-foreground">Objects</h3>
          </div>
          <span className="text-base font-mono text-muted-foreground">{bodies.length} active</span>
        </div>

        <button
          onClick={() => setTemplatesOpen(true)}
          className="w-full rounded-xl border border-primary/30 bg-gradient-to-r from-primary/16 to-secondary/10 px-4 py-3 mb-4 text-left transition-all hover:border-primary/45 hover:from-primary/22 hover:to-secondary/16 hover:shadow-[0_0_24px_rgba(96,165,250,0.16)]"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl border border-primary/30 bg-primary/10 flex items-center justify-center">
              <LayoutTemplate size={18} className="text-primary" />
            </div>
            <div>
              <div className="text-base font-semibold text-foreground">System Templates</div>
              <div className="text-sm text-muted-foreground">Load pre-built orbit systems into the grid.</div>
            </div>
          </div>
        </button>

        <div className="space-y-3 mb-4">
          <div className="rounded-lg bg-muted/20 border border-border/30 p-2">
            <div className="flex items-center gap-2 mb-2">
              <Circle size={15} className="text-primary" />
              <span className="text-base text-foreground">Planet</span>
            </div>
            <div className="relative mb-2">
              <select
                value={selectedPlanetName}
                onChange={(e) => setSelectedPlanetName(e.target.value)}
                className="w-full appearance-none bg-gradient-to-r from-cyan-950/30 to-violet-950/30 text-cyan-100 rounded-md px-3 py-2.5 text-base border border-cyan-400/25 focus:border-cyan-300/60 focus:outline-none focus:ring-1 focus:ring-cyan-400/40"
                style={{ fontSize: '15px' }}
              >
                {PLANET_PRESETS.map((planet) => (
                  <option key={planet.name} value={planet.name} className="bg-slate-950 text-cyan-100">
                    {`${planet.name}   (${MASS_FORMATTER.format(planet.mass)} kg)`}
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-cyan-300/80 text-[10px]">▼</span>
            </div>
            <button
              onClick={beginPlanetPlacement}
              className={`w-full flex items-center gap-2 p-2.5 rounded-lg border transition-all group text-left ${
                placementActive ? 'bg-primary/20 border-primary/40' : 'bg-muted/30 hover:bg-muted/50 border-transparent hover:border-primary/20'
              }`}
            >
              <Circle size={16} style={{ color: selectedPlanet.color }} />
              <span className="text-base text-muted-foreground group-hover:text-foreground transition-colors">Planet</span>
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {OTHER_PRESETS.map((preset) => (
              <button
                key={preset.type}
                onClick={() => beginPlacementFromPreset(preset)}
                className={`flex items-center gap-2 p-2.5 rounded-lg border transition-all group text-left ${
                  placementActive ? 'bg-primary/20 border-primary/40' : 'bg-muted/30 hover:bg-muted/50 border-transparent hover:border-primary/20'
                }`}
              >
                <span className="text-muted-foreground group-hover:text-primary transition-colors" style={{ color: preset.color }}>
                  {preset.icon}
                </span>
                <span className="text-base text-muted-foreground group-hover:text-foreground transition-colors">
                  {preset.label}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="border-t border-border/20 pt-3 mb-3 space-y-2">
          <div className="flex items-center justify-between text-base text-muted-foreground">
            <span>Placement velocity</span>
            <span>{velocityScale.toFixed(2)}x</span>
          </div>
          <input
            type="range"
            min={0.2}
            max={3}
            step={0.05}
            value={velocityScale}
            onChange={(e) => onVelocityScaleChange(Number(e.target.value))}
            className="w-full"
          />
          <label className="flex items-center justify-between text-base text-muted-foreground">
            <span>Realistic physics</span>
            <input
              type="checkbox"
              checked={realisticMode}
              onChange={(e) => onRealisticModeChange(e.target.checked)}
            />
          </label>
          {placementActive && (
            <p className="text-[10px] text-primary/90 font-mono">Placement mode active: click on the spacetime grid</p>
          )}
        </div>

        {bodies.length > 0 && (
          <div className="border-t border-border/20 pt-4 mt-2">
            <div className="flex items-center justify-between mb-2">
              <span className="text-base font-semibold text-muted-foreground uppercase tracking-wider">Active Bodies</span>
            </div>
            <div className="space-y-1.5 max-h-32 overflow-y-auto scrollbar-thin pr-1 mb-3">
              {bodies.map((body) => {
                const label = body.name ?? body.type;
                return (
                  <div key={body.id} className="flex items-center gap-2 justify-between p-1.5 rounded bg-muted/20 hover:bg-muted/30 transition-colors group">
                    <div className="flex items-center gap-2 overflow-hidden">
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: body.color }} />
                      <span className="text-base text-muted-foreground truncate group-hover:text-foreground">
                        {label}
                      </span>
                      <span className="text-[10px] text-muted-foreground/50 font-mono shrink-0">
                        {MASS_FORMATTER.format(body.mass)} kg
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
              className="w-full text-base py-2.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            >
              Clear All Objects
            </button>
          </div>
        )}
      </div>

      <Dialog open={templatesOpen} onOpenChange={setTemplatesOpen}>
        <DialogContent className="max-w-5xl border-primary/20 bg-slate-950/96 backdrop-blur-xl text-foreground p-0 overflow-hidden">
          <div className="p-6 border-b border-white/10">
            <DialogHeader>
              <DialogTitle className="text-2xl tracking-wide text-foreground">Stable System Templates</DialogTitle>
              <DialogDescription className="text-base text-muted-foreground">
                Pick a pre-built orbital setup to drop directly into the spacetime grid, then keep experimenting from there.
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="max-h-[72vh] overflow-y-auto p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            {SPACETIME_TEMPLATES.map((template) => (
              <button
                key={template.id}
                onClick={() => handleTemplateSelect(template.id)}
                className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-left transition-all hover:border-primary/35 hover:bg-primary/[0.06] hover:shadow-[0_0_28px_rgba(96,165,250,0.12)]"
              >
                <TemplatePreview templateId={template.id} />
                <div className="mt-4 flex items-start justify-between gap-3">
                  <div>
                    <div className="text-lg font-semibold text-foreground">{template.name}</div>
                    <div className="text-sm uppercase tracking-[0.18em] text-primary/80">{template.subtitle}</div>
                  </div>
                  <div className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-mono uppercase tracking-[0.18em] text-primary">
                    {template.bodyCount} bodies
                  </div>
                </div>
                <p className="mt-3 text-base leading-relaxed text-muted-foreground">{template.description}</p>
                <div className="mt-4 text-sm font-medium text-primary">Load Template</div>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default ObjectLibrary;
