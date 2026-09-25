import { ACTIVE_ADAPTER, activeAdapterLabel } from '@/adapters';
import { navigationStore } from '@/nav/store';
import { useTelemetry } from '@/nav/hooks';
import { useNavigationUi } from '@/nav/NavigationContext';
import { selectStateSummary, selectStateVisual } from '@/nav/selectors';
import { DemoBadge, Divider, Panel, ReadoutDef, ReadoutGrid, ReadoutTerm, StatusDot } from '@/components/ui/primitives';
import type { DataSourceLabel } from '@/types/navigation';
import { formatDuration, formatMissionTime, formatPercent } from '@/lib/format';
import { SCENARIOS } from '@/sim/scenarios';
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';

/**
 * The System panel — progressive disclosure.
 *
 * Everything in here is for someone who already believes the headline and wants
 * to check it: the raw filter statistics, the sensor error estimates, the
 * architecture contract. It is a slide-over, never a competing page, because
 * the map is the product.
 */
export function SystemPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const frame = useTelemetry(150);
  const { aiContribution } = useNavigationUi();
  const [storeVersion, setStoreVersion] = useState(0);

  useEffect(() => {
    if (!open) return;
    return navigationStore.subscribe(() => setStoreVersion((v) => v + 1));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const visual = selectStateVisual(frame);
  const status = navigationStore.status;
  const source: DataSourceLabel = frame?.source ?? 'DEMO_SIMULATED';

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="System detail">
      <button
        type="button"
        aria-label="Close system panel"
        onClick={onClose}
        className="absolute inset-0 bg-base-900/70 backdrop-blur-[1px]"
      />
      <div className="relative flex h-full w-full max-w-[440px] animate-rise-in flex-col border-l border-hairline bg-surface">
        <header
          className="flex shrink-0 items-center gap-2 border-b border-hairline px-4 py-3"
          style={{ boxShadow: `inset 3px 0 0 ${visual.border}` }}
        >
          <h2 className="panel-title">System</h2>
          <DemoBadge compact />
          <button type="button" onClick={onClose} className="btn btn-ghost ml-auto !px-1.5 !py-1">
            <X size={14} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div key={storeVersion} className="flex flex-col gap-3 p-3">
            <Panel title="Navigation State" accent={visual.accent}>
              <div className="px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <StatusDot color={visual.accent} pulse={visual.pulse} size={8} />
                  <span className="font-mono text-[13px] font-bold uppercase tracking-[0.08em]" style={{ color: visual.text }}>
                    {frame?.state.id ?? 'INITIALISING'}
                  </span>
                </div>
                <p className="mt-1.5 text-[11px] leading-snug text-ink-muted">
                  {selectStateSummary(frame)}
                </p>
                <div className="mt-2 flex items-baseline justify-between">
                  <span className="label-micro">Dwell</span>
                  <span className="readout text-[11px] text-ink-muted">
                    {formatDuration(frame?.state.dwellSeconds ?? 0)}
                  </span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="label-micro">Mission time</span>
                  <span className="readout text-[11px] text-ink-muted">
                    {formatMissionTime(frame?.time ?? 0)}
                  </span>
                </div>
              </div>
            </Panel>

            <Panel title="GNSS Receiver" accent={frame?.gnss.available ? '#2DD4BF' : '#F04E3E'}>
              <div className="px-3 py-2">
                <ReadoutGrid>
                  <ReadoutTerm>Fix type</ReadoutTerm>
                  <ReadoutDef>{frame?.gnss.fixType ?? '—'}</ReadoutDef>
                  <ReadoutTerm>Satellites</ReadoutTerm>
                  <ReadoutDef>
                    {frame?.gnss.satellitesUsed ?? 0} used / {frame?.gnss.satellitesVisible ?? 0} visible
                  </ReadoutDef>
                  <ReadoutTerm>HDOP</ReadoutTerm>
                  <ReadoutDef>{frame?.gnss.hdop.toFixed(2) ?? '—'}</ReadoutDef>
                  <ReadoutTerm>C/N₀</ReadoutTerm>
                  <ReadoutDef>{frame ? `${frame.gnss.cn0.toFixed(1)} dB-Hz` : '—'}</ReadoutDef>
                  <ReadoutTerm>Time since fix</ReadoutTerm>
                  <ReadoutDef
                    color={frame && frame.gnss.secondsSinceFix > 1 ? '#FDBA74' : undefined}
                  >
                    {frame?.gnss.secondsSinceFix.toFixed(2) ?? '—'} s
                  </ReadoutDef>
                </ReadoutGrid>
              </div>
            </Panel>

            <Panel title="Inertial Measurement Unit" accent={frame?.imu.health === 'OK' ? '#2DD4BF' : '#F5A524'}>
              <div className="px-3 py-2">
                <ReadoutGrid>
                  <ReadoutTerm>Health</ReadoutTerm>
                  <ReadoutDef>{frame?.imu.health ?? '—'}</ReadoutDef>
                  <ReadoutTerm>Sample rate</ReadoutTerm>
                  <ReadoutDef>{frame?.imu.sampleRateHz ?? 0} Hz</ReadoutDef>
                  <ReadoutTerm>Attitude</ReadoutTerm>
                  <ReadoutDef>
                    {frame ? `${frame.imu.roll.toFixed(2)}° / ${frame.imu.pitch.toFixed(2)}° / ${frame.imu.yaw.toFixed(2)}°` : '—'}
                  </ReadoutDef>
                  <ReadoutTerm>Specific force</ReadoutTerm>
                  <ReadoutDef>
                    {frame
                      ? `${frame.imu.accel.x.toFixed(3)}, ${frame.imu.accel.y.toFixed(3)}, ${frame.imu.accel.z.toFixed(3)} m/s²`
                      : '—'}
                  </ReadoutDef>
                  <ReadoutTerm>Angular rate</ReadoutTerm>
                  <ReadoutDef>
                    {frame
                      ? `${frame.imu.gyro.x.toFixed(3)}, ${frame.imu.gyro.y.toFixed(3)}, ${frame.imu.gyro.z.toFixed(3)} °/s`
                      : '—'}
                  </ReadoutDef>
                  <ReadoutTerm>Accel bias est.</ReadoutTerm>
                  <ReadoutDef>
                    {frame
                      ? `${frame.imu.accelBias.x.toFixed(4)}, ${frame.imu.accelBias.y.toFixed(4)} m/s²`
                      : '—'}
                  </ReadoutDef>
                  <ReadoutTerm>Die temperature</ReadoutTerm>
                  <ReadoutDef>{frame?.imu.temperatureC.toFixed(1) ?? '—'} °C</ReadoutDef>
                </ReadoutGrid>
              </div>
            </Panel>

            <Panel title="Error-State Kalman Filter" accent="#8C9AB2">
              <div className="px-3 py-2">
                <ReadoutGrid>
                  <ReadoutTerm>Health</ReadoutTerm>
                  <ReadoutDef>{frame?.eskf.health ?? '—'}</ReadoutDef>
                  <ReadoutTerm>Error states</ReadoutTerm>
                  <ReadoutDef>{frame?.eskf.errorStates ?? 0}</ReadoutDef>
                  <ReadoutTerm>NIS</ReadoutTerm>
                  <ReadoutDef
                    color={frame && frame.eskf.nis > 9 ? '#FBBF4C' : undefined}
                    title="Normalised Innovation Squared — the 2-DOF chi-square gate threshold is 9.3"
                  >
                    {frame?.eskf.nis.toFixed(3) ?? '—'}
                  </ReadoutDef>
                  <ReadoutTerm>Accepted</ReadoutTerm>
                  <ReadoutDef color="#6EE7B7">{frame?.eskf.updatesAccepted ?? 0}</ReadoutDef>
                  <ReadoutTerm>Rejected</ReadoutTerm>
                  <ReadoutDef color={frame && frame.eskf.updatesRejected > 0 ? '#FBBF4C' : undefined}>
                    {frame?.eskf.updatesRejected ?? 0}
                  </ReadoutDef>
                  <ReadoutTerm>Inertial only</ReadoutTerm>
                  <ReadoutDef>{frame?.eskf.inertialOnly ? 'YES' : 'NO'}</ReadoutDef>
                  <ReadoutTerm>σ East</ReadoutTerm>
                  <ReadoutDef>{frame?.navris.uncertainty.sigmaEast.toFixed(3) ?? '—'} m</ReadoutDef>
                  <ReadoutTerm>σ North</ReadoutTerm>
                  <ReadoutDef>{frame?.navris.uncertainty.sigmaNorth.toFixed(3) ?? '—'} m</ReadoutDef>
                  <ReadoutTerm>Correlation</ReadoutTerm>
                  <ReadoutDef>{frame?.navris.uncertainty.correlation.toFixed(3) ?? '—'}</ReadoutDef>
                  <ReadoutTerm>σ heading</ReadoutTerm>
                  <ReadoutDef>{frame?.navris.uncertainty.sigmaHeadingDeg.toFixed(3) ?? '—'}°</ReadoutDef>
                </ReadoutGrid>
              </div>
            </Panel>

            <Panel title="AI Correction Stage" accent={frame?.ai.active ? '#8B7BF7' : '#3A4557'}>
              <div className="px-3 py-2">
                <ReadoutGrid>
                  <ReadoutTerm>Status</ReadoutTerm>
                  <ReadoutDef color={frame?.ai.active ? '#A99BFF' : undefined}>
                    {frame?.ai.active ? 'ACTIVE' : 'STANDBY'}
                  </ReadoutDef>
                  <ReadoutTerm>Stage</ReadoutTerm>
                  <ReadoutDef>{frame?.ai.stage ?? 'IDLE'}</ReadoutDef>
                  <ReadoutTerm>Window</ReadoutTerm>
                  <ReadoutDef>{frame?.ai.windowSamples ?? 0} samples</ReadoutDef>
                  <ReadoutTerm>Features</ReadoutTerm>
                  <ReadoutDef>{frame?.ai.featureCount ?? 0}</ReadoutDef>
                  <ReadoutTerm>Predicted error</ReadoutTerm>
                  <ReadoutDef>
                    {frame
                      ? `${frame.ai.predictedError.x.toFixed(4)}, ${frame.ai.predictedError.y.toFixed(4)} m/s²`
                      : '—'}
                  </ReadoutDef>
                  <ReadoutTerm>Inference</ReadoutTerm>
                  <ReadoutDef>{frame ? `${frame.ai.inferenceMs.toFixed(2)} ms` : '—'}</ReadoutDef>
                  <ReadoutTerm>Corrections</ReadoutTerm>
                  <ReadoutDef>{frame?.ai.correctionsApplied ?? 0}</ReadoutDef>
                </ReadoutGrid>
                <Divider />
                <p className="text-[10px] leading-snug text-ink-dim">
                  The model contributes a bias estimate, which enters the filter as a measurement.
                  It is not a navigation solution and it is not the source of truth — GNSS is, when
                  it is available.
                </p>
              </div>
            </Panel>

            <Panel title="Data Source" accent={source === 'MEASURED' ? '#2DD4BF' : '#F5A524'}>
              <div className="px-3 py-2">
                <ReadoutGrid>
                  <ReadoutTerm>Adapter</ReadoutTerm>
                  <ReadoutDef>{activeAdapterLabel()}</ReadoutDef>
                  <ReadoutTerm>Transport</ReadoutTerm>
                  <ReadoutDef className="text-right text-[10px]">
                    <span className="block break-words">{status.transport}</span>
                  </ReadoutDef>
                  <ReadoutTerm>Nominal rate</ReadoutTerm>
                  <ReadoutDef>{status.targetHz} Hz</ReadoutDef>
                  <ReadoutTerm>Connected</ReadoutTerm>
                  <ReadoutDef color={status.connected ? '#6EE7B7' : '#FBBF4C'}>
                    {status.connected ? 'YES' : 'NO'}
                  </ReadoutDef>
                  <ReadoutTerm>Provenance</ReadoutTerm>
                  <ReadoutDef color={source === 'MEASURED' ? '#6EE7B7' : '#FBBF4C'}>
                    {source === 'MEASURED' ? 'MEASURED' : 'DEMO / SIMULATED'}
                  </ReadoutDef>
                  <ReadoutTerm>Scenario</ReadoutTerm>
                  <ReadoutDef>{SCENARIOS[navigationStore.control.scenario].name}</ReadoutDef>
                </ReadoutGrid>
                <Divider />
                <p className="text-[10px] leading-snug text-ink-dim">
                  Every number on this screen is <strong className="text-degraded-soft">simulated</strong> unless
                  the provenance row above says otherwise. To run on real hardware, set{' '}
                  <code className="text-ink-muted">ACTIVE_ADAPTER</code> in{' '}
                  <code className="text-ink-muted">src/adapters/index.ts</code> to{' '}
                  <code className="text-ink-muted">
                    {ACTIVE_ADAPTER === 'mock' ? "'api'" : `'${ACTIVE_ADAPTER}'`}
                  </code>
                  . No component changes are required.
                </p>
              </div>
            </Panel>

            <Panel title="Pipeline" accent="#5A6781">
              <div className="px-3 py-2">
                <ReadoutGrid>
                  <ReadoutTerm>Model self-report</ReadoutTerm>
                  <ReadoutDef>{formatPercent(frame?.ai.modelConfidence ?? 0, 1)}</ReadoutDef>
                  <ReadoutTerm>AI output applied</ReadoutTerm>
                  <ReadoutDef>{aiContribution ? 'yes' : 'no — display only'}</ReadoutDef>
                  <ReadoutTerm>Samples recorded</ReadoutTerm>
                  <ReadoutDef>{navigationStore.history.length}</ReadoutDef>
                  <ReadoutTerm>Trajectory points</ReadoutTerm>
                  <ReadoutDef>
                    {navigationStore.navrisPath.length} / {navigationStore.gnssPath.length}
                  </ReadoutDef>
                </ReadoutGrid>
                <p className="mt-2 text-[10px] leading-snug text-ink-dim">
                  Motion features → AI error estimation → correction → ESKF fusion → navigation
                  solution. The uncertainty reported to the operator is the filter's own covariance,
                  never a model output.
                </p>
              </div>
            </Panel>
          </div>
        </div>
      </div>
    </div>
  );
}
