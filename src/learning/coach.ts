// Launch coach messages read from live telemetry. Returns null when nothing in the flight
// is worth pointing out, so the coach can fall back to its general tips.
import type { RocketParams, RocketState } from '@/worlds/rocket/rocketTypes';
import { orbitalElements, orbitalSpeedAt } from '../physics/rocket';

export interface CoachMessage {
  text: string;
  tone: 'info' | 'warning' | 'danger';
}

export function liveCoachMessage(params: RocketParams, state: RocketState): CoachMessage | null {
  if (state.phase !== 'launching' && state.phase !== 'coasting') return null;
  const heatPercent = Math.round(state.heat * 100);
  const last = state.events[state.events.length - 1];

  if (last?.kind === 'lightning') return { text: 'Lightning hit the rocket and the engines are out. Whatever speed it has now is all it gets.', tone: 'danger' };
  if (last?.kind === 'seal-failure') return { text: 'A frozen seal is leaking: thrust is down to 60%. Cold weather costs performance.', tone: 'danger' };
  if (heatPercent >= 75) return { text: `Heat shield at ${heatPercent}%. Too much speed in thick air: next time climb out of it before speeding up.`, tone: 'danger' };

  if (state.phase === 'launching' && state.dynamicPressure > 0 && state.dynamicPressure >= state.maxDynamicPressure * 0.98 && state.altitude > 0.5) {
    return { text: `Dynamic pressure is still rising (${state.dynamicPressure.toFixed(2)}): this is the hardest stretch for the structure, Max-Q.`, tone: 'warning' };
  }
  if (heatPercent >= 45) return { text: `Heat shield at ${heatPercent}% and climbing.`, tone: 'warning' };

  const elements = orbitalElements(params, { px: state.position[0], py: state.position[1], vx: state.velocity[0], vy: state.velocity[1] });
  if (state.phase === 'coasting' && params.stageSeparation && state.stageSeparated && state.fuel > 0) {
    const apogee = elements.energy < 0 ? elements.semiMajorAxis * (1 + elements.eccentricity) - params.planetRadius : Infinity;
    return {
      text: Number.isFinite(apogee)
        ? `Stage 1 is gone. Coasting up to altitude ${apogee.toFixed(1)}, where stage 2 will burn sideways.`
        : 'Stage 1 is gone and the rocket is already fast enough to leave.',
      tone: 'info',
    };
  }

  const r = Math.hypot(state.position[0], state.position[1] + params.planetRadius) || 1;
  const sideways = Math.abs((state.velocity[0] * (state.position[1] + params.planetRadius) - state.velocity[1] * state.position[0]) / r);
  const needed = orbitalSpeedAt(params, state.altitude);
  if (state.altitude > 5) {
    return {
      text: `Sideways speed ${sideways.toFixed(2)} of the ${needed.toFixed(2)} an orbit needs at this height (${Math.round((sideways / needed) * 100)}%).`,
      tone: 'info',
    };
  }
  return null;
}
