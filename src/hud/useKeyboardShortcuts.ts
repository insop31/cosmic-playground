import { useEffect } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useRocketStore } from '@/stores/rocketStore';
import { useSpacetimeStore } from '@/stores/spacetimeStore';
import { useTimeStore } from '@/stores/timeStore';

const isTypingTarget = (target: EventTarget | null) => {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="listbox"], [role="menu"]'));
};

/** Resets whichever lab is on screen. */
export const resetActiveLab = () => {
  if (useAppStore.getState().mode === 'spacetime') useSpacetimeStore.getState().reset();
  else useRocketStore.getState().resetFlight();
};

/** Global keyboard map. Reads stores at key time, so it never re-subscribes. */
export const useKeyboardShortcuts = () => {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      const target = event.target instanceof Element ? event.target : null;
      const app = useAppStore.getState();
      const time = useTimeStore.getState();

      switch (event.key) {
        case ' ': {
          // A focused button already activates on Space.
          if (target?.closest('button, [role="slider"], [role="switch"], [role="radio"]')) return;
          event.preventDefault();
          time.togglePlay();
          break;
        }
        case 'ArrowLeft':
        case 'ArrowRight': {
          if (target?.closest('[role="slider"], [role="radio"], [role="radiogroup"]')) return;
          event.preventDefault();
          time.step(event.key === 'ArrowLeft' ? -1 : 1);
          break;
        }
        case 'r':
        case 'R':
          resetActiveLab();
          break;
        case '1':
          app.setMode('spacetime');
          break;
        case '2':
          app.setMode('rocket');
          break;
        case 'h':
        case 'H':
          app.toggleHud();
          break;
        case 'Escape': {
          const spacetime = useSpacetimeStore.getState();
          if (spacetime.pendingPlacement) spacetime.cancelPlacement();
          else if (app.hudHidden) app.setHudHidden(false);
          break;
        }
        case '[':
          app.toggleDock();
          break;
        case ']':
          app.toggleMissions();
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
};

/** Collapse side panels when the window shrinks past a breakpoint (expanding is left to the user). */
export const useResponsivePanels = () => {
  useEffect(() => {
    const narrow = window.matchMedia('(max-width: 1279px)');
    const compact = window.matchMedia('(max-width: 1023px)');
    const onNarrow = (event: MediaQueryListEvent) => { if (event.matches) useAppStore.getState().setMissionsCollapsed(true); };
    const onCompact = (event: MediaQueryListEvent) => { if (event.matches) useAppStore.getState().setDockCollapsed(true); };
    narrow.addEventListener('change', onNarrow);
    compact.addEventListener('change', onCompact);
    return () => {
      narrow.removeEventListener('change', onNarrow);
      compact.removeEventListener('change', onCompact);
    };
  }, []);
};
