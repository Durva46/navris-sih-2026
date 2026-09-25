import { BaseAdapter, type AdapterControl } from '@/adapters/DataAdapter';
import type { DataSourceLabel, NavigationFrame } from '@/types/navigation';

/**
 * ApiAdapter — stub, ready for backend handoff.
 *
 * Intended contract (documented so the backend team can hit it without reading
 * the frontend):
 *
 *   GET  /api/v1/nav/session        → { origin: {lat,lon,alt}, scenario, startedAt }
 *   GET  /api/v1/nav/snapshot       → NavigationFrame        (cold start / reconnect)
 *   GET  /api/v1/nav/history?since= → { samples: HistorySample[] }
 *   POST /api/v1/nav/control        → AdapterControl         (scenario, playback)
 *   POST /api/v1/nav/outage         → { triggered: true }    (operator demo trigger)
 *   POST /api/v1/nav/recovery       → { triggered: true }
 *   POST /api/v1/nav/reset          → { ok: true }
 *
 * The server emits NavigationFrame verbatim. No frontend field is invented, and
 * no field of NavigationFrame is ignored, so the swap is genuinely zero-touch.
 *
 * Until the backend exists this adapter stays disconnected and reports
 * DEMO_SIMULATED, so a half-built backend can never leak unlabelled numbers
 * into the UI.
 */
export class ApiAdapter extends BaseAdapter {
  readonly id = 'api' as const;
  readonly source: DataSourceLabel = 'DEMO_SIMULATED';

  private baseUrl = '/api/v1/nav';
  private pollHandle: number | null = null;
  private connected = false;

  /** Point the adapter at a different base URL once the backend exists. */
  configure(baseUrl: string): void {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  protected start(): () => void {
    this.patchStatus({ transport: 'REST polling — not implemented (awaiting backend)', targetHz: 0 });

    // Deliberately inert. The live implementation belongs here and nowhere else.
    const stop = () => {
      if (this.pollHandle !== null) window.clearTimeout(this.pollHandle);
      this.pollHandle = null;
      this.connected = false;
    };
    this.connected = false;
    return stop;
  }

  protected override onControlChanged(_patch: Partial<AdapterControl>): void {
    // Intentionally a no-op until the backend contract is live.
  }

  /** Not part of the DataAdapter surface; exposed for the handoff test harness. */
  async fetchSnapshot(): Promise<NavigationFrame> {
    const res = await fetch(`${this.baseUrl}/snapshot`);
    if (!res.ok) throw new Error(`NAVRIS backend returned ${res.status}`);
    return (await res.json()) as NavigationFrame;
  }

  override disconnect(): void {
    this.connected = false;
    super.disconnect();
  }

  get isConnected(): boolean {
    return this.connected;
  }
}
