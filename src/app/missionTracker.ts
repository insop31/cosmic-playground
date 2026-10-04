import { SpacetimeMissionTracker } from '@/learning/spacetimeMissions';

/**
 * The one Spacetime mission tracker for the session. The store tells it about
 * placements and new runs; the simulator feeds it states and impacts; the
 * inspector tells it which bodies were looked at.
 */
export const missionTracker = new SpacetimeMissionTracker();
