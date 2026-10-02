import { useState, useCallback, useRef, useEffect, useMemo, lazy, Suspense } from 'react';
import type { CelestialBody } from '../physics/types';
import type { LiveBodyState } from '../components/space/PhysicsSimulator';
import { RocketParams, RocketState, DEFAULT_PARAMS, INITIAL_STATE, normalizeRocketParams } from '../components/rocket/rocketTypes';
import { WeatherConditionId, applyWeatherToParams } from '../components/rocket/weatherPresets';
import TimeControls from '../components/ui/TimeControls';
import ObjectLibrary from '../components/ui/ObjectLibrary';
import { SPACETIME_TEMPLATES } from '../components/space/spacetimeTemplates';
import { Rocket, Orbit, Trophy, Sparkles, Target, NotebookPen } from 'lucide-react';
import {
  deleteRocketPreset,
  deleteSpacetimeScenario,
  listSavedRocketPresets,
  listSavedSpacetimeScenarios,
  saveRocketPreset,
  saveSpacetimeScenario,
  type SavedRocketPreset,
  type SavedSpacetimeScenario,
} from '../lib/scenarioStorage';
import {
  ALL_MISSIONS,
  CHALLENGE_PACKS,
  type AppMode,
  type ChallengePack,
} from '../lib/challengePacks';
import { DEFAULT_STAR_MASS, HUBBLE_RATE, MAX_UNIVERSE_SCALE } from '../physics/constants';
import { planPlacement } from '../physics/placement';
import { SIM_STEP, type SimSnapshot } from '../physics/simulation';
import type { SimulationControls } from '../components/space/PhysicsSimulator';
import OrbitInspector from '../components/space/OrbitInspector';
import ConservationPanel, { type ConservationSample } from '../components/space/ConservationPanel';
import TimelineBar, { type TimelineState } from '../components/space/TimelineBar';
import { WEATHER_PRESETS } from '../components/rocket/weatherPresets';
import { SpacetimeMissionTracker } from '../learning/spacetimeMissions';
import { buildDebrief } from '../learning/debrief';
import { addNotebookEntry, clearNotebook, listNotebook, type NotebookEntry } from '../lib/notebook';
import { buildExportFile, downloadTextFile } from '../lib/exportFile';
import SettingsMenu from '../components/ui/SettingsMenu';
import { QUALITY_PROFILES, applySettingsToDocument, loadSettings, motionReduced, saveSettings, type DisplaySettings } from '../lib/settings';
import { vehicleSummary } from '../physics/rocket';
import type { ImpactEvent } from '../physics/nbody';
import type { PredictedOutcome } from '../physics/simulation';

// The 3D view loads after the panels so the page is usable quickly on slow connections.
const SpaceScene = lazy(() => import('../components/space/SpaceScene'));
// The Rocket Lab (scene, weather effects, controls) loads the first time it is opened.
const RocketScene = lazy(() => import('../components/rocket/RocketScene'));
const RocketControls = lazy(() => import('../components/rocket/RocketControls'));
const LabNotebook = lazy(() => import('../components/rocket/LabNotebook'));

let nextId = 1;
const ACTIVE_MISSION_LIMIT = 3;
const MISSION_EXIT_DELAY_MS = 900;

const SNAPSHOT_UI_INTERVAL_MS = 200;
const MAX_CONSERVATION_SAMPLES = 300; // 60 s at 5 samples per second

type RightTab = 'missions' | 'inspector' | 'conservation';

// Bodies with a zero velocity are given a circular orbit around the heaviest body by the simulator.
const createDefaultBodies = (): CelestialBody[] => [
  { id: 'sun', name: 'Sun', type: 'star', bodyClass: 'star', position: [0, 0, 0], mass: DEFAULT_STAR_MASS, radius: 2.4, physicalRadius: 696_340_000, color: '#ffcc00', velocity: [0, 0, 0] },
  { id: 'earth', name: 'Earth', type: 'planet', bodyClass: 'rocky', position: [8, 0, 0], mass: 5.97e24, radius: 0.45, physicalRadius: 6_371_000, color: '#5b9ee8', atmosphere: true, velocity: [0, 0, 0] },
  { id: 'mars', name: 'Mars', type: 'planet', bodyClass: 'rocky', position: [-5, 0, 6], mass: 6.42e23, radius: 0.35, physicalRadius: 3_389_500, color: '#dd7755', atmosphere: true, velocity: [0, 0, 0] },
];

type MissionId = (typeof ALL_MISSIONS)[number]['id'];
type MissionCard = { id: MissionId; phase: 'incomplete' | 'complete' };
type MissionQueues = Record<AppMode, MissionCard[]>;

const PACKS_BY_MODE: Record<AppMode, ChallengePack[]> = {
  spacetime: CHALLENGE_PACKS.filter((pack) => pack.mode === 'spacetime'),
  rocket: CHALLENGE_PACKS.filter((pack) => pack.mode === 'rocket'),
};

const DEFAULT_PACK_BY_MODE: Record<AppMode, string> = {
  spacetime: PACKS_BY_MODE.spacetime[0].id,
  rocket: PACKS_BY_MODE.rocket[0].id,
};

const createNoAchievements = (): Record<MissionId, boolean> => Object.fromEntries(ALL_MISSIONS.map((mission) => [mission.id, false]));

const FAILURE_OUTCOMES = new Set<RocketState['outcome']>(['crashed', 'suborbital', 'burnup']);
const PREDICTIONS_FOR_FORECASTER = 3;

const findMission = (id: MissionId) => ALL_MISSIONS.find((mission) => mission.id === id);

const getActivePack = (mode: AppMode, packId: string) => (
  PACKS_BY_MODE[mode].find((pack) => pack.id === packId) ?? PACKS_BY_MODE[mode][0]
);

