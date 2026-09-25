import { SEQUENCE_TIMING } from '@/sim/scenarios';
import { descriptorForState } from '@/theme/stateColors';
import {
  SYSTEM_STATE_TRANSITIONS,
  type NavigationEvent,
  type NavigationEventSeverity,
  type SystemStateId,
} from '@/types/navigation';

/**
 * The NAVRIS navigation state machine.
 *
 * This is deliberately a *real* machine, not a timer that swaps a badge:
 *
 *  - Every transition is checked against SYSTEM_STATE_TRANSITIONS, so an
 *    illegal jump (e.g. GNSS_FUSED → AI_CORRECTION) is impossible, not just
 *    unlikely.
 *  - The outage sequence can be driven by a human pressing "Trigger Outage"
 *    or by a scenario script, and both use the identical path.
 *  - Recovery mirrors the outage in reverse and re-joins the nominal state,
 *    so the operator always lands somewhere honest.
 *
 * The machine owns *when* to transition. It owns nothing about geometry — the
 * trajectory/uncertainty generator in `engine.ts` reacts to the state.
 */

export interface MachineTime {
  /** Simulation clock, seconds. Drives all dwell timing. */
  sim: number;
  /** Wall-clock epoch ms. Used only for the timestamps written to the log. */
  wall: number;
}

export interface MachineContext extends MachineTime {
  /** True while the GNSS denial is in effect (operator- or script-driven). */
  outageRequested: boolean;
  /** True once GNSS is producing fixes again, during re-acquisition. */
  gnssAvailable: boolean;
}

export interface Transition {
  from: SystemStateId;
  to: SystemStateId;
  event: NavigationEvent;
}

const BOOT_DWELL_S = 2.2;

/** Dwell budget per state, i.e. how long the machine will sit here before
 *  advancing on its own. `null` means "stay until something external changes". */
const DWELL_BUDGET_S: Readonly<Record<SystemStateId, number | null>> = {
  INITIALISING: BOOT_DWELL_S,
  GNSS_FUSED: null,
  GNSS_DEGRADED: SEQUENCE_TIMING.degraded,
  GNSS_OUTAGE: SEQUENCE_TIMING.outageDetect,
  INS_ACTIVE: SEQUENCE_TIMING.insCoast + SEQUENCE_TIMING.aiDelay,
  AI_CORRECTION: SEQUENCE_TIMING.aiActive,
  RE_FUSION: SEQUENCE_TIMING.reacquire,
  STABILIZED: SEQUENCE_TIMING.stabilize,
  FAULT: null,
};

export function canTransition(from: SystemStateId, to: SystemStateId): boolean {
  return SYSTEM_STATE_TRANSITIONS[from]?.includes(to) ?? false;
}

export class NavigationStateMachine {
  private state: SystemStateId = 'INITIALISING';
  private enteredSim = 0;
  private enteredWall = 0;
  private seqEventSeq = 0;
  /** Set when the outage path is running, so recovery is mirror-image. */
  private inOutageSequence = false;

  constructor(time: MachineTime) {
    this.enteredSim = time.sim;
    this.enteredWall = time.wall;
  }

  get current(): SystemStateId {
    return this.state;
  }

  get since(): number {
    return this.enteredWall;
  }

  /** Dwell on the *simulation* clock, so playback speed and pausing behave. */
  dwellSeconds(simSeconds: number): number {
    return Math.max(0, simSeconds - this.enteredSim);
  }

  /**
   * Feed the machine the current world. Returns a transition if the machine
   * decided to move, otherwise null. Call once per tick.
   */
  tick(ctx: MachineContext): Transition | null {
    const next = this.decide(ctx);
    if (next === null || next === this.state) return null;
    if (!canTransition(this.state, next)) {
      // Illegal edge — should be unreachable. Fail loudly rather than silently
      // showing a state the machine never actually reached.
      console.error(
        `[NAVRIS] illegal state transition ${this.state} → ${next}; transition suppressed`,
      );
      return null;
    }
    return this.commit(next, ctx, this.narrate(this.state, next, ctx));
  }

