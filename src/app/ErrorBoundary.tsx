import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  /** Shown instead of the children after an error; `reset` remounts them. */
  fallback: (reset: () => void, error: Error) => ReactNode;
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Contains a render error to one part of the app, so a fault in the HUD
 * doesn't take down the 3D view (or the other way round).
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Cosmic Playground: a section failed to render.', error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) return this.props.fallback(this.reset, this.state.error);
    return this.props.children;
  }
}

export const HudFallback = ({ reset }: { reset: () => void }) => (
  <div className="absolute inset-x-0 top-4 z-30 flex justify-center">
    <div role="alert" className="hud-panel flex items-center gap-3 border-danger/40 px-4 py-2.5">
      <span className="text-[13px] text-foreground">The interface hit a problem. The simulation is still running.</span>
      <button
        type="button"
        onClick={reset}
        className="hud-focus rounded-[5px] border border-primary/40 bg-primary/15 px-3 py-1 text-[12.5px] text-primary hover:bg-primary/25"
      >
        Reload interface
      </button>
    </div>
  </div>
);

export const StageFallback = ({ reset }: { reset: () => void }) => (
  <div className="flex h-full items-center justify-center bg-background p-6">
    <div role="alert" className="hud-panel max-w-md p-5 text-center">
      <h2 className="font-display text-[14px] uppercase tracking-[0.06em] text-foreground">3D view unavailable</h2>
      <p className="mt-2 text-[13px] leading-relaxed text-hud-dim">
        The 3D view could not start. This usually means WebGL is turned off or not supported. Try enabling hardware acceleration in your browser settings, or use a recent version of Chrome, Edge, Firefox or Safari.
      </p>
      <button
        type="button"
        onClick={reset}
        className="hud-focus mt-4 rounded-[5px] border border-primary/40 bg-primary/15 px-4 py-1.5 text-[12.5px] text-primary hover:bg-primary/25"
      >
        Try again
      </button>
    </div>
  </div>
);
