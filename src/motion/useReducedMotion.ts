import { useSyncExternalStore } from 'react';
import { onMotionChange, reducedMotion } from './preference';

/** Reduced motion as React state: re-renders when the system setting or the override changes. */
export const useReducedMotion = () => useSyncExternalStore(onMotionChange, reducedMotion, () => false);
