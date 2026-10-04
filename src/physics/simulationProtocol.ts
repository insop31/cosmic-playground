// Messages between the main thread and the simulation (worker or in-process fallback).
import { SimulationCore, type Prediction, type SimConfig, type SimSnapshot, type TickResult } from './simulation';
import type { CelestialBody } from './types';

export type SimCommand =
  | { type: 'load'; epoch: number; bodies: CelestialBody[]; config: SimConfig }
  | { type: 'add'; epoch: number; body: CelestialBody }
  | { type: 'remove'; epoch: number; id: string }
  | { type: 'pin'; epoch: number; id: string; pinned: boolean }
  | { type: 'config'; epoch: number; config: Partial<SimConfig> }
  | { type: 'tick'; epoch: number; dt: number }
  | { type: 'seek'; epoch: number; step: number }
  | { type: 'predict'; epoch: number; requestId: number; body: CelestialBody; seconds: number };

export interface SimStateMessage {
  type: 'state';
  epoch: number;
  result: TickResult;
  snapshot: SimSnapshot;
}

export interface SimPredictionMessage {
  type: 'prediction';
  epoch: number;
  requestId: number;
  prediction: Prediction;
}

export type SimMessage = SimStateMessage | SimPredictionMessage;

/**
 * Apply one command to a core. Commands from an older epoch are ignored; ticks, seeks
 * and loads answer with the new state.
 */
export class SimulationHost {
  private core = new SimulationCore();
  private epoch = -1;

  handle(cmd: SimCommand): SimMessage | null {
    if (cmd.type === 'load') {
      this.epoch = cmd.epoch;
      this.core.load(cmd.bodies, cmd.config);
      return this.state({ impacts: [], removed: [], restored: [], spawned: [], updated: [], stepsTaken: 0, limited: false, direction: 0 });
    }
    if (cmd.epoch !== this.epoch) return null;
    switch (cmd.type) {
      case 'add':
        this.core.add(cmd.body);
        return null;
      case 'remove':
        this.core.remove(cmd.id);
        return null;
      case 'pin':
        this.core.setPinned(cmd.id, cmd.pinned);
        return null;
      case 'config':
        if (cmd.config.realistic !== undefined) this.core.setRealistic(cmd.config.realistic);
        if (cmd.config.expansionRate !== undefined) this.core.setExpansionRate(cmd.config.expansionRate);
        return null;
      case 'tick':
        return this.state(this.core.tick(cmd.dt));
      case 'seek':
        return this.state(this.core.seek(cmd.step));
      case 'predict':
        return {
          type: 'prediction',
          epoch: this.epoch,
          requestId: cmd.requestId,
          prediction: this.core.predict(cmd.body, cmd.seconds),
        };
      default:
        return null;
    }
  }

  private state(result: TickResult): SimStateMessage {
    return { type: 'state', epoch: this.epoch, result, snapshot: this.core.snapshot() };
  }
}
