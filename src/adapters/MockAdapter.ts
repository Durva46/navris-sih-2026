import { BaseAdapter, type AdapterControl } from '@/adapters/DataAdapter';
import { SimulationEngine } from '@/sim/engine';

/**
 * MockAdapter — the default data source for the SIH demo.
 *
 * It presents exactly the same interface a live stream will, and drives a real
 * physics/filter simulation on a timer. Because it honours `setControl` and
 * `requestOutage` / `requestRecovery`, a WebSocketAdapter can be written later
 * that honours the same calls, and nothing above this line changes.
 *
 * Tick rate is 50 Hz: fast enough that the covariance recursion and the map
 * animation look continuous, slow enough to leave the main thread alone for
 * rendering.
 */
export class MockAdapter extends BaseAdapter {
  readonly id = 'mock' as const;
  readonly source = 'DEMO_SIMULATED' as const;
  readonly mode = 'demo' as const;

  private engine: SimulationEngine;
  private rafHandle: number | null = null;
  private lastWallClock = 0;
  private fixedDt = 1 / 50;
  private accumulator = 0;

  constructor(control: Partial<AdapterControl> = {}) {
    super();
    this.control = { ...this.control, ...control };
    this.engine = new SimulationEngine(this.control.scenario, Date.now());
  }

  protected override start(): () => void {
    this.patchStatus({
      transport: 'synthetic generator (client-side, no network)',
      targetHz: Math.round(1 / this.fixedDt),
    });

    this.lastWallClock = performance.now();
    const loop = (now: number) => {
      this.rafHandle = requestAnimationFrame(loop);
      const wall = (now - this.lastWallClock) / 1000;
      this.lastWallClock = now;

      if (!this.control.running) return;

      // Fixed-step integration with a bounded catch-up, so a slow frame or a
      // backgrounded tab cannot make the simulation leap or explode.
      this.accumulator = Math.min(this.accumulator + wall, 0.5);
      let guard = 0;
      while (this.accumulator >= this.fixedDt && guard < 12) {
        this.accumulator -= this.fixedDt;
        guard++;
        const result = this.engine.step(this.fixedDt, {
          running: true,
          speed: this.control.playbackSpeed,
          manualOverride: this.control.manualOverride,
          aiContribution: this.control.aiContribution,
        });
        this.emitFrame(result.frame);
        if (result.navrisPoint) this.handlers?.onNavrisPoint(result.navrisPoint);
        if (result.gnssPoint) this.handlers?.onGnssPoint(result.gnssPoint);
        for (const e of result.events) this.emitEvent(e);
      }
    };

    this.rafHandle = requestAnimationFrame(loop);
    return () => {
      if (this.rafHandle !== null) cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    };
  }

  protected override onControlChanged(patch: Partial<AdapterControl>): void {
    if (patch.scenario) {
      this.engine.setScenario(patch.scenario);
    }
    if (patch.running !== undefined) {
      this.lastWallClock = performance.now();
      this.accumulator = 0;
    }
  }

  override requestOutage(): void {
    // The scenario script keeps control until an operator explicitly intervenes.
    const wasManual = this.control.manualOverride;
    this.control = { ...this.control, manualOverride: true };
    // The engine queues the transition so it reaches the timeline in the same
    // ordered path as every scripted transition. Emitting its return value here
    // as well put the same event in the log twice.
    this.engine.triggerOutage();
    this.patchStatus({
      transport: wasManual ? this.status.transport : 'synthetic generator (manual override)',
    });
  }

  override requestRecovery(): void {
    this.control = { ...this.control, manualOverride: true };
    this.engine.triggerRecovery();
  }

  override reset(): void {
    this.engine.reset(this.control.scenario, Date.now());
    this.accumulator = 0;
    this.lastWallClock = performance.now();
  }

  override dispose(): void {
    super.dispose();
  }
}
