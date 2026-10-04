import { create } from 'zustand';
import type { SimSnapshot, TimelineMarker } from '@/physics/simulation';

export interface TimelineState {
  /** Current simulation step and the range of recorded history (for scrubbing). */
  step: number;
  historyStart: number;
  historyEnd: number;
  markers: TimelineMarker[];
  /** Simulated seconds since the system was loaded. */
  simTime: number;
}

export interface ConservationSample {
  time: number;
  energy: number;
  energyScale: number;
  momentumX: number;
  momentumZ: number;
  momentumScale: number;
  angularMomentum: number;
  angularMomentumScale: number;
}

const MAX_CONSERVATION_SAMPLES = 300; // 60 s at 5 samples per second
const EMPTY_TIMELINE: TimelineState = { step: 0, historyStart: 0, historyEnd: 0, markers: [], simTime: 0 };

interface SimUiState {
  timeline: TimelineState;
  conservation: ConservationSample[];
  /** Applies the latest simulation state; called a few times a second, not every frame. */
  setSnapshot: (snapshot: SimSnapshot) => void;
  clear: () => void;
}

/**
 * The parts of the Spacetime simulation the HUD shows (timeline, conservation
 * graphs). Updated at most five times a second by PhysicsSimulator; the 3D
 * scene reads the full state from liveWorld instead.
 */
export const useSimStore = create<SimUiState>()((set, get) => ({
  timeline: EMPTY_TIMELINE,
  conservation: [],
  setSnapshot: (snapshot) => {
    let samples = get().conservation;
    const last = samples[samples.length - 1];
    if (last && snapshot.simTime < last.time) {
      // Rewound: drop samples from the undone future.
      samples = samples.filter((sample) => sample.time <= snapshot.simTime);
    }
    const diag = snapshot.diagnostics;
    if (diag && (!samples.length || snapshot.simTime > samples[samples.length - 1].time)) {
      samples = [...samples, {
        time: snapshot.simTime,
        energy: diag.energy,
        energyScale: Math.abs(diag.kinetic) + Math.abs(diag.potential),
        momentumX: diag.momentumX,
        momentumZ: diag.momentumZ,
        momentumScale: diag.momentumScale,
        angularMomentum: diag.angularMomentum,
        angularMomentumScale: diag.angularMomentumScale,
      }].slice(-MAX_CONSERVATION_SAMPLES);
    }
    set({
      timeline: {
        step: snapshot.step,
        historyStart: snapshot.historyStart,
        historyEnd: snapshot.historyEnd,
        markers: snapshot.markers,
        simTime: snapshot.simTime,
      },
      conservation: samples,
    });
  },
  clear: () => set({ timeline: EMPTY_TIMELINE, conservation: [] }),
}));
