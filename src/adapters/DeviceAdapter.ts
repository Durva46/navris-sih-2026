import { BaseAdapter } from '@/adapters/DataAdapter';
import type { DataSourceLabel } from '@/types/navigation';

/**
 * DeviceAdapter — the hardware seam, intentionally not implemented.
 *
 * This file exists to hold a boundary, not to reach hardware. The strategy puts
 * Device Adapter in phase 4 with native bridge work on iOS and Android, and the
 * desktop demo has no device to read. Creating the seam now means the shape is
 * settled before any native code exists, and — more importantly — it means
 * "no device support" is represented by a class that says so, rather than by an
 * absence someone later fills in with a `fetch`.
 *
 * The contract a real implementation must honour:
 *
 * - `source` flips to `MEASURED` only when values genuinely originate from a
 *   receiver or IMU. Not when a native bridge merely exists.
 * - Raw sensor samples are **not** `NavigationFrame`s. A device adapter publishes
 *   IMU/fix samples, and the engine turns them into frames, so the filter and the
 *   state machine stay the single owner of the solution. No adapter may hand the
 *   UI a position it did not get from the engine.
 * - Native bridges stay behind this file. `DeviceAdapter` is the only module that
 *   may know a bridge exists; no component may import one.
 * - Availability is orthogonal, exactly as with map tiles: a device that stops
 *   reporting is an availability event, and must not be conflated with the GNSS
 *   denial the demo scripts deliberately.
 */
export class DeviceAdapter extends BaseAdapter {
  readonly id = 'device' as const;
  /** Not MEASURED: nothing is read yet, so nothing may be claimed as measured. */
  readonly source: DataSourceLabel = 'DEMO_SIMULATED';
  readonly mode = 'live' as const;

  protected start(): () => void {
    this.patchStatus({
      transport: 'no device bridge',
      targetHz: 0,
    });
    // Deliberately inert. Connect returns without emitting, and the UI shows an
    // unconnected adapter — which is the truthful state.
    return () => undefined;
  }
}
