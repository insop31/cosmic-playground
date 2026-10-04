import { memo, useMemo, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { FolderOpen, LayoutTemplate, Shapes, SlidersHorizontal, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { gsap, useGSAP } from '@/motion/gsap';
import { useAppStore, type LibraryTab } from '@/stores/appStore';
import { useEffectiveRocketParams, useRocketStore } from '@/stores/rocketStore';
import { useSpacetimeStore } from '@/stores/spacetimeStore';
import ObjectLibrary from './ObjectLibrary';
import RocketControls, { type RocketFlightSummary } from './RocketControls';

/* ─── Drawer contents ──────────────────────────────────────────────────────── */

const SpacetimeDrawer = () => {
  const store = useSpacetimeStore(useShallow((state) => ({
    bodies: state.bodies,
    pendingPlacement: state.pendingPlacement,
    placementVelocityScale: state.placementVelocityScale,
    realisticMode: state.realisticMode,
    savedScenarios: state.savedScenarios,
    beginPlacement: state.beginPlacement,
    applyTemplate: state.applyTemplate,
    removeBody: state.removeBody,
    selectBody: state.selectBody,
    selectedBodyId: state.selectedBodyId,
    removeAll: state.removeAll,
    setVelocityScale: state.setVelocityScale,
    setRealisticMode: state.setRealisticMode,
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
      savedScenarios={store.savedScenarios}
      onSaveScenario={store.saveScenario}
      onLoadScenario={store.loadScenario}
      onDeleteScenario={store.deleteScenario}
      onCollapse={() => setDockCollapsed(true)}
    />
  );
};

const RocketDrawer = () => {
  const params = useEffectiveRocketParams();
  const store = useRocketStore(useShallow((state) => ({
    phase: state.flight.phase,
    outcome: state.flight.outcome,
    activeWeather: state.activeWeather,
    savedPresets: state.savedPresets,
    setParam: state.setParam,
    launch: state.launch,
    resetFlight: state.resetFlight,
    toggleWeather: state.toggleWeather,
    savePreset: state.savePreset,
    loadPreset: state.loadPreset,
    deletePreset: state.deletePreset,
  })));
  const setDockCollapsed = useAppStore((state) => state.setDockCollapsed);

  // Recomputed only when phase or outcome changes, so per-frame telemetry
  // doesn't re-render the controls.
  const summary = useMemo<RocketFlightSummary>(() => {
    const { maxAltitude, elapsed } = useRocketStore.getState().flight;
    return { phase: store.phase, outcome: store.outcome, maxAltitude, elapsed };
  }, [store.phase, store.outcome]);

  return (
    <RocketControls
      params={params}
      state={summary}
      onParamChange={store.setParam}
      onLaunch={store.launch}
      onReset={store.resetFlight}
      savedPresets={store.savedPresets}
      onSavePreset={store.savePreset}
      onLoadPreset={store.loadPreset}
      onDeletePreset={store.deletePreset}
      activeWeather={store.activeWeather}
      onWeatherChange={store.toggleWeather}
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
}

const SPACETIME_ITEMS: RailItem[] = [
  { id: 'bodies', label: 'Bodies', icon: Shapes, tab: 'bodies' },
  { id: 'systems', label: 'Systems', icon: LayoutTemplate, tab: 'systems' },
  { id: 'saved', label: 'Saved', icon: FolderOpen, tab: 'saved' },
];

const ROCKET_ITEMS: RailItem[] = [
  { id: 'setup', label: 'Launch setup', icon: SlidersHorizontal },
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
  const drawerRef = useRef<HTMLDivElement>(null);
  const items = mode === 'spacetime' ? SPACETIME_ITEMS : ROCKET_ITEMS;

  useGSAP(() => {
    // Slide stays inside the 8px gap so the drawer never passes under the rail.
    if (!collapsed) gsap.from(drawerRef.current, { autoAlpha: 0, x: -6, duration: 0.24 });
  }, { dependencies: [collapsed, mode] });

  const handleSelect = (item: RailItem) => {
    const isCurrent = !collapsed && (!item.tab || item.tab === tab);
    if (isCurrent) {
      setCollapsed(true);
      return;
    }
    if (item.tab) setTab(item.tab);
    setCollapsed(false);
  };

  return (
    <div className="flex h-full min-h-0 items-start gap-2">
      <nav aria-label="Lab tools" className="hud-panel pointer-events-auto flex w-[60px] shrink-0 flex-col gap-1 p-1.5">
        {items.map((item) => (
          <RailButton
            key={item.id}
            item={item}
            active={!collapsed && (!item.tab || item.tab === tab)}
            onClick={() => handleSelect(item)}
          />
        ))}
      </nav>
      {!collapsed && (
        <div ref={drawerRef} className={cn('pointer-events-auto flex max-h-full min-h-0', mode === 'rocket' && 'h-full')}>
          {mode === 'spacetime' ? <SpacetimeDrawer /> : <RocketDrawer />}
        </div>
      )}
    </div>
  );
};

export default memo(InstrumentRail);
