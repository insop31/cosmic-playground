// Ordered steps covering rewind → forward
export const SPEED_STEPS = [-4, -2, -1, -0.5, 0.5, 1, 2, 4];

/** Next speed one step toward rewind (-1) or fast-forward (+1). */
export const stepSpeed = (timeScale: number, direction: -1 | 1) => {
  const currentIdx = SPEED_STEPS.indexOf(timeScale);
  if (direction < 0) {
    return SPEED_STEPS[Math.max(0, currentIdx === -1 ? SPEED_STEPS.indexOf(-1) : currentIdx - 1)];
  }
  return SPEED_STEPS[Math.min(SPEED_STEPS.length - 1, currentIdx === -1 ? SPEED_STEPS.indexOf(1) : currentIdx + 1)];
};
