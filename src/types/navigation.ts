/**
 * NAVRIS core domain contracts.
 *
 * These types are the seam between the frontend and any data source. They are
 * deliberately backend-agnostic: a component consuming a `NavigationFrame` from
 * MockAdapter today must work unchanged against ApiAdapter / WebSocketAdapter
 * tomorrow. Nothing in this file may import from a concrete adapter, a browser
 * API, or React.
 */

/** WGS-84 geodetic position. `alt` is ellipsoidal height in metres. */
export interface Position {
  lat: number;
  lon: number;
  alt: number;
}

/** Body-frame-independent velocity in the local ENU frame. m/s. */
export interface Velocity {
  /** East (m/s) */
  east: number;
  /** North (m/s) */
  north: number;
  /** Up (m/s) */
  up: number;
}

export type HeadingSource = 'GNSS' | 'DEAD_RECKONING' | 'FUSED' | 'AI_CORRECTED';

/** Vehicle heading in degrees clockwise from true north, 0..360. */
export interface Heading {
  deg: number;
  source: HeadingSource;
}

/** Local East-North-Up offset from the active reference origin, in metres. */
export interface EnuOffset {
  east: number;
  north: number;
  up: number;
}

/** 2x2 position uncertainty expressed in the local ENU frame. */
export interface Uncertainty {
  /** Std-dev of the East axis error, metres. */
  sigmaEast: number;
  /** Std-dev of the North axis error, metres. */
  sigmaNorth: number;
  /** Correlation of the East/North error terms, -1..1. */
  correlation: number;
  /** Heading std-dev, degrees. */
  sigmaHeadingDeg: number;
  /**
   * Normalised 0..1 solution confidence derived from the covariance trace.
   * Presented as a relative health signal only — NEVER as an accuracy claim.
   */
  confidence: number;
}

export type GNSSFixType = 'NONE' | 'SINGLE' | 'DGPS' | 'RTK_FLOAT' | 'RTK_FIXED';
export type GNSSQuality = 'NOMINAL' | 'DEGRADED' | 'OUTAGE';

export interface GNSSStatus {
  available: boolean;
  quality: GNSSQuality;
  fixType: GNSSFixType;
  satellitesUsed: number;
  satellitesVisible: number;
  /** Horizontal dilution of precision, dimensionless. */
  hdop: number;
  /** Most recent GNSS-derived position. Frozen during outage — that is the point. */
  lastFix: Position | null;
  /** Time since the last accepted fix, seconds. */
  secondsSinceFix: number;
  /** Reported carrier-to-noise density of the reference satellite, dB-Hz. */
  cn0: number;
}

export type IMUHealth = 'OK' | 'WARMING' | 'FAULT';

export interface IMUStatus {
  health: IMUHealth;
  /** Sample rate, Hz. */
  sampleRateHz: number;
  /** Roll / pitch / yaw, degrees. */
  roll: number;
  pitch: number;
  yaw: number;
  /** Specific force, m/s^2, body frame. */
  accel: { x: number; y: number; z: number };
  /** Angular rate, deg/s, body frame. */
  gyro: { x: number; y: number; z: number };
  /** Die temperature, degrees C. */
  temperatureC: number;
  /** Bias estimate currently folded into the strapdown propagation, m/s^2. */
  accelBias: { x: number; y: number; z: number };
  gyroBias: { x: number; y: number; z: number };
}

export type ESKFHealth = 'INITIALISING' | 'RUNNING' | 'REACQUIRING' | 'DEGRADED';

export interface ESKFStatus {
  health: ESKFHealth;
  /** Normalised Innovation Squared, chi-square gate statistic. */
  nis: number;
  /** Number of measurement updates accepted by the innovation gate. */
  updatesAccepted: number;
  /** Number of measurement updates rejected by the innovation gate. */
  updatesRejected: number;
  /** Number of error states currently in the covariance. */
  errorStates: number;
  /** Propagation step time. */
  predictionHz: number;
  /** True while the filter is coasting on INS only. */
  inertialOnly: boolean;
}

export type AIPipelineStage =
  | 'IDLE'
  | 'IMU_WINDOW'
  | 'FEATURES'
  | 'INFERENCE'
  | 'CORRECTION'
  | 'FUSED';

/** The ordered stages of the AI correction stage inside the fusion pipeline. */
export const AI_PIPELINE_STAGES: readonly AIPipelineStage[] = [
  'IMU_WINDOW',
  'FEATURES',
  'INFERENCE',
  'CORRECTION',
  'FUSED',
];

export interface AIStatus {
  active: boolean;
  stage: AIPipelineStage;
  /** Sliding window length fed to the model, samples. */
  windowSamples: number;
  /** Number of features extracted from the current window. */
  featureCount: number;
  /**
   * Model-predicted IMU error, m/s^2. This is a *correction input* to the ESKF,
   * presented as a correction magnitude — not as an accuracy percentage.
   */
  predictedError: { x: number; y: number; z: number };
  /** Inference wall time, milliseconds. */
  inferenceMs: number;
  /** Model confidence in the current correction, 0..1. */
  modelConfidence: number;
  /** Number of correction events applied since the last reset. */
  correctionsApplied: number;
}

export type SystemStateId =
  | 'INITIALISING'
  | 'GNSS_FUSED'
  | 'GNSS_DEGRADED'
  | 'GNSS_OUTAGE'
  | 'INS_ACTIVE'
  | 'AI_CORRECTION'
  | 'RE_FUSION'
  | 'STABILIZED'
  | 'FAULT';

