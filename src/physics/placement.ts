// Where a new body lands and how fast it starts, shared by the placement preview (ghost
// path) and the real placement so the preview always matches what happens.
import { tangentialOrbitVelocity } from './constants';

export interface PlacementNeighbour {
  position: [number, number, number];
  velocity?: [number, number, number];
  mass: number;
  radius: number;
}

/** Scene units of drag → realistic-mode speed. */
export const DRAG_TO_VELOCITY = 0.18;
/** Drags shorter than this count as a click (circular orbit). */
export const MIN_AIM_DRAG = 0.6;

export interface PlacementPlan {
  position: [number, number, number];
  velocity: [number, number, number];
  /** True when the position was pushed out to keep a safe distance from a neighbour. */
  adjusted: boolean;
}

/**
 * Keep a safe gap from every existing body (sum of radii × 2.5 + 2), then pick the start
 * velocity: the aimed velocity if the player dragged one, otherwise a circular orbit around
 * the heaviest body (moving with it) scaled by `orbitScale`.
 */
export function planPlacement(
  point: [number, number, number],
  newRadius: number,
  neighbours: PlacementNeighbour[],
  orbitScale: number,
  aimedVelocity?: [number, number, number] | null,
): PlacementPlan {
  let position: [number, number, number] = [point[0], 0, point[2]];
  let adjusted = false;
  for (const existing of neighbours) {
    const dx = position[0] - existing.position[0];
    const dz = position[2] - existing.position[2];
    const dist = Math.hypot(dx, dz);
    const minSafe = (existing.radius + newRadius) * 2.5 + 2.0;
    if (dist < minSafe) {
      const ux = dist > 1e-6 ? dx / dist : 1;
      const uz = dist > 1e-6 ? dz / dist : 0;
      position = [existing.position[0] + ux * minSafe, 0, existing.position[2] + uz * minSafe];
      adjusted = true;
    }
  }

  if (aimedVelocity) return { position, velocity: [aimedVelocity[0], 0, aimedVelocity[2]], adjusted };
  if (neighbours.length === 0) return { position, velocity: [0, 0, 0], adjusted };

  const attractor = neighbours.reduce((max, b) => (b.mass > max.mass ? b : max));
  const orbit = tangentialOrbitVelocity(position, attractor.position, attractor.mass, orbitScale);
  const anchorVelocity = attractor.velocity ?? [0, 0, 0];
  return { position, velocity: [orbit[0] + anchorVelocity[0], 0, orbit[2] + anchorVelocity[2]], adjusted };
}

/** Velocity aimed by dragging from `start` to `end` on the grid, or null for a click. */
export function aimFromDrag(start: [number, number, number], end: [number, number, number]): [number, number, number] | null {
  const dx = end[0] - start[0];
  const dz = end[2] - start[2];
  if (Math.hypot(dx, dz) < MIN_AIM_DRAG) return null;
  return [dx * DRAG_TO_VELOCITY, 0, dz * DRAG_TO_VELOCITY];
}
