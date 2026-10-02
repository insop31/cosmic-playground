import { useEffect, useRef, useState } from 'react';
import { Settings } from 'lucide-react';
import { systemPrefersReducedMotion, type DisplaySettings, type GraphicsQuality } from '../../lib/settings';

interface SettingsMenuProps {
  settings: DisplaySettings;
  onChange: (settings: DisplaySettings) => void;
}

const QUALITY_CHOICES: { id: GraphicsQuality; label: string; hint: string }[] = [
  { id: 'low', label: 'Low', hint: 'For older laptops and Chromebooks' },
  { id: 'medium', label: 'Medium', hint: 'Balanced' },
  { id: 'high', label: 'High', hint: 'Sharpest picture' },
];

export const KEYBOARD_SHORTCUTS: [string, string][] = [
  ['Tab', 'Switch labs (click the 3D view first)'],
  ['Space', 'Pause or play'],
  ['R', 'Reset the current lab'],
  ['Esc', 'Cancel placing a body / close dialogs'],
];

/** Display settings and the keyboard shortcut list, opened from the top bar. */
const SettingsMenu = ({ settings, onChange }: SettingsMenuProps) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', close);
    };
  }, [open]);

  const reduceMotion = settings.reduceMotion ?? systemPrefersReducedMotion();

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Display settings"
        title="Display settings"
        className="press flex items-center rounded-md border border-border/40 bg-muted/10 p-1.5 text-muted-foreground hover:text-primary"
      >
        <Settings size={14} />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Display settings"
          className="absolute right-0 top-full mt-2 w-72 rounded-xl border border-border/50 bg-background/95 p-4 text-sm shadow-2xl backdrop-blur-xl z-50 animate-fade-in font-sans"
        >
          <fieldset className="mb-3">
            <legend className="text-xs uppercase tracking-widest text-muted-foreground mb-1.5">Graphics quality</legend>
            <div className="grid grid-cols-3 gap-1">
              {QUALITY_CHOICES.map((choice) => (
                <button
                  key={choice.id}
                  type="button"
                  title={choice.hint}
                  aria-pressed={settings.quality === choice.id}
                  onClick={() => onChange({ ...settings, quality: choice.id })}
                  className={`rounded-md border px-2 py-1.5 text-xs ${
                    settings.quality === choice.id ? 'border-primary/60 bg-primary/20 text-primary' : 'border-border/40 text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {choice.label}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">Lower quality draws fewer stars, a coarser grid and shorter trails. Edge smoothing changes after a reload.</p>
          </fieldset>
          <label className="flex items-center justify-between gap-3 py-1.5">
            <span>Reduce motion</span>
            <input type="checkbox" checked={reduceMotion} onChange={(e) => onChange({ ...settings, reduceMotion: e.target.checked })} />
          </label>
          <label className="flex items-center justify-between gap-3 py-1.5">
            <span>High contrast</span>
            <input type="checkbox" checked={settings.highContrast} onChange={(e) => onChange({ ...settings, highContrast: e.target.checked })} />
          </label>
          <div className="mt-3 border-t border-border/40 pt-3">
            <div className="text-xs uppercase tracking-widest text-muted-foreground mb-1.5">Keyboard shortcuts</div>
            <dl className="space-y-1 text-xs">
              {KEYBOARD_SHORTCUTS.map(([key, action]) => (
                <div key={key} className="flex gap-2">
                  <dt><kbd className="rounded border border-border/60 bg-muted/30 px-1.5 py-0.5 font-mono">{key}</kbd></dt>
                  <dd className="text-muted-foreground">{action}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      )}
    </div>
  );
};

export default SettingsMenu;
