import { useEffect, useRef } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useProgressStore } from '@/stores/progressStore';
import { useEffectiveRocketParams, useRocketStore } from '@/stores/rocketStore';
import { stability, universeClock, useSpacetimeStore } from '@/stores/spacetimeStore';
import { useTimeStore } from '@/stores/timeStore';
import type { RocketState } from '@/worlds/rocket/rocketTypes';

// Universe expansion starts after this many real seconds of forward time.
const EXPANSION_DELAY_S = 600;
const EXPANSION_RATE = 0.00018;

/**
 * Background rules that watch the simulations and award objectives, plus the
 * slow universe-expansion clock. Renders nothing.
 */
const MissionWatchers = () => {
  const mode = useAppStore((state) => state.mode);
  const timeScale = useTimeStore((state) => state.timeScale);
  const isPlaying = useTimeStore((state) => state.isPlaying);
  const bodies = useSpacetimeStore((state) => state.bodies);
  const realisticMode = useSpacetimeStore((state) => state.realisticMode);
  const setUniverseScale = useSpacetimeStore((state) => state.setUniverseScale);
  const rocketParams = useRocketStore((state) => state.params);
  const outcome = useRocketStore((state) => state.flight.outcome);
  const phase = useRocketStore((state) => state.flight.phase);
  const effectiveParams = useEffectiveRocketParams();
  const unlock = useProgressStore((state) => state.unlock);
  const awardScore = useProgressStore((state) => state.awardScore);

  // ─── Universe age ticker ───
  const lastTickRef = useRef(Date.now());
  useEffect(() => {
    if (mode !== 'spacetime') return;
    const interval = setInterval(() => {
      const now = Date.now();
      const elapsed = (now - lastTickRef.current) / 1000;
      lastTickRef.current = now;
      // Only age the universe while time is moving forward
      if (isPlaying && timeScale > 0) universeClock.age += elapsed;
      setUniverseScale(1 + EXPANSION_RATE * Math.max(0, universeClock.age - EXPANSION_DELAY_S));
    }, 1000);
    return () => clearInterval(interval);
  }, [mode, isPlaying, timeScale, setUniverseScale]);

  // ─── Spacetime objectives ───
  useEffect(() => {
    if (bodies.length >= 5) unlock('system-architect');
  }, [bodies.length, unlock]);

  useEffect(() => {
    if (mode === 'spacetime' && timeScale < 0) unlock('time-bender');
  }, [mode, timeScale, unlock]);

  useEffect(() => {
    if (!realisticMode) unlock('mode-shifter');
  }, [realisticMode, unlock]);

  useEffect(() => {
    if (bodies.length >= 7 || (bodies.some((body) => body.type === 'blackhole') && bodies.some((body) => body.type === 'neutron') && bodies.length >= 5)) {
      unlock('chaos-creator');
    }
  }, [bodies, unlock]);

  useEffect(() => {
    if (mode !== 'spacetime' || !isPlaying || timeScale <= 0) return;

    const interval = setInterval(() => {
      const hasStableCandidate = bodies.length >= 4
        && bodies.some((body) => body.type === 'star')
        && bodies.filter((body) => body.type === 'planet' || body.type === 'asteroid' || body.type === 'comet').length >= 2;
      const hasBlackHoleCandidate = bodies.some((body) => body.type === 'blackhole')
        && bodies.filter((body) => body.type !== 'blackhole').length >= 2;

      stability.system = hasStableCandidate ? stability.system + 1 : 0;
      stability.blackHole = hasBlackHoleCandidate ? stability.blackHole + 1 : 0;

      if (stability.system === 12) {
        awardScore(75);
        unlock('gravity-master');
      }
      if (stability.blackHole >= 10) unlock('black-hole-survivor');
    }, 1000);

    return () => clearInterval(interval);
  }, [awardScore, bodies, isPlaying, mode, timeScale, unlock]);

  // ─── Rocket objectives (once per flight outcome) ───
  const previousOutcomeRef = useRef<RocketState['outcome']>('none');
  useEffect(() => {
    if (phase !== 'outcome') {
      previousOutcomeRef.current = outcome;
      return;
    }
    if (previousOutcomeRef.current === outcome) return;
    previousOutcomeRef.current = outcome;

    const succeeded = outcome === 'orbiting' || outcome === 'escape';
    const survived = outcome !== 'crashed' && outcome !== 'burnup';

    if (outcome === 'orbiting') {
      awardScore(80);
      unlock('first-stable-orbit');
    }
    if (outcome === 'escape') {
      awardScore(90);
      unlock('escape-velocity-achieved');
    }

    const difficultWeather =
      Math.abs(effectiveParams.crosswind) >= 20
      && effectiveParams.windShear >= 0.5
      && effectiveParams.thermalLoad >= 0.45;
    if (difficultWeather && survived) unlock('storm-runner');

    if (rocketParams.stageSeparation && succeeded) unlock('staging-specialist');

    const preciseFlight = Math.abs(rocketParams.padTilt) <= 1 && Math.abs(rocketParams.crosswind) <= 8;
    if (preciseFlight && succeeded) unlock('precision-pilot');

    const heavyLiftConfig = rocketParams.thrustForce >= 70 && rocketParams.fuelMass >= 120;
    if (heavyLiftConfig && survived) unlock('heavy-lift');

    const thickAtmosphere = rocketParams.atmosphericDensity >= 0.75 && rocketParams.atmosphericPressure >= 1.1;
    if (thickAtmosphere && survived) unlock('dense-atmosphere-run');
  }, [awardScore, effectiveParams, outcome, phase, rocketParams, unlock]);

  return null;
};

export default MissionWatchers;
