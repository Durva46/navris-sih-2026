import type { AdapterId, DataAdapter } from '@/adapters/DataAdapter';
import { ApiAdapter } from '@/adapters/ApiAdapter';
import { DeviceAdapter } from '@/adapters/DeviceAdapter';
import { MockAdapter } from '@/adapters/MockAdapter';
import { ReplayAdapter } from '@/adapters/ReplayAdapter';
import { WebSocketAdapter } from '@/adapters/WebSocketAdapter';

/**
 * THE ONE-LINE SWAP.
 *
 * Change ACTIVE_ADAPTER below and the entire application switches data sources
 * with zero component changes. This is the acceptance criterion "swapping
 * MockAdapter for a stub ApiAdapter requires no changes to any component" --
 * it is enforced here, at the factory, and nowhere else.
 *
 * Note what the registry does *not* contain: any mode-specific or
 * provenance-specific rendering. Components cannot need changing for a new
 * adapter precisely because the adapter declares its own `mode` and `source`,
 * and the UI reads those.
 */
export const ACTIVE_ADAPTER: AdapterId = 'mock';

const registry: Record<AdapterId, () => DataAdapter> = {
  mock: () => new MockAdapter(),
  replay: () => new ReplayAdapter(),
  api: () => new ApiAdapter(),
  websocket: () => new WebSocketAdapter(),
  device: () => new DeviceAdapter(),
};

let instance: DataAdapter | null = null;

/** Create (or return) the singleton adapter for the active id. */
export function getAdapter(): DataAdapter {
  if (instance && instance.id === ACTIVE_ADAPTER) return instance;
  instance?.dispose();
  instance = registry[ACTIVE_ADAPTER]();
  return instance;
}

export function setAdapterId(id: AdapterId): void {
  if (id === ACTIVE_ADAPTER) return;
  // Reloading is the honest behaviour: the service owns the subscription
  // lifecycle, and re-creating it here is less error-prone than hot-swapping.
  instance?.dispose();
  instance = null;
  location.reload();
}

/** Display name of the active data source, surfaced in the Simulation panel. */
export function activeAdapterLabel(): string {
  const map: Record<AdapterId, string> = {
    mock: 'MockAdapter',
    replay: 'ReplayAdapter',
    api: 'ApiAdapter (stub)',
    websocket: 'WebSocketAdapter (stub)',
    device: 'DeviceAdapter (seam)',
  };
  return map[ACTIVE_ADAPTER];
}

export { ApiAdapter, DeviceAdapter, MockAdapter, ReplayAdapter, WebSocketAdapter };
export type { DataAdapter, AdapterId, AdapterControl, AdapterHandlers, AdapterStatus } from '@/adapters/DataAdapter';
