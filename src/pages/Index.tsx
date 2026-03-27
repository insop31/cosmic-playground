import { useState, useCallback, useRef, useEffect } from 'react';
import SpaceScene, { CelestialBody } from '../components/space/SpaceScene';
import RocketScene from '../components/rocket/RocketScene';
import RocketControls from '../components/rocket/RocketControls';
import { RocketParams, RocketState, DEFAULT_PARAMS, INITIAL_STATE } from '../components/rocket/rocketTypes';
import TimeControls from '../components/ui/TimeControls';
import ObjectLibrary from '../components/ui/ObjectLibrary';
import { Atom, Rocket, Orbit, Trophy, Sparkles, Target } from 'lucide-react';

let nextId = 1;

type AppMode = 'spacetime' | 'rocket';

// Universe expansion starts after this many real seconds
const EXPANSION_DELAY_S = 600; // 10 minutes
const DEFAULT_STAR_MASS = 1.989e30;
const MASSIVE_ATTRACTOR_THRESHOLD = 1e27;
const REAL_G = 6.674e-11;
const REAL_GRAVITY_BOOST = 7.5e-20; // Must match PhysicsSimulator — G_eff * M_sun ≈ 10 at scene scale
const MIN_ORBITAL_SPEED = 0.08;
const MAX_ORBITAL_SPEED = 3.0;

const ACHIEVEMENT_CONFIG = [
  { id: 'first-stable-orbit', name: 'First Stable Orbit', description: 'Reach orbit in the rocket simulator.', score: 120 },
  { id: 'gravity-master', name: 'Gravity Master', description: 'Experiment broadly across the lab.', score: 140 },
  { id: 'chaos-creator', name: 'Chaos Creator', description: 'Build a dense, unpredictable gravitational system.', score: 100 },
  { id: 'slingshot-expert', name: 'Slingshot Expert', description: 'Launch a fast body into a strong gravity assist setup.', score: 110 },
  { id: 'black-hole-survivor', name: 'Black Hole Survivor', description: 'Keep a living system stable around a black hole.', score: 150 },
  { id: 'escape-velocity-achieved', name: 'Escape Velocity Achieved', description: 'Leave the atmosphere behind for good.', score: 130 },
] as const;

type AchievementId = (typeof ACHIEVEMENT_CONFIG)[number]['id'];

