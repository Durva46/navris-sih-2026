import { descriptorForState, visualForState } from '@/theme/stateColors';
import type {
  AIPipelineStage,
  DataSourceLabel,
  GNSSQuality,
  NavigationFrame,
  SystemStateId,
  Uncertainty,
} from '@/types/navigation';

/**
 * Selectors — pure derivations over the store.
 *
 * Components read state through these, never by reaching into the frame
 * directly for anything that needs interpretation. Keeping the interpretation
 * in one place is what makes the state colour language consistent across the
 * top bar, the map, the timeline and the charts.
 */

export function selectStateId(f: NavigationFrame | null): SystemStateId {
  return f?.state.id ?? 'INITIALISING';
}

export function selectIsDenyingGnss(f: NavigationFrame | null): boolean {
  const s = selectStateId(f);
  return (
    s === 'GNSS_OUTAGE' || s === 'INS_ACTIVE' || s === 'AI_CORRECTION' || s === 'RE_FUSION'
  );
}

export function selectGnssQuality(f: NavigationFrame | null): GNSSQuality {
  return f?.gnss.quality ?? 'OUTAGE';
}

export function selectUncertaintyRadius(f: NavigationFrame | null): number {
  if (!f) return 0;
  return Math.max(f.navris.uncertainty.sigmaEast, f.navris.uncertainty.sigmaNorth);
}

export function selectConfidence(f: NavigationFrame | null): number {
  return f?.navris.uncertainty.confidence ?? 0;
}

export function selectUncertainty(f: NavigationFrame | null): Uncertainty | null {
  return f?.navris.uncertainty ?? null;
}

export function selectAiStage(f: NavigationFrame | null): AIPipelineStage {
  return f?.ai.stage ?? 'IDLE';
}

export function selectSourceLabel(f: NavigationFrame | null): DataSourceLabel {
  return f?.source ?? 'DEMO_SIMULATED';
}

export function selectStateDescriptor(f: NavigationFrame | null) {
  return descriptorForState(selectStateId(f));
}

export function selectStateVisual(f: NavigationFrame | null) {
  return visualForState(selectStateId(f));
}

/**
 * Human-readable "what is the system doing" summary. Used by the aria-live
 * region and the System panel, so the state is available to assistive tech and
 * to anyone not relying on colour.
 */
export function selectStateSummary(f: NavigationFrame | null): string {
  if (!f) return 'Initialising. No navigation data received yet.';
  const d = descriptorForState(f.state.id);
  const parts = [
    d.label,
    d.detail,
    `In this state for ${f.state.dwellSeconds.toFixed(1)} seconds.`,
    `Horizontal 1-sigma ${f.navris.uncertainty.sigmaEast.toFixed(2)} by ${f.navris.uncertainty.sigmaNorth.toFixed(2)} metres.`,
    f.gnss.available
      ? `GNSS available, ${f.gnss.satellitesUsed} satellites, HDOP ${f.gnss.hdop.toFixed(1)}.`
      : `GNSS unavailable for ${f.gnss.secondsSinceFix.toFixed(1)} seconds.`,
  ];
  return parts.join(' ');
}

/** Whether the AI correction stage is currently contributing to the solution. */
export function selectAiContributing(f: NavigationFrame | null): boolean {
  return f?.ai.active === true;
}
