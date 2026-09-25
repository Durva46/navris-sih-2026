import type {
  DataSourceLabel,
  DataSourceMode,
  NavigationEvent,
  NavigationFrame,
  ScenarioId,
  TrajectoryPoint,
} from '@/types/navigation';

/**
 * The data adapter boundary.
 *
 * This interface is the whole point of the frontend architecture: components
 * never know where a frame came from. Swapping MockAdapter for ApiAdapter or
 * WebSocketAdapter is a one-line change in `adapters/index.ts` and requires no
 * component edits. If you find yourself wanting to `fetch` from a component,
 * the interface is wrong — extend it here instead.
 */

export type AdapterId = 'mock' | 'replay' | 'api' | 'websocket' | 'device';

export interface AdapterControl {
  scenario: ScenarioId;
  running: boolean;
  /** Playback rate multiplier applied to the simulation clock. */
  playbackSpeed: number;
  /** True once an operator has taken manual control of the outage sequence. */
  manualOverride: boolean;
  /**
   * Whether the AI's estimate is actually fed to the filter. The stage still runs
   * and is still displayed when this is off — the point is to show what the model
   * is and is not contributing, side by side, on the same run.
   */
  aiContribution: boolean;
}

export interface AdapterHandlers {
  onFrame: (frame: NavigationFrame) => void;
  onNavrisPoint: (point: TrajectoryPoint) => void;
  onGnssPoint: (point: TrajectoryPoint) => void;
  /** Non-frame events the adapter wants in the timeline (outage requests, rejections). */
  onEvent: (event: NavigationEvent) => void;
  onStatus: (status: AdapterStatus) => void;
}

export interface AdapterStatus {
  connected: boolean;
  /** Human-readable transport description, shown in the System panel. */
  transport: string;
  /** Nominal frames per second the adapter intends to deliver. */
  targetHz: number;
  lastFrameAt: number | null;
}

export const DEFAULT_ADAPTER_CONTROL: AdapterControl = {
  scenario: 'gnss-blackout',
  running: true,
  playbackSpeed: 1,
  manualOverride: false,
  aiContribution: true,
};

export interface DataAdapter {
  readonly id: AdapterId;
  /**
   * Provenance of everything this adapter emits. An adapter that cannot prove
   * its numbers came from hardware must report DEMO_SIMULATED, and the UI will
   * label every value accordingly. This is the guard against the product
   * accidentally making an accuracy claim it cannot support.
   */
  readonly source: DataSourceLabel;
  /**
   * What kind of stream this is, independent of `source`.
   *
   * `source` answers "where did this number come from"; `mode` answers "what
   * kind of session is the operator in". A recorded replay is `research` and
   * `RECORDED`; a simulated run is `demo` and `DEMO_SIMULATED`. Components
   * branch on this, never on the adapter identity — so adding a new adapter
   * never requires editing a component, and the UI can label itself correctly
   * from the mode alone.
   */
  readonly mode: DataSourceMode;
  readonly status: AdapterStatus;

  /** Begin emitting frames. Returns a teardown function. */
  connect(handlers: AdapterHandlers): () => void;

  /** Push new operator control down to the data source. */
  setControl(patch: Partial<AdapterControl>): void;

  /** Operator pressed "Trigger Outage". */
  requestOutage(): void;

  /** Operator pressed "Trigger Recovery". */
  requestRecovery(): void;

  /** Operator pressed "Reset". */
  reset(): void;

  dispose(): void;
}

/** Base class holding the shared plumbing so subclasses only implement `pump`. */
export abstract class BaseAdapter implements DataAdapter {
  abstract readonly id: AdapterId;
  abstract readonly source: DataSourceLabel;
  abstract readonly mode: DataSourceMode;

  protected control: AdapterControl = { ...DEFAULT_ADAPTER_CONTROL };
  protected handlers: AdapterHandlers | null = null;
  protected teardown: (() => void) | null = null;
  protected disposed = false;

  private _status: AdapterStatus = {
    connected: false,
    transport: 'not connected',
    targetHz: 0,
    lastFrameAt: null,
  };

  get status(): AdapterStatus {
    return this._status;
  }

  protected patchStatus(patch: Partial<AdapterStatus>): void {
    this._status = { ...this._status, ...patch };
    this.handlers?.onStatus(this._status);
  }

  connect(handlers: AdapterHandlers): () => void {
    this.handlers = handlers;
    this.teardown = this.start();
    this.patchStatus({ connected: true, lastFrameAt: null });
    return () => this.disconnect();
  }

  protected abstract start(): () => void;

  setControl(patch: Partial<AdapterControl>): void {
    this.control = { ...this.control, ...patch };
    this.onControlChanged(patch);
  }

  protected onControlChanged(_patch: Partial<AdapterControl>): void {
    /* subclasses may react */
  }

  requestOutage(): void {
    /* subclasses may react */
  }

  requestRecovery(): void {
    /* subclasses may react */
  }

  reset(): void {
    /* subclasses may react */
  }

  disconnect(): void {
    this.teardown?.();
    this.teardown = null;
    this.handlers = null;
    this.patchStatus({ connected: false, transport: 'not connected' });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.disconnect();
  }

  protected emitFrame(frame: NavigationFrame): void {
    if (!this.handlers) return;
    this._status = { ...this._status, lastFrameAt: frame.timestamp };
    this.handlers.onFrame(frame);
  }

  protected emitEvent(event: NavigationEvent): void {
    this.handlers?.onEvent(event);
  }
}
