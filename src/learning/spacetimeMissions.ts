// Spacetime Lab missions judged from the simulation itself: orbits that last, flybys that
// speed bodies up, predictions that come true. Fed with snapshots a few times a second.
import { REALISTIC_G, velocityScaleFor } from '../physics/constants';
import { orbitalElements } from '../physics/orbits';
import { MOTION_BOUND } from '../physics/system';
import {
  STATE_STRIDE,
  S_CLOSE,
  S_DOMINANT,
  S_MOTION,
  S_RADIUS,
  S_VX,
  S_VZ,
  S_X,
  S_Z,
  type SimSnapshot,
} from '../physics/simulation';
import type { PredictedOutcome } from '../physics/simulation';

export type SpacetimeMissionId =
  | 'gravity-master'
  | 'system-architect'
  | 'black-hole-survivor'
  | 'chaos-creator'
  | 'slingshot-expert'
  | 'kepler-check'
  | 'aimed-orbit'
  | 'collision-course';

export const STABLE_SYSTEM_SECONDS = 30;
export const SLINGSHOT_GAIN = 1.3;
const GRAVITY_MASTER_LAPS = 3;

interface ImpactLike {
  kind: string;
  bodies: [string, string];
}

export class SpacetimeMissionTracker {
  private lastSimTime = 0;
  private starSystemSince: number | null = null;
  private allBoundSince: number | null = null;
  private blackHoleSince: number | null = null;
  private flybys = new Map<string, number>();
  private aimed = new Map<string, { placedAt: number; predicted: PredictedOutcome | null }>();
  private inspected = new Map<string, Set<string>>();

  reset() {
    this.lastSimTime = 0;
    this.starSystemSince = null;
    this.allBoundSince = null;
    this.blackHoleSince = null;
    this.flybys.clear();
    this.aimed.clear();
    this.inspected.clear();
  }

  notePlacement(id: string, aimed: boolean, simTime: number, predicted: PredictedOutcome | null) {
    if (aimed) this.aimed.set(id, { placedAt: simTime, predicted });
  }

  /** Collisions break "stable system" streaks; a predicted impact that happens completes a mission. */
  noteImpacts(impacts: ImpactLike[]): SpacetimeMissionId[] {
    const unlocked: SpacetimeMissionId[] = [];
    if (impacts.length === 0) return unlocked;
    this.starSystemSince = null;
    this.allBoundSince = null;
    if (impacts.some((impact) => impact.kind === 'absorb' || impact.kind === 'tidal')) this.blackHoleSince = null;
    for (const impact of impacts) {
      for (const id of impact.bodies) {
        if (this.aimed.get(id)?.predicted === 'collision') unlocked.push('collision-course');
      }
    }
    return unlocked;
  }

  /** The inspector was opened on `id`: two bound bodies around the same parent compare Kepler's law. */
  noteInspection(id: string, snapshot: SimSnapshot): SpacetimeMissionId[] {
    const i = snapshot.ids.indexOf(id);
    if (i < 0) return [];
    const o = i * STATE_STRIDE;
    const d = snapshot.data[o + S_DOMINANT];
    if (d < 0 || snapshot.data[o + S_MOTION] !== MOTION_BOUND) return [];
    const parent = snapshot.ids[d];
    const seen = this.inspected.get(parent) ?? new Set<string>();
    seen.add(id);
    this.inspected.set(parent, seen);
    return seen.size >= 2 ? ['kepler-check'] : [];
  }

