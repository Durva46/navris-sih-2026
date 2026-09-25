import type {
  AIPipelineStage,
  DataSourceLabel,
  GNSSQuality,
  NavigationEventSeverity,
  SystemStateId,
} from '@/types/navigation';

/** Coarse health bucket for a state, used for layout emphasis and screen-reader text. */
export type SystemStateSeverity =
  | 'info'
  | 'nominal'
  | 'degraded'
  | 'outage'
  | 'ai'
  | 'recovering';

/**
 * The state colour language. One table, used by every surface: the top-bar
 * indicator, the map tint, the trajectory lines, the timeline dots, the
 * sparkline stroke, the panel accents and the analytics charts.
 *
 * The rule the product depends on: a judge must be able to read system health
 * from colour alone, from across a room, before reading a single word.
 */

export interface StateVisual {
  /** Primary accent for this state. */
  accent: string;
  /** Low-alpha wash used for map tints and panel backgrounds. */
  wash: string;
  /** Border colour for panels keyed to this state. */
  border: string;
  /** Text colour that passes AA on the base surface. */
  text: string;
  /** Monospace hex, for the HUD / telemetry strips. */
  hex: string;
  /** Whether the accent should carry a slow "recovering" pulse. */
  pulse: boolean;
}

export const STATE_VISUALS: Readonly<Record<SystemStateId, StateVisual>> = {
  INITIALISING: {
    accent: '#8C9AB2',
    wash: 'rgba(140,154,178,0.10)',
    border: '#243146',
    text: '#C3CCDA',
    hex: '#8C9AB2',
    pulse: true,
  },
  GNSS_FUSED: {
    accent: '#2DD4BF',
    wash: 'rgba(45,212,191,0.10)',
    border: 'rgba(45,212,191,0.35)',
    text: '#5EEAD4',
    hex: '#2DD4BF',
    pulse: false,
  },
  GNSS_DEGRADED: {
    accent: '#F5A524',
    wash: 'rgba(245,165,36,0.12)',
    border: 'rgba(245,165,36,0.40)',
    text: '#FBBF4C',
    hex: '#F5A524',
    pulse: false,
  },
  GNSS_OUTAGE: {
    accent: '#F04E3E',
    wash: 'rgba(240,78,62,0.14)',
    border: 'rgba(240,78,62,0.45)',
    text: '#FB7185',
    hex: '#F04E3E',
    pulse: true,
  },
  INS_ACTIVE: {
    accent: '#F97316',
    wash: 'rgba(249,115,22,0.12)',
    border: 'rgba(249,115,22,0.40)',
    text: '#FDBA74',
    hex: '#F97316',
    pulse: false,
  },
  AI_CORRECTION: {
    accent: '#8B7BF7',
    wash: 'rgba(139,123,247,0.14)',
    border: 'rgba(139,123,247,0.45)',
    text: '#A99BFF',
    hex: '#8B7BF7',
    pulse: true,
  },
  RE_FUSION: {
    accent: '#4ADE80',
    wash: 'rgba(74,222,128,0.14)',
    border: 'rgba(74,222,128,0.45)',
    text: '#86EFAC',
    hex: '#4ADE80',
    pulse: true,
  },
  STABILIZED: {
    accent: '#34D399',
    wash: 'rgba(52,211,153,0.12)',
    border: 'rgba(52,211,153,0.40)',
    text: '#6EE7B7',
    hex: '#34D399',
    pulse: true,
  },
  FAULT: {
    accent: '#F04E3E',
    wash: 'rgba(240,78,62,0.18)',
    border: 'rgba(240,78,62,0.55)',
    text: '#FDA4AF',
    hex: '#F04E3E',
    pulse: true,
  },
};

export interface StateDescriptor {
  label: string;
  detail: string;
  severity: SystemStateSeverity;
}

/** Badge copy. `detail` is written to be read aloud by a judge. */
export const STATE_DESCRIPTORS: Readonly<Record<SystemStateId, StateDescriptor>> = {
  INITIALISING: {
    label: 'INITIALISING',
    detail: 'Aligning strapdown platform, seeding covariance — no fix published yet.',
    severity: 'info',
  },
  GNSS_FUSED: {
    label: 'GNSS FUSED',
    detail: 'GNSS and ESKF accepting updates normally. Position continuity nominal.',
    severity: 'nominal',
  },
  GNSS_DEGRADED: {
    label: 'GNSS DEGRADED',
    detail: 'GNSS quality falling. Innovation gate widening, confidence reduced.',
    severity: 'degraded',
  },
  GNSS_OUTAGE: {
    label: 'GNSS OUTAGE',
    detail: 'GNSS lost. No position update is arriving. NAVRIS is coasting on INS.',
    severity: 'outage',
  },
  INS_ACTIVE: {
    label: 'INS · DEAD RECKONING',
    detail: 'Propagating position from IMU dead reckoning. Uncertainty growing.',
    severity: 'outage',
  },
  AI_CORRECTION: {
    label: 'AI CORRECTION',
    detail: 'Model estimating IMU error and feeding a correction into the ESKF.',
    severity: 'ai',
  },
  RE_FUSION: {
    label: 'RE-FUSION',
    detail: 'GNSS returned. Re-acquiring lock and converging onto the new fixes.',
    severity: 'recovering',
  },
  STABILIZED: {
    label: 'STABILIZED',
    detail: 'Covariance settled. Solution returned to nominal GNSS-fused quality.',
    severity: 'recovering',
  },
  FAULT: {
    label: 'SENSOR FAULT',
    detail: 'A sensor has failed integrity checks. Solution is not trustworthy.',
    severity: 'outage',
  },
};

export function visualForState(id: SystemStateId): StateVisual {
  return STATE_VISUALS[id] ?? STATE_VISUALS.INITIALISING;
}

export function descriptorForState(id: SystemStateId): StateDescriptor {
  return STATE_DESCRIPTORS[id] ?? STATE_DESCRIPTORS.INITIALISING;
}

/** Trajectory channel colours: GNSS is measured truth (when available), NAVRIS is the product. */
export const TRAJECTORY_COLORS = {
  navris: '#2DD4BF',
  gnss: '#94A3B8',
  truth: '#F5A524',
} as const;

export const SEVERITY_COLORS: Readonly<Record<NavigationEventSeverity, string>> = {
  info: '#8C9AB2',
  caution: '#FBBF4C',
  warning: '#F5A524',
  critical: '#FB7185',
  success: '#6EE7B7',
};

export const GNSS_QUALITY_COLORS: Readonly<Record<GNSSQuality, string>> = {
  NOMINAL: '#2DD4BF',
  DEGRADED: '#F5A524',
  OUTAGE: '#F04E3E',
};

export const AI_STAGE_COLORS: Readonly<Record<AIPipelineStage, string>> = {
  IDLE: '#3A4557',
  IMU_WINDOW: '#5EEAD4',
  FEATURES: '#8B7BF7',
  INFERENCE: '#A99BFF',
  CORRECTION: '#8B7BF7',
  FUSED: '#2DD4BF',
};

export const AI_STAGE_LABELS: Readonly<Record<AIPipelineStage, string>> = {
  IDLE: 'Idle',
  IMU_WINDOW: 'IMU Window',
  FEATURES: 'Motion Features',
  INFERENCE: 'AI Inference',
  CORRECTION: 'Error Correction',
  FUSED: 'ESKF Fusion',
};

export const DATA_SOURCE_LABEL: Readonly<Record<DataSourceLabel, string>> = {
  DEMO_SIMULATED: 'Demo / Simulated',
  MEASURED: 'Measured',
  RECORDED: 'Recorded / Research',
};
