import { useCallback } from 'react';
import { useProgressStore } from '@/stores/progressStore';

/** Scrubbing back through history counts as rewinding (Time Bender). */
export const useUnlockTimeBender = () => {
  const unlock = useProgressStore((state) => state.unlock);
  return useCallback(() => unlock('time-bender'), [unlock]);
};
