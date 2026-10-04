import { memo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, ChevronDown, Circle, Trophy } from 'lucide-react';
import type { ChallengePack } from '@/lib/challengePacks';
import { HudSelect, IconButton } from './controls';

export interface MissionView {
  id: string;
  name: string;
  description: string;
  score: number;
  phase: 'incomplete' | 'complete';
}

interface MissionTrackerProps {
  modeLabel: string;
  activePack: ChallengePack;
  packs: ChallengePack[];
  onPackChange: (packId: string) => void;
  missions: MissionView[];
  unlockedCount: number;
  experimentLabel: string;
  experimentCount: number;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

const ProgressRing = ({ value, total, size = 40 }: { value: number; total: number; size?: number }) => {
  const r = (size - 5) / 2;
  const c = 2 * Math.PI * r;
  const pct = total > 0 ? value / total : 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0 -rotate-90" aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(0 0% 100% / 0.08)" strokeWidth={3} />
      <motion.circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={pct >= 1 ? 'hsl(var(--ok))' : 'hsl(var(--primary))'}
        strokeWidth={3}
        strokeLinecap="round"
        strokeDasharray={c}
        initial={false}
        animate={{ strokeDashoffset: c * (1 - pct) }}
        transition={{ duration: 0.6, ease: [0.2, 0.8, 0.2, 1] }}
      />
    </svg>
  );
};

const MissionTracker = ({
  modeLabel,
  activePack,
  packs,
  onPackChange,
  missions,
  unlockedCount,
  experimentLabel,
  experimentCount,
  collapsed,
  onToggleCollapsed,
}: MissionTrackerProps) => {
  const total = activePack.missions.length;

  return (
    <div className="hud-panel w-full overflow-hidden">
      {/* Header — always visible */}
      <div className="flex items-center gap-3 p-3">
        <div className="relative">
          <ProgressRing value={unlockedCount} total={total} />
          <Trophy size={14} className="absolute inset-0 m-auto text-hud-dim" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="hud-label">Missions</p>
          <p className="hud-num text-[13px] text-foreground">
            {unlockedCount}<span className="text-hud-dim"> / {total} complete</span>
          </p>
        </div>
        <IconButton label={collapsed ? 'Expand missions (])' : 'Collapse missions (])'} onClick={onToggleCollapsed} size="sm">
          <ChevronDown size={15} className={`transition-transform duration-200 ease-hud ${collapsed ? '' : 'rotate-180'}`} />
        </IconButton>
      </div>

      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="grid gap-3 border-t border-white/[0.06] px-3 pb-3 pt-3">
              <div className="grid gap-1.5">
                <HudSelect
                  ariaLabel={`${modeLabel} challenge pack`}
                  value={activePack.id}
                  onChange={onPackChange}
                  className="w-full"
                  options={packs.map((pack) => ({ value: pack.id, label: pack.name, hint: `${pack.missions.length}` }))}
                />
                <p className="text-[12px] leading-snug text-hud-dim">{activePack.description}</p>
                <p className="hud-num text-[11px] text-hud-faint">
                  {experimentLabel}: <span className="text-foreground/80">{experimentCount}</span>
                </p>
              </div>

              <ul className="grid gap-1.5">
                <AnimatePresence mode="popLayout" initial={false}>
                  {missions.map((mission) => {
                    const done = mission.phase === 'complete';
                    return (
                      <motion.li
                        key={mission.id}
                        layout
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, x: 24, transition: { duration: 0.2 } }}
                        transition={{ duration: 0.26, ease: [0.2, 0.8, 0.2, 1] }}
                        className={`flex gap-2.5 rounded-md border px-2.5 py-2 transition-colors duration-300 ${
                          done ? 'border-ok/30 bg-ok/[0.07]' : 'border-white/[0.06] bg-white/[0.02]'
                        }`}
                      >
                        {done
                          ? <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-ok" />
                          : <Circle size={15} className="mt-0.5 shrink-0 text-hud-faint" />}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className={`text-[13px] font-medium ${done ? 'text-ok' : 'text-foreground'}`}>{mission.name}</span>
                            <span className="hud-num shrink-0 text-[10.5px] text-hud-faint">+{mission.score}</span>
                          </div>
                          <p className="text-[12px] leading-snug text-hud-dim">{mission.description}</p>
                        </div>
                      </motion.li>
                    );
                  })}
                </AnimatePresence>
                {missions.length === 0 && (
                  <li className="rounded-md border border-ok/30 bg-ok/[0.07] px-3 py-3 text-center">
                    <p className="text-[13px] font-medium text-ok">All {modeLabel.toLowerCase()} missions complete</p>
                    <p className="text-[12px] text-hud-dim">Every mission in this pack has been cleared.</p>
                  </li>
                )}
              </ul>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default memo(MissionTracker);
