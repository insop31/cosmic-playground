import { useEffect, useRef } from 'react';
import { buildDebrief, peakAltitude } from '@/learning/debrief';
import { vehicleSummary } from '@/physics/rocket';
import { useAppStore } from '@/stores/appStore';
import { logLabEvent, type EventTone } from '@/stores/eventStore';
import { useProgressStore } from '@/stores/progressStore';
import { useEffectiveRocketParams, useRocketStore } from '@/stores/rocketStore';
import { useSpacetimeStore } from '@/stores/spacetimeStore';
import { useTimeStore } from '@/stores/timeStore';
import type { RocketState } from '@/worlds/rocket/rocketTypes';
import { WEATHER_PRESETS } from '@/worlds/rocket/weatherPresets';

const PHASE_EVENT: Partial<Record<RocketState['phase'], string>> = {
  launching: 'Liftoff',
};

const OUTCOME_EVENT: Partial<Record<RocketState['outcome'], [string, EventTone]>> = {
  orbiting: ['Stable orbit achieved', 'ok'],
  escape: ['Escape velocity reached', 'ok'],
  suborbital: ['Fell back to the surface', 'warn'],
  crashed: ['Impact with the surface', 'danger'],
  burnup: ['Burn-up during ascent', 'danger'],
};

const FAILURE_OUTCOMES = new Set<RocketState['outcome']>(['crashed', 'suborbital', 'burnup']);
const PREDICTIONS_FOR_FORECASTER = 3;

/**
 * Background rules that award objectives from what the labs actually do. Spacetime
 * objectives that depend on orbits, flybys and impacts are judged inside the simulator
 * (src/app/missionTracker.ts); this handles the rest. Renders nothing.
 */
const MissionWatchers = () => {
  const mode = useAppStore((state) => state.mode);
  const timeScale = useTimeStore((state) => state.timeScale);
  const isPlaying = useTimeStore((state) => state.isPlaying);
  const realisticMode = useSpacetimeStore((state) => state.realisticMode);
  const flight = useRocketStore((state) => state.flight);
  const effectiveParams = useEffectiveRocketParams();
  const unlock = useProgressStore((state) => state.unlock);
  const awardScore = useProgressStore((state) => state.awardScore);

  // ─── Spacetime objectives that come from the controls ───
  useEffect(() => {
    if (mode === 'spacetime' && isPlaying && timeScale < 0) unlock('time-bender');
  }, [isPlaying, mode, timeScale, unlock]);

  useEffect(() => {
    if (!realisticMode) unlock('mode-shifter');
  }, [realisticMode, unlock]);

  // ─── Rocket flight events for the event ribbon ───
  const { phase, outcome } = flight;
  const loggedPhaseRef = useRef<RocketState['phase']>('idle');
  useEffect(() => {
    if (phase === loggedPhaseRef.current) return;
    const previous = loggedPhaseRef.current;
    loggedPhaseRef.current = phase;
    if (phase === 'outcome') {
      const entry = OUTCOME_EVENT[outcome];
      if (entry) logLabEvent('rocket', entry[0], entry[1]);
    } else if (PHASE_EVENT[phase] && previous === 'idle') {
      logLabEvent('rocket', PHASE_EVENT[phase]!);
    }
  }, [outcome, phase]);

  // ─── Rocket objectives, prediction and notebook: once per launch ───
  // Keyed by the launch's seed, so replaying the ending after a rewind doesn't count twice.
  const recordedLaunchRef = useRef<number | null>(null);
  useEffect(() => {
    if (flight.phase !== 'outcome' || flight.outcome === 'none') return;
    if (recordedLaunchRef.current === flight.seed) return;
    recordedLaunchRef.current = flight.seed;

    const rocket = useRocketStore.getState();
    const result = flight.outcome;
    const flown = effectiveParams; // judged on the conditions actually flown (settings + weather)

    // Lab notebook: the run, its cause and whether the prediction held.
    const debrief = buildDebrief(flown, flight);
    rocket.recordNotebookEntry({
      outcome: result,
      prediction: rocket.prediction,
      params: flown,
      weather: Array.from(rocket.activeWeather, (id) => WEATHER_PRESETS[id].name),
      metrics: {
        deltaV: vehicleSummary(flown).deltaV,
        peakAltitude: peakAltitude(flown, flight),
        maxQ: flight.maxDynamicPressure,
        heat: flight.heat,
        flightTime: flight.elapsed,
      },
      cause: debrief.causes[0] ?? debrief.headline,
    });

    // Predict First
    if (rocket.prediction && rocket.prediction === result) {
      awardScore(25);
      if (rocket.countCorrectPrediction() >= PREDICTIONS_FOR_FORECASTER) unlock('forecaster');
      if (FAILURE_OUTCOMES.has(result)) unlock('failure-analyst');
      if (result === 'orbiting') unlock('orbit-call');
    }

    const reachedSpace = result === 'orbiting' || result === 'escape';
    const survived = result !== 'crashed' && result !== 'burnup';

    if (result === 'orbiting') {
      awardScore(80);
      unlock('first-stable-orbit');
    }
    if (result === 'escape') {
      awardScore(90);
      unlock('escape-velocity-achieved');
    }

    const difficultWeather = Math.abs(flown.crosswind) >= 20 && flown.windShear >= 0.5 && flown.thermalLoad >= 0.45;
    if (difficultWeather && survived) unlock('storm-runner');
    if (flown.stageSeparation && reachedSpace) unlock('staging-specialist');
    if (Math.abs(flown.padTilt) <= 1 && Math.abs(flown.crosswind) <= 8 && reachedSpace) unlock('precision-pilot');
    if (flown.thrustForce >= 70 && flown.fuelMass >= 120 && reachedSpace) unlock('heavy-lift');
    if (flown.atmosphericDensity >= 0.75 && flown.atmosphericPressure >= 1.1 && reachedSpace) unlock('dense-atmosphere-run');
  }, [awardScore, effectiveParams, flight, unlock]);

  return null;
};

export default MissionWatchers;
