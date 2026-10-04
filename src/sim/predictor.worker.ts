/// <reference lib="webworker" />
import { predictPath, type PredictionRequest } from './predict';

self.onmessage = (event: MessageEvent<{ id: number; request: PredictionRequest }>) => {
  const { id, request } = event.data;
  const result = predictPath(request);
  (self as unknown as DedicatedWorkerGlobalScope).postMessage({ id, result }, [result.path.buffer]);
};
