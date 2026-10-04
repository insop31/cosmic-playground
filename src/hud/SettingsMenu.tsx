import { Settings2 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useAppStore, useQualityTier, type QualitySetting } from '@/stores/appStore';
import { systemPrefersReducedMotion } from '@/motion/preference';
import { HudSwitch, IconButton, Kbd } from './controls';
import { SHORTCUTS } from './shortcuts';

const QUALITY_OPTIONS: { value: QualitySetting; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

const MOTION_OPTIONS: { value: 'system' | 'reduce' | 'full'; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'reduce', label: 'Reduced' },
  { value: 'full', label: 'Full' },
];

const QUALITY_NOTE: Record<Exclude<QualitySetting, 'auto'>, string> = {
  high: 'Full resolution with glow and anti-aliasing.',
  medium: 'Slightly lower resolution; glow kept.',
  low: 'Native resolution, no glow or post-processing. Best for older or integrated graphics.',
};

/** Help and settings: graphics quality, replay the introduction, keyboard shortcuts. Opens with ?. */
const SettingsMenu = () => {
  const quality = useAppStore((state) => state.quality);
  const setQuality = useAppStore((state) => state.setQuality);
  const replayIntro = useAppStore((state) => state.replayIntro);
  const reduceMotion = useAppStore((state) => state.reduceMotion);
  const setReduceMotion = useAppStore((state) => state.setReduceMotion);
  const highContrast = useAppStore((state) => state.highContrast);
  const setHighContrast = useAppStore((state) => state.setHighContrast);
  const motion = reduceMotion === null ? 'system' : reduceMotion ? 'reduce' : 'full';
  const tier = useQualityTier();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton label="Help and settings (?)" data-shortcuts-trigger="">
          <Settings2 size={15} />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={10} className="hud-panel hud-scroll max-h-[80vh] w-80 overflow-y-auto border-0 p-3 text-foreground">
        <section className="grid gap-2">
          <p className="hud-label">Graphics quality</p>
          <div role="radiogroup" aria-label="Graphics quality" className="grid grid-cols-4 gap-0.5 rounded-[5px] bg-white/[0.03] p-[3px]">
            {QUALITY_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={quality === option.value}
                onClick={() => setQuality(option.value)}
                className={cn(
                  'hud-focus h-7 rounded-[4px] text-[12px] transition-colors',
                  quality === option.value ? 'bg-primary/15 text-primary shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.35)]' : 'text-hud-dim hover:text-foreground',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="text-[11.5px] leading-snug text-hud-dim">
            {quality === 'auto' ? `Adjusts to your device. Currently ${tier}. ` : ''}{QUALITY_NOTE[tier]}
          </p>
        </section>

        <section className="mt-3 grid gap-2 border-t border-[hsl(var(--hud-line)/0.1)] pt-3">
          <p className="hud-label">Motion</p>
          <div role="radiogroup" aria-label="Motion" className="grid grid-cols-3 gap-0.5 rounded-[5px] bg-white/[0.03] p-[3px]">
            {MOTION_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={motion === option.value}
                onClick={() => setReduceMotion(option.value === 'system' ? null : option.value === 'reduce')}
                className={cn(
                  'hud-focus h-7 rounded-[4px] text-[12px] transition-colors',
                  motion === option.value ? 'bg-primary/15 text-primary shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.35)]' : 'text-hud-dim hover:text-foreground',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="text-[11.5px] leading-snug text-hud-dim">
            Reduced turns camera flights into cuts, stops camera shake and skips interface animations.
            {motion === 'system' && ` Your system currently asks for ${systemPrefersReducedMotion() ? 'reduced' : 'full'} motion.`}
          </p>
          <HudSwitch
            label="High contrast"
            hint="Solid panels and brighter secondary text"
            checked={highContrast}
            onCheckedChange={setHighContrast}
          />
          <button
            type="button"
            onClick={replayIntro}
            className="hud-focus justify-self-start rounded-[5px] border border-[hsl(var(--hud-line)/0.16)] px-2.5 py-1 text-[12px] text-foreground/85 transition-colors hover:text-foreground"
          >
            Replay introduction
          </button>
        </section>

        <section className="mt-3 border-t border-[hsl(var(--hud-line)/0.1)] pt-3">
          <p className="hud-label mb-2">Keyboard shortcuts</p>
          <ul className="grid gap-1.5">
            {SHORTCUTS.map((shortcut) => (
              <li key={shortcut.label} className="flex items-center justify-between gap-3 text-[12.5px] text-foreground/85">
                <span>{shortcut.label}</span>
                <span className="flex shrink-0 gap-1">{shortcut.keys.map((key) => <Kbd key={key}>{key}</Kbd>)}</span>
              </li>
            ))}
          </ul>
        </section>
      </PopoverContent>
    </Popover>
  );
};

export default SettingsMenu;
