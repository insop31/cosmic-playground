import { useState, useCallback, useRef, useEffect } from 'react';
import SpaceScene, { CelestialBody } from '../components/space/SpaceScene';
import RocketScene from '../components/rocket/RocketScene';
import RocketControls from '../components/rocket/RocketControls';
import { RocketParams, RocketState, DEFAULT_PARAMS, INITIAL_STATE } from '../components/rocket/rocketTypes';
import TimeControls from '../components/ui/TimeControls';
import ObjectLibrary, { OBJECT_PRESETS, createBodyFromPreset } from '../components/ui/ObjectLibrary';
import { Atom, Rocket, Orbit, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

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
    <div className="w-screen h-screen relative overflow-hidden bg-background">
      <div className="bg-noise mix-blend-overlay"></div>
      {/* 3D Canvases - use visibility instead of conditional render to avoid WebGL context loss */}
      <div className="absolute inset-0 z-0 pointer-events-auto" style={{ display: mode === 'spacetime' ? 'block' : 'none' }}>
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
      <div className="absolute inset-0 z-0 pointer-events-auto" style={{ display: mode === 'rocket' ? 'block' : 'none' }}>
        <RocketScene params={rocketParams} state={rocketState} onUpdateState={setRocketState} />
      </div>

      {/* Absolute UI Overlay (z-10) */}
      <div className="absolute inset-0 z-10 pointer-events-none flex flex-col">
        {/* Top Navigation Bar */}
        <motion.div 
          className="p-6 flex items-start justify-between"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        >
          {/* Logo / Brand */}
          <div className="glass-panel px-5 py-3 flex items-center gap-4 pointer-events-auto group">
            <div className="relative flex items-center justify-center">
              <Sparkles size={24} className="text-secondary opacity-70 absolute scale-150 blur-[10px] group-hover:opacity-100 transition-opacity" />
              <Atom size={24} className="text-primary animate-pulse-glow relative z-10" />
            </div>
            <div>
              <h1 className="text-base font-bold tracking-widest text-foreground glow-text uppercase">COSMIC PLAYGROUND</h1>
              <p className="text-[10px] font-mono text-muted-foreground tracking-[0.2em] uppercase">
                {mode === 'spacetime' ? 'Gravity Sandbox' : 'Rocket Flight System'}
              </p>
            </div>
          </div>

          {/* Elegant Pill Toggles */}
          <div className="glass-panel p-1.5 flex gap-1 pointer-events-auto rounded-full">
            <button
              onClick={() => setMode('spacetime')}
              className={`flex items-center gap-2 px-6 py-2.5 rounded-full text-xs font-semibold tracking-wide transition-all ${
                mode === 'spacetime'
                  ? 'bg-primary/20 text-primary glow-border shadow-[inset_0_0_15px_rgba(139,92,246,0.1)]'
                  : 'text-muted-foreground hover:text-foreground hover:bg-white/5'
              }`}
            >
              <Orbit size={16} strokeWidth={1.5} /> Spacetime
            </button>
            <button
              onClick={() => setMode('rocket')}
              className={`flex items-center gap-2 px-6 py-2.5 rounded-full text-xs font-semibold tracking-wide transition-all ${
                mode === 'rocket'
                  ? 'bg-secondary/20 text-secondary border border-secondary/30 shadow-[inset_0_0_15px_rgba(139,92,246,0.1)]'
                  : 'text-muted-foreground hover:text-foreground hover:bg-white/5'
              }`}
            >
              <Rocket size={16} strokeWidth={1.5} /> Rocket
            </button>
          </div>

          {/* Minimalist Stats */}
          <div className="glass-panel px-4 py-3 pointer-events-auto min-w-[12rem] flex flex-col justify-center items-end">
             {mode === 'spacetime' ? (
                <div className="flex flex-col items-end gap-1 text-[11px] font-mono tracking-wider">
                  <div className="text-muted-foreground">ACTIVE BODIES <span className="text-primary ml-2">{bodies.length}</span></div>
                  {universeScale > 1.001 && (
                    <div className="text-muted-foreground">
                      EXPANSION <span className="text-secondary ml-2">{(universeScale - 1).toFixed(4)}x</span>
                    </div>
                  )}
                  <div className="text-muted-foreground">
                    TIME DILATION <span className={`ml-2 ${timeScale < 0 ? 'text-amber-400' : 'text-primary'}`}>
                      {timeScale < 0 ? `◀ ${Math.abs(timeScale)}x` : `${timeScale}x`}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-end gap-1 text-[11px] font-mono tracking-wider">
                  <div className="text-muted-foreground">ALTITUDE <span className="text-primary ml-2">{rocketState.altitude.toFixed(1)} km</span></div>
                  <div className="text-muted-foreground">FUEL LEVEL <span className="text-secondary ml-2">{(rocketState.fuel * 100).toFixed(0)}%</span></div>
                </div>
              )}
          </div>
        </motion.div>

        {/* Main Interface Areas */}
        <div className="flex-1 relative">
          {/* Left Panel */}
          <AnimatePresence mode="wait">
            <motion.div 
              key={mode} /* Key triggers re-animation when mode changes */
              className="absolute left-6 top-0 bottom-6 z-10 pointer-events-auto"
              initial={{ opacity: 0, x: -30 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.6, ease: "easeOut" }}
            >
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
            </motion.div>
          </AnimatePresence>

          {/* Bottom Center - Time Controls (spacetime mode only) */}
          <AnimatePresence>
            {mode === 'spacetime' && (
              <motion.div 
                className="absolute bottom-10 left-1/2 -translate-x-1/2 z-10 pointer-events-auto"
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                transition={{ duration: 0.6, ease: "easeOut", delay: 0.2 }}
              >
                <TimeControls
                  timeScale={timeScale}
                  isPlaying={isPlaying}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onSpeedChange={setTimeScale}
                  onReset={handleResetSpacetime}
                />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Bottom Right - Immersive Hint */}
          <motion.div 
            className="absolute bottom-6 right-6 z-10 pointer-events-none"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1, duration: 1 }}
          >
            <p className="text-[10px] font-mono text-white/30 tracking-widest uppercase selection:bg-transparent">
              {mode === 'spacetime'
                ? 'LMB: Orbit • RMB: Pan • Scroll: Zoom'
                : 'Adjust Flight Parameters • Deploy • Monitor'}
            </p>
          </motion.div>
        </div>
      </div>

    </div>
  );
};

export default Index;