const buildMissionCards = (
  pack: ChallengePack,
  achievements: Record<MissionId, boolean>,
  existing: MissionCard[] = [],
) => {
  const cards = [...existing];
  const visibleIds = new Set(cards.map((card) => card.id));
  for (const mission of pack.missions) {
    if (cards.length >= ACTIVE_MISSION_LIMIT) break;
    if (achievements[mission.id] || visibleIds.has(mission.id)) continue;
    cards.push({ id: mission.id, phase: 'incomplete' });
    visibleIds.add(mission.id);
  }
  return cards;
};

const cloneBodiesForScene = (savedBodies: CelestialBody[]) => savedBodies.map((body, index) => ({
  ...body,
  id: `saved_${nextId++}_${index}`,
}));

const Index = () => {
  const [mode, setMode] = useState<AppMode>('spacetime');
  const [settings, setSettings] = useState<DisplaySettings>(loadSettings);
  const [, setSystemMotionTick] = useState(0);
  const quality = QUALITY_PROFILES[settings.quality];
  const reduceMotion = motionReduced(settings);
  useEffect(() => {
    applySettingsToDocument(settings);
    saveSettings(settings);
  }, [settings]);
  useEffect(() => {
    // Follow changes to the system "reduce motion" setting while the page is open.
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const onChange = () => setSystemMotionTick((tick) => tick + 1);
    query?.addEventListener?.('change', onChange);
    return () => query?.removeEventListener?.('change', onChange);
  }, []);
  // Once opened, the Rocket Lab stays mounted so switching back does not lose its WebGL context.
  const [rocketLabLoaded, setRocketLabLoaded] = useState(false);
  useEffect(() => {
    if (mode === 'rocket') setRocketLabLoaded(true);
  }, [mode]);
  const [activePacks, setActivePacks] = useState<Record<AppMode, string>>(DEFAULT_PACK_BY_MODE);

  // ─── Spacetime state ───
  const [bodies, setBodies] = useState<CelestialBody[]>(createDefaultBodies);
  // Incremented whenever the whole system is replaced (reset, template, load, clear) so the
  // simulator restarts from `bodies` and clears its rewind history.
  const [simulationEpoch, setSimulationEpoch] = useState(0);
  // Live positions/velocities/masses published by the simulator every step.
  const livePhysicsRef = useRef<LiveBodyState[]>([]);
  const simulationRef = useRef<SimulationControls | null>(null);
  const snapshotRef = useRef<SimSnapshot | null>(null);
  const lastSnapshotUiRef = useRef(0);
  const snapshotUiTimerRef = useRef<number | null>(null);
  const conservationRef = useRef<ConservationSample[]>([]);
  const [timeline, setTimeline] = useState<TimelineState>({ step: 0, historyStart: 0, historyEnd: 0, markers: [], simTime: 0 });
  const [selectedBodyId, setSelectedBodyId] = useState<string | null>(null);
  const [rightTab, setRightTab] = useState<RightTab>('missions');
  const [pendingPlacement, setPendingPlacement] = useState<Omit<CelestialBody, 'id' | 'position'> | null>(null);
  const [placementVelocityScale, setPlacementVelocityScale] = useState(1);
  const [realisticMode, setRealisticMode] = useState(true);

  // timeScale can be negative for rewind (-4 … -0.5 … 0.5 … 4)
  const [timeScale, setTimeScale] = useState(1);
  const [isPlaying, setIsPlaying] = useState(true);

  // Universe expansion (opt-in)
  const [expansionEnabled, setExpansionEnabled] = useState(false);
  const universeAgeRef = useRef(0);
  const [universeScale, setUniverseScale] = useState(1);
  const lastTickRef = useRef(Date.now());
  const spaceViewRef = useRef<HTMLDivElement>(null);
  const rocketViewRef = useRef<HTMLDivElement>(null);
  // Body types by id, for mission checks that run on simulation snapshots.
  const bodyTypesRef = useRef(new Map<string, string>());
  bodyTypesRef.current = new Map(bodies.map((body) => [body.id, body.type]));

  // ─── Rocket state ───
  const [rocketParams, setRocketParams] = useState<RocketParams>(DEFAULT_PARAMS);
  const [rocketState, setRocketState] = useState<RocketState>(INITIAL_STATE);
  const [savedScenarios, setSavedScenarios] = useState<SavedSpacetimeScenario[]>([]);
  const [savedRocketPresets, setSavedRocketPresets] = useState<SavedRocketPreset[]>([]);
  const [activeWeather, setActiveWeather] = useState<Set<WeatherConditionId>>(new Set());
  const [prediction, setPrediction] = useState<RocketState['outcome'] | null>(null);
  const [correctPredictions, setCorrectPredictions] = useState(0);
  const [notebook, setNotebook] = useState<NotebookEntry[]>([]);
  const [notebookOpen, setNotebookOpen] = useState(false);

  const effectiveRocketParams = useMemo(
    () => applyWeatherToParams(rocketParams, activeWeather),
    [rocketParams, activeWeather],
  );
  const [explorationScore, setExplorationScore] = useState(0);
  const [achievements, setAchievements] = useState<Record<MissionId, boolean>>(createNoAchievements);
  const [missionQueues, setMissionQueues] = useState<MissionQueues>(() => ({
    spacetime: buildMissionCards(getActivePack('spacetime', DEFAULT_PACK_BY_MODE.spacetime), createNoAchievements()),
    rocket: buildMissionCards(getActivePack('rocket', DEFAULT_PACK_BY_MODE.rocket), createNoAchievements()),
  }));
  const experimentKeysRef = useRef<Set<string>>(new Set());
  const achievementStateRef = useRef(achievements);
  const missionRemovalTimersRef = useRef<Partial<Record<MissionId, number>>>({});
  // Judges spacetime missions from the simulation itself (bound orbits, flybys, impacts).
  const missionTrackerRef = useRef(new SpacetimeMissionTracker());
  // Each launch is scored and written to the notebook once, even if its ending is replayed.
  const recordedLaunchRef = useRef<number | null>(null);

  const awardScore = useCallback((points: number) => {
    setExplorationScore((prev) => prev + points);
  }, []);

  const unlockAchievement = useCallback((id: MissionId) => {
    setAchievements((prev) => {
      if (prev[id]) return prev;
      const reward = findMission(id)?.score ?? 0;
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

  useEffect(() => {
    setSavedScenarios(listSavedSpacetimeScenarios());
    setSavedRocketPresets(listSavedRocketPresets());
    setNotebook(listNotebook());
  }, []);

  useEffect(() => {
    achievementStateRef.current = achievements;
  }, [achievements]);

  useEffect(() => {
    setMissionQueues((prev) => {
      const activeSpacetimePack = getActivePack('spacetime', activePacks.spacetime);
      const activeRocketPack = getActivePack('rocket', activePacks.rocket);
      const next: MissionQueues = {
        spacetime: buildMissionCards(activeSpacetimePack, achievements, prev.spacetime),
        rocket: buildMissionCards(activeRocketPack, achievements, prev.rocket),
      };
      let changed = false;

      (['spacetime', 'rocket'] as const).forEach((queueMode) => {
        next[queueMode] = next[queueMode].map((card) => {
          if (!achievements[card.id] || card.phase === 'complete') return card;
          changed = true;
          if (!missionRemovalTimersRef.current[card.id]) {
            missionRemovalTimersRef.current[card.id] = window.setTimeout(() => {
              delete missionRemovalTimersRef.current[card.id];
              setMissionQueues((current) => ({
                ...current,
                [queueMode]: buildMissionCards(
                  getActivePack(queueMode, activePacks[queueMode]),
                  achievementStateRef.current,
                  current[queueMode].filter((entry) => entry.id !== card.id),
                ),
              }));
            }, MISSION_EXIT_DELAY_MS);
          }
          return { ...card, phase: 'complete' };
        });
      });

      if (!changed
        && next.spacetime === prev.spacetime
        && next.rocket === prev.rocket) {
        return prev;
      }
      return next;
    });
  }, [achievements, activePacks]);

  const handleChallengePackChange = useCallback((modeKey: AppMode, packId: string) => {
    setActivePacks((prev) => ({
      ...prev,
      [modeKey]: packId,
    }));
    setMissionQueues((prev) => ({
      ...prev,
      [modeKey]: buildMissionCards(getActivePack(modeKey, packId), achievements),
    }));
  }, [achievements]);

  useEffect(() => () => {
    Object.values(missionRemovalTimersRef.current).forEach((timer) => {
      if (timer) window.clearTimeout(timer);
    });
  }, []);

  // ─── Universe expansion clock ───
  // Tracks simulated time while expansion is on; the grid scale follows exp(H·t) and
  // shrinks back when time is rewound.
  useEffect(() => {
    if (mode !== 'spacetime' || !expansionEnabled) return;
    lastTickRef.current = Date.now();

    const interval = setInterval(() => {
      const now = Date.now();
      const elapsed = (now - lastTickRef.current) / 1000;
      lastTickRef.current = now;

      if (isPlaying) {
        universeAgeRef.current = Math.max(0, universeAgeRef.current + elapsed * timeScale);
      }
      setUniverseScale(Math.min(MAX_UNIVERSE_SCALE, Math.exp(HUBBLE_RATE * universeAgeRef.current)));
    }, 500);

    return () => clearInterval(interval);
  }, [mode, isPlaying, timeScale, expansionEnabled]);

  useEffect(() => {
    conservationRef.current = [];
    missionTrackerRef.current.reset();
  }, [simulationEpoch]);

  useEffect(() => {
    if (selectedBodyId && !bodies.some((b) => b.id === selectedBodyId)) setSelectedBodyId(null);
  }, [bodies, selectedBodyId]);

  useEffect(() => {
    if (mode === 'spacetime' && timeScale < 0) {
      unlockAchievement('time-bender');
    }
  }, [mode, timeScale, unlockAchievement]);

  useEffect(() => {
    if (!realisticMode) {
      unlockAchievement('mode-shifter');
    }
  }, [realisticMode, unlockAchievement]);

  useEffect(() => {
    if (rocketState.phase !== 'outcome' || rocketState.outcome === 'none') return;
    if (recordedLaunchRef.current === rocketState.seed) return;
    recordedLaunchRef.current = rocketState.seed;

    // Write the run into the lab notebook with its cause, and check the prediction.
    const debrief = buildDebrief(effectiveRocketParams, rocketState);
    setNotebook(addNotebookEntry({
      outcome: rocketState.outcome,
      prediction,
      params: effectiveRocketParams,
      weather: Array.from(activeWeather, (id) => WEATHER_PRESETS[id].name),
      metrics: {
        deltaV: vehicleSummary(effectiveRocketParams).deltaV,
        peakAltitude: rocketState.maxAltitude,
        maxQ: rocketState.maxDynamicPressure,
        heat: rocketState.heat,
        flightTime: rocketState.elapsed,
      },
      cause: debrief.causes[0] ?? debrief.headline,
    }));
    if (prediction && prediction === rocketState.outcome) {
      awardScore(25);
      setCorrectPredictions(correctPredictions + 1);
      if (correctPredictions + 1 >= PREDICTIONS_FOR_FORECASTER) unlockAchievement('forecaster');
      if (FAILURE_OUTCOMES.has(rocketState.outcome)) unlockAchievement('failure-analyst');
      if (rocketState.outcome === 'orbiting') unlockAchievement('orbit-call');
    }

    if (rocketState.outcome === 'orbiting') {
      awardScore(80);
      unlockAchievement('first-stable-orbit');
    }

    if (rocketState.outcome === 'escape') {
      awardScore(90);
      unlockAchievement('escape-velocity-achieved');
    }

    // Missions are judged on the conditions actually flown (base values + weather).
    const flown = effectiveRocketParams;
    const reachedSpace = rocketState.outcome === 'orbiting' || rocketState.outcome === 'escape';
    const survived = rocketState.outcome !== 'crashed' && rocketState.outcome !== 'burnup';

    const difficultWeather =
      Math.abs(flown.crosswind) >= 20
      && flown.windShear >= 0.5
      && flown.thermalLoad >= 0.45;
    if (difficultWeather && survived) {
      unlockAchievement('storm-runner');
    }

    if (flown.stageSeparation && reachedSpace) {
      unlockAchievement('staging-specialist');
    }

    const preciseFlight = Math.abs(flown.padTilt) <= 1 && Math.abs(flown.crosswind) <= 8;
    if (preciseFlight && reachedSpace) {
      unlockAchievement('precision-pilot');
    }

    const heavyLiftConfig = flown.thrustForce >= 70 && flown.fuelMass >= 120;
    if (heavyLiftConfig && reachedSpace) {
      unlockAchievement('heavy-lift');
    }

    const thickAtmosphere = flown.atmosphericDensity >= 0.75 && flown.atmosphericPressure >= 1.1;
    if (thickAtmosphere && reachedSpace) {
      unlockAchievement('dense-atmosphere-run');
    }
  }, [
    activeWeather,
    awardScore,
    correctPredictions,
    effectiveRocketParams,
    prediction,
    rocketState,
    unlockAchievement,
  ]);

  // ─── Spacetime handlers ───
  // Physics positions are managed inside PhysicsSimulator via refs — no per-frame
  // React state update needed. These callbacks only fire on low-frequency events.
  const handleBodyRemoved = useCallback((id: string) => {
    setBodies((prev) => prev.filter((b) => b.id !== id));
  }, []);

  const handleBodyUpdated = useCallback((id: string, mass: number, radius: number) => {
    setBodies((prev) => prev.map((b) => (b.id === id ? { ...b, mass, radius } : b)));
  }, []);

  const handleBodyRestored = useCallback((body: CelestialBody) => {
    setBodies((prev) => (prev.some((b) => b.id === body.id) ? prev : [...prev, body]));
  }, []);

  /** Bodies as they are right now in the simulation (React state only holds spawn values). */
  const getLiveBodies = useCallback((current: CelestialBody[]): CelestialBody[] => {
    const live = new Map(livePhysicsRef.current.map((entry) => [entry.id, entry]));
    return current.map((body) => {
      const state = live.get(body.id);
      return state
        ? { ...body, position: state.position, velocity: state.velocity, mass: state.mass, radius: state.radius }
        : body;
    });
  }, []);

  const handleBeginPlacement = useCallback((obj: Omit<CelestialBody, 'id'>) => {
    const { position: _ignored, ...bodyWithoutPosition } = obj;
    setPendingPlacement(bodyWithoutPosition);
    registerExperiment(`prep:${obj.type}:${Math.round(obj.mass).toExponential(1)}`);
  }, [registerExperiment]);

  const handlePlace = useCallback((
    point: [number, number, number],
    aimedVelocity: [number, number, number] | null,
    predicted: PredictedOutcome | null,
  ) => {
    if (!pendingPlacement) return;
    const plan = planPlacement(point, pendingPlacement.radius ?? 0.3, getLiveBodies(bodies), placementVelocityScale, aimedVelocity);
    const id = `obj_${nextId++}`;
    registerExperiment(`place:${pendingPlacement.type}:${plan.position[0].toFixed(1)}:${plan.position[2].toFixed(1)}:${aimedVelocity ? 'aimed' : placementVelocityScale.toFixed(2)}:${realisticMode ? 'real' : 'arcade'}`, 18);
    missionTrackerRef.current.notePlacement(id, aimedVelocity !== null, snapshotRef.current?.simTime ?? 0, predicted);
    setBodies((prev) => [...prev, { ...pendingPlacement, id, position: plan.position, velocity: plan.velocity }]);
    setPendingPlacement(null);
  }, [bodies, getLiveBodies, pendingPlacement, placementVelocityScale, realisticMode, registerExperiment]);

  const handleBodySpawned = useCallback((body: CelestialBody) => {
    setBodies((prev) => (prev.some((b) => b.id === body.id) ? prev : [...prev, body]));
  }, []);

  // ─── Live simulation readouts (timeline, inspector, conservation) ───
  const flushSnapshotUi = useCallback(() => {
    snapshotUiTimerRef.current = null;
    lastSnapshotUiRef.current = performance.now();
    const snapshot = snapshotRef.current;
    if (!snapshot) return;
    const diag = snapshot.diagnostics;
    if (diag) {
      const samples = conservationRef.current;
      const last = samples[samples.length - 1];
      if (last && snapshot.simTime < last.time) {
        // Rewound: drop samples from the undone future.
        conservationRef.current = samples.filter((sample) => sample.time <= snapshot.simTime);
      }
      if (!last || snapshot.simTime > last.time) {
        conservationRef.current.push({
          time: snapshot.simTime,
          energy: diag.energy,
          energyScale: Math.abs(diag.kinetic) + Math.abs(diag.potential),
          momentumX: diag.momentumX,
          momentumZ: diag.momentumZ,
          momentumScale: diag.momentumScale,
          angularMomentum: diag.angularMomentum,
          angularMomentumScale: diag.angularMomentumScale,
        });
        while (conservationRef.current.length > MAX_CONSERVATION_SAMPLES) conservationRef.current.shift();
      }
    }
    missionTrackerRef.current.update(snapshot, (id) => bodyTypesRef.current.get(id)).forEach(unlockAchievement);
    setTimeline({
      step: snapshot.step,
      historyStart: snapshot.historyStart,
      historyEnd: snapshot.historyEnd,
      markers: snapshot.markers,
      simTime: snapshot.simTime,
    });
  }, [unlockAchievement]);

  const handleImpacts = useCallback((impacts: ImpactEvent[]) => {
    missionTrackerRef.current.noteImpacts(impacts).forEach(unlockAchievement);
  }, [unlockAchievement]);

  // Panels refresh at most five times a second, but the latest state always lands
  // (a seek while paused produces a single snapshot that must not be dropped).
  const handleSnapshot = useCallback((snapshot: SimSnapshot) => {
    snapshotRef.current = snapshot;
    if (snapshotUiTimerRef.current !== null) return;
    const wait = Math.max(0, SNAPSHOT_UI_INTERVAL_MS - (performance.now() - lastSnapshotUiRef.current));
    snapshotUiTimerRef.current = window.setTimeout(flushSnapshotUi, wait);
  }, [flushSnapshotUi]);

  useEffect(() => () => {
    if (snapshotUiTimerRef.current !== null) window.clearTimeout(snapshotUiTimerRef.current);
  }, []);

  const handleSelectBody = useCallback((id: string) => {
    setSelectedBodyId(id);
    setRightTab('inspector');
    if (snapshotRef.current) missionTrackerRef.current.noteInspection(id, snapshotRef.current).forEach(unlockAchievement);
  }, [unlockAchievement]);

  const handlePinBody = useCallback((id: string, pinned: boolean) => {
    simulationRef.current?.setPinned(id, pinned);
    setBodies((prev) => prev.map((b) => (b.id === id ? { ...b, pinned } : b)));
  }, []);

  const handleScrubStart = useCallback(() => setIsPlaying(false), []);

  const handleSeek = useCallback((step: number) => {
    simulationRef.current?.seek(step);
    if (step < (snapshotRef.current?.step ?? 0)) unlockAchievement('time-bender');
  }, [unlockAchievement]);

  const handleRemoveBody = useCallback((id: string) => {
    setBodies((prev) => prev.filter((b) => b.id !== id));
  }, []);

  const handleRemoveAll = useCallback(() => {
    setBodies([]);
    setSimulationEpoch((epoch) => epoch + 1);
  }, []);

  const handleApplyTemplate = useCallback((templateId: string) => {
    const template = SPACETIME_TEMPLATES.find((entry) => entry.id === templateId);
    if (!template) return;

    const nextBodies = template.createBodies().map((body, index) => ({
      ...body,
      id: `template_${templateId}_${nextId++}_${index}`,
    }));

    setBodies(nextBodies);
    setSimulationEpoch((epoch) => epoch + 1);
    setPendingPlacement(null);
    setTimeScale(1);
    setIsPlaying(true);
    universeAgeRef.current = 0;
    setUniverseScale(1);
    registerExperiment(`template:${templateId}`, 24);
  }, [registerExperiment]);

  const handleResetSpacetime = useCallback(() => {
    setBodies(createDefaultBodies());
    setSimulationEpoch((epoch) => epoch + 1);
    setTimeScale(1);
    setIsPlaying(true);
    universeAgeRef.current = 0;
    setUniverseScale(1);
    setPendingPlacement(null);
  }, []);

  const handleSaveCurrentScenario = useCallback((name: string) => {
    const trimmedName = name.trim();
    if (!trimmedName) return false;

    setSavedScenarios(saveSpacetimeScenario({
      name: trimmedName,
      bodies: getLiveBodies(bodies),
      placementVelocityScale,
      realisticMode,
    }));
    return true;
  }, [bodies, getLiveBodies, placementVelocityScale, realisticMode]);

  const handleLoadScenario = useCallback((scenarioId: string) => {
    const scenario = savedScenarios.find((entry) => entry.id === scenarioId);
    if (!scenario) return;

    setBodies(cloneBodiesForScene(scenario.bodies));
    setSimulationEpoch((epoch) => epoch + 1);
    setPlacementVelocityScale(scenario.placementVelocityScale);
    setRealisticMode(scenario.realisticMode);
    setPendingPlacement(null);
    setTimeScale(1);
    setIsPlaying(true);
    universeAgeRef.current = 0;
    setUniverseScale(1);
    registerExperiment(`saved-scenario:${scenario.id}`, 20);
  }, [registerExperiment, savedScenarios]);

  const handleDeleteScenario = useCallback((scenarioId: string) => {
    setSavedScenarios(deleteSpacetimeScenario(scenarioId));
  }, []);

  // ─── Rocket handlers ───
  const handleRocketParamChange = useCallback((key: keyof RocketParams, value: number | boolean) => {
    setRocketParams((prev) => {
      const next = { ...prev, [key]: value };
      registerExperiment(`rocket:${key}:${String(value)}`);
      registerExperiment(
        `rocket-profile:${next.launchAngle}-${next.thrustForce}-${next.fuelMass}-${next.dragCoefficient}-${next.gravity}-${next.crosswind}-${next.windShear}-${next.thermalLoad}-${next.ambientTemperature}-${next.atmosphericPressure}-${next.padTilt}-${next.stageSeparation ? 1 : 0}`,
        10,
      );
      return next;
    });
  }, [registerExperiment]);

  const handleLaunch = useCallback(() => {
    awardScore(15);
    // A fresh seed per launch: weather hazards differ between launches but replay exactly on rewind.
    setRocketState({ ...INITIAL_STATE, phase: 'launching', fuel: 1, seed: Math.floor(Math.random() * 2 ** 31) });
  }, [awardScore]);

  const handleRocketReset = useCallback(() => {
    setRocketState({ ...INITIAL_STATE });
  }, []);

  const handleSaveRocketPreset = useCallback((name: string) => {
    const trimmedName = name.trim();
    if (!trimmedName) return false;

    setSavedRocketPresets(saveRocketPreset({
      name: trimmedName,
      params: rocketParams,
    }));
    return true;
  }, [rocketParams]);

  const handleLoadRocketPreset = useCallback((presetId: string) => {
    const preset = savedRocketPresets.find((entry) => entry.id === presetId);
    if (!preset) return;

    setRocketParams(normalizeRocketParams(preset.params));
    setRocketState({ ...INITIAL_STATE });
    registerExperiment(`saved-rocket:${preset.id}`, 16);
  }, [registerExperiment, savedRocketPresets]);

  const handleDeleteRocketPreset = useCallback((presetId: string) => {
    setSavedRocketPresets(deleteRocketPreset(presetId));
  }, []);

  // ─── Teacher packs ───
  const handleLoadLessonSetup = useCallback((pack: ChallengePack) => {
    if (pack.teacher?.templateId) handleApplyTemplate(pack.teacher.templateId);
    if (pack.teacher?.rocketSettings) {
      setRocketParams(normalizeRocketParams({ ...DEFAULT_PARAMS, ...pack.teacher.rocketSettings }));
      setActiveWeather(new Set());
      setRocketState({ ...INITIAL_STATE });
    }
  }, [handleApplyTemplate]);

  // ─── Sharing saved work as files ───
  const handleExportFile = useCallback(() => {
    downloadTextFile('cosmic-playground-export.json', buildExportFile(savedScenarios, savedRocketPresets));
  }, [savedRocketPresets, savedScenarios]);

  const handleImportFile = useCallback(async (text: string) => {
    try {
      const { parseImportFile } = await import('../lib/exportImport');
      const imported = parseImportFile(text);
      let scenarios = savedScenarios;
      let presets = savedRocketPresets;
      imported.spacetimeScenarios.forEach((scenario) => { scenarios = saveSpacetimeScenario(scenario); });
      imported.rocketPresets.forEach((preset) => { presets = saveRocketPreset(preset); });
      setSavedScenarios(scenarios);
      setSavedRocketPresets(presets);
      const parts = [
        `${imported.spacetimeScenarios.length} system${imported.spacetimeScenarios.length === 1 ? '' : 's'}`,
        `${imported.rocketPresets.length} rocket preset${imported.rocketPresets.length === 1 ? '' : 's'}`,
      ];
      return `Imported ${parts.join(' and ')}.`;
    } catch (error) {
      return error instanceof Error ? error.message : 'Could not read that file.';
    }
  }, [savedRocketPresets, savedScenarios]);

  const handleClearNotebook = useCallback(() => setNotebook(clearNotebook()), []);

  const handleWeatherChange = useCallback((id: WeatherConditionId) => {
    setActiveWeather((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const handleVelocityScaleChange = useCallback((value: number) => {
    setPlacementVelocityScale(value);
    registerExperiment(`velocity-scale:${value.toFixed(2)}`);
  }, [registerExperiment]);

  const handleRealisticModeChange = useCallback((value: boolean) => {
    setRealisticMode(value);
    registerExperiment(`physics-mode:${value ? 'realistic' : 'arcade'}`);
  }, [registerExperiment]);

  const handleExpansionChange = useCallback((value: boolean) => {
    setExpansionEnabled(value);
    universeAgeRef.current = 0;
    setUniverseScale(1);
    if (value) registerExperiment('universe-expansion');
  }, [registerExperiment]);

  // ─── Keyboard shortcuts ───
  // Space pauses, R resets, Esc cancels a placement. Tab switches labs while a 3D view has
  // focus (click it first), so Tab still moves through the panels for keyboard users.
  const shortcutsRef = useRef({ mode, handleResetSpacetime, handleRocketReset });
  shortcutsRef.current = { mode, handleResetSpacetime, handleRocketReset };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      const typing = target?.closest('input, textarea, select, [contenteditable="true"]');
      const onControl = target?.closest('button, a, [role="radio"], [role="checkbox"], [role="tab"]');
      if (typing || document.querySelector('[role="dialog"][data-state="open"]')) return;
      const current = shortcutsRef.current;
      const viewFocused = target === spaceViewRef.current || target === rocketViewRef.current;
      if (event.key === 'Tab' && viewFocused && !event.shiftKey) {
        event.preventDefault();
        const next: AppMode = current.mode === 'spacetime' ? 'rocket' : 'spacetime';
        setMode(next);
        // Keep focus on the newly shown view so Tab can switch straight back.
        window.setTimeout(() => (next === 'spacetime' ? spaceViewRef : rocketViewRef).current?.focus(), 0);
      } else if (event.key === ' ' && !onControl) {
        event.preventDefault();
        setIsPlaying((playing) => !playing);
      } else if ((event.key === 'r' || event.key === 'R') && !event.shiftKey) {
        event.preventDefault();
        if (current.mode === 'spacetime') current.handleResetSpacetime(); else current.handleRocketReset();
      } else if (event.key === 'Escape') {
        setPendingPlacement(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // effectiveTimeScale carries sign (negative = rewind, 0 = paused)
  const effectiveTimeScale = isPlaying ? timeScale : 0;
  const activePack = getActivePack(mode, activePacks[mode]);
  const modePacks = PACKS_BY_MODE[mode];
  const modeMissions = activePack.missions;
  const unlockedCount = modeMissions.filter((mission) => achievements[mission.id]).length;
  const visibleMissions = missionQueues[mode].map((card) => ({
    ...findMission(card.id)!,
    phase: card.phase,
  }));
  const experimentCount = Array.from(experimentKeysRef.current).filter((key) => (
    mode === 'rocket'
      ? key.startsWith('rocket:')
        || key.startsWith('rocket-profile:')
      : !key.startsWith('rocket:')
        && !key.startsWith('rocket-profile:')
  )).length;

  return (
    <div className="w-full h-screen relative overflow-hidden bg-background">
      {/* 3D Canvases - use visibility instead of conditional render to avoid WebGL context loss */}
      <div
        ref={spaceViewRef}
        tabIndex={-1}
        aria-label="Spacetime 3D view"
        className="absolute inset-0 outline-none"
        style={{ display: mode === 'spacetime' ? 'block' : 'none' }}
      >
        <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading the 3D view…</div>}>
        <SpaceScene
          quality={quality}
          reduceMotion={reduceMotion}
          bodies={bodies}
          timeScale={effectiveTimeScale}
          onBodyRemoved={handleBodyRemoved}
          onBodyUpdated={handleBodyUpdated}
          onBodyRestored={handleBodyRestored}
          onBodySpawned={handleBodySpawned}
          pendingPlacement={pendingPlacement}
          placementVelocityScale={placementVelocityScale}
          onPlace={handlePlace}
          simulationRef={simulationRef}
          onSnapshot={handleSnapshot}
          onImpacts={handleImpacts}
          selectedBodyId={selectedBodyId}
          onSelectBody={handleSelectBody}
          realisticMode={realisticMode}
          universeScale={universeScale}
          expansionRate={expansionEnabled && universeScale < MAX_UNIVERSE_SCALE ? HUBBLE_RATE : 0}
          simulationEpoch={simulationEpoch}
          livePhysicsRef={livePhysicsRef}
        />
        </Suspense>
      </div>
      <div
        ref={rocketViewRef}
        tabIndex={-1}
        aria-label="Rocket 3D view"
        className="absolute inset-0 outline-none"
        style={{ display: mode === 'rocket' ? 'block' : 'none' }}
      >
        {rocketLabLoaded && (
          <Suspense fallback={null}>
            <RocketScene params={effectiveRocketParams} state={rocketState} onUpdateState={setRocketState} timeScale={effectiveTimeScale} activeWeather={activeWeather} quality={quality} reduceMotion={reduceMotion} />
          </Suspense>
        )}
      </div>

      {/* Top Bar */}
      <div className="absolute top-0 left-0 right-0 z-20 p-4 flex items-center justify-between pointer-events-none">
        <div className="glass-panel px-4 py-2.5 flex items-center gap-3 pointer-events-auto min-w-[280px]">
          <img
            src="/cosmic-playground-logo.png"
            alt="Cosmic Playground logo"
            className="h-12 w-auto object-contain drop-shadow-[0_0_18px_rgba(34,211,238,0.2)]"
          />
          <div>
            <h1 className="text-sm font-bold tracking-wide text-foreground">COSMIC PLAYGROUND</h1>
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

        {/* Stats and settings */}
        <div className="flex items-center gap-2 pointer-events-auto">
        <div className="glass-panel px-3 py-2">
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
                <button
                  type="button"
                  onClick={() => setNotebookOpen(true)}
                  className="flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-2 py-1 text-primary hover:bg-primary/20"
                >
                  <NotebookPen size={12} /> Notebook ({notebook.length})
                </button>
              </>
            )}
          </div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-[hsla(var(--glass-bg)/0.6)] p-1.5 backdrop-blur-xl">
          <SettingsMenu settings={settings} onChange={setSettings} />
        </div>
        </div>
      </div>

      {/* Left Panel */}
      <div className="absolute left-4 top-20 bottom-20 z-10 pointer-events-auto">
        {mode === 'spacetime' ? (
          <ObjectLibrary
            onBeginPlacement={handleBeginPlacement}
            onApplyTemplate={handleApplyTemplate}
            bodies={bodies}
            onRemoveBody={handleRemoveBody}
            selectedBodyId={selectedBodyId}
            onSelectBody={handleSelectBody}
            onRemoveAll={handleRemoveAll}
            placementActive={Boolean(pendingPlacement)}
            velocityScale={placementVelocityScale}
            onVelocityScaleChange={handleVelocityScaleChange}
            realisticMode={realisticMode}
            onRealisticModeChange={handleRealisticModeChange}
            expansionEnabled={expansionEnabled}
            onExpansionChange={handleExpansionChange}
            savedScenarios={savedScenarios}
            onSaveScenario={handleSaveCurrentScenario}
            onLoadScenario={handleLoadScenario}
            onDeleteScenario={handleDeleteScenario}
            onExportFile={handleExportFile}
            onImportFile={handleImportFile}
          />
        ) : (
          <Suspense fallback={<div className="glass-panel-strong w-[440px] h-[calc(100vh-140px)] p-7 text-sm text-muted-foreground">Loading the Rocket Lab…</div>}>
            <RocketControls
              params={rocketParams}
              effectiveParams={effectiveRocketParams}
              state={rocketState}
              onParamChange={handleRocketParamChange}
              onLaunch={handleLaunch}
              onReset={handleRocketReset}
              savedPresets={savedRocketPresets}
              onSavePreset={handleSaveRocketPreset}
              onLoadPreset={handleLoadRocketPreset}
              onDeletePreset={handleDeleteRocketPreset}
              activeWeather={activeWeather}
              onWeatherChange={handleWeatherChange}
              onExportFile={handleExportFile}
              onImportFile={handleImportFile}
              prediction={prediction}
              onPredictionChange={setPrediction}
            />
          </Suspense>
        )}
      </div>

      <div className="absolute right-4 top-20 z-10 w-[460px] pointer-events-auto">
        <div className="glass-panel p-4 animate-fade-in max-h-[calc(100vh-200px)] overflow-y-auto scrollbar-thin">
          {mode === 'spacetime' && (
            <div className="mb-4 grid grid-cols-3 gap-1 rounded-lg bg-muted/20 p-1" role="tablist" aria-label="Right panel">
              {([
                ['missions', 'Missions'],
                ['inspector', 'Inspector'],
                ['conservation', 'Conservation'],
              ] as const).map(([tab, label]) => (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={rightTab === tab}
                  onClick={() => setRightTab(tab)}
                  className={`rounded-md px-2 py-1.5 text-sm transition-colors ${
                    rightTab === tab ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {mode === 'spacetime' && rightTab === 'inspector' && (
            <OrbitInspector
              snapshot={snapshotRef.current}
              bodies={bodies}
              selectedId={selectedBodyId}
              onClear={() => setSelectedBodyId(null)}
              onPin={handlePinBody}
            />
          )}
          {mode === 'spacetime' && rightTab === 'conservation' && (
            <ConservationPanel
              samples={conservationRef.current}
              impactTimes={timeline.markers.map((marker) => marker.step * SIM_STEP)}
              realisticMode={realisticMode}
              expansionEnabled={expansionEnabled}
            />
          )}
          {(mode === 'rocket' || rightTab === 'missions') && (<>
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <div className="flex items-center gap-2 text-primary mb-1">
                <Trophy size={16} />
                <span className="text-base font-semibold tracking-[0.18em] uppercase">Mission Progress</span>
              </div>
              <p className="text-base text-muted-foreground">{activePack.description}</p>
            </div>
            <div className="text-right">
              <div className="text-sm uppercase tracking-[0.2em] text-muted-foreground">Score</div>
              <div className="text-2xl font-semibold text-foreground">{explorationScore}</div>
            </div>
          </div>

          <div className="mb-4 rounded-xl border border-border/30 bg-muted/15 p-3">
            <div className="flex items-center justify-between gap-3 mb-2">
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Challenge Pack</div>
                <div className="text-base font-semibold text-foreground">{activePack.name}</div>
              </div>
              <select
                value={activePack.id}
                onChange={(e) => handleChallengePackChange(mode, e.target.value)}
                aria-label="Challenge pack"
                className="max-w-[58%] min-w-0 rounded-lg border border-border/40 bg-background/80 px-3 py-2 text-sm text-foreground focus:border-primary/40 focus:outline-none"
              >
                <optgroup label="Challenge packs">
                  {modePacks.filter((pack) => !pack.teacher).map((pack) => (
                    <option key={pack.id} value={pack.id}>{pack.name}</option>
                  ))}
                </optgroup>
                <optgroup label="Teacher packs">
                  {modePacks.filter((pack) => pack.teacher).map((pack) => (
                    <option key={pack.id} value={pack.id}>{pack.name}</option>
                  ))}
                </optgroup>
              </select>
            </div>
            <p className="text-sm text-muted-foreground">{activePack.missions.length} themed missions in this pack.</p>
            {activePack.teacher && (
              <div className="mt-3 rounded-lg border border-secondary/30 bg-secondary/10 p-3" aria-label="Teacher notes">
                <div className="text-xs uppercase tracking-[0.2em] text-secondary mb-1">Teacher notes</div>
                <p className="text-sm text-foreground/90 leading-snug">{activePack.teacher.notes}</p>
                <button
                  type="button"
                  onClick={() => handleLoadLessonSetup(activePack)}
                  disabled={mode === 'rocket' && rocketState.phase !== 'idle' && rocketState.phase !== 'outcome'}
                  className="press mt-2 rounded-md border border-secondary/40 bg-secondary/15 px-3 py-1.5 text-sm text-secondary hover:bg-secondary/25 disabled:opacity-40"
                >
                  Load lesson setup
                </button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 mb-4">
            <div className="rounded-xl border border-border/30 bg-muted/15 p-3">
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted-foreground mb-1">
                <Sparkles size={12} />
                Unlocks
              </div>
              <div className="text-2xl font-semibold text-foreground">{unlockedCount}/{modeMissions.length}</div>
            </div>
            <div className="rounded-xl border border-border/30 bg-muted/15 p-3">
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted-foreground mb-1">
                <Target size={12} />
                {mode === 'spacetime' ? 'Lab Runs' : 'Flight Tests'}
              </div>
              <div className="text-2xl font-semibold text-foreground">{experimentCount}</div>
            </div>
          </div>

          <div className="space-y-2 min-h-[248px]">
            {visibleMissions.map((achievement) => (
              <div
                key={achievement.id}
                className={`rounded-xl border px-3 py-2.5 animate-fade-in transition-all duration-300 ${
                  achievement.phase === 'complete'
                    ? 'scale-[0.985] border-primary/35 bg-primary/10'
                    : 'border-slate-400/20 bg-slate-400/10'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className={`text-base font-medium ${achievement.phase === 'complete' ? 'text-primary' : 'text-foreground'}`}>{achievement.name}</div>
                    <div className="text-base text-muted-foreground">{achievement.description}</div>
                  </div>
                  <div className={`text-sm font-mono uppercase tracking-[0.2em] ${achievement.phase === 'complete' ? 'text-primary' : 'text-muted-foreground/70'}`}>
                    {achievement.phase === 'complete' ? 'Complete' : 'Incomplete'}
                  </div>
                </div>
              </div>
            ))}

            {visibleMissions.length === 0 && (
              <div className="rounded-xl border border-primary/35 bg-primary/10 px-3 py-4 text-center animate-fade-in">
                <div className="text-base font-medium text-primary">All {mode === 'spacetime' ? 'spacetime' : 'rocket'} missions complete</div>
                <div className="text-base text-muted-foreground mt-1">Every mission in this queue has been cleared.</div>
              </div>
            )}
          </div>
          </>)}
        </div>
      </div>

      {notebookOpen && (
        <Suspense fallback={null}>
          <LabNotebook open={notebookOpen} onOpenChange={setNotebookOpen} entries={notebook} onClear={handleClearNotebook} />
        </Suspense>
      )}

      {/* Bottom Center - Time Controls */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 pointer-events-auto flex flex-col items-center gap-2">
        {mode === 'spacetime' && (
          <TimelineBar timeline={timeline} onScrubStart={handleScrubStart} onSeek={handleSeek} />
        )}
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
            ? (pendingPlacement
              ? 'Click the grid for a circular orbit · Drag to aim · The line shows where it will go'
              : 'Drag to orbit · Scroll to zoom · Click a body to inspect it')
            : 'Adjust parameters · Launch · Observe trajectory'}
        </p>
      </div>
    </div>
  );
};

export default Index;
