import type { FlightState } from '@/physics/rocket';

/**
 * The exact flight-model state of the current launch, written every frame by
 * RocketModel. The force arrows and the flight recorder read it; React state
 * holds a copy of the display values.
 */
export const liveFlight: { current: FlightState | null } = { current: null };

/** True while an engine is firing. */
export const isBurning = (flight: FlightState) =>
  !flight.engineOut && ((flight.stage === 1 && flight.fuel1 > 0) || (flight.stage === 2 && flight.stage2Lit && flight.fuel2 > 0));
