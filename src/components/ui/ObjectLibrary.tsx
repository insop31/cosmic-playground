import { memo, useEffect, useRef, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { FolderOpen, LayoutTemplate, Maximize2, Orbit, PanelLeftClose, Save, Sparkles, Trash2, X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './dialog';
import { SPACETIME_TEMPLATES } from '../space/spacetimeTemplates';
import type { CelestialBody } from '../space/SpaceScene';
import type { SavedSpacetimeScenario } from '@/lib/scenarioStorage';
import { HudSlider, HudSwitch, IconButton, Segmented } from '../hud/controls';

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

const OTHER_PRESETS: { type: string; label: string; mass: number; radius: number; color: string }[] = [
  { type: 'star',      label: 'Star',         mass: 1.989e30, radius: 2.4,  color: '#ffcc00' },
  { type: 'blackhole', label: 'Black hole',   mass: 5.0e30,   radius: 1.4,  color: '#cc66ff' },
  { type: 'neutron',   label: 'Neutron star', mass: 2.8e30,   radius: 0.7,  color: '#00ffcc' },
  { type: 'asteroid',  label: 'Asteroid',     mass: 1.0e16,   radius: 0.28, color: '#b0a898' },
  { type: 'comet',     label: 'Comet',        mass: 2.0e14,   radius: 0.22, color: '#88eeff' },
];

const TYPE_LABEL: Record<string, string> = {
  star: 'Star',
  planet: 'Planet',
  blackhole: 'Black hole',
  neutron: 'Neutron star',
  asteroid: 'Asteroid',
  comet: 'Comet',
};

const MASS_FORMATTER = new Intl.NumberFormat('en-US', { notation: 'scientific', maximumFractionDigits: 2 });
const DATE_FORMATTER = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const PLANET_RENDER_RADIUS_SCALE = 4e7;

const formatMass = (mass: number) => MASS_FORMATTER.format(mass).replace('E', 'e');

type LibraryTab = 'bodies' | 'systems' | 'saved';

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
  savedScenarios: SavedSpacetimeScenario[];
  onSaveScenario: (name: string) => boolean;
  onLoadScenario: (scenarioId: string) => void;
  onDeleteScenario: (scenarioId: string) => void;
  onCollapse?: () => void;
}

/** A small CSS-shaded sphere used as a swatch for bodies. */
const Orb = ({ color, type, size = 22 }: { color: string; type?: string; size?: number }) => {
  if (type === 'blackhole') {
    return (
      <span
        className="relative inline-block shrink-0 rounded-full"
        style={{
          width: size,
          height: size,
          background: 'radial-gradient(circle at 50% 50%, #000 0 42%, #2a0a3a 50%, transparent 72%)',
          boxShadow: `0 0 0 2px rgba(255,160,80,0.55), 0 0 10px 2px ${color}66`,
        }}
      />
    );
  }
  const glow = type === 'star' || type === 'neutron';
  return (
    <span
      className="inline-block shrink-0 rounded-full"
      style={{
        width: size,
        height: size,
        background: `radial-gradient(circle at 34% 30%, #ffffffcc 0%, ${color} 34%, ${color}99 62%, #05070d 100%)`,
        boxShadow: glow ? `0 0 12px 2px ${color}88` : 'inset -2px -3px 6px rgba(0,0,0,0.45)',
      }}
    />
  );
};

const TemplatePreview = ({ templateId, className = 'h-36' }: { templateId: string; className?: string }) => {
  const template = SPACETIME_TEMPLATES.find((entry) => entry.id === templateId);
  if (!template) return null;

  return (
    <div className={`relative overflow-hidden rounded-lg border border-white/[0.06] bg-[radial-gradient(circle_at_center,rgba(90,216,240,0.10),rgba(7,11,20,0.95)_65%)] ${className}`}>
      <svg viewBox="0 0 100 100" className="h-full w-full">
        {template.preview.orbits.map((orbit, index) => (
          <circle
            key={`${template.id}-orbit-${index}`}
            cx="50"
            cy="50"
            r={orbit.radius}
            fill="none"
            stroke={orbit.stroke}
            strokeWidth="1.1"
            strokeOpacity="0.65"
            strokeDasharray={orbit.dashed ? '3 3' : undefined}
          />
        ))}
        {template.preview.bodies.map((body, index) => (
          <circle key={`${template.id}-body-${index}`} cx={body.x} cy={body.y} r={body.radius} fill={body.color} />
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
  savedScenarios,
  onSaveScenario,
  onLoadScenario,
  onDeleteScenario,
  onCollapse,
}: ObjectLibraryProps) => {
  const [tab, setTab] = useState<LibraryTab>('bodies');
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [armedKey, setArmedKey] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [scenarioName, setScenarioName] = useState('');
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const clearTimerRef = useRef<number>();
  const noteTimerRef = useRef<number>();

  useEffect(() => () => {
    window.clearTimeout(clearTimerRef.current);
    window.clearTimeout(noteTimerRef.current);
  }, []);

  useEffect(() => {
    if (!placementActive) setArmedKey(null);
  }, [placementActive]);

  const beginPlanetPlacement = (planet: PlanetPreset) => {
    setArmedKey(`planet:${planet.name}`);
    onBeginPlacement({
      name: planet.name,
      type: 'planet',
      bodyClass: planet.bodyClass,
      position: [0, 0, 0],
      mass: planet.mass,
      radius: Math.max(0.35, planet.physicalRadius / PLANET_RENDER_RADIUS_SCALE),
      physicalRadius: planet.physicalRadius,
      color: planet.color,
      atmosphere: planet.atmosphere,
      velocity: [0, 0, 0],
    });
  };

  const beginPlacementFromPreset = (preset: typeof OTHER_PRESETS[0]) => {
    setArmedKey(`type:${preset.type}`);
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

  const handleClearAll = () => {
    if (!confirmClear) {
      setConfirmClear(true);
      window.clearTimeout(clearTimerRef.current);
      clearTimerRef.current = window.setTimeout(() => setConfirmClear(false), 3000);
      return;
    }
    window.clearTimeout(clearTimerRef.current);
    setConfirmClear(false);
    onRemoveAll();
  };

  const handleSave = (event: FormEvent) => {
    event.preventDefault();
    const name = scenarioName.trim();
    if (!name) {
      setSaveNote('Name the scenario first.');
    } else if (onSaveScenario(name)) {
      setScenarioName('');
      setSaveNote(`Saved “${name}”.`);
    }
    window.clearTimeout(noteTimerRef.current);
    noteTimerRef.current = window.setTimeout(() => setSaveNote(null), 2600);
  };

  const tileClass = (key: string) => {
    const armed = placementActive && armedKey === key;
    return `hud-focus group flex flex-col items-center gap-1.5 rounded-md border px-1 py-2 text-center transition-[background-color,border-color,transform] duration-150 active:scale-[0.96] ${
      armed
        ? 'border-primary/60 bg-primary/[0.12] shadow-[0_0_0_3px_hsl(var(--primary)/0.12)]'
        : 'border-white/[0.06] bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.05]'
    }`;
  };

  return (
    <>
      <div className="hud-panel flex max-h-full w-[340px] flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2.5 px-4 pb-3 pt-3.5">
          <Orbit size={17} className="text-primary" />
          <h2 className="hud-title flex-1 text-foreground">Spacetime Lab</h2>
          {onCollapse && (
            <IconButton label="Collapse dock ([)" onClick={onCollapse} size="sm">
              <PanelLeftClose size={15} />
            </IconButton>
          )}
        </div>
        <div className="px-4 pb-3">
          <Segmented<LibraryTab>
            ariaLabel="Lab sections"
            layoutId="library-tab"
            value={tab}
            onChange={setTab}
            className="w-full [&>button]:flex-1"
            options={[
              { value: 'bodies', label: 'Bodies' },
              { value: 'systems', label: 'Systems' },
              { value: 'saved', label: <>Saved{savedScenarios.length > 0 && <span className="hud-num text-[10px] text-hud-faint">{savedScenarios.length}</span>}</> },
            ]}
          />
        </div>
        <div className="hud-divider" />

        <div className="hud-scroll min-h-0 flex-1 overflow-y-auto px-4">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
              className="py-4"
            >
              {tab === 'bodies' && (
                <div className="grid gap-5">
                  <div className="grid gap-2">
                    <div className="flex items-baseline justify-between">
                      <span className="hud-label">Planets</span>
                      <span className="text-[11px] text-hud-faint">Pick one, then click the grid</span>
                    </div>
                    <div className="grid grid-cols-4 gap-1.5">
                      {PLANET_PRESETS.map((planet) => (
                        <button
                          key={planet.name}
                          type="button"
                          onClick={() => beginPlanetPlacement(planet)}
                          title={`${planet.name} · ${formatMass(planet.mass)} kg`}
                          className={tileClass(`planet:${planet.name}`)}
                        >
                          <span className="flex h-6 items-center"><Orb color={planet.color} type="planet" size={planet.bodyClass === 'gas' ? 24 : planet.bodyClass === 'ice' ? 21 : 17} /></span>
                          <span className="text-[11.5px] leading-none text-foreground/85">{planet.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid gap-2">
                    <span className="hud-label">Stars &amp; small bodies</span>
                    <div className="grid grid-cols-5 gap-1.5">
                      {OTHER_PRESETS.map((preset) => (
                        <button
                          key={preset.type}
                          type="button"
                          onClick={() => beginPlacementFromPreset(preset)}
                          title={`${preset.label} · ${formatMass(preset.mass)} kg`}
                          className={tileClass(`type:${preset.type}`)}
                        >
                          <span className="flex h-6 items-center"><Orb color={preset.color} type={preset.type} size={preset.type === 'star' ? 22 : preset.type === 'blackhole' ? 20 : 16} /></span>
                          <span className="text-[10.5px] leading-tight text-foreground/85">{preset.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid gap-3.5 border-t border-white/[0.06] pt-4">
                    <span className="hud-label">Physics</span>
                    <HudSlider
                      label="Placement velocity"
                      info="Scales the orbital speed a new body is given when you place it. Above 1.5× sends comets and asteroids on fast flybys."
                      value={velocityScale}
                      min={0.2}
                      max={3}
                      step={0.05}
                      format={(v) => v.toFixed(2)}
                      unit="×"
                      onChange={onVelocityScaleChange}
                    />
                    <HudSwitch
                      label="Realistic gravity"
                      hint={realisticMode ? 'Newtonian G with real masses' : 'Arcade gravity, tuned for play'}
                      checked={realisticMode}
                      onCheckedChange={onRealisticModeChange}
                    />
                  </div>

                  <div className="grid gap-2 border-t border-white/[0.06] pt-4">
                    <div className="flex items-center justify-between">
                      <span className="hud-label">In the scene · <span className="hud-num">{bodies.length}</span></span>
                      {bodies.length > 0 && (
                        <button
                          type="button"
                          onClick={handleClearAll}
                          className={`hud-focus rounded px-2 py-1 text-[11.5px] font-medium transition-colors ${
                            confirmClear ? 'bg-danger/15 text-danger' : 'text-hud-dim hover:bg-danger/10 hover:text-danger'
                          }`}
                        >
                          {confirmClear ? 'Click again to clear' : 'Clear all'}
                        </button>
                      )}
                    </div>
                    {bodies.length === 0 ? (
                      <p className="rounded-md border border-dashed border-white/10 px-3 py-4 text-center text-[12px] text-hud-dim">
                        The grid is empty. Place a body or load a system.
                      </p>
                    ) : (
                      <ul className="grid gap-0.5">
                        {bodies.map((body) => (
                          <li key={body.id} className="group flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-white/[0.04]">
                            <Orb color={body.color} type={body.type} size={10} />
                            <span className="min-w-0 flex-1 truncate text-[12.5px] text-foreground/85">{body.name ?? TYPE_LABEL[body.type] ?? body.type}</span>
                            <span className="hud-num shrink-0 text-[10.5px] text-hud-faint">{formatMass(body.mass)} kg</span>
                            <button
                              type="button"
                              onClick={() => onRemoveBody(body.id)}
                              className="hud-focus rounded p-1 text-hud-faint opacity-0 transition-[opacity,color] hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
                              aria-label={`Remove ${body.name ?? TYPE_LABEL[body.type] ?? body.type}`}
                              title="Remove"
                            >
                              <X size={12} />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}

              {tab === 'systems' && (
                <div className="grid gap-2">
                  <div className="flex items-center justify-between">
                    <span className="hud-label">System templates</span>
                    <button
                      type="button"
                      onClick={() => setTemplatesOpen(true)}
                      className="hud-focus flex items-center gap-1 rounded px-1.5 py-1 text-[11.5px] text-hud-dim transition-colors hover:text-primary"
                    >
                      <Maximize2 size={11} /> Large previews
                    </button>
                  </div>
                  <p className="text-[12px] text-hud-dim">Loading a template replaces everything on the grid.</p>
                  <ul className="mt-1 grid gap-1.5">
                    {SPACETIME_TEMPLATES.map((template) => (
                      <li key={template.id}>
                        <button
                          type="button"
                          onClick={() => onApplyTemplate(template.id)}
                          className="hud-focus group flex w-full items-center gap-3 rounded-md border border-white/[0.06] bg-white/[0.02] p-2 text-left transition-colors hover:border-primary/30 hover:bg-primary/[0.05]"
                        >
                          <TemplatePreview templateId={template.id} className="h-14 w-14 shrink-0" />
                          <span className="min-w-0 flex-1">
                            <span className="block text-[13px] font-medium text-foreground">{template.name}</span>
                            <span className="block truncate text-[11.5px] text-hud-dim">{template.subtitle}</span>
                          </span>
                          <span className="hud-num shrink-0 text-[10.5px] text-hud-faint group-hover:text-primary">{template.bodyCount} bodies</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {tab === 'saved' && (
                <div className="grid gap-4">
                  <form onSubmit={handleSave} className="grid gap-2">
                    <label htmlFor="scenario-name" className="hud-label">Save current grid</label>
                    <div className="flex gap-1.5">
                      <input
                        id="scenario-name"
                        value={scenarioName}
                        onChange={(event) => setScenarioName(event.target.value)}
                        placeholder="e.g. Binary with comet"
                        maxLength={48}
                        className="hud-focus h-8 min-w-0 flex-1 rounded-md border border-white/10 bg-white/[0.04] px-2.5 text-[12.5px] text-foreground placeholder:text-hud-faint focus:border-primary/50"
                      />
                      <button
                        type="submit"
                        className="hud-focus flex h-8 items-center gap-1.5 rounded-md border border-primary/40 bg-primary/15 px-3 text-[12.5px] font-medium text-primary transition-colors hover:bg-primary/25"
                      >
                        <Save size={13} /> Save
                      </button>
                    </div>
                    <p className="min-h-4 text-[11.5px] leading-snug text-hud-dim" aria-live="polite">
                      {saveNote ?? `Stores ${bodies.length} bodies, placement velocity and gravity mode in this browser.`}
                    </p>
                  </form>

                  <div className="grid gap-1.5">
                    <span className="hud-label">Saved scenarios</span>
                    {savedScenarios.length === 0 ? (
                      <p className="rounded-md border border-dashed border-white/10 px-3 py-4 text-center text-[12px] text-hud-dim">
                        Nothing saved yet. Up to 12 scenarios are kept.
                      </p>
                    ) : (
                      <ul className="grid gap-1">
                        {savedScenarios.map((scenario) => (
                          <li key={scenario.id} className="group flex items-center gap-2 rounded-md border border-white/[0.06] bg-white/[0.02] py-1.5 pl-2.5 pr-1.5">
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[12.5px] text-foreground">{scenario.name}</p>
                              <p className="hud-num text-[10.5px] text-hud-faint">
                                {scenario.bodies.length} bodies · {scenario.realisticMode ? 'realistic' : 'arcade'} · {DATE_FORMATTER.format(new Date(scenario.updatedAt))}
                              </p>
                            </div>
                            <IconButton label={`Load ${scenario.name}`} size="sm" onClick={() => onLoadScenario(scenario.id)}>
                              <FolderOpen size={14} />
                            </IconButton>
                            <IconButton label={`Delete ${scenario.name}`} size="sm" tone="danger" onClick={() => onDeleteScenario(scenario.id)}>
                              <Trash2 size={13} />
                            </IconButton>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      <Dialog open={templatesOpen} onOpenChange={setTemplatesOpen}>
        <DialogContent className="hud-panel max-w-4xl gap-0 overflow-hidden border-white/10 bg-[hsl(var(--hud-surface)/0.94)] p-0 text-foreground sm:rounded-xl">
          <div className="border-b border-white/[0.07] px-6 py-5">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 font-display text-xl tracking-wide text-foreground">
                <LayoutTemplate size={18} className="text-primary" /> System templates
              </DialogTitle>
              <DialogDescription className="text-[13px] text-hud-dim">
                Pick a pre-built orbital setup to drop onto the spacetime grid, then keep experimenting from there.
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="hud-scroll grid max-h-[70vh] grid-cols-1 gap-3 overflow-y-auto p-5 md:grid-cols-2">
            {SPACETIME_TEMPLATES.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => handleTemplateSelect(template.id)}
                className="hud-focus group rounded-lg border border-white/[0.07] bg-white/[0.02] p-3 text-left transition-colors hover:border-primary/35 hover:bg-primary/[0.04]"
              >
                <TemplatePreview templateId={template.id} />
                <div className="mt-3 flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[15px] font-semibold text-foreground">{template.name}</div>
                    <div className="hud-label text-primary/80">{template.subtitle}</div>
                  </div>
                  <span className="hud-num shrink-0 rounded-full border border-white/10 px-2 py-0.5 text-[10.5px] text-hud-dim">
                    {template.bodyCount} bodies
                  </span>
                </div>
                <p className="mt-2 text-[13px] leading-relaxed text-hud-dim">{template.description}</p>
                <span className="mt-3 flex items-center gap-1 text-[12.5px] font-medium text-primary opacity-80 group-hover:opacity-100">
                  <Sparkles size={12} /> Load template
                </span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default memo(ObjectLibrary);
