import { useEffect, useRef, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import type { AppMode } from '@/lib/challengePacks';
import { gsap, prefersReducedMotion, SplitText, useGSAP } from '@/motion/gsap';
import { useAppStore } from '@/stores/appStore';
import { Kbd } from './controls';
import { LAB_META } from './labs';

const LOG_LINES: { key: 'stage' | 'physics' | 'mesh'; text: string }[] = [
  { key: 'stage', text: 'Initializing engine' },
  { key: 'physics', text: 'Integrating N-body solver (velocity Verlet)' },
  { key: 'mesh', text: 'Loading relativistic mesh' },
];

const LAB_COPY: Record<AppMode, string> = {
  spacetime: 'Place stars and planets on a sheet that bends with mass, aim their launch, and predict their orbits.',
  rocket: 'Configure a launch vehicle and fly it through the atmosphere to orbit, or watch why it doesn’t make it.',
};

/**
 * Opening sequence: the live Spacetime world orbits in the background while
 * the engine reports real start-up milestones, then the visitor picks a lab.
 * Shown on the first visit (and when replayed from the shortcuts menu).
 */
const BootSequence = () => {
  const booting = useAppStore((state) => state.booting);
  const readiness = useAppStore((state) => state.readiness);
  const finishBoot = useAppStore((state) => state.finishBoot);
  const rootRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const cardsRef = useRef<HTMLDivElement>(null);
  const [leaving, setLeaving] = useState(false);
  const ready = LOG_LINES.every((line) => readiness[line.key] !== undefined);

  // Wordmark reveal
  useGSAP(() => {
    if (!booting || !titleRef.current || prefersReducedMotion()) return;
    const split = SplitText.create(titleRef.current, { type: 'chars' });
    gsap.from(split.chars, { autoAlpha: 0, y: 18, duration: 0.8, ease: 'expo.out', stagger: 0.035, delay: 0.2 });
    return () => split.revert();
  }, { dependencies: [booting], scope: rootRef });

  // Lab cards rise once the engine is up
  useGSAP(() => {
    if (!booting || !ready || !cardsRef.current || prefersReducedMotion()) return;
    gsap.from(cardsRef.current.children, { autoAlpha: 0, y: 16, duration: 0.6, ease: 'back.out(1.4)', stagger: 0.12, delay: 0.3 });
  }, { dependencies: [booting, ready], scope: rootRef });

  const enter = (mode: AppMode) => {
    if (leaving) return;
    setLeaving(true);
    gsap.to(rootRef.current, {
      autoAlpha: 0,
      duration: prefersReducedMotion() ? 0 : 0.6,
      ease: 'power2.inOut',
      onComplete: () => {
        setLeaving(false);
        finishBoot(mode);
      },
    });
  };

  useEffect(() => {
    if (!booting) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === '1' || event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); enter('spacetime'); }
      if (event.key === '2') { event.preventDefault(); event.stopPropagation(); enter('rocket'); }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); enter(useAppStore.getState().mode); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  useEffect(() => {
    if (booting && rootRef.current) gsap.set(rootRef.current, { autoAlpha: 1 });
  }, [booting]);

  if (!booting) return null;

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="boot-title"
      className="absolute inset-0 z-40 flex flex-col justify-between bg-[radial-gradient(ellipse_at_50%_40%,hsl(var(--background)/0.35),hsl(var(--background)/0.9)_70%)] px-6 py-6 sm:px-10"
    >
      <div className="flex items-center justify-between">
        <img src="/logo-mark.png" alt="" className="h-10 w-10" />
        <button type="button" onClick={() => enter(useAppStore.getState().mode)} className="hud-focus rounded-[5px] px-2 py-1 text-[12px] text-hud-dim hover:text-foreground">
          Skip intro <Kbd className="ml-1">Esc</Kbd>
        </button>
      </div>

      <div className="mx-auto grid w-full max-w-5xl justify-items-center gap-4 text-center">
        <h1 id="boot-title" ref={titleRef} className="font-display text-[clamp(30px,6vw,64px)] leading-[1.05] tracking-[0.06em] text-foreground">
          COSMIC <span className="text-primary">PLAYGROUND</span>
        </h1>
        <p className="max-w-[46ch] text-[15px] leading-relaxed text-foreground/75">
          An interactive lab for gravity, orbits and rocket flight.
        </p>

        <div ref={cardsRef} className={`mt-6 grid w-full max-w-3xl gap-4 sm:grid-cols-2 ${ready ? '' : 'invisible'}`}>
          {(['spacetime', 'rocket'] as const).map((mode, index) => {
            const { name, subject, icon: Icon } = LAB_META[mode];
            return (
              <button
                key={mode}
                type="button"
                onClick={() => enter(mode)}
                className="hud-panel hud-focus group grid gap-2 p-5 text-left transition-colors hover:border-primary/50"
              >
                <span className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-primary"><Icon size={18} /><span className="hud-label text-primary/80">{subject}</span></span>
                  <Kbd>{index + 1}</Kbd>
                </span>
                <span className="font-display text-[16px] uppercase tracking-[0.06em] text-foreground">{name}</span>
                <span className="text-[13px] leading-relaxed text-hud-dim">{LAB_COPY[mode]}</span>
                <span className="mt-1 flex items-center gap-1 text-[12.5px] text-primary opacity-80 transition-opacity group-hover:opacity-100">
                  Enter <ArrowRight size={13} />
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <ol className="font-mono text-[11.5px] leading-[1.9] text-hud-dim" aria-label="Start-up progress">
        {LOG_LINES.map((line) => {
          const at = readiness[line.key];
          return (
            <li key={line.key} className="flex gap-3">
              <span>&gt;&gt; {line.text}</span>
              <span className="text-hud-faint">{'.'.repeat(Math.max(2, 44 - line.text.length))}</span>
              {at !== undefined ? <span className="text-ok">DONE · {at} ms</span> : <span className="animate-pulse-dot text-warn">WAIT</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
};

export default BootSequence;
