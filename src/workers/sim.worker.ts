/// <reference lib="webworker" />
// Runs the Spacetime Lab simulation off the main thread so rendering stays smooth.
import { SimulationHost, type SimCommand } from '../physics/simulationProtocol';

const host = new SimulationHost();

self.onmessage = (event: MessageEvent<SimCommand>) => {
  const reply = host.handle(event.data);
  if (!reply) return;
  const { data, masses } = reply.snapshot;
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(reply, [data.buffer, masses.buffer]);
};
