/// <reference lib="webworker" />
// Placement previews run here, so a long look-ahead never holds up the live simulation.
import { predictPath, type PredictionRequest } from '../physics/predict';

self.onmessage = (event: MessageEvent<{ id: number; request: PredictionRequest }>) => {
  const { id, request } = event.data;
  const prediction = predictPath(request);
  (self as unknown as DedicatedWorkerGlobalScope).postMessage({ id, prediction }, [prediction.points.buffer]);
};
