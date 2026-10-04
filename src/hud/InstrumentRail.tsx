import { memo, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { CloudSun, FolderOpen, LayoutTemplate, Rocket, Shapes, Target, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { gsap, useGSAP } from '@/motion/gsap';
import { useAppStore, type LibraryTab } from '@/stores/appStore';
import { useRocketStore } from '@/stores/rocketStore';
import { useFlightStore, type RocketStep } from '@/stores/flightStore';
import { useSpacetimeStore } from '@/stores/spacetimeStore';
import ObjectLibrary from './ObjectLibrary';
import LaunchSetup from './LaunchSetup';
import FlightTapes from './FlightTapes';

/* ─── Drawer contents ──────────────────────────────────────────────────────── */

const SpacetimeDrawer = () => {
  const store = useSpacetimeStore(useShallow((state) => ({
    bodies: state.bodies,
    pendingPlacement: state.pendingPlacement,
    placementVelocityScale: state.placementVelocityScale,
    realisticMode: state.realisticMode,
    expansionEnabled: state.expansionEnabled,
    savedScenarios: state.savedScenarios,
    beginPlacement: state.beginPlacement,
    applyTemplate: state.applyTemplate,
    removeBody: state.removeBody,
    selectBody: state.selectBody,
    selectedBodyId: state.selectedBodyId,
    removeAll: state.removeAll,
    setVelocityScale: state.setVelocityScale,
    setRealisticMode: state.setRealisticMode,
    setExpansionEnabled: state.setExpansionEnabled,
    saveScenario: state.saveScenario,
    loadScenario: state.loadScenario,
    deleteScenario: state.deleteScenario,
  })));
  const tab = useAppStore((state) => state.spacetimeTab);
  const setTab = useAppStore((state) => state.setSpacetimeTab);
  const setDockCollapsed = useAppStore((state) => state.setDockCollapsed);

  return (
    <ObjectLibrary
      tab={tab}
      onTabChange={setTab}
      onBeginPlacement={store.beginPlacement}
      onApplyTemplate={store.applyTemplate}
      bodies={store.bodies}
      onRemoveBody={store.removeBody}
      onSelectBody={store.selectBody}
      selectedBodyId={store.selectedBodyId}
      onRemoveAll={store.removeAll}
      placementActive={Boolean(store.pendingPlacement)}
      velocityScale={store.placementVelocityScale}
      onVelocityScaleChange={store.setVelocityScale}
      realisticMode={store.realisticMode}
      onRealisticModeChange={store.setRealisticMode}
      expansionEnabled={store.expansionEnabled}
      onExpansionChange={store.setExpansionEnabled}
      savedScenarios={store.savedScenarios}
      onSaveScenario={store.saveScenario}
      onLoadScenario={store.loadScenario}
      onDeleteScenario={store.deleteScenario}
      onCollapse={() => setDockCollapsed(true)}
    />
  );
};

/* ─── Rail ─────────────────────────────────────────────────────────────────── */

interface RailItem {
  id: string;
  label: string;
  icon: LucideIcon;
  tab?: LibraryTab;
  step?: RocketStep;
}

const SPACETIME_ITEMS: RailItem[] = [
  { id: 'bodies', label: 'Bodies', icon: Shapes, tab: 'bodies' },
  { id: 'systems', label: 'Systems', icon: LayoutTemplate, tab: 'systems' },
  { id: 'saved', label: 'Saved', icon: FolderOpen, tab: 'saved' },
];

const ROCKET_ITEMS: RailItem[] = [
  { id: 'vehicle', label: 'Vehicle', icon: Rocket, step: 'vehicle' },
  { id: 'weather', label: 'Weather', icon: CloudSun, step: 'weather' },
  { id: 'launch', label: 'Launch', icon: Target, step: 'launch' },
];

const RailButton = ({ item, active, onClick }: { item: RailItem; active: boolean; onClick: () => void }) => {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={item.label}
      className={cn(
        'hud-focus group relative flex w-full flex-col items-center gap-1 rounded-[5px] px-1 py-2 transition-colors duration-150',
        active ? 'text-primary' : 'text-hud-dim hover:bg-white/[0.04] hover:text-foreground',
      )}
    >
      {/* Active marker sits on the rail's inner edge, like a selected instrument */}
      <span
        aria-hidden
        className={cn(
          'absolute left-[-7px] top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-full bg-primary transition-opacity duration-150',
          active ? 'opacity-100' : 'opacity-0',
        )}
      />
      <Icon size={17} strokeWidth={1.75} />
      <span className="text-[9.5px] font-medium leading-none tracking-[0.02em]">{item.label.split(' ')[0]}</span>
    </button>
  );
};

/** Left zone: a narrow instrument rail plus the lab's tool panel. */
const InstrumentRail = () => {
  const mode = useAppStore((state) => state.mode);
  const collapsed = useAppStore((state) => state.dockCollapsed);
  const setCollapsed = useAppStore((state) => state.setDockCollapsed);
  const tab = useAppStore((state) => state.spacetimeTab);
  const setTab = useAppStore((state) => state.setSpacetimeTab);
  const step = useFlightStore((state) => state.setupStep);
  const setStep = useFlightStore((state) => state.setSetupStep);
  const flying = useRocketStore((state) => state.flight.phase !== 'idle');
  const section = mode === 'spacetime' ? tab : step;
  const drawerRef = useRef<HTMLDivElement>(null);
  const items = mode === 'spacetime' ? SPACETIME_ITEMS : ROCKET_ITEMS;

  useGSAP(() => {
    // Slide stays inside the 8px gap so the drawer never passes under the rail.
    if (!collapsed) gsap.from(drawerRef.current, { autoAlpha: 0, x: -6, duration: 0.24 });
  }, { dependencies: [collapsed, mode] });

  const handleSelect = (item: RailItem) => {
    const isCurrent = !collapsed && (item.tab ?? item.step) === section;
    if (isCurrent) {
      setCollapsed(true);
      return;
    }
    if (item.tab) setTab(item.tab);
    if (item.step) setStep(item.step);
    setCollapsed(false);
  };

  return (
    <div className="flex h-full min-h-0 items-start gap-2">
      <nav aria-label="Lab tools" className="hud-panel pointer-events-auto flex w-[60px] shrink-0 flex-col gap-1 p-1.5">
        {items.map((item) => (
          <RailButton
            key={item.id}
            item={item}
            active={!collapsed && (item.tab ?? item.step) === section}
            onClick={() => handleSelect(item)}
          />
        ))}
      </nav>
      {!collapsed && (
        <div ref={drawerRef} className={cn('pointer-events-auto flex max-h-full min-h-0', mode === 'rocket' && 'h-full')}>
          {mode === 'spacetime' ? <SpacetimeDrawer /> : <LaunchSetup />}
        </div>
      )}
      {collapsed && mode === 'rocket' && flying && <FlightTapes />}
    </div>
  );
};

export default memo(InstrumentRail);
