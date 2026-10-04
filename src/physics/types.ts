/** A body in the Spacetime Lab, as stored in React state, templates and saved scenarios. */
export interface CelestialBody {
  id: string;
  name?: string;
  type: string;
  bodyClass?: 'rocky' | 'gas' | 'ice' | 'star' | 'asteroid' | 'blackhole' | 'neutron' | 'comet';
  position: [number, number, number];
  mass: number;
  radius: number;
  physicalRadius?: number;
  color: string;
  atmosphere?: boolean;
  eventHorizonRadius?: number;
  /**
   * Velocity in realistic-mode units. A zero velocity means "give me a circular orbit
   * around the heaviest body" when the body enters the simulation.
   */
  velocity?: [number, number, number];
  /** Pinned bodies (black holes by choice) stay fixed in place but still pull on others. */
  pinned?: boolean;
}
