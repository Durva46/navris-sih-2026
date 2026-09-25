import { BaseAdapter, type AdapterControl } from '@/adapters/DataAdapter';
import { DEMO_ORIGIN, positionToEnu } from '@/lib/geo';
import type { DataSourceLabel, EnuOffset, NavigationFrame, TrajectoryPoint } from '@/types/navigation';

/**
 * ReplayAdapter — the research data path.
 *
 * This is a **seam, not an implementation**. It exists now so the architecture is
 * proven before any dataset exists: the strategy requires that a recorded run can
 * be replayed on the real map, with the engine driven by stored frames instead of
 * the live simulation, and with nothing outside this file needing to change.
 *
 * The design decision that matters:
 *
 * **Replay reuses the existing frame pipeline, not the filter.** A recorded run is
 * a sequence of `NavigationFrame`s. Feeding those to the store, the state machine,
 * the map, and the charts means a replay is *indistinguishable* from a live run
 * downstream — which is exactly what makes it a trustworthy research tool. The
 * filter is not re-run: re-integrating a recorded solution would produce a
 * different trajectory, and the whole value of a recording is that it is the run
 * that actually happened.
 *
 * When this is implemented, the loader should accept a JSONL export of frames
 * (the same shape `scripts/verify-demo.mjs` already asserts) and drive playback
 * through the same `AdapterControl` fields — `running`, `playbackSpeed`,
 * `scenario` — so the existing transport controls drive a replay unchanged.
 *
 * ## What is deliberately absent
 *
 * - No bundled dataset. There is no recorded run to ship yet.
 * - No `Math.random()`. Replays must be bit-identical across runs, or they cannot
 *   be used to compare two filter configurations.
 * - No map matching, and no re-derivation of positions from the basemap.
 *
 * ## What a consumer may rely on today
 *
 * `mode` is `research` and `source` is `RECORDED`. Because `RECORDED` is a distinct
 * provenance from `MEASURED`, a replay cannot claim live authority: a recording is
 * a real measurement that happened at some other time, and the UI says so.
 */
export class ReplayAdapter extends BaseAdapter {
  readonly id = 'replay' as const;
  readonly source: DataSourceLabel = 'RECORDED';
  readonly mode = 'research' as const;

  /**
   * Loaded recording, if one has been supplied. Null until a dataset is attached,
   * which is the state the demo ships in.
   */
  private frames: NavigationFrame[] | null = null;
  private cursor = 0;

  /**
   * Timestamp of the frame currently being played, or null while stopped.
   * Read by the transport UI to show where in the recording the playhead sits.
   */
  private playhead: number | null = null;

  /**
   * Attach a recorded run. Recorded frames must be stamped `research` on the way
   * in, whatever the file claims: provenance in the UI comes from the adapter, not
   * from data on disk that a stray export could have mislabelled.
   */
  load(frames: NavigationFrame[]): void {
    this.frames = frames.map((f) => ({ ...f, source: 'RECORDED', sourceMode: 'research' }));
    this.cursor = 0;
    this.playhead = this.frames[0]?.timestamp ?? null;
  }

  /** Number of frames in the attached recording, 0 when none is loaded. */
  get length(): number {
    return this.frames?.length ?? 0;
  }

  get loaded(): boolean {
    return this.frames !== null && this.frames.length > 0;
  }

  /** Playhead position in epoch ms, or null when the transport is stopped. */
  get currentTimestamp(): number | null {
    return this.playhead;
  }

  protected start(): () => void {
    this.patchStatus({
      transport: this.loaded ? 'recorded dataset' : 'no dataset attached',
      targetHz: 50,
    });

    if (!this.loaded) {
      // Not an error. An empty replay adapter is a valid, inert state, and it is
      // the shipped state. It reports honestly rather than pretending to stream.
      return () => undefined;
    }

    const tick = () => {
      const frame = this.frames?.[this.cursor];
      if (!frame) return;
      this.emitFrame(frame);
      this.playhead = frame.timestamp;
      this.cursor += 1;
      if (this.cursor >= (this.frames?.length ?? 0)) this.cursor = 0; // loop the run
    };

    const timer = window.setInterval(tick, 1000 / 50);
    return () => window.clearInterval(timer);
  }

  protected onControlChanged(patch: Partial<AdapterControl>): void {
    // Scrub support belongs here: `running` and `playbackSpeed` should drive a
    // replay through the same transport controls that already drive the demo.
    if (patch.running === false) this.playhead = null;
  }

  override requestOutage(): void {
    // A recording contains the outage it recorded. The operator cannot request
    // one, because inventing an outage that did not happen would be fabrication.
  }

  override requestRecovery(): void {
    /* likewise: recovery is part of the recording, not operator-driven */
  }

  override reset(): void {
    this.cursor = 0;
    this.playhead = this.frames?.[0]?.timestamp ?? null;
  }

  /**
   * Trajectory extraction for a loaded recording.
   *
   * Returns the NAVRIS and GNSS tracks the map would draw, so a dataset can be
   * inspected before playback without touching the store.
   *
   * Note the asymmetry in what is available, which is a property of the
   * recording rather than of this code: a `NavigationFrame` carries the fused
   * ENU solution and the *geographic* last GNSS fix, but no GNSS ENU offset. A
   * GNSS track in ENU therefore only exists where a fix was actually present, and
   * is empty across a denied stretch — the same information loss the real
   * receiver has, preserved rather than papered over.
   */
  trajectories(): { navris: TrajectoryPoint[]; gnss: TrajectoryPoint[] } {
    const navris: TrajectoryPoint[] = [];
    const gnss: TrajectoryPoint[] = [];
    for (const f of this.frames ?? []) {
      navris.push({
        t: f.timestamp,
        position: f.navris.position,
        enu: f.navris.enu,
        speed: f.navris.speed,
        headingDeg: f.navris.heading.deg,
        uncertainty: f.navris.uncertainty,
      });
      if (f.gnss.lastFix) {
        gnss.push({
          t: f.timestamp,
          position: f.gnss.lastFix,
          enu: enuOffset(f),
          speed: 0,
          headingDeg: 0,
          uncertainty: f.navris.uncertainty,
        });
      }
    }
    return { navris, gnss };
  }
}

/**
 * ENU offset of a frame's last GNSS fix.
 *
 * A rigid conversion from the frame's own geographic position. It is a change of
 * coordinates, not a correction: no reference to the basemap, no snapping, and
 * the fix is used exactly as recorded.
 */
function enuOffset(frame: NavigationFrame): EnuOffset {
  if (!frame.gnss.lastFix) return { east: 0, north: 0, up: 0 };
  return positionToEnu(DEMO_ORIGIN, frame.gnss.lastFix);
}
