import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, ArrowUpRight, Crosshair, Eye, Orbit, PanelLeftOpen, Rocket, TrendingUp, X } from 'lucide-react';
import StageCanvas from '@/stage/StageCanvas';
import MissionWatchers from '@/app/MissionWatchers';
import TopBar from '@/hud/TopBar';
import MissionTracker, { type MissionView } from '@/hud/MissionTracker';
import ObjectLibrary from '@/hud/ObjectLibrary';
import RocketControls, { type RocketFlightSummary } from '@/hud/RocketControls';
import TimeControls from '@/hud/TimeControls';
import { IconButton, Kbd } from '@/hud/controls';
import { resetActiveLab, useKeyboardShortcuts, useResponsivePanels } from '@/hud/useKeyboardShortcuts';
import { useAppStore } from '@/stores/appStore';
import { useTimeStore } from '@/stores/timeStore';
import { useSpacetimeStore } from '@/stores/spacetimeStore';
import { useEffectiveRocketParams, useRocketStore } from '@/stores/rocketStore';
import {
  PACKS_BY_MODE,
  findMission,
  getActivePack,
  useExperimentCount,
  useProgressStore,
} from '@/stores/progressStore';
import type { RocketState } from '@/worlds/rocket/rocketTypes';

const TYPE_LABEL: Record<string, string> = {
  star: 'star',
  planet: 'planet',
  blackhole: 'black hole',
  neutron: 'neutron star',
  asteroid: 'asteroid',
  comet: 'comet',
};

const OUTCOME_BANNER: Partial<Record<RocketState['outcome'], { text: string; tone: string; icon: JSX.Element }>> = {
  orbiting: { text: 'Stable orbit achieved', tone: 'border-ok/40 text-ok', icon: <Orbit size={14} /> },
  escape: { text: 'Escape velocity reached', tone: 'border-primary/40 text-primary', icon: <ArrowUpRight size={14} /> },
  suborbital: { text: 'Suborbital trajectory', tone: 'border-warn/40 text-warn', icon: <TrendingUp size={14} /> },
  crashed: { text: 'Impact', tone: 'border-danger/40 text-danger', icon: <AlertTriangle size={14} /> },
  burnup: { text: 'Burn-up on ascent', tone: 'border-danger/40 text-danger', icon: <AlertTriangle size={14} /> },
};

const EASE = [0.2, 0.8, 0.2, 1] as const;

// ─── Zone 1: top bar ───
const TopBarZone = () => {
  const mode = useAppStore((state) => state.mode);
  const setMode = useAppStore((state) => state.setMode);
  const setHudHidden = useAppStore((state) => state.setHudHidden);
  const score = useProgressStore((state) => state.score);
  const spacetime = useSpacetimeStore(useShallow((state) => ({ bodies: state.bodies.length, universeScale: state.universeScale })));
  const time = useTimeStore(useShallow((state) => ({ timeScale: state.timeScale, isPlaying: state.isPlaying })));
  const rocket = useRocketStore(useShallow((state) => ({
    altitude: state.flight.altitude,
    fuel: state.flight.fuel,
    phase: state.flight.phase,
    velocity: state.flight.velocity,
  })));
  const spacetimeStats = useMemo(() => ({ ...spacetime, ...time }), [spacetime, time]);

  return (
    <TopBar
      mode={mode}
      onModeChange={setMode}
      onHideHud={() => setHudHidden(true)}
      score={score}
      spacetime={spacetimeStats}
      rocket={rocket}
    />
  );
};

// ─── Zone 2: tool dock ───
const SpacetimeDock = () => {
  const store = useSpacetimeStore(useShallow((state) => ({
    bodies: state.bodies,
    pendingPlacement: state.pendingPlacement,
    placementVelocityScale: state.placementVelocityScale,
    realisticMode: state.realisticMode,
    savedScenarios: state.savedScenarios,
    beginPlacement: state.beginPlacement,
    applyTemplate: state.applyTemplate,
    removeBody: state.removeBody,
    removeAll: state.removeAll,
    setVelocityScale: state.setVelocityScale,
    setRealisticMode: state.setRealisticMode,
    saveScenario: state.saveScenario,
    loadScenario: state.loadScenario,
    deleteScenario: state.deleteScenario,
  })));
  const setDockCollapsed = useAppStore((state) => state.setDockCollapsed);

  return (
    <ObjectLibrary
      onBeginPlacement={store.beginPlacement}
      onApplyTemplate={store.applyTemplate}
      bodies={store.bodies}
      onRemoveBody={store.removeBody}
      onRemoveAll={store.removeAll}
      placementActive={Boolean(store.pendingPlacement)}
      velocityScale={store.placementVelocityScale}
      onVelocityScaleChange={store.setVelocityScale}
      realisticMode={store.realisticMode}
      onRealisticModeChange={store.setRealisticMode}
      savedScenarios={store.savedScenarios}
      onSaveScenario={store.saveScenario}
      onLoadScenario={store.loadScenario}
      onDeleteScenario={store.deleteScenario}
      onCollapse={() => setDockCollapsed(true)}
    />
  );
};

