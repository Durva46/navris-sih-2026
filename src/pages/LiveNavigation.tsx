import { SimulationDrawer } from '@/components/sim/SimulationDrawer';
import { NavigationMap } from '@/components/map/NavigationMap';
import { TelemetryHUD } from '@/components/hud/TelemetryHUD';
import { IntroSection } from '@/components/intro/IntroSection';
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
 *   • a short, collapsible introduction sits above everything
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
    <div className="flex min-h-0 flex-1 flex-col">
      <IntroSection />

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* ---------------- Map column ----------------
            `lg:min-h-0` lets this column shrink inside the non-scrolling desktop
            shell so the timeline cannot push the map off screen. Below `lg` it is
            sized by its content, because the page scrolls instead. */}
        <div className="flex min-w-0 flex-1 flex-col lg:min-h-0">
        {/* The map's height is declared here, on this single element, and the map
            fills it absolutely. Two separate bugs came from delegating that job
            upward through a flex chain instead:
              1. below `lg` the chain has no definite height, so `h-full` resolved
                 to 0 and the map disappeared entirely;
              2. on every viewport the MapLibre container's own stylesheet
                 overrode the `absolute` utility, collapsing it regardless.
            Owning the height in one place removes both classes of failure.

            The mobile value is a deliberate share of the viewport — a map needs
            real estate to be worth looking at — and the page scrolls below `lg`,
            so it cannot clip.

            On desktop the map takes the height left over after the introduction
            and the timeline, and it has a floor. Without a floor it collapsed to
            85px at 1024x768, because the open introduction is 329px of a 614px
            column and the map was left with the scraps. The introduction now
            yields (it is height-capped and scrolls internally), so the floor is
            affordable: at 768px tall the budget is
            768 = header + 16vh intro + 285px map + 200px timeline, where the
            header is 115px in a calm state and 154px when the state label wraps to
            a second line. The map's own overlays need 285px in the worst case —
            73px of mode strip, legend and held-fix note above, 212px of HUD and
            attribution below — so the floor is set above that rather than at a
            round number. */}
        <div className="relative h-[56vh] min-h-[300px] shrink-0 lg:h-auto lg:min-h-[285px] lg:flex-1">
          <NavigationMap>
            {/* Mode strip: the current mode, named in words as well as colour.
                Wraps rather than clips — at 320px these three chips are wider
                than the map, and all three say something a viewer should be able
                to read. It is a child of the map so that it and the legend stack
                in one column instead of both claiming the top-left corner. */}
            <div className="flex w-full flex-wrap items-center gap-1.5">
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
          </NavigationMap>
          <TelemetryHUD />
        </div>

        {/* Event timeline: the readable account of what the system just did.

            `flex flex-col` is load-bearing: `Panel` is a flex column whose body
            scrolls, but it only fills a parent that is itself a flex container.
            In a plain block wrapper the panel sized itself to its content, the
            body's `overflow-y-auto` never engaged, and the events spilled out
            below the 24vh box and over the right rail at every width under 1xl.

            The timeline is also the page's designated scroll container, so it is
            the right element to yield when the viewport is too short to honour
            every preferred height at once. `flex-[0_1_200px]` keeps 200px whenever
            the budget allows and gives up as much as 60px when it does not,
            instead of letting the column overflow and hiding the last rows below
            the fold. The header above it is not a fixed height — it grows by 39px
            when the state chip wraps to a second line — so this column has to be
            able to absorb that. */}
        <div className="flex h-[24vh] min-h-[140px] shrink-0 flex-col border-t border-hairline lg:h-[200px] lg:flex-[0_1_200px]">
          <EventTimeline limit={80} />
        </div>
      </div>

      {/* ---------------- Right rail ----------------
          `lg:overflow-y-auto` is what makes the rail scroll. Below `lg` the
          layout is a document, so the rail is sized by its content and the page
          scrolls instead — without that split, a `shrink-0` rail inside a
          non-scrolling shell is simply clipped off the bottom of the screen. */}
      <div className="flex w-full shrink-0 flex-col border-t border-hairline lg:w-[336px] lg:border-l lg:border-t-0">
        <div className="flex min-h-0 flex-1 flex-col lg:overflow-y-auto">
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
