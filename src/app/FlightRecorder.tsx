import { useEffect } from 'react';
import { applyWeatherToParams } from '@/worlds/rocket/weatherPresets';
import { AI_HINTS } from '@/worlds/rocket/rocketHints';
import type { RocketState } from '@/worlds/rocket/rocketTypes';
import { ascentForces, liftoffTwr } from '@/sim/rocket';
import { SPACE_ALTITUDE_UNITS, altitudeKm } from '@/sim/units';
import { useFlightStore } from '@/stores/flightStore';
import { useProgressStore } from '@/stores/progressStore';
import { useRocketStore } from '@/stores/rocketStore';
import { useTimeStore } from '@/stores/timeStore';
import { logLabEvent } from '@/stores/eventStore';

const SAMPLE_EVERY_S = 0.1;
/** Max-Q is called once q has fallen this far below its peak. */
const MAX_Q_DROP = 0.92;
const MIN_MEANINGFUL_Q = 0.002;

const pick = (lines: string[]) => lines[Math.floor(Math.random() * lines.length)];

/**
 * Watches the flight (outside React rendering) and records what the flight
 * director and mission report show: telemetry samples, Max-Q, peak heating,
 * milestones and coach commentary. Rewinding truncates the record.
 */
const FlightRecorder = () => {
  useEffect(() => {
    let lastSampleT = -Infinity;
    let lastElapsed = 0;

    const onFlight = (flight: RocketState, prev: RocketState) => {
      const store = useFlightStore.getState();
      const t = flight.elapsed;

      if (flight.phase === 'idle') {
        if (prev.phase !== 'idle') store.clear();
        lastSampleT = -Infinity;
        lastElapsed = 0;
        return;
      }

      // Fresh launch
      if (prev.phase === 'idle' && flight.phase === 'launching') {
        store.beginFlight(useProgressStore.getState().score);
        store.markMilestone('liftoff', 0, 0);
        const { params: p, activeWeather: w } = useRocketStore.getState();
        store.say(0, `Liftoff. Thrust is ${liftoffTwr(applyWeatherToParams(p, w)).toFixed(1)}× the vehicle's weight, so it accelerates upward.`);
        lastSampleT = -Infinity;
      }

      // Rewind: forget everything after the new time
      if (t < lastElapsed - 1e-6) {
        store.truncateAfter(t);
        lastSampleT = Math.min(lastSampleT, t);
        const until = store.rewindUntil;
        if (until !== null && t <= until) {
          useTimeStore.getState().pause();
          useTimeStore.getState().setTimeScale(1);
          store.setRewindUntil(null);
        }
      }
      lastElapsed = t;

      const { params, activeWeather } = useRocketStore.getState();
      const effective = applyWeatherToParams(params, activeWeather);
      const [px, py] = flight.position;
      const altKm = altitudeKm(py);

      // Milestones that come from phase changes
      if (prev.phase === 'launching' && flight.phase === 'coasting') {
        store.markMilestone('cutoff', t, altKm);
        store.say(t, 'Engine cutoff. The vehicle now coasts; only gravity and drag act on it.');
        if (params.stageSeparation) {
          store.markMilestone('separation', t, altKm);
          store.say(t, 'Stage separation. The spent first stage falls away.');
          logLabEvent('rocket', 'Stage separation');
        }
      }

      if (py >= SPACE_ALTITUDE_UNITS && !store.milestones.space) {
        store.markMilestone('space', t, altKm);
        store.say(t, 'Above the atmosphere. With no air there is no drag; gravity alone bends the path.', 'ok');
      }

      if (flight.phase === 'outcome' && prev.phase !== 'outcome') {
        store.setReportOpen(true);
        const tone = flight.outcome === 'orbiting' || flight.outcome === 'escape' ? 'ok' : flight.outcome === 'suborbital' ? 'warn' : 'danger';
        const hints = AI_HINTS[flight.outcome as keyof typeof AI_HINTS];
        if (hints) store.say(t, pick(hints), tone);
        return;
      }

      if (flight.phase !== 'launching' && flight.phase !== 'coasting') return;
      if (t - lastSampleT < SAMPLE_EVERY_S) return;
      lastSampleT = t;

      const forces = ascentForces(
        { px, py, vx: flight.velocity[0], vy: flight.velocity[1], fuel: flight.fuel, elapsed: t, maxAltitude: flight.maxAltitude },
        effective,
        flight.phase === 'launching',
      );
      const heat = Math.max(0, forces.thermalPenalty - 1);
      store.record({ t, altKm, speed: Math.hypot(flight.velocity[0], flight.velocity[1]), q: forces.dynamicPressure, heat });

      const maxQ = store.maxQ;
      if (!maxQ || forces.dynamicPressure > maxQ.q) {
        store.setMaxQ({ q: forces.dynamicPressure, t, altKm });
      } else if (!store.milestones.maxq && maxQ.q > MIN_MEANINGFUL_Q && forces.dynamicPressure < maxQ.q * MAX_Q_DROP) {
        store.markMilestone('maxq', maxQ.t, maxQ.altKm);
        store.say(t, `Max-Q passed at ${maxQ.altKm.toFixed(0)} km: the moment of peak aerodynamic pressure, q = ½ρv². Air is thinning faster than speed is rising.`, 'warn');
      }
      if (!store.peakHeat || heat > store.peakHeat.heat) store.setPeakHeat({ heat, altKm });
    };

    return useRocketStore.subscribe((state, prev) => {
      if (state.flight !== prev.flight) onFlight(state.flight, prev.flight);
    });
  }, []);

  return null;
};

export default FlightRecorder;
