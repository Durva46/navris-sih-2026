import type {
  DataSourceLabel,
  NavigationEvent,
  NavigationFrame,
  ScenarioId,
  SystemStateId,
  TrajectoryPoint,
} from '@/types/navigation';

/**
 * Mutable high-frequency store.
 *
 * React re-renders are ~50x more expensive than a canvas draw, so live
 * telemetry does not live in React state. It lives here, in plain mutable
 * fields, and the map canvas reads it directly inside a requestAnimationFrame
 * loop — 60 fps with no reconciliation. React components that need to *print*
 * numbers subscribe through `useTelemetry`, which re-renders at a controlled
 * low rate (10 Hz by default) rather than 50 Hz.
 *
 * Low-frequency, user-visible state (events, controls, adapter status) stays in
 * a reducer, because those genuinely belong in React's model.
 */

export interface HistorySample {
  /** Simulation clock, seconds. */
  t: number;
  positionError: number;
  velocityError: number;
  headingError: number;
  sigmaEast: number;
  sigmaNorth: number;
  confidence: number;
  nis: number;
  updatesAccepted: number;
  updatesRejected: number;
  gnssAvailable: 0 | 1;
  aiActive: 0 | 1;
  state: SystemStateId;
  speed: number;
  accelMag: number;
  gyroMag: number;
}

export interface StoreControl {
  scenario: ScenarioId;
  running: boolean;
  playbackSpeed: number;
  manualOverride: boolean;
  /** Whether the AI's estimate is actually fed to the filter. */
  aiContribution: boolean;
}

export interface StoreStatus {
  connected: boolean;
  transport: string;
  targetHz: number;
  lastFrameAt: number | null;
}

const MAX_NAVRIS_POINTS = 2400;
const MAX_GNSS_POINTS = 1200;
const MAX_EVENTS = 250;
const HISTORY_HZ = 5;
const HISTORY_MAX = 1800;

export class NavigationStore {
  frame: NavigationFrame | null = null;
  navrisPath: TrajectoryPoint[] = [];
  gnssPath: TrajectoryPoint[] = [];
  history: HistorySample[] = [];
  events: NavigationEvent[] = [];
  control: StoreControl = {
    scenario: 'gnss-blackout',
    running: true,
    playbackSpeed: 1,
    manualOverride: false,
    aiContribution: true,
  };
  status: StoreStatus = {
    connected: false,
    transport: 'not connected',
    targetHz: 0,
    lastFrameAt: null,
  };
  source: DataSourceLabel = 'DEMO_SIMULATED';
  /** Bumped on every mutation. Consumers compare it to decide whether to re-render. */
  version = 0;
  /** Bumped only when the event log changes, so the timeline re-renders rarely. */
  eventVersion = 0;

  private historyAccumulator = 0;
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private bump(): void {
    this.version++;
    for (const l of this.listeners) l();
  }

  private bumpEvents(): void {
    this.eventVersion++;
    for (const l of this.listeners) l();
  }

  setFrame(frame: NavigationFrame): void {
    this.frame = frame;
    this.source = frame.source;

    // History is sampled, not per-tick: 5 Hz is plenty for the analytics
    // charts and keeps a 30-minute session bounded.
    this.historyAccumulator += 1 / 50;
    if (this.historyAccumulator >= 1 / HISTORY_HZ) {
      this.historyAccumulator = 0;
      this.pushHistory(this.toSample(frame));
    }
    this.bump();
  }

  private toSample(frame: NavigationFrame): HistorySample {
    return {
      t: frame.time,
      positionError: frame.metrics.positionError,
      velocityError: frame.metrics.velocityError,
      headingError: frame.metrics.headingError,
      sigmaEast: frame.navris.uncertainty.sigmaEast,
      sigmaNorth: frame.navris.uncertainty.sigmaNorth,
      confidence: frame.navris.uncertainty.confidence,
      nis: frame.eskf.nis,
      updatesAccepted: frame.eskf.updatesAccepted,
      updatesRejected: frame.eskf.updatesRejected,
      gnssAvailable: frame.gnss.available ? 1 : 0,
      aiActive: frame.ai.active ? 1 : 0,
      state: frame.state.id,
      speed: frame.navris.speed,
      accelMag: Math.hypot(frame.imu.accel.x, frame.imu.accel.y, frame.imu.accel.z),
      gyroMag: Math.hypot(frame.imu.gyro.x, frame.imu.gyro.y, frame.imu.gyro.z),
    };
  }

  private pushHistory(s: HistorySample): void {
    this.history.push(s);
    if (this.history.length > HISTORY_MAX) {
      // Decimate rather than shift: O(1), and it preserves the whole envelope.
      this.history = this.history.filter((_, i) => i % 2 === 0);
    }
  }

  pushNavrisPoint(p: TrajectoryPoint): void {
    this.navrisPath.push(p);
    if (this.navrisPath.length > MAX_NAVRIS_POINTS) this.navrisPath.shift();
  }

  pushGnssPoint(p: TrajectoryPoint): void {
    this.gnssPath.push(p);
    if (this.gnssPath.length > MAX_GNSS_POINTS) this.gnssPath.shift();
  }

  pushEvent(e: NavigationEvent): void {
    this.events.unshift(e);
    if (this.events.length > MAX_EVENTS) this.events.pop();
    this.bumpEvents();
  }

  setControl(patch: Partial<StoreControl>): void {
    this.control = { ...this.control, ...patch };
    this.bump();
  }

  setStatus(s: StoreStatus): void {
    this.status = s;
    this.bump();
  }

  clearPaths(): void {
    this.navrisPath = [];
    this.gnssPath = [];
    this.bump();
  }

  resetAll(): void {
    this.navrisPath = [];
    this.gnssPath = [];
    this.history = [];
    this.events = [];
    this.frame = null;
    this.historyAccumulator = 0;
    this.bumpEvents();
    this.bump();
  }
}

export const navigationStore = new NavigationStore();
