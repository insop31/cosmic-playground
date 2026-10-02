// Two-body orbital elements in the XZ plane, used by the orbit inspector and the
// predicted-orbit line. Inputs are positions and velocities relative to the parent body.

export interface OrbitElements {
  /** Specific orbital energy ε = v²/2 − μ/r; negative means bound. */
  energy: number;
  /** Semi-major axis (Infinity for unbound orbits). */
  semiMajorAxis: number;
  eccentricity: number;
  /** Unit vector from the parent towards periapsis (x, z). */
  periapsisDirection: [number, number];
  periapsisDistance: number;
  /** Infinity for unbound orbits. */
  apoapsisDistance: number;
  /** Orbital period in simulated seconds (Infinity for unbound orbits). */
  period: number;
  /** Specific angular momentum h = r × v (sign gives the direction of travel). */
  angularMomentum: number;
  distance: number;
  speed: number;
}

export function orbitalElements(rx: number, rz: number, vx: number, vz: number, mu: number): OrbitElements {
  const r = Math.max(Math.hypot(rx, rz), 1e-9);
  const v2 = vx * vx + vz * vz;
  const energy = v2 / 2 - mu / r;
  const angularMomentum = rx * vz - rz * vx;
  const rDotV = rx * vx + rz * vz;
  const ex = ((v2 - mu / r) * rx - rDotV * vx) / mu;
  const ez = ((v2 - mu / r) * rz - rDotV * vz) / mu;
  const eccentricity = Math.hypot(ex, ez);
  const periapsisDirection: [number, number] = eccentricity > 1e-9
    ? [ex / eccentricity, ez / eccentricity]
    : [rx / r, rz / r];
  const p = (angularMomentum * angularMomentum) / mu; // semi-latus rectum
  const periapsisDistance = p / (1 + eccentricity);
  const bound = energy < 0 && eccentricity < 1;
  const semiMajorAxis = bound ? -mu / (2 * energy) : Infinity;
  return {
    energy,
    semiMajorAxis,
    eccentricity,
    periapsisDirection,
    periapsisDistance,
    apoapsisDistance: bound ? semiMajorAxis * (1 + eccentricity) : Infinity,
    period: bound ? 2 * Math.PI * Math.sqrt(semiMajorAxis ** 3 / mu) : Infinity,
    angularMomentum,
    distance: r,
    speed: Math.sqrt(v2),
  };
}

/**
 * Points (x, z) along the predicted path around a parent at (cx, cz): the full ellipse for
 * bound orbits, or the outgoing branch of the hyperbola/parabola up to `maxDistance`.
 */
export function conicPoints(el: OrbitElements, cx: number, cz: number, segments = 160, maxDistance = 150): [number, number][] {
  const p = el.periapsisDistance * (1 + el.eccentricity);
  const [ux, uz] = el.periapsisDirection;
  const travel = el.angularMomentum >= 0 ? 1 : -1;
  // Perpendicular in the direction of travel at periapsis.
  const wx = -uz * travel;
  const wz = ux * travel;
  const points: [number, number][] = [];
  let limit = Math.PI;
  if (el.eccentricity >= 1) {
    // Stop before the asymptote, or where the path leaves the grid.
    const asymptote = Math.acos(-1 / el.eccentricity);
    limit = asymptote - 1e-3;
  }
  for (let k = 0; k <= segments; k++) {
    const nu = -limit + (2 * limit * k) / segments;
    const r = p / (1 + el.eccentricity * Math.cos(nu));
    if (!Number.isFinite(r) || r <= 0 || r > maxDistance) continue;
    points.push([cx + r * (Math.cos(nu) * ux + Math.sin(nu) * wx), cz + r * (Math.cos(nu) * uz + Math.sin(nu) * wz)]);
  }
  return points;
}
