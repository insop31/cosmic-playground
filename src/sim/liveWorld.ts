import type { PhysicsBody } from './nbody';

/**
 * Read-only window onto the running Spacetime simulation, for code outside
 * the render loop (orbit predictor, body inspector). Written once per frame
 * by PhysicsSimulator; never mutate these bodies from outside it.
 */
export const liveWorld = {
  bodies: [] as PhysicsBody[],
  effectiveG: 0,
};
