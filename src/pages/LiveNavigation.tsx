import { SimulationDrawer } from '@/components/sim/SimulationDrawer';
import { NavigationMap } from '@/components/map/NavigationMap';
import { TelemetryHUD } from '@/components/hud/TelemetryHUD';
import { AIPipelineIndicator, EventTimeline, SensorSnapshot } from '@/components/panels/HealthPanels';
import { ConfidenceSparkline } from '@/components/panels/ConfidenceSparkline';
import { Panel } from '@/components/ui/primitives';
import { useNavigationCommands, useNavigationUi } from '@/nav/NavigationContext';
import { useTelemetry } from '@/nav/hooks';
import { descriptorForState, visualForState } from '@/theme/stateColors';
import { formatMissionTime } from '@/lib/format';
import { Info } from 'lucide-react';
import { useMemo } from 'react';

/**
 * Live Navigation — the default landing view and the demo screen.
 *
 * The layout contract:
 *   • the map owns the majority of the width and never scrolls
 *   • the right rail is glanceable health, not sensor detail
 *   • the timeline runs along the bottom and is the narrative artefact
 *   • the simulation drawer is a sibling of the map, not a route, so the map
 *     is on screen while an operator triggers an outage
 *
 * It loads directly into an already-animating scenario. There is no empty
 * state: the first five seconds of the demo are the ones that matter.
 */
export function LiveNavigation() {
  const { simulationOpen } = useNavigationUi();
  const cmd = useNavigationCommands();
  const frame = useTelemetry(200);
  const visual = visualForState(frame?.state.id ?? 'INITIALISING');
  const descriptor = descriptorForState(frame?.state.id ?? 'INITIALISING');

  const mode = useMemo(() => modeFor(frame?.state.id ?? 'INITIALISING'), [frame?.state.id]);

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      {/* ---------------- Map column ---------------- */}
      <div className="flex min-h-[44vh] min-w-0 flex-1 flex-col lg:min-h-0">
        <div className="relative min-h-0 flex-1">
          <NavigationMap />
          <TelemetryHUD />

          {/* Mode strip: the current mode, named in words as well as colour. */}
          <div className="pointer-events-none absolute left-0 right-0 top-0 flex items-center gap-2 px-3 py-2">
            <span
              className="readout border px-2 py-[3px] text-[9px] uppercase tracking-[0.14em]"
              style={{ color: visual.text, borderColor: visual.border, background: visual.wash }}
            >
              {mode}
            </span>
            <span className="readout border border-hairline bg-surface/80 px-2 py-[3px] text-[9px] uppercase tracking-[0.14em] text-ink-dim">
              {descriptor.label}
            </span>
            <span className="readout ml-auto border border-hairline bg-surface/80 px-2 py-[3px] text-[9px] uppercase tracking-[0.14em] text-ink-dim">
              {formatMissionTime(frame?.time ?? 0)}
            </span>
          </div>
        </div>

        {/* Event timeline: the readable account of what the system just did. */}
        <div className="h-[24vh] min-h-[140px] shrink-0 border-t border-hairline lg:h-[200px]">
          <EventTimeline limit={80} />
        </div>
      </div>

      {/* ---------------- Right rail ---------------- */}
      <div className="flex w-full shrink-0 flex-col border-t border-hairline lg:w-[336px] lg:border-l lg:border-t-0">
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <SensorSnapshot onExpand={() => cmd.setSystemPanelOpen(true)} />
          <AIPipelineIndicator />

          <Panel title="Solution Health" accent={visual.accent}>
            <ConfidenceSparkline />
          </Panel>

          <Panel title="About this data" accent="#F5A524">
            <div className="flex gap-2 px-3 py-2.5">
              <Info size={12} className="mt-[2px] shrink-0 text-degraded" />
              <p className="text-[10.5px] leading-snug text-ink-dim">
                This is a client-side simulation. The filter covariance, the trajectory and the
                outage sequence are computed in your browser from a synthetic model — nothing here is
                a measurement. The same components render a live backend by changing one line in{' '}
                <code className="text-ink-muted">src/adapters/index.ts</code>.
              </p>
            </div>
          </Panel>
        </div>

        {simulationOpen && <SimulationDrawer />}
      </div>
    </div>
  );
}

/** A plain-language name for the current mode, for viewers who read words, not colours. */
function modeFor(stateId: string): string {
  switch (stateId) {
    case 'GNSS_FUSED':
      return 'GNSS + INS fusion';
    case 'GNSS_DEGRADED':
      return 'GNSS degraded';
    case 'GNSS_OUTAGE':
      return 'GNSS lost';
    case 'INS_ACTIVE':
      return 'Dead reckoning';
    case 'AI_CORRECTION':
      return 'AI correction active';
    case 'RE_FUSION':
      return 'Re-fusing';
    case 'STABILIZED':
      return 'Stabilized';
    case 'FAULT':
      return 'Sensor fault';
    default:
      return 'Aligning';
  }
}