  update(snapshot: SimSnapshot, typeOf: (id: string) => string | undefined): SpacetimeMissionId[] {
    const unlocked: SpacetimeMissionId[] = [];
    const { ids, data, masses, simTime } = snapshot;
    if (simTime < this.lastSimTime) {
      // Rewound: streaks have to be earned again from here.
      this.starSystemSince = null;
      this.allBoundSince = null;
      this.blackHoleSince = null;
      this.flybys.clear();
    }
    this.lastSimTime = simTime;
    const n = ids.length;
    const types = ids.map((id) => typeOf(id) ?? '');
    const dominant = (i: number) => data[i * STATE_STRIDE + S_DOMINANT];
    // A body at the centre of its system (its strongest pull comes from something lighter)
    // is what the others orbit, so it counts as held in place rather than escaping.
    const bound = (i: number) => {
      const d = dominant(i);
      return data[i * STATE_STRIDE + S_MOTION] === MOTION_BOUND || (d >= 0 && masses[d] < masses[i]);
    };
    // Arcade gravity runs orbits faster; periods are computed in realistic units.
    const timeScale = 1 / velocityScaleFor(snapshot.realistic);

    const periodAround = (i: number, d: number) => {
      const o = i * STATE_STRIDE;
      const od = d * STATE_STRIDE;
      const el = orbitalElements(
        data[o + S_X] - data[od + S_X],
        data[o + S_Z] - data[od + S_Z],
        data[o + S_VX] - data[od + S_VX],
        data[o + S_VZ] - data[od + S_VZ],
        REALISTIC_G * (masses[i] + masses[d]),
      );
      return el.period * timeScale;
    };

    // Dense system.
    const hasBlackHole = types.includes('blackhole');
    if (n >= 7 || (hasBlackHole && types.includes('neutron') && n >= 5)) unlocked.push('chaos-creator');

    // Gravity Master: a star with two or more planets bound to it, for three laps of the outermost.
    let required = Infinity;
    for (let s = 0; s < n; s++) {
      if (types[s] !== 'star') continue;
      const planets: number[] = [];
      for (let i = 0; i < n; i++) if (types[i] === 'planet' && dominant(i) === s && bound(i)) planets.push(i);
      if (planets.length >= 2) required = Math.min(required, GRAVITY_MASTER_LAPS * Math.max(...planets.map((i) => periodAround(i, s))));
    }
    if (Number.isFinite(required)) {
      this.starSystemSince ??= simTime;
      if (simTime - this.starSystemSince >= required) unlocked.push('gravity-master');
    } else {
      this.starSystemSince = null;
    }

    // System Architect: five or more bodies, all bound, for 30 s.
    if (n >= 5 && ids.every((_, i) => bound(i))) {
      this.allBoundSince ??= simTime;
      if (simTime - this.allBoundSince >= STABLE_SYSTEM_SECONDS) unlocked.push('system-architect');
    } else {
      this.allBoundSince = null;
    }

    // Black Hole Survivor: two or more bodies bound to a black hole for 30 s.
    let aroundHole = 0;
    for (let i = 0; i < n; i++) {
      const d = dominant(i);
      if (types[i] !== 'blackhole' && d >= 0 && types[d] === 'blackhole' && bound(i)) aroundHole++;
    }
    if (aroundHole >= 2) {
      this.blackHoleSince ??= simTime;
      if (simTime - this.blackHoleSince >= STABLE_SYSTEM_SECONDS) unlocked.push('black-hole-survivor');
    } else {
      this.blackHoleSince = null;
    }

    // Slingshot: a small body leaves a close pass by a moving body (not the system's heaviest)
    // at least 30% faster, measured relative to the heaviest body. With real masses only
    // star-class partners pull hard enough; a planet flyby barely bends the path.
    let heaviest = 0;
    for (let i = 1; i < n; i++) if (masses[i] > masses[heaviest]) heaviest = i;
    const speedRelHeaviest = (i: number) => Math.hypot(
      data[i * STATE_STRIDE + S_VX] - data[heaviest * STATE_STRIDE + S_VX],
      data[i * STATE_STRIDE + S_VZ] - data[heaviest * STATE_STRIDE + S_VZ],
    );
    for (let i = 0; i < n; i++) {
      if (types[i] !== 'asteroid' && types[i] !== 'comet') continue;
      const id = ids[i];
      let partner = -1;
      if (data[i * STATE_STRIDE + S_CLOSE] === 1) {
        let best = Infinity;
        for (let j = 0; j < n; j++) {
          if (j === i) continue;
          const dist = Math.hypot(data[i * STATE_STRIDE + S_X] - data[j * STATE_STRIDE + S_X], data[i * STATE_STRIDE + S_Z] - data[j * STATE_STRIDE + S_Z]);
          const reach = (data[i * STATE_STRIDE + S_RADIUS] + data[j * STATE_STRIDE + S_RADIUS]) * 3;
          if (dist < reach && dist < best) { best = dist; partner = j; }
        }
      }
      const inFlyby = partner >= 0 && partner !== heaviest;
      if (inFlyby && !this.flybys.has(id)) {
        this.flybys.set(id, speedRelHeaviest(i));
      } else if (!inFlyby && this.flybys.has(id)) {
        const before = this.flybys.get(id)!;
        this.flybys.delete(id);
        if (before > 0 && speedRelHeaviest(i) >= before * SLINGSHOT_GAIN) unlocked.push('slingshot-expert');
      }
    }

    // Aimed Orbit: a body placed by dragging stays bound for one full lap.
    for (const [id, info] of this.aimed) {
      const i = ids.indexOf(id);
      if (i < 0) { this.aimed.delete(id); continue; }
      const d = dominant(i);
      if (d < 0 || masses[d] < masses[i] || !bound(i)) continue;
      if (simTime - info.placedAt >= periodAround(i, d)) unlocked.push('aimed-orbit');
    }

    return unlocked;
  }
}
