import { dominantBodyIndex, type PhysicsBody } from './nbody';

export interface OrbitalElements {
  parentId: string | null;
  /** Distance to the parent, scene units. */
  distance: number;
  /** Speed relative to the parent, scene units per simulated second. */
  speed: number;
  /** Speed a circular orbit would need at this distance. */
  circularSpeed: number;
  /** Speed needed to escape the parent from here. */
  escapeSpeed: number;
  /** Null when the orbit is unbound (no ellipse). */
  semiMajorAxis: number | null;
  eccentricity: number;
  /** Orbital period in simulated seconds; null when unbound. */
  period: number | null;
  bound: boolean;
}

/**
 * Two-body orbital elements of `body` around its dominant neighbour (the same
 * Hill-sphere rule the simulation uses to classify bound vs escaping):
 *   μ = G(M + m),  ε = v²/2 − μ/r,  a = −μ / 2ε,
 *   e = √(1 + 2εh²/μ²),  T = 2π √(a³/μ)
 */
export const orbitalElements = (body: PhysicsBody, bodies: PhysicsBody[], G: number): OrbitalElements | null => {
  const index = bodies.indexOf(body);
  if (index < 0 || bodies.length < 2) return null;
  const parentIndex = dominantBodyIndex(index, bodies);
  if (parentIndex < 0) return null;
  const parent = bodies[parentIndex];

  const rx = body.position.x - parent.position.x;
  const rz = body.position.z - parent.position.z;
  const vx = body.velocity.x - parent.velocity.x;
  const vz = body.velocity.z - parent.velocity.z;
  const r = Math.max(Math.hypot(rx, rz), 1e-6);
  const v = Math.hypot(vx, vz);
  const mu = G * (parent.mass + body.mass);
  const energy = 0.5 * v * v - mu / r;
  const h = rx * vz - rz * vx;
  const eccentricity = Math.sqrt(Math.max(0, 1 + (2 * energy * h * h) / (mu * mu)));
  const bound = energy < 0;
  const semiMajorAxis = bound ? -mu / (2 * energy) : null;

  return {
    parentId: parent.id,
    distance: r,
    speed: v,
    circularSpeed: Math.sqrt(mu / r),
    escapeSpeed: Math.sqrt((2 * mu) / r),
    semiMajorAxis,
    eccentricity,
    period: semiMajorAxis !== null ? 2 * Math.PI * Math.sqrt(semiMajorAxis ** 3 / mu) : null,
    bound,
  };
};
