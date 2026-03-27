import type { CelestialBody } from './SpaceScene';

export interface TemplatePreviewBody {
  x: number;
  y: number;
  radius: number;
  color: string;
}

export interface TemplatePreviewOrbit {
  radius: number;
  stroke: string;
  dashed?: boolean;
}

export interface SpacetimeTemplate {
  id: string;
  name: string;
  subtitle: string;
  description: string;
  bodyCount: number;
  preview: {
    orbits: TemplatePreviewOrbit[];
    bodies: TemplatePreviewBody[];
  };
  createBodies: () => Array<Omit<CelestialBody, 'id'>>;
}

const DEFAULT_STAR_MASS = 1.989e30;
const REAL_G = 6.674e-11;
const REAL_GRAVITY_BOOST = 7.5e-20;
const MASSIVE_ATTRACTOR_THRESHOLD = 1e27;
const MIN_ORBITAL_SPEED = 0.08;
const MAX_ORBITAL_SPEED = 3.0;

const orbitalSpeed = (anchorMass: number, radius: number, multiplier = 1) => {
  const normalizedDistance = Math.max(radius, 0.25);
  const effectiveMass = Math.max(anchorMass, MASSIVE_ATTRACTOR_THRESHOLD);
  const speed = Math.sqrt((REAL_G * effectiveMass * REAL_GRAVITY_BOOST) / normalizedDistance);
  return Math.min(MAX_ORBITAL_SPEED, Math.max(MIN_ORBITAL_SPEED, speed)) * multiplier;
};

const tangentialVelocity = (
  position: [number, number, number],
  anchor: [number, number, number],
  multiplier = 1,
  anchorMass = DEFAULT_STAR_MASS,
): [number, number, number] => {
  const dx = position[0] - anchor[0];
  const dz = position[2] - anchor[2];
  const distance = Math.max(Math.sqrt(dx * dx + dz * dz), 0.01);
  const speed = orbitalSpeed(anchorMass, distance, multiplier);
  return [(-dz / distance) * speed, 0, (dx / distance) * speed];
};

const createPlanet = ({
  name,
  position,
  mass,
  radius,
  physicalRadius,
  color,
  atmosphere = false,
  bodyClass = 'rocky',
  velocity,
}: {
  name: string;
  position: [number, number, number];
  mass: number;
  radius: number;
  physicalRadius: number;
  color: string;
  atmosphere?: boolean;
  bodyClass?: 'rocky' | 'gas' | 'ice';
  velocity: [number, number, number];
}): Omit<CelestialBody, 'id'> => ({
  name,
  type: 'planet',
  bodyClass,
  position,
  mass,
  radius,
  physicalRadius,
  color,
  atmosphere,
  velocity,
});

const createStar = ({
  name,
  position,
  mass,
  radius,
  color,
  velocity,
}: {
  name: string;
  position: [number, number, number];
  mass: number;
  radius: number;
  color: string;
  velocity: [number, number, number];
}): Omit<CelestialBody, 'id'> => ({
  name,
  type: 'star',
  bodyClass: 'star',
  position,
  mass,
  radius,
  physicalRadius: 696_340_000,
  color,
  velocity,
});

const createSmallBody = ({
  name,
  type,
  position,
  mass,
  radius,
  color,
  velocity,
}: {
  name: string;
  type: 'asteroid' | 'comet';
  position: [number, number, number];
  mass: number;
  radius: number;
  color: string;
  velocity: [number, number, number];
}): Omit<CelestialBody, 'id'> => ({
  name,
  type,
  bodyClass: type,
  position,
  mass,
  radius,
  color,
  velocity,
});

const createBlackHole = ({
  name,
  position,
  mass,
  radius,
  color,
}: {
  name: string;
  position: [number, number, number];
  mass: number;
  radius: number;
  color: string;
}): Omit<CelestialBody, 'id'> => ({
  name,
  type: 'blackhole',
  bodyClass: 'blackhole',
  position,
  mass,
  radius,
  color,
  velocity: [0, 0, 0],
  eventHorizonRadius: radius * 2.2,
});

const createBinaryPair = (
  starA: { name: string; mass: number; radius: number; color: string },
  starB: { name: string; mass: number; radius: number; color: string },
  separation: number,
) => {
  const totalMass = starA.mass + starB.mass;
  const omega = Math.sqrt((REAL_G * REAL_GRAVITY_BOOST * totalMass) / Math.pow(separation, 3));
  const starAPosition: [number, number, number] = [-(starB.mass / totalMass) * separation, 0, 0];
  const starBPosition: [number, number, number] = [(starA.mass / totalMass) * separation, 0, 0];
  const starAVelocity: [number, number, number] = [0, 0, -(Math.abs(starAPosition[0]) * omega)];
  const starBVelocity: [number, number, number] = [0, 0, Math.abs(starBPosition[0]) * omega];

  return [
    createStar({ ...starA, position: starAPosition, velocity: starAVelocity }),
    createStar({ ...starB, position: starBPosition, velocity: starBVelocity }),
  ];
};