const RocketDock = () => {
  const params = useEffectiveRocketParams();
  const store = useRocketStore(useShallow((state) => ({
    phase: state.flight.phase,
    outcome: state.flight.outcome,
    activeWeather: state.activeWeather,
    savedPresets: state.savedPresets,
    setParam: state.setParam,
    launch: state.launch,
    resetFlight: state.resetFlight,
    toggleWeather: state.toggleWeather,
    savePreset: state.savePreset,
    loadPreset: state.loadPreset,
    deletePreset: state.deletePreset,
  })));
  const setDockCollapsed = useAppStore((state) => state.setDockCollapsed);

  // Recomputed only when phase or outcome changes, so per-frame telemetry
  // doesn't re-render the controls.
  const summary = useMemo<RocketFlightSummary>(() => {
    const { maxAltitude, elapsed } = useRocketStore.getState().flight;
    return { phase: store.phase, outcome: store.outcome, maxAltitude, elapsed };
  }, [store.phase, store.outcome]);

  return (
    <RocketControls
      params={params}
      state={summary}
      onParamChange={store.setParam}
      onLaunch={store.launch}
      onReset={store.resetFlight}
      savedPresets={store.savedPresets}
      onSavePreset={store.savePreset}
      onLoadPreset={store.loadPreset}
      onDeletePreset={store.deletePreset}
      activeWeather={store.activeWeather}
      onWeatherChange={store.toggleWeather}
      onCollapse={() => setDockCollapsed(true)}
    />
  );
};

const DockZone = () => {
  const mode = useAppStore((state) => state.mode);
  const dockCollapsed = useAppStore((state) => state.dockCollapsed);
  const setDockCollapsed = useAppStore((state) => state.setDockCollapsed);

  return (
    <AnimatePresence mode="wait" initial={false}>
      {dockCollapsed ? (
        <motion.div
          key="rail"
          initial={{ opacity: 0, x: -12 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -12 }}
          transition={{ duration: 0.18, ease: EASE }}
          className="hud-panel pointer-events-auto flex h-fit flex-col items-center gap-1 p-1.5"
        >
          <IconButton label="Open dock ([)" onClick={() => setDockCollapsed(false)}>
            <PanelLeftOpen size={16} />
          </IconButton>
          <div className="my-1 h-px w-5 bg-white/10" />
          <IconButton label={mode === 'spacetime' ? 'Spacetime lab' : 'Launch control'} onClick={() => setDockCollapsed(false)} active>
            {mode === 'spacetime' ? <Orbit size={15} /> : <Rocket size={15} />}
          </IconButton>
        </motion.div>
      ) : (
        <motion.div
          key={`dock-${mode}`}
          initial={{ opacity: 0, x: -16 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -16 }}
          transition={{ duration: 0.22, ease: EASE }}
          className={`pointer-events-auto flex max-h-full ${mode === 'rocket' ? 'h-full' : ''}`}
        >
          {mode === 'spacetime' ? <SpacetimeDock /> : <RocketDock />}
        </motion.div>
      )}
    </AnimatePresence>
  );
};

// ─── Zone 3: mission tracker ───
const MissionZone = () => {
  const mode = useAppStore((state) => state.mode);
  const collapsed = useAppStore((state) => state.missionsCollapsed);
  const toggleMissions = useAppStore((state) => state.toggleMissions);
  const activePackId = useProgressStore((state) => state.activePacks[mode]);
  const achievements = useProgressStore((state) => state.achievements);
  const queue = useProgressStore((state) => state.missionQueues[mode]);
  const setActivePack = useProgressStore((state) => state.setActivePack);
  const experimentCount = useExperimentCount(mode);

  const activePack = getActivePack(mode, activePackId);
  const unlockedCount = activePack.missions.filter((mission) => achievements[mission.id]).length;
  const missions = useMemo<MissionView[]>(
    () => queue.map((card) => ({ ...findMission(card.id)!, phase: card.phase })),
    [queue],
  );

  return (
    <MissionTracker
      modeLabel={mode === 'spacetime' ? 'Spacetime' : 'Rocket'}
      activePack={activePack}
      packs={PACKS_BY_MODE[mode]}
      onPackChange={(packId) => setActivePack(mode, packId)}
      missions={missions}
      unlockedCount={unlockedCount}
      experimentLabel={mode === 'spacetime' ? 'Lab runs' : 'Flight tests'}
      experimentCount={experimentCount}
      collapsed={collapsed}
      onToggleCollapsed={toggleMissions}
    />
  );
};