/** The declared legal transitions of the NAVRIS navigation state machine. */
export const SYSTEM_STATE_TRANSITIONS: Readonly<Record<SystemStateId, readonly SystemStateId[]>> = {
  INITIALISING: ['GNSS_FUSED', 'GNSS_DEGRADED', 'FAULT'],
  GNSS_FUSED: ['GNSS_DEGRADED', 'GNSS_OUTAGE', 'FAULT'],
  GNSS_DEGRADED: ['GNSS_FUSED', 'GNSS_OUTAGE', 'FAULT'],
  GNSS_OUTAGE: ['INS_ACTIVE', 'GNSS_FUSED', 'FAULT'],
  INS_ACTIVE: ['AI_CORRECTION', 'RE_FUSION', 'FAULT'],
  AI_CORRECTION: ['RE_FUSION', 'INS_ACTIVE', 'FAULT'],
  RE_FUSION: ['STABILIZED', 'AI_CORRECTION', 'INS_ACTIVE'],
  STABILIZED: ['GNSS_FUSED', 'GNSS_DEGRADED', 'FAULT'],
  FAULT: ['INITIALISING'],
};

export interface SystemState {
  id: SystemStateId;
  /** Short badge text, e.g. "INS ACTIVE". */
  label: string;
  /** One-line explanation shown under the indicator. Judges read this. */
  detail: string;
  /** Monotonic uptime in this state, seconds. */
  dwellSeconds: number;
  /** Wall-clock ms at which the state was entered. */
  since: number;
}

export type NavigationEventKind =
  | 'STATE'
  | 'GNSS'
  | 'INS'
  | 'AI'
  | 'ESKF'
  | 'SIM';

export type NavigationEventSeverity = 'info' | 'caution' | 'warning' | 'critical' | 'success';

export interface NavigationEvent {
  id: string;
  /** Epoch milliseconds. */
  timestamp: number;
  kind: NavigationEventKind;
  severity: NavigationEventSeverity;
  /** Short headline, e.g. "GNSS OUTAGE DETECTED". */
  title: string;
  /** Human-readable explanation of what the system did and why. */
  message: string;
  /** State the system moved into, when kind === 'STATE'. */
  state?: SystemStateId;
  /** Data-source provenance for this event. Never "measured" unless it truly is. */
  source: DataSourceLabel;
}

export interface TrajectoryPoint {
  /** Epoch ms. */
  t: number;
  position: Position;
  enu: EnuOffset;
  /** Speed over ground, m/s. */
  speed: number;
  headingDeg: number;
  /** Uncertainty attached to this fix, for rendering the corridor. */
  uncertainty: Uncertainty;
}

export type TrajectoryChannel = 'gnss' | 'navris';

export interface Trajectory {
  channel: TrajectoryChannel;
  points: TrajectoryPoint[];
}

/**
 * Provenance of a value or event. `MEASURED` is reserved for data that came from
 * real hardware and has been verified — the mock pipeline must never emit it.
 */
export type DataSourceLabel = 'DEMO_SIMULATED' | 'MEASURED';

/** Aggregate performance metrics. Only meaningful in DEMO_SIMULATED mode. */
export interface NavigationErrorMetrics {
  /** Horizontal position error, metres. */
  positionError: number;
  /** Velocity error magnitude, m/s. */
  velocityError: number;
  /** Heading error magnitude, degrees. */
  headingError: number;
  /** Horizontal error as a percentage of the active uncertainty ellipse. */
  errorOverSigma: number;
}

/** The complete, self-describing unit of navigation data crossing the adapter boundary. */
export interface NavigationFrame {
  /** Epoch ms. */
  timestamp: number;
  /** Monotonic seconds since the stream started. */
  time: number;
  state: SystemState;
  navris: {
    position: Position;
    enu: EnuOffset;
    velocity: Velocity;
    speed: number;
    heading: Heading;
    uncertainty: Uncertainty;
  };
  gnss: GNSSStatus;
  imu: IMUStatus;
  eskf: ESKFStatus;
  ai: AIStatus;
  metrics: NavigationErrorMetrics;
  /** Region currently shadowing GNSS, in local ENU metres. Null when clear. */
  outageRegion: OutageRegion | null;
  source: DataSourceLabel;
}

/** A GNSS-denied region (tunnel, urban canyon, blackout) in local ENU metres. */
export interface OutageRegion {
  label: string;
  /** Axis-aligned ENU bounds. */
  minEast: number;
  maxEast: number;
  minNorth: number;
  maxNorth: number;
}

export type ScenarioId = 'highway' | 'urban' | 'tunnel' | 'sharp-turn' | 'gnss-blackout';

export interface ScenarioProfile {
  id: ScenarioId;
  name: string;
  summary: string;
  /** Target cruise speed, m/s. */
  targetSpeed: number;
  /** Lateral path curvature, 1/m. Drives the heading rate. */
  curvature: number;
  /** Broadband road noise injected into the IMU, m/s^2. */
  imuNoise: number;
  /** Gyro scale-factor drift, fraction. */
  gyroDrift: number;
  /** Baseline horizontal 1-sigma under nominal GNSS, metres. */
  nominalSigma: number;
  /** 1-sigma growth rate while coasting on INS only, m/s. */
  driftSigmaPerSec: number;
  /** Fractional speed oscillation for stop-and-go traffic, 0..1. */
  speedOscillation: number;
  /** Period of the speed oscillation, seconds. */
  speedOscillationPeriod: number;
  /** Lateral path wander from road roughness, metres. */
  roadNoise: number;
  /** Scenario plays the full outage sequence on its own unless the operator intervenes. */
  scripted: boolean;
  /** Seconds into the scenario at which scripted mode injects a degradation, if any. */
  scriptedOutageAt: number | null;
  /** Seconds of outage injected by the script, if any. */
  scriptedOutageDuration: number | null;
}
