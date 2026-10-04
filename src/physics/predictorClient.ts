import { predictPath, type Prediction, type PredictionRequest } from './predict';

/**
 * Latest-wins front end for the prediction worker: while one prediction runs,
 * only the newest request waits; older ones are dropped. Falls back to the
 * main thread where workers are unavailable (tests, old browsers).
 */
type Listener = (prediction: Prediction) => void;

let worker: Worker | null = null;
let busy = false;
let queued: PredictionRequest | null = null;
let nextId = 1;
let listener: Listener | null = null;

const getWorker = () => {
  if (worker || typeof Worker === 'undefined') return worker;
  try {
    worker = new Worker(new URL('../workers/predict.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<{ id: number; prediction: Prediction }>) => {
      busy = false;
      listener?.(event.data.prediction);
      flush();
    };
    worker.onerror = () => {
      worker?.terminate();
      worker = null;
      busy = false;
    };
  } catch {
    worker = null;
  }
  return worker;
};

const flush = () => {
  if (busy || !queued) return;
  const request = queued;
  queued = null;
  const w = getWorker();
  if (w) {
    busy = true;
    w.postMessage({ id: nextId++, request });
  } else {
    listener?.(predictPath(request));
  }
};

export const onPrediction = (fn: Listener | null) => {
  listener = fn;
};

export const requestPrediction = (request: PredictionRequest) => {
  queued = request;
  flush();
};

export const cancelPredictions = () => {
  queued = null;
};
