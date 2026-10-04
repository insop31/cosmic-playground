import { forwardRef, useId, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import * as SliderPrimitive from '@radix-ui/react-slider';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as SelectPrimitive from '@radix-ui/react-select';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';

/* ─── Info tooltip ─────────────────────────────────────────────────────────── */

export const InfoTip = ({ label, children, side = 'right' }: { label: string; children: ReactNode; side?: 'top' | 'right' | 'bottom' | 'left' }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <button
        type="button"
        className="hud-focus inline-flex h-4 w-4 items-center justify-center rounded text-hud-faint transition-colors hover:text-primary"
        aria-label={`About ${label}`}
      >
        <Info size={12} />
      </button>
    </TooltipTrigger>
    <TooltipContent side={side} sideOffset={10} className="hud-panel max-w-[280px] border-0 px-3 py-2 text-[12.5px] leading-relaxed text-foreground">
      {children}
    </TooltipContent>
  </Tooltip>
);

/* ─── Slider ───────────────────────────────────────────────────────────────── */

interface HudSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  format?: (value: number) => string;
  info?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}

export const HudSlider = ({ label, value, min, max, step, unit = '', format, info, disabled, onChange }: HudSliderProps) => {
  const id = useId();
  const display = format ? format(value) : value.toFixed(step < 1 ? (step < 0.1 ? 2 : 1) : 0);
  return (
    <div className={cn('grid gap-2', disabled && 'opacity-40')}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-[13px] text-foreground/85">
          <label htmlFor={id} className="truncate">{label}</label>
          {info && <InfoTip label={label}>{info}</InfoTip>}
        </span>
        <span className="hud-num shrink-0 text-[12px] text-primary">
          {display}
          {unit && <span className="ml-0.5 text-hud-dim">{unit}</span>}
        </span>
      </div>
      <SliderPrimitive.Root
        id={id}
        min={min}
        max={max}
        step={step}
        value={[value]}
        disabled={disabled}
        onValueChange={(next) => onChange(next[0])}
        className="relative flex h-4 w-full touch-none select-none items-center"
        aria-label={label}
      >
        <SliderPrimitive.Track className="relative h-[3px] w-full grow overflow-hidden rounded-full bg-white/10">
          <SliderPrimitive.Range className="absolute h-full rounded-full bg-primary" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb
          className="block h-3.5 w-3.5 rounded-full border-2 border-primary bg-background shadow-[0_0_0_4px_hsl(var(--primary)/0.12)] transition-[box-shadow,transform] duration-150 hover:shadow-[0_0_0_6px_hsl(var(--primary)/0.18)] focus-visible:outline-none focus-visible:shadow-[0_0_0_6px_hsl(var(--primary)/0.3)] active:scale-110 disabled:pointer-events-none"
        />
      </SliderPrimitive.Root>
    </div>
  );
};

/* ─── Switch ───────────────────────────────────────────────────────────────── */

interface HudSwitchProps {
  label: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  info?: string;
  infoLabel?: string;
  hint?: string;
}

export const HudSwitch = ({ label, checked, onCheckedChange, disabled, info, infoLabel, hint }: HudSwitchProps) => {
  const id = useId();
  return (
    <div className={cn('flex items-center justify-between gap-3', disabled && 'opacity-40')}>
      <div className="min-w-0">
        <span className="flex items-center gap-1.5 text-[13px] text-foreground/85">
          <label htmlFor={id}>{label}</label>
          {info && <InfoTip label={infoLabel ?? String(label)}>{info}</InfoTip>}
        </span>
        {hint && <p className="mt-0.5 text-[11.5px] text-hud-dim">{hint}</p>}
      </div>
      <SwitchPrimitive.Root
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
        className="hud-focus relative inline-flex h-[18px] w-8 shrink-0 cursor-pointer items-center rounded-full border border-white/10 bg-white/10 transition-colors duration-200 data-[state=checked]:border-primary/50 data-[state=checked]:bg-primary/40 disabled:cursor-not-allowed"
      >
        <SwitchPrimitive.Thumb className="block h-3 w-3 translate-x-[3px] rounded-full bg-hud-dim shadow transition-transform duration-200 ease-hud data-[state=checked]:translate-x-[15px] data-[state=checked]:bg-white" />
      </SwitchPrimitive.Root>
    </div>
  );
};

/* ─── Select ───────────────────────────────────────────────────────────────── */

interface HudSelectOption {
  value: string;
  label: string;
  hint?: string;
  swatch?: string;
}

interface HudSelectProps {
  value: string;
  options: HudSelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  className?: string;
  align?: 'start' | 'center' | 'end';
}

export const HudSelect = ({ value, options, onChange, ariaLabel, className, align = 'start' }: HudSelectProps) => {
  const current = options.find((option) => option.value === value);
  return (
    <SelectPrimitive.Root value={value} onValueChange={onChange}>
      <SelectPrimitive.Trigger
        aria-label={ariaLabel}
        className={cn(
          'hud-focus group inline-flex h-8 items-center justify-between gap-2 rounded-md border border-white/10 bg-white/[0.04] px-2.5 text-[12.5px] text-foreground transition-colors hover:border-white/20 hover:bg-white/[0.07] data-[state=open]:border-primary/50',
          className,
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          {current?.swatch && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: current.swatch }} />}
          <SelectPrimitive.Value />
        </span>
        <SelectPrimitive.Icon>
          <ChevronDown size={14} className="text-hud-dim transition-transform duration-200 group-data-[state=open]:rotate-180" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={6}
          align={align}
          className="hud-panel z-50 max-h-[320px] min-w-[var(--radix-select-trigger-width)] overflow-hidden p-1 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <SelectPrimitive.Viewport className="hud-scroll">
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                className="relative flex cursor-pointer select-none items-center gap-2 rounded-md py-1.5 pl-2 pr-7 text-[12.5px] text-foreground/85 outline-none data-[highlighted]:bg-white/[0.07] data-[highlighted]:text-foreground data-[state=checked]:text-primary"
              >
                {option.swatch && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: option.swatch }} />}
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                {option.hint && <span className="hud-num ml-auto pl-3 text-[11px] text-hud-faint">{option.hint}</span>}
                <SelectPrimitive.ItemIndicator className="absolute right-2">
                  <Check size={13} />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
};

