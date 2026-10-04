// Ordered steps covering rewind → warp (the spec's −4× … 1× … 64×)
export const SPEED_STEPS = [-4, -2, -1, -0.5, 0.5, 1, 2, 4, 8, 16, 32, 64];

/** The subset shown as one-click chips; the arrow keys step through all of them. */
export const SPEED_CHIPS = [-4, -1, 0.5, 1, 4, 16, 64];

/** Next speed one step toward rewind (-1) or fast-forward (+1). */
export const stepSpeed = (timeScale: number, direction: -1 | 1) => {
  const currentIdx = SPEED_STEPS.indexOf(timeScale);
  if (direction < 0) {
    return SPEED_STEPS[Math.max(0, currentIdx === -1 ? SPEED_STEPS.indexOf(-1) : currentIdx - 1)];
  }
  return SPEED_STEPS[Math.min(SPEED_STEPS.length - 1, currentIdx === -1 ? SPEED_STEPS.indexOf(1) : currentIdx + 1)];
};
