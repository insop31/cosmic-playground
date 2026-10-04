import { useEffect } from 'react';
import { liveCoachMessage } from '@/learning/coach';
import { AI_HINTS } from '@/worlds/rocket/rocketHints';
import type { FlightEventRecord, RocketState } from '@/worlds/rocket/rocketTypes';
import { applyWeatherToParams } from '@/worlds/rocket/weatherPresets';
import { SPACE_ALTITUDE, altitudeKm, liftoffTwr } from '@/worlds/rocket/units';
import { useFlightStore, type CoachLine, type Milestone } from '@/stores/flightStore';
import { useProgressStore } from '@/stores/progressStore';
import { useRocketStore } from '@/stores/rocketStore';
import { useTimeStore } from '@/stores/timeStore';
import { logLabEvent } from '@/stores/eventStore';

const SAMPLE_EVERY_S = 0.1;
/** The live coach is asked for a new remark at most this often (flight seconds). */
const COACH_EVERY_S = 2;

/** Flight-model events that mark a phase of the ascent. */
const MILESTONE_FOR: Partial<Record<FlightEventRecord['kind'], Milestone>> = {
  liftoff: 'liftoff',
  'max-q': 'maxq',
  'stage-separation': 'separation',
  burnout: 'cutoff',
};

const EVENT_TONE: Partial<Record<FlightEventRecord['kind'], CoachLine['tone']>> = {
  'max-q': 'warn',
  lightning: 'danger',
  'seal-failure': 'danger',
};

const pick = (lines: string[]) => lines[Math.floor(Math.random() * lines.length)];

/**
 * Watches the flight (outside React rendering) and records what the flight
 * director and mission report show: telemetry samples, Max-Q, peak heating,
 * milestones and coach commentary. Milestones and most commentary come from
 * the flight model's own event log; the live coach adds warnings read from the
 * telemetry. Rewinding truncates the record.
 */
const FlightRecorder = () => {
  useEffect(() => {
    let lastSampleT = -Infinity;
    let lastElapsed = 0;
    let lastCoachT = -Infinity;
    let lastCoachText = '';
    let eventsSeen = 0;

    const onFlight = (flight: RocketState, prev: RocketState) => {
      const store = useFlightStore.getState();
      const t = flight.elapsed;

      if (flight.phase === 'idle') {
        if (prev.phase !== 'idle') store.clear();
        lastSampleT = -Infinity;
        lastElapsed = 0;
        lastCoachT = -Infinity;
        lastCoachText = '';
        eventsSeen = 0;
        return;
      }

      // Fresh launch
      if (prev.phase === 'idle' && flight.phase === 'launching') {
        store.beginFlight(useProgressStore.getState().score);
        const { params: p, activeWeather: w } = useRocketStore.getState();
        store.say(0, `Ignition. Thrust is ${liftoffTwr(applyWeatherToParams(p, w)).toFixed(1)}× the vehicle's weight, so it accelerates upward.`);
        lastSampleT = -Infinity;
        eventsSeen = 0;
      }

      // Rewind: forget everything after the new time
      if (t < lastElapsed - 1e-6) {
        store.truncateAfter(t);
        lastSampleT = Math.min(lastSampleT, t);
        lastCoachT = Math.min(lastCoachT, t);
        eventsSeen = flight.events.length;
        const until = store.rewindUntil;
        if (until !== null && t <= until) {
          useTimeStore.getState().pause();
          useTimeStore.getState().setTimeScale(1);
          store.setRewindUntil(null);
        }
      }
      lastElapsed = t;

      // The flight model's own log: milestones and plain-language commentary with numbers.
      for (let i = eventsSeen; i < flight.events.length; i++) {
        const event = flight.events[i];
        const km = altitudeKm(event.altitude);
        const milestone = MILESTONE_FOR[event.kind];
        if (milestone) store.markMilestone(milestone, event.time, km);
        if (event.kind === 'stage-separation') logLabEvent('rocket', 'Stage separation');
        if (event.kind === 'stage-ignition') logLabEvent('rocket', 'Stage 2 ignition');
        if (event.kind === 'lightning') logLabEvent('rocket', 'Lightning strike', 'danger');
        if (event.kind === 'seal-failure') logLabEvent('rocket', 'Seal failure', 'danger');
        if (event.kind !== 'liftoff' && event.kind !== 'pitch-over') store.say(event.time, event.message, EVENT_TONE[event.kind] ?? 'info');
      }
      eventsSeen = flight.events.length;

      const altitude = flight.altitude;
      if (altitude >= SPACE_ALTITUDE && !store.milestones.space) {
        store.markMilestone('space', t, altitudeKm(altitude));
        store.say(t, 'Above the atmosphere: the air is under 1% of its surface density. With almost no drag, gravity alone bends the path.', 'ok');
      }

      if (flight.phase === 'outcome' && prev.phase !== 'outcome') {
        store.setReportOpen(true);
        const tone = flight.outcome === 'orbiting' || flight.outcome === 'escape' ? 'ok' : flight.outcome === 'suborbital' ? 'warn' : 'danger';
        if (flight.outcomeReason) store.say(t, flight.outcomeReason, tone);
        else {
          const hints = AI_HINTS[flight.outcome as keyof typeof AI_HINTS];
          if (hints) store.say(t, pick(hints), tone);
        }
        return;
      }

      if (flight.phase !== 'launching' && flight.phase !== 'coasting') return;

      // Live coaching from the telemetry (heating, Max-Q, how much sideways speed is missing).
      if (t - lastCoachT >= COACH_EVERY_S) {
        const { params, activeWeather } = useRocketStore.getState();
        const message = liveCoachMessage(applyWeatherToParams(params, activeWeather), flight);
        if (message && message.text !== lastCoachText && message.tone !== 'info') {
          store.say(t, message.text, message.tone === 'danger' ? 'danger' : 'warn');
          lastCoachText = message.text;
          lastCoachT = t;
        }
      }

      if (t - lastSampleT < SAMPLE_EVERY_S) return;
      lastSampleT = t;

      const altKm = altitudeKm(altitude);
      const q = flight.dynamicPressure;
      store.record({ t, altKm, alt: altitude, speed: Math.hypot(flight.velocity[0], flight.velocity[1]), q, heat: flight.heat });

      const maxQ = store.maxQ;
      if (!maxQ || q > maxQ.q) store.setMaxQ({ q, t, altKm });
      if (!store.peakHeat || flight.heat > store.peakHeat.heat) store.setPeakHeat({ heat: flight.heat, altKm });
    };

    return useRocketStore.subscribe((state, prev) => {
      if (state.flight !== prev.flight) onFlight(state.flight, prev.flight);
    });
  }, []);

  return null;
};

export default FlightRecorder;
