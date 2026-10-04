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
  velocity?: [number, number, number];
}
