import { Wordmark } from '@/components/brand/Wordmark';
import { SystemStateIndicator } from '@/components/status/SystemStateIndicator';
import { DataSourceBadge } from '@/components/ui/primitives';
import { useNavigationCommands, useNavigationUi } from '@/nav/NavigationContext';
import { useTelemetry } from '@/nav/hooks';
import { selectStateVisual } from '@/nav/selectors';
import { SCENARIOS } from '@/sim/scenarios';
import { navigationStore } from '@/nav/store';
import { Cpu, Gauge, LineChart, SlidersHorizontal } from 'lucide-react';
import { useEffect } from 'react';
import { NavLink } from 'react-router-dom';

/**
 * The persistent top bar.
 *
 * Layout priority, left to right, is deliberate: wordmark â†’ the system state
 * (the largest thing on screen) â†’ data provenance â†’ view navigation. A judge
 * standing at the back of the room reads only the middle group, and it has to
 * be legible without effort.
 */
export function TopBar() {
  const { simulationOpen, systemPanelOpen, manualOverride } = useNavigationUi();
  const cmd = useNavigationCommands();
  const frame = useTelemetry(400);
  const visual = selectStateVisual(frame);
  const state = frame?.state.id;
  const scenario = SCENARIOS[navigationStore.control.scenario];

  // The state colour becomes a document-level custom property so the body
  // wash, focus rings and the scrollbar frame all shift together on a
  // transition. One variable, one place, no per-component bookkeeping.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--state-accent', visual.accent);
    root.style.setProperty('--state-wash', visual.wash);
  }, [visual.accent, visual.wash]);

  const showAiBadge = state === 'AI_CORRECTION';

  return (
    <header
      className="relative z-30 flex shrink-0 items-center gap-4 border-b border-hairline bg-surface px-4 py-2.5"
      style={{ boxShadow: `inset 0 -1px 0 ${visual.border}00` }}
    >
      {/* Wordmark */}
      <Wordmark accent={visual.accent} animate={state === 'RE_FUSION' || state === 'STABILIZED'} />

      <div className="h-8 w-px bg-hairline" />

      {/* The headline: system state */}
      <div className="min-w-0 flex-1">
        <SystemStateIndicator />
      </div>

      {/* Provenance + mode */}
      <div className="flex shrink-0 items-center gap-2">
        {showAiBadge && (
          <span
            className="readout hidden items-center gap-1.5 border px-2 py-1 text-micro uppercase tracking-[0.12em] lg:inline-flex"
            style={{ color: '#A99BFF', borderColor: 'rgba(139,123,247,0.45)', background: 'rgba(139,123,247,0.08)' }}
          >
            <Cpu size={11} /> AI Stage
          </span>
        )}

        <DataSourceBadge />

        <button
          type="button"
          onClick={cmd.toggleSimulation}
          aria-pressed={simulationOpen}
          className={`btn ${simulationOpen ? 'border-current text-ink' : ''}`}
          style={simulationOpen ? { color: visual.accent, borderColor: visual.border } : undefined}
          title="Scenario and manual outage controls"
        >
          <Gauge size={12} />
          <span className="hidden sm:inline">Sim</span>
        </button>

        <button
          type="button"
          onClick={() => cmd.setSystemPanelOpen(!systemPanelOpen)}
          aria-pressed={systemPanelOpen}
          className={`btn ${systemPanelOpen ? 'border-current text-ink' : ''}`}
          title="Sensor, filter and AI detail"
        >
          <SlidersHorizontal size={12} />
          <span className="hidden md:inline">System</span>
        </button>
      </div>

      {/* View switch */}
      <nav
        className="flex shrink-0 items-center gap-0.5 border border-hairline p-0.5"
        aria-label="Primary views"
      >
        <NavLink
          to="/"
          end
          className={({ isActive }) =>
            `flex items-center gap-1.5 px-2.5 py-1 font-mono text-micro uppercase tracking-[0.1em] transition-colors duration-150 ${
              isActive ? 'bg-surface-hover text-ink' : 'text-ink-dim hover:text-ink-muted'
            }`
          }
        >
          <Gauge size={11} /> Live
        </NavLink>
        <NavLink
          to="/analytics"
          className={({ isActive }) =>
            `flex items-center gap-1.5 px-2.5 py-1 font-mono text-micro uppercase tracking-[0.1em] transition-colors duration-150 ${
              isActive ? 'bg-surface-hover text-ink' : 'text-ink-dim hover:text-ink-muted'
            }`
          }
        >
          <LineChart size={11} /> Analytics
        </NavLink>
      </nav>

      {/* Current scenario, so the operator is never guessing what is running. */}
      <div className="hidden shrink-0 flex-col items-end border-l border-hairline pl-4 xl:flex">
        <span className="label-micro leading-none">Scenario</span>
        <span className="readout mt-1 text-[11px] text-ink-muted">
          {scenario.name}
          {manualOverride && <span className="ml-1.5 text-ai-soft">Â· manual</span>}
        </span>
      </div>
    </header>
  );
}
