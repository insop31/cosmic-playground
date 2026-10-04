import { useEffect, useRef } from 'react';
import { HUBBLE_RATE, MAX_UNIVERSE_SCALE } from '@/physics/constants';
import { useSimStore } from '@/stores/simStore';
import { useSpacetimeStore } from '@/stores/spacetimeStore';

/**
 * Grid scale for the opt-in expansion: exp(H·t) over the simulated time since it was
 * switched on, so rewinding shrinks it back.
 */
export const useUniverseScale = () => {
  const enabled = useSpacetimeStore((state) => state.expansionEnabled);
  const epoch = useSpacetimeStore((state) => state.epoch);
  const simTime = useSimStore((state) => state.timeline.simTime);
  const startRef = useRef<number | null>(null);
  useEffect(() => {
    startRef.current = enabled ? useSimStore.getState().timeline.simTime : null;
  }, [enabled, epoch]);
  if (!enabled || startRef.current === null) return 1;
  return Math.min(MAX_UNIVERSE_SCALE, Math.exp(HUBBLE_RATE * Math.max(0, simTime - startRef.current)));
};

