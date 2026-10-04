import { useRef } from 'react';
import { Eye } from 'lucide-react';
import StageCanvas from '@/stage/StageCanvas';
import MissionWatchers from '@/app/MissionWatchers';
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
  const setHudHidden = useAppStore((state) => state.setHudHidden);
  const hudRef = useRef<HTMLDivElement>(null);

  useKeyboardShortcuts();
  useResponsivePanels();

  useGSAP(() => {
    if (hudRef.current) hudRef.current.inert = hudHidden; // hidden HUD must not take focus
    gsap.to(hudRef.current, { autoAlpha: hudHidden ? 0 : 1, duration: 0.2 });
  }, { dependencies: [hudHidden] });

  return (
    <div data-hud-mode={mode} className="relative h-screen w-full overflow-hidden bg-background">
      <div className="absolute inset-0">
        <StageCanvas />
      </div>
      <StasisField />
      <LabTransition />
      <MissionWatchers />

      <div ref={hudRef} className="hud-shell z-10">
        <div className="[grid-area:bar]">
          <FlightBar />
        </div>
        <div className="min-h-0 [grid-area:left]">
          <InstrumentRail />
        </div>
        <div className="flex min-w-0 justify-center [grid-area:center]">
          <ContextBanner />
        </div>
        <div className="flex min-h-0 flex-col items-end gap-3 [grid-area:right]">
          {mode === 'spacetime' && <BodyInspector />}
          <ObjectivesPanel />
        </div>
        <div className="flex min-w-0 items-end justify-center [grid-area:temporal]">
          <div className="w-full max-w-[640px]">
            <TemporalHud />
          </div>
        </div>
      </div>

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
