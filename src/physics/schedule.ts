/**
 * Time scheduling shared by both labs: how much simulated time each rendered
 * frame advances, and in how many fixed steps. Warp never changes the physics
 * step itself, only how many identical steps run per frame, so 64× is exactly
 * 64 frames' worth of ordinary 1× steps.
 */

/** Real frame time is clamped to this first, so a hitch (tab switch, GC) doesn't fast-forward. */
export const MAX_FRAME_DELTA = 0.1;

/** Highest warp the time controls offer. */
export const MAX_WARP = 64;

/**
 * Work budget per frame for the N-body loop, in body-pairs × steps. Each step
 * costs O(n²), so the step cap shrinks as systems get crowded.
 */
const STEP_WORK_BUDGET = 36_000;
/** Never fewer steps than 4× needs at 60 fps, never more than 64× needs at 30 fps. */
const MIN_STEP_CAP = 8;
const MAX_STEP_CAP = 256;

/** Most fixed steps one Spacetime tick may run for a system of `bodyCount` bodies. */
export const stepCap = (bodyCount: number) => {
  const pairs = Math.max(1, (bodyCount * (bodyCount - 1)) / 2);
  return Math.max(MIN_STEP_CAP, Math.min(MAX_STEP_CAP, Math.floor(STEP_WORK_BUDGET / pairs)));
};

export interface ForwardPlan {
  /** Number of fixed steps to run. */
  steps: number;
  /** Accumulator carried into the next tick. */
  carry: number;
  /** True when the step cap cut this tick short (warp is being limited). */
  limited: boolean;
}

/**
 * Fixed-step accumulator: `owed` seconds of simulated time are paid in
 * `fixedStep` steps, at most `cap` of them. Time beyond the cap is dropped
 * rather than carried, so a slow machine slows the warp instead of spiralling.
 * The small epsilon keeps 64 × (1/60 s) and 1 × (64/60 s) at the same count.
 */
export const planForwardSteps = (owed: number, fixedStep: number, cap: number): ForwardPlan => {
  const wanted = Math.floor(owed / fixedStep + 1e-9);
  const steps = Math.min(wanted, cap);
  let carry = owed - steps * fixedStep;
  const limited = wanted > cap;
  if (limited) carry = Math.min(carry, fixedStep);
  return { steps, carry: Math.max(0, carry), limited };
};

/** Achieved Spacetime speed, smoothed, for the time controls to report honestly. */
export const simTelemetry = {
  spacetime: { achievedScale: 1, limited: false },
};

/** Called with each new simulation state: `simulated` seconds advanced over `wall` real seconds. */
export const reportSpacetimeSpeed = (simulated: number, wall: number, limited: boolean) => {
  if (wall <= 0) return;
  const instant = simulated / Math.min(wall, MAX_FRAME_DELTA);
  const t = simTelemetry.spacetime;
  t.achievedScale += (instant - t.achievedScale) * 0.1;
  t.limited = limited;
};

/**
 * Rocket flight steps per frame. The flight model is cheap, so the cap only guards
 * against a stalled tab; 64× at 60 fps needs 64 steps, a 10× orbit replay at 64× more.
 */
export const ROCKET_STEP_CAP = 256;