const Index = () => {
  const [mode, setMode] = useState<AppMode>('spacetime');

  // ─── Spacetime state ───
  const [bodies, setBodies] = useState<CelestialBody[]>([
    { id: 'sun', name: 'Sun', type: 'star', bodyClass: 'star', position: [0, 0, 0], mass: DEFAULT_STAR_MASS, radius: 2.4, physicalRadius: 696_340_000, color: '#ffcc00', velocity: [0, 0, 0] },
    { id: 'earth', name: 'Earth', type: 'planet', bodyClass: 'rocky', position: [8, 0, 0], mass: 5.97e24, radius: 0.45, physicalRadius: 6_371_000, color: '#4b84d8', atmosphere: true, velocity: [0, 0, 0] },
    { id: 'mars', name: 'Mars', type: 'planet', bodyClass: 'rocky', position: [-5, 0, 6], mass: 6.42e23, radius: 0.35, physicalRadius: 3_389_500, color: '#c96b4b', atmosphere: true, velocity: [0, 0, 0] },
  ]);
  const [pendingPlacement, setPendingPlacement] = useState<Omit<CelestialBody, 'id' | 'position'> | null>(null);
  const [placementVelocityScale, setPlacementVelocityScale] = useState(1);
  const [realisticMode, setRealisticMode] = useState(true);

  // timeScale can be negative for rewind (-4 … -0.5 … 0.5 … 4)
  const [timeScale, setTimeScale] = useState(1);
  const [isPlaying, setIsPlaying] = useState(true);

  // Universe expansion
  const universeAgeRef = useRef(0);
  const [universeScale, setUniverseScale] = useState(1);
  const lastTickRef = useRef(Date.now());

  // ─── Rocket state ───
  const [rocketParams, setRocketParams] = useState<RocketParams>(DEFAULT_PARAMS);
  const [rocketState, setRocketState] = useState<RocketState>(INITIAL_STATE);
  const [explorationScore, setExplorationScore] = useState(0);
  const [achievements, setAchievements] = useState<Record<AchievementId, boolean>>({
    'first-stable-orbit': false,
    'gravity-master': false,
    'chaos-creator': false,
    'slingshot-expert': false,
    'black-hole-survivor': false,
    'escape-velocity-achieved': false,
  });
  const experimentKeysRef = useRef<Set<string>>(new Set());
  const stableSystemTimerRef = useRef(0);
  const stableBlackHoleTimerRef = useRef(0);
  const previousOutcomeRef = useRef<RocketState['outcome']>('none');

  const awardScore = useCallback((points: number) => {
    setExplorationScore((prev) => prev + points);
  }, []);

  const unlockAchievement = useCallback((id: AchievementId) => {
    setAchievements((prev) => {
      if (prev[id]) return prev;
      const reward = ACHIEVEMENT_CONFIG.find((achievement) => achievement.id === id)?.score ?? 0;
      if (reward > 0) {
        setExplorationScore((score) => score + reward);
      }
      return { ...prev, [id]: true };
    });
  }, []);

  const registerExperiment = useCallback((key: string, points = 12) => {
    if (experimentKeysRef.current.has(key)) return;
    experimentKeysRef.current.add(key);
    awardScore(points);
  }, [awardScore]);

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

  useEffect(() => {
    if (experimentKeysRef.current.size >= 8) {
      unlockAchievement('gravity-master');
    }
  }, [bodies, placementVelocityScale, realisticMode, rocketParams, unlockAchievement]);

  useEffect(() => {
    if (rocketState.phase !== 'outcome') {
      previousOutcomeRef.current = rocketState.outcome;
      return;
    }

    if (previousOutcomeRef.current === rocketState.outcome) return;
    previousOutcomeRef.current = rocketState.outcome;

    if (rocketState.outcome === 'orbiting') {
      awardScore(80);
      unlockAchievement('first-stable-orbit');
    }

    if (rocketState.outcome === 'escape') {
      awardScore(90);
      unlockAchievement('escape-velocity-achieved');
    }
  }, [awardScore, rocketState.outcome, rocketState.phase, unlockAchievement]);

  useEffect(() => {
    if (mode !== 'spacetime' || !isPlaying || timeScale <= 0) return;

    const interval = setInterval(() => {
      const hasStableCandidate = bodies.length >= 4
        && bodies.some((body) => body.type === 'star')
        && bodies.filter((body) => body.type === 'planet' || body.type === 'asteroid' || body.type === 'comet').length >= 2;
      const hasBlackHoleCandidate = bodies.some((body) => body.type === 'blackhole')
        && bodies.filter((body) => body.type !== 'blackhole').length >= 2;

      stableSystemTimerRef.current = hasStableCandidate ? stableSystemTimerRef.current + 1 : 0;
      stableBlackHoleTimerRef.current = hasBlackHoleCandidate ? stableBlackHoleTimerRef.current + 1 : 0;

      if (stableSystemTimerRef.current === 12) {
        awardScore(75);
        unlockAchievement('gravity-master');
      }

      if (stableBlackHoleTimerRef.current >= 10) {
        unlockAchievement('black-hole-survivor');
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [awardScore, bodies, isPlaying, mode, timeScale, unlockAchievement]);

  useEffect(() => {
    if (bodies.length >= 7 || (bodies.some((body) => body.type === 'blackhole') && bodies.some((body) => body.type === 'neutron') && bodies.length >= 5)) {
      unlockAchievement('chaos-creator');
    }
  }, [bodies, unlockAchievement]);

  // ─── Spacetime handlers ───
  // Physics positions are managed inside PhysicsSimulator via refs — no per-frame
  // React state update needed. These callbacks only fire on low-frequency events.
  const handleBodyRemoved = useCallback((id: string) => {
    setBodies((prev) => prev.filter((b) => b.id !== id));
  }, []);

  const handleBodyUpdated = useCallback((id: string, mass: number, radius: number) => {
    setBodies((prev) => prev.map((b) => (b.id === id ? { ...b, mass, radius } : b)));
  }, []);

  const computePlacementVelocity = useCallback((position: [number, number, number], allBodies: CelestialBody[], scale: number) => {
    if (allBodies.length === 0) return [0, 0, 0] as [number, number, number];
    const attractor = allBodies.reduce((max, b) => (b.mass > max.mass ? b : max));
    const rx = position[0] - attractor.position[0];
    const rz = position[2] - attractor.position[2];
    const distance = Math.sqrt(rx * rx + rz * rz);
    if (distance < 0.01) return [0, 0, 0];
    const normalizedDistance = Math.max(distance, 0.25);
    const effectiveMass = Math.max(attractor.mass, MASSIVE_ATTRACTOR_THRESHOLD);
    const orbitalSpeedRaw = Math.sqrt((REAL_G * effectiveMass * REAL_GRAVITY_BOOST) / normalizedDistance);
    const orbitalSpeed = Math.min(MAX_ORBITAL_SPEED, Math.max(MIN_ORBITAL_SPEED, orbitalSpeedRaw));
    const tangentX = -rz / distance;
    const tangentZ = rx / distance;
    return [tangentX * orbitalSpeed * scale, 0, tangentZ * orbitalSpeed * scale];
  }, []);

  const handleBeginPlacement = useCallback((obj: Omit<CelestialBody, 'id'>) => {
    const { position: _ignored, ...bodyWithoutPosition } = obj;
    setPendingPlacement(bodyWithoutPosition);
    registerExperiment(`prep:${obj.type}:${Math.round(obj.mass).toExponential(1)}`);
  }, [registerExperiment]);

  const handlePlaceOnGrid = useCallback((position: [number, number, number]) => {
    if (!pendingPlacement) return;
    setBodies((prev) => {
      let spawnPos: [number, number, number] = [...position] as [number, number, number];
      const newRadius = pendingPlacement.radius ?? 0.3;

      // Enforce minimum safe distance from EVERY existing body, not just the heaviest.
      // This prevents the extreme close-range gravitational forces that shoot bodies off-screen.
      for (const existing of prev) {
        const dx = spawnPos[0] - existing.position[0];
        const dz = spawnPos[2] - existing.position[2];
        const dist = Math.sqrt(dx * dx + dz * dz);
        // Buffer: sum of radii × 2.5 + 2.0 extra units of breathing room
        const minSafe = (existing.radius + newRadius) * 2.5 + 2.0;
        if (dist < minSafe) {
          const ux = dist > 1e-6 ? dx / dist : 1;
          const uz = dist > 1e-6 ? dz / dist : 0;
          spawnPos = [
            existing.position[0] + ux * minSafe,
            0,
            existing.position[2] + uz * minSafe,
          ];
        }
      }

      const velocity = computePlacementVelocity(spawnPos, prev, placementVelocityScale);
      const hasHeavyAnchor = prev.some((body) => body.mass >= 1e27);
      if ((pendingPlacement.type === 'comet' || pendingPlacement.type === 'asteroid') && placementVelocityScale >= 1.5 && hasHeavyAnchor) {
        unlockAchievement('slingshot-expert');
      }
      registerExperiment(`place:${pendingPlacement.type}:${spawnPos[0].toFixed(1)}:${spawnPos[2].toFixed(1)}:${placementVelocityScale.toFixed(2)}:${realisticMode ? 'real' : 'arcade'}`, 18);
      return [...prev, {
        ...pendingPlacement,
        id: `obj_${nextId++}`,
        position: spawnPos,
        velocity: velocity as [number, number, number],
      }];
    });
    setPendingPlacement(null);
  }, [computePlacementVelocity, pendingPlacement, placementVelocityScale, realisticMode, registerExperiment, unlockAchievement]);

  const handleRemoveBody = useCallback((id: string) => {
    setBodies((prev) => prev.filter((b) => b.id !== id));
  }, []);

  const handleRemoveAll = useCallback(() => {
    setBodies([]);
    stableSystemTimerRef.current = 0;
    stableBlackHoleTimerRef.current = 0;
  }, []);

  const handleResetSpacetime = useCallback(() => {
    setBodies([
      { id: 'sun', name: 'Sun', type: 'star', bodyClass: 'star', position: [0, 0, 0], mass: DEFAULT_STAR_MASS, radius: 2.4, physicalRadius: 696_340_000, color: '#ffcc00', velocity: [0, 0, 0] },
      { id: 'earth', name: 'Earth', type: 'planet', bodyClass: 'rocky', position: [8, 0, 0], mass: 5.97e24, radius: 0.45, physicalRadius: 6_371_000, color: '#4b84d8', atmosphere: true, velocity: [0, 0, 0] },
    ]);
    setTimeScale(1);
    setIsPlaying(true);
    universeAgeRef.current = 0;
    setUniverseScale(1);
    setPendingPlacement(null);
    stableSystemTimerRef.current = 0;
    stableBlackHoleTimerRef.current = 0;
  }, []);

  // ─── Rocket handlers ───
  const handleRocketParamChange = useCallback((key: keyof RocketParams, value: number | boolean) => {
    setRocketParams((prev) => {
      const next = { ...prev, [key]: value };
      registerExperiment(`rocket:${key}:${String(value)}`);
      registerExperiment(`rocket-profile:${next.launchAngle}-${next.thrustForce}-${next.fuelMass}-${next.dragCoefficient}-${next.gravity}-${next.stageSeparation ? 1 : 0}`, 10);
      return next;
    });
  }, [registerExperiment]);

  const handleLaunch = useCallback(() => {
    awardScore(15);
    setRocketState({ ...INITIAL_STATE, phase: 'launching', fuel: 1 });
  }, [awardScore]);

  const handleRocketReset = useCallback(() => {
    setRocketState({ ...INITIAL_STATE });
    previousOutcomeRef.current = 'none';
  }, []);

  const handleVelocityScaleChange = useCallback((value: number) => {
    setPlacementVelocityScale(value);
    registerExperiment(`velocity-scale:${value.toFixed(2)}`);
  }, [registerExperiment]);

  const handleRealisticModeChange = useCallback((value: boolean) => {
    setRealisticMode(value);
    registerExperiment(`physics-mode:${value ? 'realistic' : 'arcade'}`);
  }, [registerExperiment]);

  // effectiveTimeScale carries sign (negative = rewind, 0 = paused)
  const effectiveTimeScale = isPlaying ? timeScale : 0;
  const unlockedCount = ACHIEVEMENT_CONFIG.filter((achievement) => achievements[achievement.id]).length;

  return (
    <div className="w-full h-screen relative overflow-hidden bg-background">
      {/* 3D Canvases - use visibility instead of conditional render to avoid WebGL context loss */}
      <div className="absolute inset-0" style={{ display: mode === 'spacetime' ? 'block' : 'none' }}>
        <SpaceScene
          bodies={bodies}
          timeScale={effectiveTimeScale}
          onBodyRemoved={handleBodyRemoved}
          onBodyUpdated={handleBodyUpdated}
          onGridClick={handlePlaceOnGrid}
          realisticMode={realisticMode}
          universeScale={universeScale}
        />
      </div>
      <div className="absolute inset-0" style={{ display: mode === 'rocket' ? 'block' : 'none' }}>
        <RocketScene params={rocketParams} state={rocketState} onUpdateState={setRocketState} timeScale={effectiveTimeScale} />
      </div>

      {/* Top Bar */}
      <div className="absolute top-0 left-0 right-0 z-10 p-4 flex items-center justify-between pointer-events-none">
        <div className="glass-panel px-4 py-2.5 flex items-center gap-3 pointer-events-auto">
          <Atom size={20} className="text-primary animate-pulse-glow" />
          <div>
            <h1 className="text-sm font-bold tracking-wide text-foreground">SPACE–TIME LAB</h1>
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
        <div className="glass-panel px-3 py-2 pointer-events-auto">
          <div className="flex items-center gap-4 text-xs font-mono">
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
            onBeginPlacement={handleBeginPlacement}
            bodies={bodies}
            onRemoveBody={handleRemoveBody}
            onRemoveAll={handleRemoveAll}
            placementActive={Boolean(pendingPlacement)}
            velocityScale={placementVelocityScale}
            onVelocityScaleChange={handleVelocityScaleChange}
            realisticMode={realisticMode}
            onRealisticModeChange={handleRealisticModeChange}
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

      <div className="absolute right-4 top-20 z-10 w-72 pointer-events-auto">
        <div className="glass-panel p-4 animate-fade-in">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <div className="flex items-center gap-2 text-primary mb-1">
                <Trophy size={16} />
                <span className="text-xs font-semibold tracking-[0.18em] uppercase">Mission Progress</span>
              </div>
              <p className="text-[11px] text-muted-foreground">Experiment, orbit, and build resilient systems to unlock milestones.</p>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Score</div>
              <div className="text-2xl font-semibold text-foreground">{explorationScore}</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 mb-4">
            <div className="rounded-xl border border-border/30 bg-muted/15 p-3">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-1">
                <Sparkles size={12} />
                Unlocks
              </div>
              <div className="text-lg font-semibold text-foreground">{unlockedCount}/{ACHIEVEMENT_CONFIG.length}</div>
            </div>
            <div className="rounded-xl border border-border/30 bg-muted/15 p-3">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-1">
                <Target size={12} />
                Experiments
              </div>
              <div className="text-lg font-semibold text-foreground">{experimentKeysRef.current.size}</div>
            </div>
          </div>

          <div className="space-y-2">
            {ACHIEVEMENT_CONFIG.map((achievement) => {
              const unlocked = achievements[achievement.id];
              return (
                <div
                  key={achievement.id}
                  className={`rounded-xl border px-3 py-2.5 transition-colors ${
                    unlocked
                      ? 'border-primary/35 bg-primary/10'
                      : 'border-border/25 bg-muted/10'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className={`text-sm font-medium ${unlocked ? 'text-primary' : 'text-foreground'}`}>{achievement.name}</div>
                      <div className="text-[11px] text-muted-foreground">{achievement.description}</div>
                    </div>
                    <div className={`text-[10px] font-mono uppercase tracking-[0.2em] ${unlocked ? 'text-primary' : 'text-muted-foreground/70'}`}>
                      {unlocked ? 'Unlocked' : 'Locked'}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Bottom Center - Time Controls */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 pointer-events-auto">
        <TimeControls
          timeScale={timeScale}
          isPlaying={isPlaying}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onSpeedChange={setTimeScale}
          onReset={mode === 'spacetime' ? handleResetSpacetime : handleRocketReset}
        />
      </div>

      {/* Bottom Right - Hint */}
      <div className="absolute bottom-6 right-4 z-10">
        <p className="text-[10px] font-mono text-muted-foreground/50">
          {mode === 'spacetime'
            ? 'Drag to orbit · Scroll to zoom · Add objects to warp spacetime'
            : 'Adjust parameters · Launch · Observe trajectory'}
        </p>
      </div>
    </div>
  );
};

export default Index;
