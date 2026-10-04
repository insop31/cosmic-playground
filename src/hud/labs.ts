import { Orbit, Rocket } from 'lucide-react';
import type { AppMode } from '@/lib/challengePacks';

export const LAB_META: Record<AppMode, { name: string; subject: string; icon: typeof Orbit }> = {
  spacetime: { name: 'Spacetime Lab', subject: 'Gravity and orbits', icon: Orbit },
  rocket: { name: 'Rocket Lab', subject: 'Launch and ascent', icon: Rocket },
};
