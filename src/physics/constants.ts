// Single source of truth for the Spacetime Lab's physical constants and unit rules.
//
// Unit rule: every velocity stored on a CelestialBody (React state, templates, saved
// scenarios) is expressed in realistic-mode units. The simulator converts it to the
// active gravity mode with `velocityScaleFor` when the body enters the simulation.

export const REAL_G = 6.674e-11; // SI gravitational constant
// Tuned so G_eff * M_sun ≈ 10 at scene scale → circular orbit speed ≈ 1 scene-unit/s at r=10.
export const REAL_GRAVITY_BOOST = 7.5e-20;
export const REALISTIC_G = REAL_G * REAL_GRAVITY_BOOST;

// Arcade mode runs the same engine with stronger gravity and a speed cap. Orbits keep
// their shape (velocities are rescaled by √scale) but play out faster, and the cap stops
// close slingshots from flinging bodies off the grid.
export const ARCADE_GRAVITY_SCALE = 4;
export const ARCADE_MAX_SPEED = 8;

export const SPEED_OF_LIGHT = 299_792_458;
export const SCHWARZSCHILD_SCENE_SCALE = 1e-8;
export const SOFTENING_SQ = 0.64; // ε²=0.64 (ε≈0.8) — avoids the r→0 singularity
export const CLOSE_APPROACH_FACTOR = 3.0;
export const MIN_SPAWN_DIST = 0.01;

export const DEFAULT_STAR_MASS = 1.989e30;
export const MASSIVE_ATTRACTOR_THRESHOLD = 1e27;
export const MIN_ORBITAL_SPEED = 0.08;
export const MAX_ORBITAL_SPEED = 3.0;

// Opt-in universe expansion: unbound bodies drift apart at this fractional rate per
// simulated second; bound systems are unaffected. The grid scale follows exp(H·t).
export const HUBBLE_RATE = 0.003;
export const MAX_UNIVERSE_SCALE = 3;

export const gravityConstant = (realisticMode: boolean) =>
  (realisticMode ? REALISTIC_G : REALISTIC_G * ARCADE_GRAVITY_SCALE);

export const velocityScaleFor = (realisticMode: boolean) =>
  (realisticMode ? 1 : Math.sqrt(ARCADE_GRAVITY_SCALE));

export const maxSpeedFor = (realisticMode: boolean) =>
  (realisticMode ? Infinity : ARCADE_MAX_SPEED);

/**
 * Circular-orbit speed (realistic units) used when placing bodies and building templates.
 * Light anchors are treated as at least MASSIVE_ATTRACTOR_THRESHOLD so placement near a
 * planet still produces a usable orbit, and the result is clamped to a playable range.
 */
export const circularOrbitSpeed = (anchorMass: number, distance: number) => {
  const normalizedDistance = Math.max(distance, 0.25);
  const effectiveMass = Math.max(anchorMass, MASSIVE_ATTRACTOR_THRESHOLD);
  const speed = Math.sqrt((REALISTIC_G * effectiveMass) / normalizedDistance);
  return Math.min(MAX_ORBITAL_SPEED, Math.max(MIN_ORBITAL_SPEED, speed));
};

/** Velocity for a circular orbit around `anchor`, in the XZ plane (realistic units). */
export const tangentialOrbitVelocity = (
  position: [number, number, number],
  anchor: [number, number, number],
  anchorMass: number,
  multiplier = 1,
): [number, number, number] => {
  const dx = position[0] - anchor[0];
  const dz = position[2] - anchor[2];
  const distance = Math.sqrt(dx * dx + dz * dz);
  if (distance < MIN_SPAWN_DIST) return [0, 0, 0];
  const speed = circularOrbitSpeed(anchorMass, distance) * multiplier;
  return [(-dz / distance) * speed, 0, (dx / distance) * speed];
};
