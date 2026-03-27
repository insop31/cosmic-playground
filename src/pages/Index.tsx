import { useState, useCallback, useRef, useEffect } from 'react';
import SpaceScene, { CelestialBody } from '../components/space/SpaceScene';
import RocketScene from '../components/rocket/RocketScene';
import RocketControls from '../components/rocket/RocketControls';
import { RocketParams, RocketState, DEFAULT_PARAMS, INITIAL_STATE } from '../components/rocket/rocketTypes';
import TimeControls from '../components/ui/TimeControls';
import ObjectLibrary, { OBJECT_PRESETS, createBodyFromPreset } from '../components/ui/ObjectLibrary';
import { Atom, Rocket, Orbit } from 'lucide-react';

let nextId = 1;

type AppMode = 'spacetime' | 'rocket';

// Universe expansion starts after this many real seconds
const EXPANSION_DELAY_S = 600; // 10 minutes

const Index = () => {
  const [mode, setMode] = useState<AppMode>('spacetime');

  // ─── Spacetime state ───
  const [bodies, setBodies] = useState<CelestialBody[]>([
    { id: 'sun', type: 'star', position: [0, 0, 0], mass: 10, radius: 1.5, color: '#ffcc00', velocity: [0, 0, 0] },
    { id: 'planet1', type: 'planet', position: [8, 0, 0], mass: 2, radius: 0.7, color: '#4488ff', velocity: [0, 0, 1.1] },
    { id: 'planet2', type: 'planet', position: [-5, 0, 6], mass: 1.5, radius: 0.5, color: '#ff6644', velocity: [0.9, 0, 0.3] },
  ]);

  // timeScale can be negative for rewind (-4 … -0.5 … 0.5 … 4)
  const [timeScale, setTimeScale] = useState(1);
  const [isPlaying, setIsPlaying] = useState(true);
  const [selectedObjectType, setSelectedObjectType] = useState<string | null>(null);

  // Universe expansion
  const universeAgeRef = useRef(0);
  const [universeScale, setUniverseScale] = useState(1);
  const lastTickRef = useRef(Date.now());

  // ─── Rocket state ───
  const [rocketParams, setRocketParams] = useState<RocketParams>(DEFAULT_PARAMS);
  const [rocketState, setRocketState] = useState<RocketState>(INITIAL_STATE);

  // ─── Universe age ticker ───
  useEffect(() => {
    if (mode !== 'spacetime') return;

    const interval = setInterval(() => {
      const now = Date.now();
      const elapsed = (now - lastTickRef.current) / 1000;
      lastTickRef.current = now;

      // Only age the universe while time is moving forward
      if (isPlaying && timeScale > 0) {
        universeAgeRef.current += elapsed;
      }

      const age = universeAgeRef.current;
      // Scale starts at 1, grows slowly after EXPANSION_DELAY_S
      const newScale = 1 + 0.00018 * Math.max(0, age - EXPANSION_DELAY_S);
      setUniverseScale(newScale);
    }, 1000);

    return () => clearInterval(interval);
  }, [mode, isPlaying, timeScale]);

  // ─── Spacetime handlers ───
  // Physics positions are managed inside PhysicsSimulator via refs — no per-frame
  // React state update needed. These callbacks only fire on low-frequency events.
  const handleBodyRemoved = useCallback((id: string) => {
    setBodies((prev) => prev.filter((b) => b.id !== id));
  }, []);

  const handleBodyUpdated = useCallback((id: string, mass: number, radius: number) => {
    setBodies((prev) => prev.map((b) => (b.id === id ? { ...b, mass, radius } : b)));
  }, []);

  const handleAddObject = useCallback((obj: Omit<CelestialBody, 'id'>) => {
    setBodies((prev) => [...prev, { ...obj, id: `obj_${nextId++}` }]);
  }, []);

  const handlePlaceSelectedBody = useCallback((position: [number, number, number]) => {
    if (!selectedObjectType) return;
    const preset = OBJECT_PRESETS.find((p) => p.type === selectedObjectType);
    if (!preset) return;
    handleAddObject(createBodyFromPreset(preset, bodies, position));
  }, [selectedObjectType, bodies, handleAddObject]);

  const handleRemoveBody = useCallback((id: string) => {
    setBodies((prev) => prev.filter((b) => b.id !== id));
  }, []);

  const handleRemoveAll = useCallback(() => setBodies([]), []);

  const handleResetSpacetime = useCallback(() => {
    setBodies([
      { id: 'sun', type: 'star', position: [0, 0, 0], mass: 10, radius: 1.5, color: '#ffcc00', velocity: [0, 0, 0] },
      { id: 'planet1', type: 'planet', position: [8, 0, 0], mass: 2, radius: 0.7, color: '#4488ff', velocity: [0, 0, 1.1] },
    ]);
    setTimeScale(1);
    setIsPlaying(true);
    universeAgeRef.current = 0;
    setUniverseScale(1);
  }, []);

  // ─── Rocket handlers ───
  const handleRocketParamChange = useCallback((key: keyof RocketParams, value: number | boolean) => {
    setRocketParams((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleLaunch = useCallback(() => {
    setRocketState({ ...INITIAL_STATE, phase: 'launching', fuel: 1 });
  }, []);

  const handleRocketReset = useCallback(() => {
    setRocketState({ ...INITIAL_STATE });
  }, []);

  // effectiveTimeScale carries sign (negative = rewind, 0 = paused)
  const effectiveTimeScale = isPlaying ? timeScale : 0;

  return (
    <div className="w-full h-screen relative overflow-hidden bg-background">
      <div className="bg-noise mix-blend-overlay"></div>
      {/* 3D Canvases - use visibility instead of conditional render to avoid WebGL context loss */}
      <div className="absolute inset-0" style={{ display: mode === 'spacetime' ? 'block' : 'none' }}>
        <SpaceScene
          bodies={bodies}
          timeScale={effectiveTimeScale}
          onBodyRemoved={handleBodyRemoved}
          onBodyUpdated={handleBodyUpdated}
          placementEnabled={Boolean(selectedObjectType)}
          onPlaceBody={handlePlaceSelectedBody}
          universeScale={universeScale}
        />
      </div>
      <div className="absolute inset-0" style={{ display: mode === 'rocket' ? 'block' : 'none' }}>
        <RocketScene params={rocketParams} state={rocketState} onUpdateState={setRocketState} />
      </div>

      {/* Top Bar */}
      <div className="absolute top-0 left-0 right-0 z-10 p-4 flex items-center justify-between pointer-events-none">
        <div className="glass-panel px-5 py-3 flex items-center gap-3 pointer-events-auto hover-lift">
          <Atom size={22} className="text-primary animate-pulse w-6 h-6 drop-shadow-[0_0_8px_rgba(0,242,254,0.8)]" />
          <div>
            <h1 className="text-base font-bold tracking-widest text-gradient-premium">SPACE–TIME LAB</h1>
            <p className="text-[10px] font-mono text-muted-foreground tracking-widest uppercase">
              {mode === 'spacetime' ? 'Gravity Sandbox' : 'Rocket Simulator'}
            </p>
          </div>
        </div>

        {/* Mode Switcher */}
        <div className="glass-panel p-1 flex gap-1 pointer-events-auto">
          <button
            onClick={() => setMode('spacetime')}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
              mode === 'spacetime'
                ? 'bg-primary/20 text-primary glow-border'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'
            }`}
          >
            <Orbit size={14} /> Spacetime
          </button>
          <button
            onClick={() => setMode('rocket')}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
              mode === 'rocket'
                ? 'bg-primary/20 text-primary glow-border'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'
            }`}
          >
            <Rocket size={14} /> Rocket
          </button>
        </div>

        {/* Stats */}
        <div className="glass-panel-strong px-4 py-2.5 pointer-events-auto">
          <div className="flex items-center gap-5 text-xs font-mono">
            {mode === 'spacetime' ? (
              <>
                <div className="text-muted-foreground">Bodies: <span className="text-primary">{bodies.length}</span></div>
                <div className="text-muted-foreground">
                  Speed: <span className={timeScale < 0 ? 'text-amber-400' : 'text-primary'}>
                    {timeScale < 0 ? `◀ ${Math.abs(timeScale)}x` : `${timeScale}x`}
                  </span>
                </div>
                {universeScale > 1.001 && (
                  <div className="text-muted-foreground">
                    ∿ Scale: <span className="text-violet-400">{universeScale.toFixed(3)}x</span>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="text-muted-foreground">Alt: <span className="text-primary">{rocketState.altitude.toFixed(1)}</span></div>
                <div className="text-muted-foreground">Fuel: <span className="text-primary">{(rocketState.fuel * 100).toFixed(0)}%</span></div>
                <div className="text-muted-foreground">Phase: <span className="text-primary capitalize">{rocketState.phase}</span></div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Left Panel */}
      <div className="absolute left-4 top-20 bottom-20 z-10 pointer-events-auto">
        {mode === 'spacetime' ? (
          <ObjectLibrary
            bodies={bodies}
            onRemoveBody={handleRemoveBody}
            onRemoveAll={handleRemoveAll}
            selectedType={selectedObjectType}
            onSelectType={setSelectedObjectType}
          />
        ) : (
          <RocketControls
            params={rocketParams}
            state={rocketState}
            onParamChange={handleRocketParamChange}
            onLaunch={handleLaunch}
            onReset={handleRocketReset}
          />
        )}
      </div>

      {/* Bottom Center - Time Controls (spacetime mode only) */}
      {mode === 'spacetime' && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 pointer-events-auto">
          <TimeControls
            timeScale={timeScale}
            isPlaying={isPlaying}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onSpeedChange={setTimeScale}
            onReset={handleResetSpacetime}
          />
        </div>
      )}

      {/* Bottom Right - Hint */}
      <div className="absolute bottom-6 right-4 z-10">
        <p className="text-[10px] font-mono text-muted-foreground/50">
          {mode === 'spacetime'
            ? 'Select an object, then click or drag on grid to place · Scroll to zoom'
            : 'Adjust parameters · Launch · Observe trajectory'}
        </p>
      </div>
    </div>
  );
};

export default Index;
