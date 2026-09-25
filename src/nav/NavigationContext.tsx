import { getAdapter } from '@/adapters';
import type { AdapterControl, AdapterHandlers } from '@/adapters/DataAdapter';
import { navigationStore } from '@/nav/store';
import type { ScenarioId } from '@/types/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

/**
 * The Navigation Service.
 *
 * This provider is the only place in the app that talks to a data adapter. It
 * wires the adapter into the high-frequency store, owns the React-side UI
 * state (drawer/panel visibility, event log), and exposes an imperative command
 * surface for the Simulation controls.
 *
 * Layering, top to bottom:
 *
 *   UI Components
 *        ↓  (hooks only, never fetch/axios/WebSocket)
 *   NavigationContext  ← this file
 *        ↓
 *   navigationStore (high-frequency) + selectors
 *        ↓
 *   DataAdapter (MockAdapter today)
 *        ↓
 *   (backend, later)
 */

export interface NavigationUiState {
  simulationOpen: boolean;
  systemPanelOpen: boolean;
  paused: boolean;
  manualOverride: boolean;
  /** Whether the AI's estimate is actually fed to the filter. */
  aiContribution: boolean;
  scenario: ScenarioId;
  playbackSpeed: number;
  /** Monotonic counter used to key re-renders of the event timeline. */
  eventVersion: number;
}

export interface NavigationCommands {
  setScenario: (id: ScenarioId) => void;
  setRunning: (running: boolean) => void;
  setPlaybackSpeed: (speed: number) => void;
  setAiContribution: (on: boolean) => void;
  triggerOutage: () => void;
  triggerRecovery: () => void;
  reset: () => void;
  toggleSimulation: () => void;
  setSimulationOpen: (open: boolean) => void;
  setSystemPanelOpen: (open: boolean) => void;
}

const UiStateContext = createContext<NavigationUiState | null>(null);
const CommandsContext = createContext<NavigationCommands | null>(null);

const INITIAL_UI: NavigationUiState = {
  simulationOpen: true,
  systemPanelOpen: false,
  paused: false,
  manualOverride: false,
  aiContribution: true,
  scenario: 'gnss-blackout',
  playbackSpeed: 1,
  eventVersion: 0,
};

export function NavigationProvider({ children }: { children: ReactNode }) {
  const [ui, setUi] = useState<NavigationUiState>(INITIAL_UI);
  const adapterRef = useRef(getAdapter());
  const controlRef = useRef<AdapterControl>({
    scenario: INITIAL_UI.scenario,
    running: true,
    playbackSpeed: 1,
    manualOverride: false,
    aiContribution: true,
  });

  // ---- connect once for the lifetime of the app
  useEffect(() => {
    const adapter = adapterRef.current;
    const handlers: AdapterHandlers = {
      onFrame: (frame) => navigationStore.setFrame(frame),
      onNavrisPoint: (p) => navigationStore.pushNavrisPoint(p),
      onGnssPoint: (p) => navigationStore.pushGnssPoint(p),
      onEvent: (e) => navigationStore.pushEvent(e),
      onStatus: (s) => navigationStore.setStatus(s),
    };
    const disconnect = adapter.connect(handlers);
    return () => {
      disconnect();
      adapter.dispose();
    };
  }, []);

  // ---- keep React's event counter in step with the store's event log
  useEffect(() => {
    const off = navigationStore.subscribe(() => {
      setUi((prev) =>
        prev.eventVersion === navigationStore.eventVersion
          ? prev
          : { ...prev, eventVersion: navigationStore.eventVersion },
      );
    });
    return off;
  }, []);

  // ---- also mirror adapter control into React so the drawer stays truthful
  useEffect(() => {
    const off = navigationStore.subscribe(() => {
      setUi((prev) => {
        const c = navigationStore.control;
        if (
          prev.manualOverride === c.manualOverride &&
          prev.aiContribution === c.aiContribution &&
          prev.playbackSpeed === c.playbackSpeed &&
          prev.scenario === c.scenario
        ) {
          return prev;
        }
        return {
          ...prev,
          manualOverride: c.manualOverride,
          aiContribution: c.aiContribution,
          playbackSpeed: c.playbackSpeed,
          scenario: c.scenario,
        };
      });
    });
    return off;
  }, []);

  const pushControl = useCallback((patch: Partial<AdapterControl>) => {
    controlRef.current = { ...controlRef.current, ...patch };
    adapterRef.current.setControl(patch);
    navigationStore.setControl(patch);
  }, []);

  const commands = useMemo<NavigationCommands>(
    () => ({
      setScenario: (id) => {
        navigationStore.clearPaths();
        pushControl({ scenario: id, manualOverride: false });
        setUi((p) => ({ ...p, scenario: id, manualOverride: false }));
      },
      setRunning: (running) => {
        pushControl({ running });
        setUi((p) => ({ ...p, paused: !running }));
      },
      setPlaybackSpeed: (playbackSpeed) => pushControl({ playbackSpeed }),
      setAiContribution: (aiContribution) => {
        pushControl({ aiContribution });
        setUi((p) => ({ ...p, aiContribution }));
      },
      triggerOutage: () => {
        setUi((p) => ({ ...p, manualOverride: true }));
        adapterRef.current.requestOutage();
      },
      triggerRecovery: () => {
        setUi((p) => ({ ...p, manualOverride: true }));
        adapterRef.current.requestRecovery();
      },
      reset: () => {
        navigationStore.resetAll();
        adapterRef.current.reset();
        setUi((p) => ({ ...p, manualOverride: false, eventVersion: 0 }));
      },
      toggleSimulation: () => setUi((p) => ({ ...p, simulationOpen: !p.simulationOpen })),
      setSimulationOpen: (simulationOpen) => setUi((p) => ({ ...p, simulationOpen })),
      setSystemPanelOpen: (systemPanelOpen) => setUi((p) => ({ ...p, systemPanelOpen })),
    }),
    [pushControl],
  );

  return (
    <UiStateContext.Provider value={ui}>
      <CommandsContext.Provider value={commands}>{children}</CommandsContext.Provider>
    </UiStateContext.Provider>
  );
}

export function useNavigationUi(): NavigationUiState {
  const ctx = useContext(UiStateContext);
  if (!ctx) throw new Error('useNavigationUi must be used inside <NavigationProvider>');
  return ctx;
}

export function useNavigationCommands(): NavigationCommands {
  const ctx = useContext(CommandsContext);
  if (!ctx) throw new Error('useNavigationCommands must be used inside <NavigationProvider>');
  return ctx;
}
