import { Suspense, lazy, useRef } from 'react';
import { Eye } from 'lucide-react';
import MissionWatchers from '@/app/MissionWatchers';
import { ErrorBoundary, HudFallback, StageFallback } from '@/app/ErrorBoundary';
import FlightRecorder from '@/app/FlightRecorder';
import Countdown from '@/hud/Countdown';
import BootSequence from '@/hud/BootSequence';
import MissionLog from '@/hud/MissionLog';
import LabNotebook from '@/hud/LabNotebook';
import FlightDirector from '@/hud/FlightDirector';
import MissionReport from '@/hud/MissionReport';
import FlightBar from '@/hud/FlightBar';
import InstrumentRail from '@/hud/InstrumentRail';
import ContextBanner from '@/hud/ContextBanner';
import ObjectivesPanel from '@/hud/ObjectivesPanel';
import BodyInspector from '@/hud/BodyInspector';
import ConservationPanel from '@/hud/ConservationPanel';
import TemporalHud from '@/hud/TemporalHud';
import { LabTransition, StasisField } from '@/hud/StageOverlays';
import { Kbd } from '@/hud/controls';
import { useKeyboardShortcuts, useResponsivePanels } from '@/hud/useKeyboardShortcuts';
import { gsap, prefersReducedMotion, useGSAP } from '@/motion/gsap';
import { useAppStore } from '@/stores/appStore';

// The 3D stage (three.js, React Three Fiber, post-processing) loads after the HUD, so the
// page is usable quickly; the opening sequence waits for it to report ready.
const StageCanvas = lazy(() => import('@/stage/StageCanvas'));

const Index = () => {
  const mode = useAppStore((state) => state.mode);
  const hudHidden = useAppStore((state) => state.hudHidden);
  const booting = useAppStore((state) => state.booting);
  const setHudHidden = useAppStore((state) => state.setHudHidden);
  const hudRef = useRef<HTMLDivElement>(null);

  useKeyboardShortcuts();
  useResponsivePanels();

  useGSAP(() => {
    const hidden = hudHidden || booting;
    if (hudRef.current) hudRef.current.inert = hidden; // hidden HUD must not take focus
    gsap.to(hudRef.current, { autoAlpha: hidden ? 0 : 1, duration: booting ? 0 : 0.4 });
  }, { dependencies: [hudHidden, booting] });

  // Leaving the intro: zones dock in from their edges.
  const wasBooting = useRef(booting);
  useGSAP(() => {
    if (booting) {
      wasBooting.current = true;
      return;
    }
    if (!wasBooting.current || !hudRef.current || prefersReducedMotion()) return;
    wasBooting.current = false;
    const zone = (area: string) => hudRef.current!.querySelector(`[data-zone="${area}"]`);
    gsap.timeline({ defaults: { duration: 0.6, ease: 'hud' }, delay: 0.5 })
      .from(zone('bar'), { y: -24, autoAlpha: 0 })
      .from(zone('left'), { x: -24, autoAlpha: 0 }, '<0.08')
      .from(zone('right'), { x: 24, autoAlpha: 0 }, '<0.04')
      .from(zone('temporal'), { y: 24, autoAlpha: 0 }, '<0.04');
  }, { dependencies: [booting] });

  return (
    <div data-hud-mode={mode} className="relative h-screen w-full overflow-hidden bg-background">
      <div className="absolute inset-0">
        <ErrorBoundary fallback={(reset) => <StageFallback reset={reset} />}>
          <Suspense fallback={null}>
            <StageCanvas />
          </Suspense>
        </ErrorBoundary>
      </div>
      <StasisField />
      <LabTransition />
      <MissionWatchers />
      <FlightRecorder />
      <Countdown />
      <BootSequence />
      <MissionLog />
      <LabNotebook />

      <ErrorBoundary fallback={(reset) => <HudFallback reset={reset} />}>
        <div ref={hudRef} className="hud-shell z-10">
          <div data-zone="bar" className="[grid-area:bar]">
            <FlightBar />
          </div>
          <div data-zone="left" className="min-h-0 [grid-area:left]">
            <InstrumentRail />
          </div>
          <div className="flex min-h-0 min-w-0 flex-col items-center gap-3 [grid-area:center]">
            <ContextBanner />
            {mode === 'rocket' && <MissionReport />}
          </div>
          <div data-zone="right" className="flex min-h-0 flex-col items-end gap-3 [grid-area:right]">
            {mode === 'spacetime' ? <><BodyInspector /><ConservationPanel /></> : <FlightDirector />}
            <ObjectivesPanel />
          </div>
          <div data-zone="temporal" className="flex min-w-0 items-end justify-center [grid-area:temporal]">
            <div className="w-full max-w-[640px]">
              <TemporalHud />
            </div>
          </div>
        </div>
      </ErrorBoundary>

      {hudHidden && (
        <button
          type="button"
          onClick={() => setHudHidden(false)}
          className="hud-panel hud-focus absolute bottom-4 right-4 z-10 flex items-center gap-2 px-3 py-2 text-[12px] text-hud-dim transition-colors hover:text-foreground"
        >
          <Eye size={14} /> Show interface <Kbd>H</Kbd>
        </button>
      )}
    </div>
  );
};

export default Index;