  /** Operator pressed "Trigger Outage". Begins the degradation ladder. */
  beginOutage(time: MachineTime): Transition | null {
    const ctx: MachineContext = { ...time, outageRequested: true, gnssAvailable: false };
    // Re-fusion is the one in-sequence state a new denial has to interrupt;
    // narrate() already has a "GNSS lost again" message for that edge.
    if (this.state === 'RE_FUSION') {
      this.inOutageSequence = true;
      return canTransition(this.state, 'AI_CORRECTION')
        ? this.commit('AI_CORRECTION', ctx, this.narrate(this.state, 'AI_CORRECTION', ctx))
        : null;
    }
    // Already inside the sequence, so the denial is already in force and there
    // is nothing to restart.
    if (this.state !== 'GNSS_FUSED' && this.state !== 'STABILIZED') return null;

    this.inOutageSequence = true;
    const to: SystemStateId = this.state === 'STABILIZED' ? 'GNSS_FUSED' : 'GNSS_DEGRADED';
    return canTransition(this.state, to) ? this.commit(to, ctx, this.narrate(this.state, to, ctx)) : null;
  }

  /** Operator pressed "Trigger Recovery". Ends the denial and mirrors the
   *  sequence back out, or short-circuits straight to re-fusion if the outage
   *  path has already been running. */
  beginRecovery(time: MachineTime): Transition | null {
    this.inOutageSequence = false;
    const target: SystemStateId | null =
      this.state === 'GNSS_OUTAGE' || this.state === 'GNSS_DEGRADED' || this.state === 'GNSS_FUSED'
        ? 'GNSS_FUSED'
        : this.state === 'INS_ACTIVE' || this.state === 'AI_CORRECTION'
          ? 'RE_FUSION'
          : null;
    if (target === null) return null;
    if (!canTransition(this.state, target)) return null;
    const ctx: MachineContext = { ...time, outageRequested: false, gnssAvailable: true };
    return this.commit(target, ctx, this.narrate(this.state, target, ctx));
  }

  /** Hard reset, e.g. the Reset button. Returns no event; the caller logs its own. */
  reset(time: MachineTime): void {
    this.state = 'INITIALISING';
    this.enteredSim = time.sim;
    this.enteredWall = time.wall;
    this.inOutageSequence = false;
    this.seqEventSeq = 0;
  }

  /** True when GNSS is not currently permitted to update the solution. */
  get isDenyingGnss(): boolean {
    return (
      this.state === 'GNSS_OUTAGE' ||
      this.state === 'INS_ACTIVE' ||
      this.state === 'AI_CORRECTION' ||
      this.state === 'RE_FUSION'
    );
  }

  private decide(ctx: MachineContext): SystemStateId | null {
    const dwell = this.dwellSeconds(ctx.sim);
    const budget = DWELL_BUDGET_S[this.state];
    const budgetElapsed = budget === null ? false : dwell >= budget;

    switch (this.state) {
      case 'INITIALISING':
        return budgetElapsed ? 'GNSS_FUSED' : null;

      case 'GNSS_FUSED':
        // Only ever leave FUSED downward, and only on an actual degradation or
        // an operator-triggered outage.
        if (ctx.outageRequested) return this.inOutageSequence ? 'GNSS_DEGRADED' : 'GNSS_DEGRADED';
        return null;

      case 'GNSS_DEGRADED':
        if (!ctx.outageRequested) return 'GNSS_FUSED';
        return budgetElapsed ? 'GNSS_OUTAGE' : null;

      case 'GNSS_OUTAGE':
        if (!ctx.outageRequested) return 'GNSS_FUSED';
        return budgetElapsed ? 'INS_ACTIVE' : null;

      case 'INS_ACTIVE':
        // If the denial lifts early, go straight back to fusion rather than
        // pretending the drift happened.
        if (!ctx.outageRequested) return 'RE_FUSION';
        return budgetElapsed ? 'AI_CORRECTION' : null;

      case 'AI_CORRECTION':
        // Re-fusion needs a fix to fuse. While the denial is still in force
        // there is nothing to re-fuse with, so the model stays engaged and
        // keeps damping. Advancing on the dwell budget here regardless would
        // put the machine in RE_FUSION with no GNSS available, which then
        // bounced it straight back to AI_CORRECTION — a visible flap.
        if (!ctx.outageRequested) return 'RE_FUSION';
        return null;

      case 'RE_FUSION':
        if (ctx.outageRequested) return 'AI_CORRECTION';
        return budgetElapsed ? 'STABILIZED' : null;

      case 'STABILIZED':
        if (ctx.outageRequested) return 'GNSS_FUSED';
        return budgetElapsed ? 'GNSS_FUSED' : null;

      case 'FAULT':
        return null;

      default:
        return null;
    }
  }

