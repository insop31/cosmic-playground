// Main-thread handle on the simulation. Uses a Web Worker when the browser allows it and
// falls back to running the same SimulationHost in-process otherwise (or if the worker
// fails), replaying everything since the last load so no state is lost.
import { SimulationHost, type SimCommand, type SimMessage } from './simulationProtocol';

export class SimulationClient {
  private worker: Worker | null = null;
  private local: SimulationHost | null = null;
  private replayLog: SimCommand[] = [];
  private tickInFlight = false;
  private pendingDt = 0;
  private disposed = false;

  constructor(private readonly onMessage: (message: SimMessage) => void) {
    if (typeof Worker !== 'undefined') {
      try {
        this.worker = new Worker(new URL('../workers/sim.worker.ts', import.meta.url), { type: 'module' });
        this.worker.onmessage = (event: MessageEvent<SimMessage>) => this.receive(event.data);
        this.worker.onerror = () => this.fallBackToLocal();
      } catch {
        this.worker = null;
      }
    }
    if (!this.worker) this.local = new SimulationHost();
  }

  get usesWorker() {
    return this.worker !== null;
  }

  send(cmd: SimCommand) {
    if (cmd.type === 'load') this.replayLog = [cmd];
    else if (cmd.type !== 'tick' && cmd.type !== 'seek') this.replayLog.push(cmd);
    if (cmd.type === 'load') {
      this.pendingDt = 0;
      this.tickInFlight = false;
    }
    this.dispatch(cmd);
  }

  /**
   * Advance by `dt` simulated seconds (negative rewinds). Only one tick is in flight at a
   * time; time that passes meanwhile is added to the next tick.
   */
  tick(epoch: number, dt: number) {
    this.pendingDt += dt;
    if (this.tickInFlight) return;
    const step = this.pendingDt;
    this.pendingDt = 0;
    this.tickInFlight = true;
    this.dispatch({ type: 'tick', epoch, dt: step });
  }

  private dispatch(cmd: SimCommand) {
    if (this.disposed) return;
    if (this.worker) {
      this.worker.postMessage(cmd);
      return;
    }
    const reply = this.local?.handle(cmd) ?? null;
    if (cmd.type === 'tick' && !reply) this.tickInFlight = false;
    if (reply) this.receive(reply);
  }

  private receive(message: SimMessage) {
    if (this.disposed) return;
    // Every state message answers the oldest outstanding request, so another tick may go.
    this.tickInFlight = false;
    this.onMessage(message);
  }

  private fallBackToLocal() {
    if (this.local || this.disposed) return;
    this.worker?.terminate();
    this.worker = null;
    this.local = new SimulationHost();
    this.tickInFlight = false;
    for (const cmd of this.replayLog) {
      const reply = this.local.handle(cmd);
      if (reply) this.receive(reply);
    }
  }

  dispose() {
    this.disposed = true;
    this.worker?.terminate();
    this.worker = null;
    this.local = null;
  }
}
