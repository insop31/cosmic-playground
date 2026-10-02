/// <reference lib="webworker" />
// Runs the Spacetime Lab simulation off the main thread so rendering stays smooth.
import { SimulationHost, type SimCommand } from '../physics/simulationProtocol';

const host = new SimulationHost();

self.onmessage = (event: MessageEvent<SimCommand>) => {
  const reply = host.handle(event.data);
  if (!reply) return;
  const scope = self as unknown as DedicatedWorkerGlobalScope;
  if (reply.type === 'state') {
    scope.postMessage(reply, [reply.snapshot.data.buffer, reply.snapshot.masses.buffer]);
  } else {
    scope.postMessage(reply, [reply.prediction.points.buffer]);
  }
};
