import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import SpaceScene, { CelestialBody } from '../components/space/SpaceScene';
import RocketScene from '../components/rocket/RocketScene';
import RocketControls from '../components/rocket/RocketControls';
import { RocketParams, RocketState, DEFAULT_PARAMS, INITIAL_STATE } from '../components/rocket/rocketTypes';
import { WeatherConditionId, applyWeatherToParams } from '../components/rocket/weatherPresets';
import TimeControls from '../components/ui/TimeControls';
import ObjectLibrary from '../components/ui/ObjectLibrary';
import { SPACETIME_TEMPLATES } from '../components/space/spacetimeTemplates';
import { Rocket, Orbit, Trophy, Sparkles, Target } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
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

let nextId = 1;
const ACTIVE_MISSION_LIMIT = 3;
const MISSION_EXIT_DELAY_MS = 900;

// Universe expansion starts after this many real seconds
const EXPANSION_DELAY_S = 600; // 10 minutes
const DEFAULT_STAR_MASS = 1.989e30;
const MASSIVE_ATTRACTOR_THRESHOLD = 1e27;
const REAL_G = 6.674e-11;
const REAL_GRAVITY_BOOST = 7.5e-20; // Must match PhysicsSimulator — G_eff * M_sun ≈ 10 at scene scale
const MIN_ORBITAL_SPEED = 0.08;
const MAX_ORBITAL_SPEED = 3.0;

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
  const [activePacks, setActivePacks] = useState<Record<AppMode, string>>(DEFAULT_PACK_BY_MODE);

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
  const [savedScenarios, setSavedScenarios] = useState<SavedSpacetimeScenario[]>([]);
  const [savedRocketPresets, setSavedRocketPresets] = useState<SavedRocketPreset[]>([]);
  const [activeWeather, setActiveWeather] = useState<Set<WeatherConditionId>>(new Set());

  const effectiveRocketParams = useMemo(
    () => applyWeatherToParams(rocketParams, activeWeather),
    [rocketParams, activeWeather],
  );
  const [explorationScore, setExplorationScore] = useState(0);
  const [achievements, setAchievements] = useState<Record<MissionId, boolean>>({
    'gravity-master': false,
    'chaos-creator': false,
    'slingshot-expert': false,
    'black-hole-survivor': false,
    'time-bender': false,
    'system-architect': false,
    'mode-shifter': false,
    'first-stable-orbit': false,
    'escape-velocity-achieved': false,
    'storm-runner': false,
    'staging-specialist': false,
    'precision-pilot': false,
    'heavy-lift': false,
    'dense-atmosphere-run': false,
  });
  const [missionQueues, setMissionQueues] = useState<MissionQueues>(() => ({
    spacetime: buildMissionCards(getActivePack('spacetime', DEFAULT_PACK_BY_MODE.spacetime), {
      'gravity-master': false,
      'chaos-creator': false,
      'slingshot-expert': false,
      'black-hole-survivor': false,
      'time-bender': false,
      'system-architect': false,
      'mode-shifter': false,
      'first-stable-orbit': false,
      'escape-velocity-achieved': false,
      'storm-runner': false,
      'staging-specialist': false,
      'precision-pilot': false,
      'heavy-lift': false,
      'dense-atmosphere-run': false,
    }),
    rocket: buildMissionCards(getActivePack('rocket', DEFAULT_PACK_BY_MODE.rocket), {
      'gravity-master': false,
      'chaos-creator': false,
      'slingshot-expert': false,
      'black-hole-survivor': false,
      'time-bender': false,
      'system-architect': false,
      'mode-shifter': false,
      'first-stable-orbit': false,
      'escape-velocity-achieved': false,
      'storm-runner': false,
      'staging-specialist': false,
      'precision-pilot': false,
      'heavy-lift': false,
      'dense-atmosphere-run': false,
    }),
  }));
  const experimentKeysRef = useRef<Set<string>>(new Set());
  const achievementStateRef = useRef(achievements);
  const missionRemovalTimersRef = useRef<Partial<Record<MissionId, number>>>({});
  const stableSystemTimerRef = useRef(0);
  const stableBlackHoleTimerRef = useRef(0);
  const previousOutcomeRef = useRef<RocketState['outcome']>('none');

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
    if (bodies.length >= 5) {
      unlockAchievement('system-architect');
    }
  }, [bodies.length, unlockAchievement]);

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

    const difficultWeather =
      Math.abs(effectiveRocketParams.crosswind) >= 20
      && effectiveRocketParams.windShear >= 0.5
      && effectiveRocketParams.thermalLoad >= 0.45;
    if (difficultWeather && rocketState.outcome !== 'crashed' && rocketState.outcome !== 'burnup') {
      unlockAchievement('storm-runner');
    }

    if (rocketParams.stageSeparation && (rocketState.outcome === 'orbiting' || rocketState.outcome === 'escape')) {
      unlockAchievement('staging-specialist');
    }

    const preciseFlight = Math.abs(rocketParams.padTilt) <= 1 && Math.abs(rocketParams.crosswind) <= 8;
    if (preciseFlight && (rocketState.outcome === 'orbiting' || rocketState.outcome === 'escape')) {
      unlockAchievement('precision-pilot');
    }

    const heavyLiftConfig = rocketParams.thrustForce >= 70 && rocketParams.fuelMass >= 120;
    if (heavyLiftConfig && rocketState.outcome !== 'crashed' && rocketState.outcome !== 'burnup') {
      unlockAchievement('heavy-lift');
    }

    const thickAtmosphere = rocketParams.atmosphericDensity >= 0.75 && rocketParams.atmosphericPressure >= 1.1;
    if (thickAtmosphere && rocketState.outcome !== 'crashed' && rocketState.outcome !== 'burnup') {
      unlockAchievement('dense-atmosphere-run');
    }
  }, [
    awardScore,
    rocketParams.atmosphericDensity,
    rocketParams.atmosphericPressure,
    rocketParams.crosswind,
    rocketParams.fuelMass,
    rocketParams.padTilt,
    rocketParams.stageSeparation,
    rocketParams.thermalLoad,
    rocketParams.thrustForce,
    rocketParams.windShear,
    rocketState.outcome,
    rocketState.phase,
    unlockAchievement,
  ]);

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

  const handleApplyTemplate = useCallback((templateId: string) => {
    const template = SPACETIME_TEMPLATES.find((entry) => entry.id === templateId);
    if (!template) return;

    const nextBodies = template.createBodies().map((body, index) => ({
      ...body,
      id: `template_${templateId}_${nextId++}_${index}`,
    }));

    setBodies(nextBodies);
    setPendingPlacement(null);
    setTimeScale(1);
    setIsPlaying(true);
    universeAgeRef.current = 0;
    setUniverseScale(1);
    stableSystemTimerRef.current = 0;
    stableBlackHoleTimerRef.current = 0;
    registerExperiment(`template:${templateId}`, 24);
  }, [registerExperiment]);

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

  const handleSaveCurrentScenario = useCallback((name: string) => {
    const trimmedName = name.trim();
    if (!trimmedName) return false;

    setSavedScenarios(saveSpacetimeScenario({
      name: trimmedName,
      bodies,
      placementVelocityScale,
      realisticMode,
    }));
    return true;
  }, [bodies, placementVelocityScale, realisticMode]);

  const handleLoadScenario = useCallback((scenarioId: string) => {
    const scenario = savedScenarios.find((entry) => entry.id === scenarioId);
    if (!scenario) return;

    setBodies(cloneBodiesForScene(scenario.bodies));
    setPlacementVelocityScale(scenario.placementVelocityScale);
    setRealisticMode(scenario.realisticMode);
    setPendingPlacement(null);
    setTimeScale(1);
    setIsPlaying(true);
    universeAgeRef.current = 0;
    setUniverseScale(1);
    stableSystemTimerRef.current = 0;
    stableBlackHoleTimerRef.current = 0;
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
    setRocketState({ ...INITIAL_STATE, phase: 'launching', fuel: 1 });
  }, [awardScore]);

  const handleRocketReset = useCallback(() => {
    setRocketState({ ...INITIAL_STATE });
    previousOutcomeRef.current = 'none';
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

    setRocketParams(preset.params);
    setRocketState({ ...INITIAL_STATE });
    previousOutcomeRef.current = 'none';
    registerExperiment(`saved-rocket:${preset.id}`, 16);
  }, [registerExperiment, savedRocketPresets]);

  const handleDeleteRocketPreset = useCallback((presetId: string) => {
    setSavedRocketPresets(deleteRocketPreset(presetId));
  }, []);

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
        <RocketScene params={effectiveRocketParams} state={rocketState} onUpdateState={setRocketState} timeScale={effectiveTimeScale} activeWeather={activeWeather} />
      </div>

      {/* Top Bar */}
      <div className="absolute top-0 left-0 right-0 z-10 p-4 flex items-center justify-between pointer-events-none">
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
            onApplyTemplate={handleApplyTemplate}
            bodies={bodies}
            onRemoveBody={handleRemoveBody}
            onRemoveAll={handleRemoveAll}
            placementActive={Boolean(pendingPlacement)}
            velocityScale={placementVelocityScale}
            onVelocityScaleChange={handleVelocityScaleChange}
            realisticMode={realisticMode}
            onRealisticModeChange={handleRealisticModeChange}
            savedScenarios={savedScenarios}
            onSaveScenario={handleSaveCurrentScenario}
            onLoadScenario={handleLoadScenario}
            onDeleteScenario={handleDeleteScenario}
          />
        ) : (
          <RocketControls
            params={effectiveRocketParams}
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
          />
        )}
      </div>

      <div className="absolute right-4 top-20 z-10 w-[460px] pointer-events-auto">
        <div className="glass-panel p-4 animate-fade-in">
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
                className="rounded-lg border border-border/40 bg-background/80 px-3 py-2 text-sm text-foreground focus:border-primary/40 focus:outline-none"
              >
                {modePacks.map((pack) => (
                  <option key={pack.id} value={pack.id}>
                    {pack.name}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-sm text-muted-foreground">{activePack.missions.length} themed missions in this pack.</p>
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
            <AnimatePresence mode="popLayout">
              {visibleMissions.map((achievement) => (
                <motion.div
                  key={achievement.id}
                  layout
                  initial={{ opacity: 0, y: 18, scale: 0.97 }}
                  animate={{
                    opacity: 1,
                    y: 0,
                    scale: achievement.phase === 'complete' ? 0.985 : 1,
                    borderColor: achievement.phase === 'complete' ? 'rgba(0, 229, 255, 0.35)' : 'rgba(148, 163, 184, 0.18)',
                    backgroundColor: achievement.phase === 'complete' ? 'rgba(0, 229, 255, 0.08)' : 'rgba(148, 163, 184, 0.08)',
                  }}
                  exit={{ opacity: 0, x: 36, scale: 0.94, height: 0, marginBottom: 0, paddingTop: 0, paddingBottom: 0 }}
                  transition={{ duration: 0.32, ease: 'easeOut' }}
                  className="rounded-xl border px-3 py-2.5"
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
                </motion.div>
              ))}
            </AnimatePresence>

            {visibleMissions.length === 0 && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-xl border border-primary/35 bg-primary/10 px-3 py-4 text-center"
              >
                <div className="text-base font-medium text-primary">All {mode === 'spacetime' ? 'spacetime' : 'rocket'} missions complete</div>
                <div className="text-base text-muted-foreground mt-1">Every mission in this queue has been cleared.</div>
              </motion.div>
            )}
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
