import { BaseAdapter, type AdapterControl } from '@/adapters/DataAdapter';
import type { DataSourceLabel, NavigationFrame } from '@/types/navigation';

/**
 * WebSocketAdapter — stub, ready for the live-vehicle stream.
 *
 * Intended contract:
 *
 *   ws(s)://<host>/ws/nav
 *     → server : NavigationFrame  (exactly the type in types/navigation.ts)
 *     → client : AdapterControl  |  { type: 'outage' } | { type: 'recovery' } | { type: 'reset' }
 *
 * Two implementation notes the backend team should know:
 *
 *  1. If a vehicle is producing ~50 Hz, do not ship 50 messages/second over the
 *     wire. Ship at 10–20 Hz and let the frontend interpolate. The mock already
 *     runs the filter at 50 Hz internally, so this is purely a transport
 *     decision.
 *  2. Every server frame must carry `source`. The frontend renders a permanent
 *     "Demo / Simulated" or "Measured" badge from it, and will render nothing
 *     that is not explicitly labelled.
 */
export class WebSocketAdapter extends BaseAdapter {
  readonly id = 'websocket' as const;
  readonly source: DataSourceLabel = 'DEMO_SIMULATED';

  private endpoint = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/nav`;
  private socket: WebSocket | null = null;
  private reconnectTimer: number | null = null;

  configure(url: string): void {
    this.endpoint = url;
  }

  /** The endpoint this adapter will connect to. Surfaced in the System panel. */
  get url(): string {
    return this.endpoint;
  }

  protected start(): () => void {
    this.patchStatus({ transport: 'WebSocket — not implemented (awaiting backend)', targetHz: 0 });

    // Deliberately inert until the backend exists.
    return () => {
      if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
      this.socket?.close();
      this.socket = null;
    };
  }

  protected override onControlChanged(_patch: Partial<AdapterControl>): void {
    // Intentionally a no-op until the backend contract is live.
  }

  /** Not part of the DataAdapter surface; exposed for the handoff test harness. */
  handleMessage(raw: string): void {
    const frame = JSON.parse(raw) as NavigationFrame;
    this.emitFrame(frame);
  }
}