  private commit(to: SystemStateId, time: MachineTime, event: NavigationEvent): Transition {
    const from = this.state;
    this.state = to;
    this.enteredSim = time.sim;
    this.enteredWall = time.wall;
    return { from, to, event };
  }

  /** Writes the timeline entry. The message text is what a judge reads, so it
   *  states what the system did and what it costs. */
  private narrate(from: SystemStateId, to: SystemStateId, ctx: MachineContext): NavigationEvent {
    const id = `st-${ctx.sim.toFixed(2)}-${this.seqEventSeq++}`;
    const toDesc = descriptorForState(to);
    let severity: NavigationEventSeverity = 'info';
    let message = toDesc.detail;
    let title = toDesc.label;

    switch (to) {
      case 'GNSS_FUSED':
        if (from === 'GNSS_DEGRADED') {
          severity = 'success';
          title = 'GNSS QUALITY RESTORED';
          message = 'Multipath cleared. Innovation gate narrowed, covariance re-tightening.';
        } else if (from === 'STABILIZED') {
          severity = 'success';
          title = 'NOMINAL · GNSS FUSED';
          message = 'Solution stable. Normal GNSS-fused operation resumed.';
        } else {
          severity = 'success';
          title = 'GNSS FUSED';
          message = 'Cold start complete. ESKF aligned to first fix, covariance initialised.';
        }
        break;
      case 'GNSS_DEGRADED':
        severity = 'warning';
        title = 'GNSS DEGRADED';
        message =
          'Position dilution rising. The filter is widening its innovation gate — confidence is falling but the solution is still being corrected by GNSS.';
        break;
      case 'GNSS_OUTAGE':
        severity = 'critical';
        title = 'GNSS OUTAGE DETECTED';
        message =
          'GNSS position input lost. Switching to strapdown dead reckoning. The GNSS trajectory is now frozen; NAVRIS continues to propagate.';
        break;
      case 'INS_ACTIVE':
        severity = 'warning';
        title = 'INS ACTIVE · DEAD RECKONING';
        message =
          'Propagating position from IMU integration alone. Uncertainty is accumulating — watch the ellipse grow.';
        break;
      case 'AI_CORRECTION':
        severity = 'caution';
        title = 'AI CORRECTION STAGE ENGAGED';
        message =
          'Model is estimating the IMU error from a motion-feature window and feeding a correction into the ESKF. Uncertainty growth is being damped — not eliminated.';
        break;
      case 'RE_FUSION':
        severity = 'caution';
        title = 'GNSS REACQUIRED · RE-FUSION';
        message =
          'GNSS returned. Re-acquiring the fix and pulling the solution back onto the true path. Covariance is collapsing toward nominal.';
        break;
      case 'STABILIZED':
        severity = 'success';
        title = 'STABILIZED';
        message =
          'Covariance settled. The solution has genuinely re-converged — not merely been reset.';
        break;
      default:
        break;
    }

    if (from === 'RE_FUSION' && to === 'AI_CORRECTION') {
      severity = 'critical';
      title = 'GNSS LOST AGAIN';
      message = 'Denial returned mid re-fusion. Returning to the AI correction stage.';
    }

    return {
      id,
      timestamp: ctx.wall,
      kind: 'STATE',
      severity,
      title,
      message,
      state: to,
      source: 'DEMO_SIMULATED',
    };
  }
}
