/**
 * Time scheduling shared by both labs: how much simulated time each rendered
 * frame advances, and in how many steps. Warp never changes the physics step
 * itself, only how many identical steps run per frame.
 */

/** Real frame time is clamped to this first, so a hitch (tab switch, GC) doesn't fast-forward. */
export const MAX_FRAME_DELTA = 0.1;

/** Highest warp the time controls offer. */
export const MAX_WARP = 64;

/**
 * Work budget per frame for the N-body loop, in body-pairs × substeps. Each
 * substep costs O(n²), so the substep cap shrinks as systems get crowded.
 */
const SUBSTEP_WORK_BUDGET = 36_000;
/** Never fewer substeps than the original 1×–4× cap, never more than this. */
const MIN_SUBSTEP_CAP = 8;
const MAX_SUBSTEP_CAP = 256;

export const substepCap = (bodyCount: number) => {
  const pairs = Math.max(1, (bodyCount * (bodyCount - 1)) / 2);
  return Math.max(MIN_SUBSTEP_CAP, Math.min(MAX_SUBSTEP_CAP, Math.floor(SUBSTEP_WORK_BUDGET / pairs)));
};

export interface ForwardPlan {
  /** Number of fixed substeps to run this frame. */
  steps: number;
  /** Accumulator carried into the next frame. */
  carry: number;
  /** True when the step cap cut this frame short (warp is being limited). */
  limited: boolean;
  /** Simulated seconds this frame will actually cover. */
  simulated: number;
}

/**
 * Fixed-step accumulator. Simulated time owed this frame is
 * `min(delta, MAX_FRAME_DELTA) × timeScale`; it is paid in `fixedStep`
 * substeps, at most `cap` of them. Time beyond the cap is dropped rather than
 * carried, so a slow machine slows the warp instead of spiralling.
 */
export const planForwardSteps = (
  accumulator: number,
  delta: number,
  timeScale: number,
  fixedStep: number,
  cap: number,
): ForwardPlan => {
  let owed = accumulator + Math.min(delta, MAX_FRAME_DELTA) * timeScale;
  const wanted = Math.floor(owed / fixedStep + 1e-9);
  const steps = Math.min(wanted, cap);
  owed -= steps * fixedStep;
  const limited = wanted > cap;
  if (limited) owed = Math.min(owed, fixedStep);
  return { steps, carry: Math.max(0, owed), limited, simulated: steps * fixedStep };
};

/**
 * Rewind pops history entries; each entry is one fixed substep, so popping at
 * the same rate forward time was produced keeps rewind speeds honest.
 */
export const planRewindSteps = (accumulator: number, delta: number, timeScale: number, fixedStep: number) => {
  const owed = accumulator + Math.min(delta, MAX_FRAME_DELTA) * Math.abs(timeScale);
  const steps = Math.floor(owed / fixedStep + 1e-9);
  return { steps, carry: owed - steps * fixedStep };
};

/**
 * Rocket flight integrates once per frame with the frame's own dt. At warp it
 * runs `round(timeScale)` of those same steps instead of one giant step, so
 * 64× is exactly 64 ordinary frames of physics.
 */
export const planRocketSteps = (delta: number, timeScale: number) => {
  const frame = Math.min(delta, MAX_FRAME_DELTA);
  if (timeScale <= 1) return { steps: 1, dt: Math.min(delta * timeScale, MAX_FRAME_DELTA) };
  const steps = Math.max(1, Math.round(timeScale));
  return { steps, dt: (frame * timeScale) / steps };
};

/** Achieved simulation speed per lab, smoothed, for the time controls to report. */
export const simTelemetry = {
  spacetime: { achievedScale: 1, limited: false },
};

export const reportSpacetimeSpeed = (simulated: number, delta: number, limited: boolean) => {
  if (delta <= 0) return;
  const instant = simulated / Math.min(delta, MAX_FRAME_DELTA);
  const t = simTelemetry.spacetime;
  t.achievedScale += (instant - t.achievedScale) * 0.1;
  t.limited = limited;
};