export const SPACETIME_TEMPLATES: SpacetimeTemplate[] = [
  {
    id: 'harmonic-trio',
    name: 'Harmonic Trio',
    subtitle: 'Three-body starter',
    description: 'One bright anchor star with two planets already staged in calm, readable orbits.',
    bodyCount: 3,
    preview: {
      orbits: [
        { radius: 23, stroke: '#4cc9f0' },
        { radius: 34, stroke: '#8b5cf6' },
      ],
      bodies: [
        { x: 50, y: 50, radius: 7, color: '#ffcc00' },
        { x: 73, y: 50, radius: 4, color: '#4b84d8' },
        { x: 50, y: 16, radius: 3.2, color: '#c96b4b' },
      ],
    },
    createBodies: () => {
      const anchor: [number, number, number] = [0, 0, 0];
      return [
        createStar({ name: 'Helios', position: anchor, mass: DEFAULT_STAR_MASS, radius: 2.4, color: '#ffcc00', velocity: [0, 0, 0] }),
        createPlanet({
          name: 'Aurelia',
          position: [7.5, 0, 0],
          mass: 5.97e24,
          radius: 0.45,
          physicalRadius: 6_371_000,
          color: '#4b84d8',
          atmosphere: true,
          velocity: tangentialVelocity([7.5, 0, 0], anchor, 1.02, DEFAULT_STAR_MASS),
        }),
        createPlanet({
          name: 'Cinder',
          position: [0, 0, -11.5],
          mass: 7.1e23,
          radius: 0.32,
          physicalRadius: 3_100_000,
          color: '#c96b4b',
          atmosphere: true,
          velocity: tangentialVelocity([0, 0, -11.5], anchor, 0.98, DEFAULT_STAR_MASS),
        }),
      ];
    },
  },
  {
    id: 'binary-waltz',
    name: 'Binary Waltz',
    subtitle: 'Stable double-star dance',
    description: 'A binary pair orbits a shared center while a circumbinary world tracks the whole system.',
    bodyCount: 3,
    preview: {
      orbits: [
        { radius: 12, stroke: '#f59e0b' },
        { radius: 42, stroke: '#60a5fa' },
      ],
      bodies: [
        { x: 42, y: 50, radius: 5.2, color: '#fbbf24' },
        { x: 58, y: 50, radius: 4.8, color: '#f97316' },
        { x: 50, y: 8, radius: 3.8, color: '#93c5fd' },
      ],
    },
    createBodies: () => {
      const starA = { name: 'Solenne', mass: 1.15e30, radius: 2.1, color: '#fbbf24' };
      const starB = { name: 'Vesper', mass: 9.8e29, radius: 1.9, color: '#f97316' };
      const pair = createBinaryPair(starA, starB, 8.4);
      const totalMass = starA.mass + starB.mass;
      const planetPosition: [number, number, number] = [0, 0, -15];

      return [
        ...pair,
        createPlanet({
          name: 'Janus',
          position: planetPosition,
          mass: 6.2e24,
          radius: 0.44,
          physicalRadius: 6_150_000,
          color: '#93c5fd',
          atmosphere: true,
          velocity: tangentialVelocity(planetPosition, [0, 0, 0], 0.94, totalMass),
        }),
      ];
    },
  },
  {
    id: 'resonant-chain',
    name: 'Resonant Chain',
    subtitle: 'Multi-body single anchor',
    description: 'A bright central star with four worlds spaced into a smooth outer progression.',
    bodyCount: 5,
    preview: {
      orbits: [
        { radius: 16, stroke: '#4cc9f0' },
        { radius: 24, stroke: '#22c55e' },
        { radius: 33, stroke: '#a78bfa' },
        { radius: 42, stroke: '#f59e0b' },
      ],
      bodies: [
        { x: 50, y: 50, radius: 7, color: '#ffcc00' },
        { x: 66, y: 50, radius: 3.3, color: '#4b84d8' },
        { x: 50, y: 26, radius: 3.8, color: '#7fd1d8' },
        { x: 17, y: 50, radius: 3.4, color: '#d8c58f' },
        { x: 50, y: 8, radius: 2.8, color: '#c96b4b' },
      ],
    },
    createBodies: () => {
      const anchor: [number, number, number] = [0, 0, 0];
      return [
        createStar({ name: 'Kepler Prime', position: anchor, mass: DEFAULT_STAR_MASS, radius: 2.4, color: '#ffcc00', velocity: [0, 0, 0] }),
        createPlanet({
          name: 'Iona',
          position: [5.2, 0, 0],
          mass: 4.4e24,
          radius: 0.38,
          physicalRadius: 5_900_000,
          color: '#4b84d8',
          atmosphere: true,
          velocity: tangentialVelocity([5.2, 0, 0], anchor, 1.01, DEFAULT_STAR_MASS),
        }),
        createPlanet({
          name: 'Nysa',
          position: [0, 0, -7.8],
          mass: 8.2e24,
          radius: 0.52,
          physicalRadius: 24_622_000,
          color: '#7fd1d8',
          bodyClass: 'ice',
          atmosphere: true,
          velocity: tangentialVelocity([0, 0, -7.8], anchor, 0.99, DEFAULT_STAR_MASS),
        }),
        createPlanet({
          name: 'Pelion',
          position: [-10.8, 0, 0],
          mass: 6.8e26,
          radius: 0.82,
          physicalRadius: 58_232_000,
          color: '#d8c58f',
          bodyClass: 'gas',
          atmosphere: true,
          velocity: tangentialVelocity([-10.8, 0, 0], anchor, 0.97, DEFAULT_STAR_MASS),
        }),
        createPlanet({
          name: 'Tharsis',
          position: [0, 0, 14.2],
          mass: 7.0e23,
          radius: 0.31,
          physicalRadius: 3_389_500,
          color: '#c96b4b',
          atmosphere: true,
          velocity: tangentialVelocity([0, 0, 14.2], anchor, 0.95, DEFAULT_STAR_MASS),
        }),
      ];
    },
  },
  {
    id: 'giant-anchor',
    name: 'Giant Anchor',
    subtitle: 'Gas giant moon stack',
    description: 'A heavy gas giant sits at the center while four moons orbit it at different radii.',
    bodyCount: 5,
    preview: {
      orbits: [
        { radius: 11, stroke: '#4cc9f0' },
        { radius: 18, stroke: '#38bdf8' },
        { radius: 26, stroke: '#818cf8' },
        { radius: 34, stroke: '#facc15' },
      ],
      bodies: [
        { x: 50, y: 50, radius: 7.5, color: '#d8c58f' },
        { x: 61, y: 50, radius: 2.4, color: '#f8fafc' },
        { x: 50, y: 32, radius: 2.9, color: '#7fd1d8' },
        { x: 24, y: 50, radius: 2.6, color: '#cbd5e1' },
        { x: 50, y: 16, radius: 2.3, color: '#fde68a' },
      ],
    },
    createBodies: () => {
      const anchorMass = 1.2e28;
      const anchor: [number, number, number] = [0, 0, 0];
      return [
        createPlanet({
          name: 'Atlas',
          position: anchor,
          mass: anchorMass,
          radius: 1.15,
          physicalRadius: 69_911_000,
          color: '#d8c58f',
          bodyClass: 'gas',
          atmosphere: true,
          velocity: [0, 0, 0],
        }),
        createPlanet({
          name: 'Lyra',
          position: [3.6, 0, 0],
          mass: 5.0e22,
          radius: 0.18,
          physicalRadius: 1_560_000,
          color: '#f8fafc',
          velocity: tangentialVelocity([3.6, 0, 0], anchor, 0.98, anchorMass),
        }),
        createPlanet({
          name: 'Mira',
          position: [0, 0, -5.6],
          mass: 8.4e22,
          radius: 0.22,
          physicalRadius: 1_900_000,
          color: '#7fd1d8',
          bodyClass: 'ice',
          velocity: tangentialVelocity([0, 0, -5.6], anchor, 0.99, anchorMass),
        }),
        createPlanet({
          name: 'Rho',
          position: [-8.1, 0, 0],
          mass: 6.2e22,
          radius: 0.2,
          physicalRadius: 1_760_000,
          color: '#cbd5e1',
          velocity: tangentialVelocity([-8.1, 0, 0], anchor, 0.97, anchorMass),
        }),
        createPlanet({
          name: 'Eos',
          position: [0, 0, 10.8],
          mass: 4.1e22,
          radius: 0.17,
          physicalRadius: 1_420_000,
          color: '#fde68a',
          velocity: tangentialVelocity([0, 0, 10.8], anchor, 0.95, anchorMass),
        }),
      ];
    },
  },
  {
    id: 'black-hole-halo',
    name: 'Black Hole Halo',
    subtitle: 'Static singularity system',
    description: 'A static black hole with planets and a comet already arranged around the horizon safely.',
    bodyCount: 4,
    preview: {
      orbits: [
        { radius: 16, stroke: '#8b5cf6' },
        { radius: 27, stroke: '#60a5fa', dashed: true },
        { radius: 39, stroke: '#22d3ee' },
      ],
      bodies: [
        { x: 50, y: 50, radius: 7.2, color: '#111827' },
        { x: 66, y: 50, radius: 3.3, color: '#38bdf8' },
        { x: 50, y: 23, radius: 3.4, color: '#c084fc' },
        { x: 15, y: 50, radius: 2.4, color: '#66ddff' },
      ],
    },
    createBodies: () => {
      const anchorMass = 5e30;
      const anchor: [number, number, number] = [0, 0, 0];
      return [
        createBlackHole({ name: 'Umbra', position: anchor, mass: anchorMass, radius: 1.4, color: '#aa44ff' }),
        createPlanet({
          name: 'Perihel',
          position: [6.1, 0, 0],
          mass: 5.4e24,
          radius: 0.4,
          physicalRadius: 5_900_000,
          color: '#38bdf8',
          atmosphere: true,
          velocity: tangentialVelocity([6.1, 0, 0], anchor, 0.96, anchorMass),
        }),
        createPlanet({
          name: 'Nyx',
          position: [0, 0, -10.4],
          mass: 7.8e24,
          radius: 0.47,
          physicalRadius: 6_700_000,
          color: '#c084fc',
          bodyClass: 'ice',
          atmosphere: true,
          velocity: tangentialVelocity([0, 0, -10.4], anchor, 0.93, anchorMass),
        }),
        createSmallBody({
          name: 'Ghost Tail',
          type: 'comet',
          position: [-14.2, 0, 0],
          mass: 2e14,
          radius: 0.22,
          color: '#66ddff',
          velocity: tangentialVelocity([-14.2, 0, 0], anchor, 0.92, anchorMass),
        }),
      ];
    },
  },
  {
    id: 'trojan-garden',
    name: 'Trojan Garden',
    subtitle: 'Shared-orbit experiment',
    description: 'A gas giant leads two Trojan companions while an outer comet trails the star farther out.',
    bodyCount: 5,
    preview: {
      orbits: [
        { radius: 24, stroke: '#f59e0b' },
        { radius: 38, stroke: '#22d3ee' },
      ],
      bodies: [
        { x: 50, y: 50, radius: 7, color: '#ffcc00' },
        { x: 74, y: 50, radius: 4.2, color: '#d8c58f' },
        { x: 62, y: 29, radius: 2.3, color: '#fca5a5' },
        { x: 62, y: 71, radius: 2.3, color: '#93c5fd' },
        { x: 50, y: 12, radius: 2.2, color: '#66ddff' },
      ],
    },
    createBodies: () => {
      const anchor: [number, number, number] = [0, 0, 0];
      const giantPos: [number, number, number] = [9.4, 0, 0];
      const giantVelocity = tangentialVelocity(giantPos, anchor, 0.98, DEFAULT_STAR_MASS);
      return [
        createStar({ name: 'Aurora', position: anchor, mass: DEFAULT_STAR_MASS, radius: 2.4, color: '#ffcc00', velocity: [0, 0, 0] }),
        createPlanet({
          name: 'Titan Reach',
          position: giantPos,
          mass: 8.6e26,
          radius: 0.88,
          physicalRadius: 69_911_000,
          color: '#d8c58f',
          bodyClass: 'gas',
          atmosphere: true,
          velocity: giantVelocity,
        }),
        createSmallBody({
          name: 'L4 Bloom',
          type: 'asteroid',
          position: [4.7, 0, -8.2],
          mass: 1.3e16,
          radius: 0.24,
          color: '#fca5a5',
          velocity: giantVelocity,
        }),
        createSmallBody({
          name: 'L5 Bloom',
          type: 'asteroid',
          position: [4.7, 0, 8.2],
          mass: 1.3e16,
          radius: 0.24,
          color: '#93c5fd',
          velocity: giantVelocity,
        }),
        createSmallBody({
          name: 'Farwake',
          type: 'comet',
          position: [0, 0, -14.5],
          mass: 2.0e14,
          radius: 0.22,
          color: '#66ddff',
          velocity: tangentialVelocity([0, 0, -14.5], anchor, 0.94, DEFAULT_STAR_MASS),
        }),
      ];
    },
  },
];
