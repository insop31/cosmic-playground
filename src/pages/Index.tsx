import { useRef } from 'react';
import { Eye } from 'lucide-react';
import StageCanvas from '@/stage/StageCanvas';
import MissionWatchers from '@/app/MissionWatchers';
import { ErrorBoundary, HudFallback, StageFallback } from '@/app/ErrorBoundary';
import FlightRecorder from '@/app/FlightRecorder';
import Countdown from '@/hud/Countdown';
import BootSequence from '@/hud/BootSequence';
import MissionLog from '@/hud/MissionLog';
import FlightDirector from '@/hud/FlightDirector';
import MissionReport from '@/hud/MissionReport';
import FlightBar from '@/hud/FlightBar';
import InstrumentRail from '@/hud/InstrumentRail';
import ContextBanner from '@/hud/ContextBanner';
import ObjectivesPanel from '@/hud/ObjectivesPanel';
import BodyInspector from '@/hud/BodyInspector';
import TemporalHud from '@/hud/TemporalHud';
import { LabTransition, StasisField } from '@/hud/StageOverlays';
import { Kbd } from '@/hud/controls';
import { useKeyboardShortcuts, useResponsivePanels } from '@/hud/useKeyboardShortcuts';
import { gsap, useGSAP } from '@/motion/gsap';
import { useAppStore } from '@/stores/appStore';

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

  return (
    <div data-hud-mode={mode} className="relative h-screen w-full overflow-hidden bg-background">
      <div className="absolute inset-0">
        <ErrorBoundary fallback={(reset) => <StageFallback reset={reset} />}>
          <StageCanvas />
        </ErrorBoundary>
      </div>
      <StasisField />
      <LabTransition />
      <MissionWatchers />
      <FlightRecorder />
      <Countdown />
      <BootSequence />
      <MissionLog />

      <ErrorBoundary fallback={(reset) => <HudFallback reset={reset} />}>
        <div ref={hudRef} className="hud-shell z-10">
          <div className="[grid-area:bar]">
            <FlightBar />
          </div>
          <div className="min-h-0 [grid-area:left]">
            <InstrumentRail />
          </div>
          <div className="flex min-h-0 min-w-0 flex-col items-center gap-3 [grid-area:center]">
            <ContextBanner />
            {mode === 'rocket' && <MissionReport />}
          </div>
          <div className="flex min-h-0 flex-col items-end gap-3 [grid-area:right]">
            {mode === 'spacetime' ? <BodyInspector /> : <FlightDirector />}
            <ObjectivesPanel />
          </div>
          <div className="flex min-w-0 items-end justify-center [grid-area:temporal]">
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