// ─── Zone 5: context banner ───
const BannerZone = () => {
  const mode = useAppStore((state) => state.mode);
  const pendingPlacement = useSpacetimeStore((state) => state.pendingPlacement);
  const cancelPlacement = useSpacetimeStore((state) => state.cancelPlacement);
  const outcome = useRocketStore((state) => (state.flight.phase === 'outcome' ? state.flight.outcome : 'none'));

  const placementLabel = pendingPlacement
    ? pendingPlacement.name ?? TYPE_LABEL[pendingPlacement.type] ?? pendingPlacement.type
    : null;
  const outcomeBanner = mode === 'rocket' ? OUTCOME_BANNER[outcome] : undefined;

  return (
    <AnimatePresence>
      {mode === 'spacetime' && placementLabel && (
        <motion.div
          key="placement"
          initial={{ opacity: 0, y: -8, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.97 }}
          transition={{ duration: 0.2, ease: EASE }}
          className="hud-panel pointer-events-auto flex items-center gap-2.5 border-primary/40 py-1.5 pl-3 pr-1.5"
          role="status"
        >
          <Crosshair size={14} className="text-primary" />
          <span className="whitespace-nowrap text-[12.5px] text-foreground">
            Click the grid to place <span className="font-semibold capitalize text-primary">{placementLabel}</span>
          </span>
          <Kbd>Esc</Kbd>
          <IconButton label="Cancel placement" size="sm" onClick={cancelPlacement}>
            <X size={14} />
          </IconButton>
        </motion.div>
      )}
      {outcomeBanner && (
        <motion.div
          key={`outcome-${outcome}`}
          initial={{ opacity: 0, y: -8, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.97 }}
          transition={{ duration: 0.24, ease: EASE }}
          className={`hud-panel flex items-center gap-2 whitespace-nowrap px-3.5 py-2 font-display text-[12px] uppercase tracking-[0.1em] ${outcomeBanner.tone}`}
          role="status"
        >
          {outcomeBanner.icon}
          {outcomeBanner.text}
        </motion.div>
      )}
    </AnimatePresence>
  );
};

// ─── Zone 4: time dock ───
const TimeZone = () => {
  const time = useTimeStore(useShallow((state) => ({
    timeScale: state.timeScale,
    isPlaying: state.isPlaying,
    play: state.play,
    pause: state.pause,
    setTimeScale: state.setTimeScale,
  })));

  return (
    <TimeControls
      timeScale={time.timeScale}
      isPlaying={time.isPlaying}
      onPlay={time.play}
      onPause={time.pause}
      onSpeedChange={time.setTimeScale}
      onReset={resetActiveLab}
    />
  );
};

const Index = () => {
  const mode = useAppStore((state) => state.mode);
  const hudHidden = useAppStore((state) => state.hudHidden);
  const setHudHidden = useAppStore((state) => state.setHudHidden);

  useKeyboardShortcuts();
  useResponsivePanels();

  return (
    <div data-hud-mode={mode} className="relative h-screen w-full overflow-hidden bg-background">
      <div className="absolute inset-0">
        <StageCanvas />
      </div>
      <MissionWatchers />

      <AnimatePresence>
        {!hudHidden && (
          <motion.div
            key="hud"
            className="pointer-events-none absolute inset-0 z-10"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="absolute inset-x-3 top-3">
              <TopBarZone />
            </div>

            <div className="absolute bottom-[76px] left-3 top-[72px] flex items-start">
              <DockZone />
            </div>

            <div className="pointer-events-auto absolute right-3 top-[72px] flex max-h-[calc(100%-148px)] w-[300px] flex-col">
              <MissionZone />
            </div>

            <div className="absolute left-1/2 top-[72px] flex -translate-x-1/2 flex-col items-center gap-2">
              <BannerZone />
            </div>

            <div className="pointer-events-auto absolute bottom-3 left-1/2 -translate-x-1/2">
              <TimeZone />
            </div>

            <div className="absolute bottom-5 right-4 hidden items-center gap-2 font-mono text-[10.5px] text-hud-faint 2xl:flex">
              {mode === 'spacetime' ? (
                <span>Drag to orbit · Scroll to zoom · Add bodies to warp spacetime</span>
              ) : (
                <span>Tune · Ignite · Watch the trajectory</span>
              )}
              <span className="text-white/15">|</span>
              <Kbd>H</Kbd><span>hide HUD</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {hudHidden && (
          <motion.button
            key="show-hud"
            type="button"
            onClick={() => setHudHidden(false)}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="hud-panel hud-focus absolute bottom-4 right-4 z-10 flex items-center gap-2 px-3 py-2 text-[12px] text-hud-dim transition-colors hover:text-foreground"
          >
            <Eye size={14} /> Show HUD <Kbd>H</Kbd>
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Index;
