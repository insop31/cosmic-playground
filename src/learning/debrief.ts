// Post-flight debrief: turns a finished flight into its likely cause and one concrete
// change to try next, with the numbers that back it up. Pure rules, no randomness.
import type { RocketParams, RocketState } from '../components/rocket/rocketTypes';
import {
  MIN_PERIAPSIS_ALTITUDE,
  THRUST_SCALE,
  escapeSpeedAt,
  orbitalElements,
  orbitalSpeedAt,
  vehicleSummary,
} from '../physics/rocket';

export interface DebriefNumber {
  label: string;
  value: string;
}

export interface Debrief {
  /** One sentence on what happened. */
  headline: string;
  /** Why it happened, most important first. */
  causes: string[];
  /** One or two specific changes to try next. */
  suggestions: string[];
  numbers: DebriefNumber[];
  success: boolean;
}

const GRAVITY_SCALE = 0.01;

/** Thrust (kN) for a lift-off thrust-to-weight of `target`. */
const thrustForTwr = (params: RocketParams, target: number) => {
  const current = vehicleSummary(params).liftoffThrustToWeight;
  return current > 0 ? (params.thrustForce * target) / current : (target * (params.dryMass + params.fuelMass) * params.gravity * GRAVITY_SCALE) / THRUST_SCALE;
};

export function buildDebrief(params: RocketParams, state: RocketState): Debrief {
  const summary = vehicleSummary(params);
  const has = (kind: string) => state.events.some((e) => e.kind === kind);
  const numbers: DebriefNumber[] = [
    { label: 'Δv budget', value: summary.deltaV.toFixed(2) },
    { label: 'Thrust ÷ weight', value: summary.liftoffThrustToWeight.toFixed(2) },
    { label: 'Peak altitude', value: state.maxAltitude.toFixed(1) },
    { label: 'Max-Q', value: state.maxDynamicPressure.toFixed(2) },
    { label: 'Heat shield', value: `${Math.round(Math.min(state.heat, 1) * 100)}%` },
  ];
  const causes: string[] = [];
  const suggestions: string[] = [];

  if (has('lightning')) causes.push('Lightning struck in the storm clouds and shut the engines down.');
  if (has('seal-failure')) causes.push(`The cold (${params.ambientTemperature.toFixed(0)} °C) made a seal leak and cut thrust to 60%.`);

  switch (state.outcome) {
    case 'crashed': {
      if (summary.liftoffThrustToWeight < 1) {
        causes.unshift(`Thrust was only ${summary.liftoffThrustToWeight.toFixed(2)}× the rocket's weight, so it could not lift off.`);
        suggestions.push(`Raise thrust to about ${Math.ceil(thrustForTwr(params, 1.4))} kN, or carry less fuel or dry mass.`);
      } else {
        const needed = escapeSpeedAt(params, 0) * 0.75;
        causes.unshift(`It only reached altitude ${state.maxAltitude.toFixed(1)}: a Δv budget of ${summary.deltaV.toFixed(2)} is too small to climb far against gravity (getting to space takes roughly ${needed.toFixed(1)} or more).`);
        if (summary.liftoffThrustToWeight < 1.3) suggestions.push('More thrust: below about 1.3× weight, most of the fuel is spent just holding the rocket up.');
        suggestions.push('Add fuel or cut dry mass: the rocket equation rewards a high fuel-to-empty mass ratio.');
      }
      break;
    }
    case 'suborbital': {
      if (!params.stageSeparation) {
        causes.unshift('A single burn from the ground cannot reach orbit: the lowest point of the path is never higher than where the engines stopped, which was inside the atmosphere.');
        suggestions.push('Turn on stage separation. Stage 2 coasts to the top of the climb and burns sideways there.');
      } else {
        causes.unshift(`Stage 2 did not add enough sideways speed: orbit at that height needs about ${orbitalSpeedAt(params, state.maxAltitude).toFixed(2)}.`);
        suggestions.push(`Give stage 2 more fuel (now ${(params.stage2FuelShare * 100).toFixed(0)}% of the propellant) or more thrust.`);
      }
      if (params.launchAngle < 3) suggestions.push('Pitch over a few degrees so some of the climb turns into sideways speed.');
      break;
    }
    case 'burnup': {
      causes.unshift(`The heat shield overloaded: heating grows with the cube of speed, and the rocket was fast while the air was still thick (Max-Q ${state.maxDynamicPressure.toFixed(2)}).`);
      if (params.launchAngle > 25) suggestions.push(`Pitch over less (now ${params.launchAngle}°) so the rocket climbs out of the thick air before it builds speed.`);
      if (params.thrustForce > 60) suggestions.push('Lower the thrust or lengthen the burn so the rocket speeds up higher, where the air is thin.');
      if (params.thermalLoad > 0.5) suggestions.push('Reduce the thermal load, or launch in calmer weather.');
      if (suggestions.length === 0) suggestions.push('Climb more steeply early on and save the speed for higher up.');
      break;
    }
    case 'escape': {
      causes.unshift(`The Δv budget of ${summary.deltaV.toFixed(2)} was more than enough: the rocket passed escape speed and left the planet.`);
      suggestions.push('Aiming for orbit instead? Use less fuel or a smaller stage 2, so it ends below escape speed.');
      break;
    }
    case 'orbiting': {
      const elements = orbitalElements(params, { px: state.position[0], py: state.position[1], vx: state.velocity[0], vy: state.velocity[1] });
      const perigee = elements.periapsisRadius - params.planetRadius;
      const apogee = elements.semiMajorAxis * (1 + elements.eccentricity) - params.planetRadius;
      numbers.push({ label: 'Lowest point', value: perigee.toFixed(1) }, { label: 'Highest point', value: apogee.toFixed(1) });
      causes.unshift(`Stage 2 burned at the top of the climb and raised the lowest point of the path to altitude ${perigee.toFixed(1)}, above the thick air (${MIN_PERIAPSIS_ALTITUDE}+).`);
      suggestions.push('Next challenge: give stage 2 more fuel and see how much it takes to escape.');
      break;
    }
    default:
      break;
  }

  const headline = {
    orbiting: 'Orbit reached.',
    escape: 'Escaped the planet.',
    suborbital: 'Went up and came back down.',
    crashed: summary.liftoffThrustToWeight < 1 ? 'Never left the pad.' : 'Fell back before reaching space.',
    burnup: 'Burned up in the atmosphere.',
    none: '',
  }[state.outcome];

  return {
    headline,
    causes,
    suggestions,
    numbers,
    success: state.outcome === 'orbiting' || state.outcome === 'escape',
  };
}
