import { DataSourceBadge } from '@/components/ui/primitives';
import { useNavigationCommands, useNavigationUi } from '@/nav/NavigationContext';
import { useTelemetry } from '@/nav/hooks';
import { selectStateVisual } from '@/nav/selectors';
import { SCENARIO_ORDER, SCENARIOS } from '@/sim/scenarios';
import { formatMissionTime } from '@/lib/format';
import { activeAdapterLabel } from '@/adapters';
import {
  Gauge,
  Play,
  RotateCcw,
  Satellite,
  Undo2,
  X,
  Zap,
} from 'lucide-react';
import { useState } from 'react';

/**
 * The Simulation / Demo panel.
 *
 * A drawer attached to Live Navigation, deliberately *not* a route: the map must
 * never leave the screen while an operator is driving the demo. The one rule
 * this panel enforces above all others is that a presenter always has manual
 * control â€” no transition in the product is reachable only by a timer.
 */
export function SimulationDrawer() {
  const { simulationOpen, scenario, paused, manualOverride, playbackSpeed, aiContribution } =
    useNavigationUi();
  const cmd = useNavigationCommands();
  const frame = useTelemetry(200);
  const [confirmReset, setConfirmReset] = useState(false);
  const visual = selectStateVisual(frame);
  const active = SCENARIOS[scenario];
  const adapterName = activeAdapterLabel();

  if (!simulationOpen) return null;

  return (
    <aside
      className="flex w-full shrink-0 flex-col border-l border-hairline bg-surface
                 lg:w-[310px]"
      aria-label="Simulation and demo controls"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-hairline px-3 py-2.5">
        <Gauge size={13} strokeWidth={1.6} className="text-ink-muted" />
        <h2 className="panel-title">Simulation / Demo</h2>
        <button
          type="button"
          onClick={() => cmd.setSimulationOpen(false)}
          className="btn btn-ghost ml-auto !px-1.5 !py-1"
          aria-label="Collapse simulation panel"
        >
          <X size={13} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Provenance: impossible to mistake for a live claim. */}
        <div className="flex flex-col gap-2 border-b border-hairline px-3 py-3">
          <DataSourceBadge />
          <p className="text-[11px] leading-snug text-ink-dim">
            Every value on this screen is generated in your browser. No vehicle, no satellite and
            no sensor is involved.
          </p>
        </div>

        {/* Scenario */}
        <section className="border-b border-hairline px-3 py-3">
          <span className="label-micro">Scenario</span>
          <div className="mt-1.5 grid grid-cols-1 gap-1">
            {SCENARIO_ORDER.map((id) => {
              const s = SCENARIOS[id];
              const isActive = id === scenario;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => cmd.setScenario(id)}
                  aria-pressed={isActive}
                  className={`group flex items-center gap-2 border px-2.5 py-2 text-left transition-colors duration-150 ease-instrument ${
                    isActive
                      ? 'border-current bg-white/[0.03]'
                      : 'border-hairline hover:border-hairline-strong hover:bg-surface-hover'
                  }`}
                  style={isActive ? { color: '#2DD4BF' } : undefined}
                >
                  <span
                    aria-hidden
                    className="h-1.5 w-1.5 shrink-0 rounded-full transition-colors"
                    style={{ background: isActive ? '#2DD4BF' : '#3A4557' }}
                  />
                  <span className="min-w-0 flex-1">
                    <span
                      className="block font-mono text-[11px] font-medium uppercase tracking-[0.1em]"
                      style={{ color: isActive ? '#5EEAD4' : '#C3CCDA' }}
                    >
                      {s.name}
                    </span>
                    <span className="mt-[2px] block text-[10px] leading-snug text-ink-dim">
                      {s.summary}
                    </span>
                  </span>
                  {s.scripted && (
                    <span className="readout shrink-0 text-[8px] uppercase tracking-[0.1em] text-degraded">
                      Scripted
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {active.scripted && (
            <p className="mt-2 border-l-2 border-degraded/50 pl-2 text-[10px] leading-snug text-ink-dim">
              This scenario runs its own outage at T+{active.scriptedOutageAt}s for{' '}
              {active.scriptedOutageDuration}s. Pressing either trigger below hands control to you
              permanently.
            </p>
          )}
        </section>

        {/* Transport */}
        <section className="border-b border-hairline px-3 py-3">
          <span className="label-micro">Transport</span>
          <div className="mt-1.5 grid grid-cols-3 gap-1">
            <button
              type="button"
              className="btn"
              onClick={() => cmd.setRunning(!paused)}
              disabled={paused}
            >
              <Play size={11} /> Run
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => cmd.setRunning(false)}
              disabled={!paused}
            >
              <span aria-hidden>â™â™</span> Hold
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                if (!confirmReset) {
                  setConfirmReset(true);
                  window.setTimeout(() => setConfirmReset(false), 3000);
                  return;
                }
                cmd.reset();
                setConfirmReset(false);
              }}
              title="Clears trajectories, history and the event log"
            >
              <RotateCcw size={11} /> {confirmReset ? 'Sure?' : 'Reset'}
            </button>
          </div>

          <div className="mt-3">
            <div className="flex items-baseline justify-between">
              <span className="label-micro">Playback speed</span>
              <span className="readout text-[11px] text-ink-muted">{playbackSpeed}Ã—</span>
            </div>
            <input
              type="range"
              min={0.25}
              max={3}
              step={0.25}
              value={playbackSpeed}
              onChange={(e) => cmd.setPlaybackSpeed(Number(e.target.value))}
              className="mt-1.5 w-full accent-[#2DD4BF]"
              aria-label="Playback speed multiplier"
            />
            <div className="readout mt-0.5 flex justify-between text-[9px] text-ink-faint">
              <span>0.25Ã—</span>
              <span>1Ã—</span>
              <span>3Ã—</span>
            </div>
          </div>

          <div className="mt-3 border-t border-hairline pt-3">
            <button
              type="button"
              role="switch"
              aria-checked={aiContribution}
              onClick={() => cmd.setAiContribution(!aiContribution)}
              className="flex w-full items-start gap-2 text-left"
            >
              <span
                aria-hidden
                className="mt-0.5 flex h-3.5 w-6 shrink-0 items-center rounded-full px-0.5 transition-colors"
                style={{ background: aiContribution ? '#2DD4BF' : '#2A3242' }}
              >
                <span
                  className="h-2.5 w-2.5 rounded-full bg-[#0B0E14] transition-transform"
                  style={{ transform: `translateX(${aiContribution ? 12 : 0}px)` }}
                />
              </span>
              <span>
                <span className="label-micro">Feed AI output to filter</span>
                <span className="mt-0.5 block text-[10px] leading-snug text-ink-dim">
                  {aiContribution
                    ? 'The modelâ€™s bias estimate is applied as a weighted measurement.'
                    : 'Displayed but ignored. Trigger an outage to watch the ellipse grow unchecked â€” the clearest way to see what the model is actually worth.'}
                </span>
              </span>
            </button>
          </div>
        </section>

        {/* The demo triggers */}
        <section className="px-3 py-3">
          <div className="flex items-center justify-between">
            <span className="label-micro">GNSS control</span>
            <span
              className="readout text-[9px] uppercase tracking-[0.1em]"
              style={{ color: manualOverride ? '#A99BFF' : '#5A6781' }}
            >
              {manualOverride ? 'Manual' : 'Script'}
            </span>
          </div>

          <button
            type="button"
            onClick={cmd.triggerOutage}
            className="btn btn-danger mt-1.5 w-full !py-2.5"
          >
            <Zap size={13} /> Trigger Outage
          </button>
          <button
            type="button"
            onClick={cmd.triggerRecovery}
            className="btn mt-1 w-full !py-2.5"
            style={{ color: '#86EFAC', borderColor: 'rgba(74,222,128,0.45)' }}
          >
            <Undo2 size={13} /> Trigger Recovery
          </button>

          <p className="mt-2 text-[10px] leading-snug text-ink-dim">
            Outage runs the full ladder â€” degraded, outage detected, dead reckoning, AI correction,
            re-fusion, stabilized â€” and writes each step to the timeline.
          </p>
        </section>

        {/* Live scenario stats */}
        <section className="border-t border-hairline px-3 py-3">
          <span className="label-micro">Scenario parameters</span>
          <dl className="mt-1.5 space-y-[3px]">
            <Stat label="Target speed" value={`${(active.targetSpeed * 3.6).toFixed(0)} km/h`} />
            <Stat label="IMU noise" value={`${active.imuNoise.toFixed(3)} m/sÂ²`} />
            <Stat label="Nominal 1Ïƒ" value={`${active.nominalSigma.toFixed(1)} m`} />
            <Stat
              label="Drift rate"
              value={`${active.driftSigmaPerSec.toFixed(3)} m/s`}
            />
            <Stat label="Elapsed" value={formatMissionTime(frame?.time ?? 0)} />
            <Stat label="Source" value={adapterName} />
          </dl>
        </section>
      </div>

      <footer
        className="shrink-0 border-t border-hairline px-3 py-2"
        style={{ boxShadow: `inset 2px 0 0 ${visual.border}` }}
      >
        <div className="flex items-center gap-1.5">
          <Satellite size={11} className="text-ink-dim" />
          <span className="readout truncate text-[9px] text-ink-dim">
            {frame?.gnss.available
              ? `GNSS locked Â· ${frame.gnss.satellitesUsed} sats`
              : `GNSS denied Â· ${(frame?.gnss.secondsSinceFix ?? 0).toFixed(0)}s`}
          </span>
        </div>
      </footer>
    </aside>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="label-micro">{label}</dt>
      <dd className="readout text-[10px] text-ink-muted">{value}</dd>
    </div>
  );
}