/* ─── Segmented control ────────────────────────────────────────────────────── */

interface SegmentedOption<T extends string | number> {
  value: T;
  label: ReactNode;
  title?: string;
  tone?: 'default' | 'warn';
}

interface SegmentedProps<T extends string | number> {
  options: SegmentedOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  layoutId: string;
  size?: 'sm' | 'md';
  className?: string;
  ariaLabel: string;
}

export const Segmented = <T extends string | number>({ options, value, onChange, layoutId, size = 'md', className, ariaLabel }: SegmentedProps<T>) => (
  <div role="radiogroup" aria-label={ariaLabel} className={cn('relative flex items-center gap-0.5 rounded-lg bg-white/[0.04] p-[3px]', className)}>
    {options.map((option) => {
      const active = option.value === value;
      const warn = option.tone === 'warn';
      return (
        <button
          key={String(option.value)}
          type="button"
          role="radio"
          aria-checked={active}
          title={option.title}
          onClick={() => onChange(option.value)}
          className={cn(
            'hud-focus relative flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors duration-150',
            size === 'sm' ? 'h-6 min-w-[30px] px-1.5 text-[11px]' : 'h-8 px-3 text-[12.5px]',
            active
              ? warn ? 'text-warn' : 'text-primary'
              : 'text-hud-dim hover:text-foreground',
          )}
        >
          {active && (
            <motion.span
              layoutId={layoutId}
              className={cn(
                'absolute inset-0 rounded-md',
                warn ? 'bg-warn/15 shadow-[inset_0_0_0_1px_hsl(var(--warn)/0.35)]' : 'bg-primary/15 shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.35)]',
              )}
              transition={{ type: 'spring', stiffness: 520, damping: 38 }}
            />
          )}
          <span className="relative z-10 flex items-center gap-1.5">{option.label}</span>
        </button>
      );
    })}
  </div>
);

/* ─── Icon button ──────────────────────────────────────────────────────────── */

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  active?: boolean;
  tone?: 'default' | 'primary' | 'warn' | 'danger';
  size?: 'sm' | 'md' | 'lg';
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ label, active, tone = 'default', size = 'md', className, children, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'hud-focus inline-flex shrink-0 items-center justify-center rounded-md border transition-[color,background-color,border-color,transform] duration-150 active:scale-[0.94] disabled:pointer-events-none disabled:opacity-40',
        size === 'sm' && 'h-7 w-7',
        size === 'md' && 'h-8 w-8',
        size === 'lg' && 'h-10 w-10 rounded-lg',
        tone === 'primary'
          ? 'border-primary/40 bg-primary/15 text-primary hover:bg-primary/25'
          : active
            ? tone === 'warn'
              ? 'border-warn/40 bg-warn/15 text-warn'
              : 'border-primary/35 bg-primary/10 text-primary'
            : tone === 'danger'
              ? 'border-transparent text-hud-dim hover:border-danger/30 hover:bg-danger/10 hover:text-danger'
              : 'border-transparent text-hud-dim hover:border-white/10 hover:bg-white/[0.06] hover:text-foreground',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  ),
);
IconButton.displayName = 'IconButton';

/* ─── Collapsible section ──────────────────────────────────────────────────── */

interface HudSectionProps {
  title: string;
  icon?: ReactNode;
  aside?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}

export const HudSection = ({ title, icon, aside, defaultOpen = true, children }: HudSectionProps) => {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();
  return (
    <section className="border-t border-white/[0.06] first:border-t-0">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={contentId}
          onClick={() => setOpen((value) => !value)}
          className="hud-focus group flex flex-1 items-center gap-2 rounded py-3 text-left"
        >
          {icon && <span className="text-hud-dim transition-colors group-hover:text-primary">{icon}</span>}
          <span className="hud-label group-hover:text-foreground">{title}</span>
          <ChevronDown
            size={13}
            className={cn('ml-auto text-hud-faint transition-transform duration-200 ease-hud', !open && '-rotate-90')}
          />
        </button>
        {aside}
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={contentId}
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="pb-4">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
};

/* ─── Small pieces ─────────────────────────────────────────────────────────── */

export const Kbd = ({ children, className }: { children: ReactNode; className?: string }) => (
  <kbd className={cn('kbd', className)}>{children}</kbd>
);

export const Readout = ({
  label,
  value,
  unit,
  tone = 'default',
  className,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  tone?: 'default' | 'primary' | 'warn' | 'danger' | 'ok' | 'violet';
  className?: string;
}) => (
  <div className={cn('grid min-w-0 leading-tight', className)}>
    <span className="hud-label text-[9.5px]">{label}</span>
    <span
      className={cn(
        'hud-num truncate text-[13px] font-medium',
        tone === 'default' && 'text-foreground',
        tone === 'primary' && 'text-primary',
        tone === 'warn' && 'text-warn',
        tone === 'danger' && 'text-danger',
        tone === 'ok' && 'text-ok',
        tone === 'violet' && 'text-secondary',
      )}
    >
      {value}
      {unit && <span className="ml-0.5 text-[11px] text-hud-dim">{unit}</span>}
    </span>
  </div>
);
