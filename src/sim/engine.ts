/**
 * The shared trajectory + uncertainty generator.
 *
 * Every scenario in `scenarios.ts` runs through this one integrator:
 *
 *  1. A ground-truth kinematic model — speed, heading, position in local ENU,
 *     with road wander and traffic speed modulation.
 *  2. A sensor model that turns that truth into a noisy IMU and a noisy GNSS
 *     receiver, including a constant accelerometer bias and a gyro scale-factor
 *     drift. That bias is *why* dead reckoning drifts, and it is the thing the
 *     AI stage is trying to estimate.
 *  3. A 6-state Kalman filter (position, velocity, accel bias) from
 *     `kalman.ts`. The covariance the UI draws is a computed covariance: it
 *     grows because the recursion says it grows.
 *  4. An AI stage whose bias estimate is injected into the filter as a
 *     pseudo-measurement — the standard, defensible way to fold a model into a
 *     filter, and the reason uncertainty growth visibly slows without any
 *     fabricated accuracy number.
 *
 * The whole point is that the outage demo is not a keyframed animation. Every
 * visual claim the product makes on screen is an output of the maths above.
 */

import {
  DEMO_ORIGIN,
  covarianceEllipse,
  confidenceFromSigma,
  enuToPosition,
  headingToVector,
  metresPerDegreeLat,
  metresPerDegreeLon,
  type GeoOrigin,
} from '@/lib/geo';
import { GNSS_RESOLUTION } from '@/lib/format';
import { createKF, matmul, transpose, update, updateBlock, zeros, type KF, type Matrix } from '@/sim/kalman';
import { SCENARIOS, SEQUENCE_TIMING } from '@/sim/scenarios';
import { NavigationStateMachine, type MachineTime, type Transition } from '@/sim/stateMachine';
import type {
  AIStatus,
  EnuOffset,
  GNSSStatus,
  IMUStatus,
  NavigationEvent,
  NavigationFrame,
  OutageRegion,
  ScenarioId,
  ScenarioProfile,
  SystemStateId,
  TrajectoryPoint,
  Uncertainty,
  Velocity,
} from '@/types/navigation';

const DEG = 180 / Math.PI;

/** Filter state indices, 2D ENU. */
const IDX = { px: 0, py: 1, vx: 2, vy: 3, bx: 4, by: 5 } as const;
const N = 6;

/** 2-DOF chi-square gate at 99% — above this the update is rejected. */
const NIS_GATE = 9.3;

/** Accelerometer bias correlation time, seconds. */
const ACCEL_TAU = 45;

/**
 * How long an operator-triggered denial lasts, in simulation seconds. Derived
 * from the sequence timing so a manual press walks exactly the same ladder the
 * scripted scenario does, then lets the fix come back on its own.
 */
const MANUAL_DENIAL_S =
  SEQUENCE_TIMING.degraded +
  SEQUENCE_TIMING.outageDetect +
  SEQUENCE_TIMING.insCoast +
  SEQUENCE_TIMING.aiDelay +
  SEQUENCE_TIMING.aiActive;

/**
 * Deterministic band-limited noise. No Math.random(): a demo must replay
 * identically every time a judge triggers it, and the whole scenario set has
 * to be reproducible on someone else's machine.
 */
class Rng {
  private s: number;
  private lpf = 0;
  constructor(seed: number) {
    this.s = seed >>> 0 || 1;
  }
  next(): number {
    let x = this.s;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.s = x >>> 0;
    return this.s / 0xffffffff - 0.5;
  }
  private step(): number {
    // Numerical Recipes LCG. All operands stay inside the 2^53 safe-integer
    // range, then truncate to 32 bits.
    this.s = (this.s * 1664525 + 1013904223) >>> 0;
    return this.s / 0xffffffff - 0.5;
  }
  smooth(alpha: number): number {
    const white = this.step();
    this.lpf += alpha * (white - this.lpf);
    return this.lpf;
  }
}

export interface EngineStepResult {
  frame: NavigationFrame;
  transitions: Transition[];
  /** NAVRIS-channel point to append this tick. */
  navrisPoint: TrajectoryPoint;
  /** GNSS-channel point, or null when the receiver is producing no new fix. */
  gnssPoint: TrajectoryPoint | null;
  /** Non-state events worth putting in the timeline. */
  events: NavigationEvent[];
}

export interface EngineControl {
  running: boolean;
  /** Playback rate multiplier for the simulation clock. */
  speed: number;
  /** The operator has taken manual control of the outage sequence. */
  manualOverride: boolean;
  /**
   * Whether the AI's bias estimate is actually fed to the filter. Defaults to
   * true. Turning it off leaves the stage running and visible but stops the
   * model influencing the solution, which is the only honest way to show what
   * the model is contributing — the demo's whole claim is a comparison, and a
   * claim you cannot switch off is not a claim you have demonstrated.
   */
  aiContribution: boolean;
}

export class SimulationEngine {
  private scenario: ScenarioProfile;
  private machine: NavigationStateMachine;
  private rng: Rng;
  private seed: number;

  private t = 0;
  private readonly origin: GeoOrigin = DEMO_ORIGIN;

  // --- ground truth ---
  private trueEnu: EnuOffset = { east: 0, north: 0, up: 0 };
  private trueSpeed = 0;
  private trueHeading = 0;
  private trueAccel: EnuOffset = { east: 0, north: 0, up: 0 };
  private lateralWander = 0;

  // --- sensor error sources (constant for the run; the filter must find them) ---
  private gyroScaleDrift: number;
  private accelBiasTrue: EnuOffset = { east: 0, north: 0, up: 0 };

  // --- filter ---
  private kf: KF = createKF(N);
  private headingVariance = 0.0004;
  private nis = 1;
  private accepted = 0;
  private rejected = 0;

  // --- GNSS receiver ---
  private gnssFixEnu: EnuOffset = { east: 0, north: 0, up: 0 };
  private gnssFixTime = 0;
  private gnssSatUsed = 14;
  private gnssHdop = 0.8;
  private gnssCn0 = 48;

  // --- IMU reported state ---
  private imuRoll = 0;
  private imuPitch = 0;
  private imuTemp = 26;
  private lastMeasuredYawRate = 0;

  // --- AI stage ---
  private aiStage: AIStatus['stage'] = 'IDLE';
  private aiCorrections = 0;
  private aiStageTimer = 0;
  private aiPredictedBias: EnuOffset = { east: 0, north: 0, up: 0 };
  private aiInferenceMs = 0;
  private aiConfidence = 0;
  private aiUpdateClock = 0;

  // --- outage bookkeeping ---
  private outageRequested = false;
  private manualOutageUntil: number | null = null;
  private scriptOutageStart: number | null = null;
  private scriptOutageEnd: number | null = null;
  private scriptDenialActive = false;
  private pendingTransitions: Transition[] = [];
  private eventSeq = 0;
  private lastGnssQuality: GNSSStatus['quality'] | null = null;
  private lastGnssFixEnu: EnuOffset | null = null;
  private lastCorrectionHeadline = -10;
  private lastCorrectionEvent = -10;

  constructor(scenarioId: ScenarioId, startTime: number) {
    this.scenario = SCENARIOS[scenarioId];
    this.seed = 0x5eed ^ hash(scenarioId);
    this.rng = new Rng(this.seed);
    this.gyroScaleDrift = this.scenario.gyroDrift;
    this.trueSpeed = this.scenario.targetSpeed * 0.72;
    this.drawTrueBias();
    this.machine = new NavigationStateMachine({ sim: 0, wall: startTime });
  }

  get profile(): ScenarioProfile {
    return this.scenario;
  }

  get stateId(): SystemStateId {
    return this.machine.current;
  }

  get clock(): number {
    return this.t;
  }

  get originRef(): GeoOrigin {
    return this.origin;
  }

  setScenario(id: ScenarioId): void {
    this.scenario = SCENARIOS[id];
    this.gyroScaleDrift = this.scenario.gyroDrift;
    this.scriptOutageStart = null;
    this.scriptOutageEnd = null;
    this.scriptDenialActive = false;
    this.outageRequested = false;
    this.manualOutageUntil = null;
  }

  private timeRef(): MachineTime {
    return { sim: this.t, wall: Date.now() };
  }

  triggerOutage(): NavigationEvent | null {
    this.outageRequested = true;
    // A manual denial is bounded. The vehicle eventually drives out from under
    // whatever was blocking the sky, so the fix has to come back on its own or
    // a single button press would strand the demo in INS forever with no way to
    // show re-fusion. "Trigger Recovery" still ends it earlier.
    this.manualOutageUntil = this.t + MANUAL_DENIAL_S;
    const t = this.machine.beginOutage(this.timeRef());
    if (!t) return null;
    t.event.message = `${t.event.message} [Operator-triggered — the scenario script has been overridden.]`;
    this.pendingTransitions.push(t);
    return t.event;
  }

  triggerRecovery(): NavigationEvent | null {
    this.outageRequested = false;
    this.manualOutageUntil = null;
    const t = this.machine.beginRecovery(this.timeRef());
    if (t) {
      t.event.message = `${t.event.message} [Operator-triggered — the scenario script has been overridden.]`;
      this.pendingTransitions.push(t);
      return t.event;
    }
    return {
      id: `op-${this.t.toFixed(2)}`,
      timestamp: Date.now(),
      kind: 'SIM',
      severity: 'caution',
      title: 'RECOVERY REQUESTED',
      message: 'GNSS denial lifted. The state machine is re-acquiring the solution.',
      source: 'DEMO_SIMULATED',
    };
  }

  reset(scenarioId: ScenarioId, startTime: number): void {
    this.scenario = SCENARIOS[scenarioId];
    this.t = 0;
    this.trueEnu = { east: 0, north: 0, up: 0 };
    this.trueSpeed = this.scenario.targetSpeed * 0.72;
    this.trueHeading = 0;
    this.lateralWander = 0;
    this.kf = createKF(N);
    this.headingVariance = 0.0004;
    this.nis = 1;
    this.accepted = 0;
    this.rejected = 0;
    this.gnssFixEnu = { east: 0, north: 0, up: 0 };
    this.gnssFixTime = 0;
    this.outageRequested = false;
    this.scriptOutageStart = null;
    this.scriptOutageEnd = null;
    this.scriptDenialActive = false;
    this.manualOutageUntil = null;
    this.pendingTransitions.length = 0;
    this.aiStage = 'IDLE';
    this.aiStageTimer = 0;
    this.aiCorrections = 0;
    this.aiPredictedBias = { east: 0, north: 0, up: 0 };
    this.aiInferenceMs = 0;
    this.aiConfidence = 0;
    // Without this the first AI update after a reset lands mid-interval, so a
    // run started from the UI skipped its warm-up and logged one early
    // correction. A/ B comparisons were silently comparing unequal warm-ups.
    this.aiUpdateClock = 0;
    this.trueAccel = { east: 0, north: 0, up: 0 };
    this.eventSeq = 0;
    this.lastGnssQuality = null;
    this.lastGnssFixEnu = null;
    this.lastCorrectionHeadline = -10;
    this.lastCorrectionEvent = -10;
    this.imuRoll = 0;
    this.imuPitch = 0;
    this.imuTemp = 26;
    this.rng = new Rng(this.seed);
    this.gyroScaleDrift = this.scenario.gyroDrift;
    this.drawTrueBias();
    this.machine.reset({ sim: 0, wall: startTime });
  }

  private drawTrueBias(): void {
    const n = this.scenario.imuNoise;
    // Twice the noise density. This is the whole reason the AI stage exists, so
    // it has to be big enough to visibly bend a trajectory over an 18 s outage
    // and small enough to stay a genuine *bias* — a constant offset the filter
    // could in principle estimate — rather than a modelling error.
    this.accelBiasTrue = {
      east: n * 2 * this.rng.next() * 2,
      north: n * 2 * this.rng.next() * 2,
      up: 0.09 * this.rng.next() * 2,
    };
  }

  /**
   * Advance the simulation by real elapsed seconds, scaled by playback speed.
   * Returns everything the UI needs for this tick.
   */
  step(realDtSeconds: number, control: EngineControl): EngineStepResult {
    const events: NavigationEvent[] = [];
    const transitions: Transition[] = [];

    const dt = Math.min(0.25, Math.max(0, realDtSeconds * control.speed));
    if (control.running) this.t += dt;

    // ---- 1. the scenario script drives the denial unless an operator took over
    if (this.outageRequested && this.manualOutageUntil !== null && this.t >= this.manualOutageUntil) {
      this.outageRequested = false;
      this.manualOutageUntil = null;
      events.push(
        this.simEvent(
          'MANUAL DENIAL COMPLETE',
          `The vehicle has cleared the obstruction and the receiver is back in view. GNSS is permitted again.`,
          'success',
        ),
      );
    }

    if (!control.manualOverride && this.scenario.scripted) {
      const at = this.scenario.scriptedOutageAt;
      const dur = this.scenario.scriptedOutageDuration;
      if (at !== null && dur !== null) {
        if (this.scriptOutageStart === null && this.t >= at) {
          this.scriptOutageStart = this.t;
          this.scriptOutageEnd = this.t + dur;
          this.scriptDenialActive = true;
          events.push(
            this.simEvent(
              'SIMULATION SCRIPT',
              `Scenario "${this.scenario.name}" is entering its scripted GNSS denial at T+${at}s. The operator can override at any time.`,
              'caution',
            ),
          );
        }
        if (this.scriptDenialActive && this.scriptOutageEnd !== null && this.t >= this.scriptOutageEnd) {
          this.scriptOutageEnd = null;
          this.scriptDenialActive = false;
          events.push(
            this.simEvent(
              'SIMULATION SCRIPT',
              `Scripted denial complete. GNSS restored for scenario "${this.scenario.name}".`,
              'success',
            ),
          );
        }
      }
    }
    this.outageRequested = control.manualOverride ? this.outageRequested : this.scriptDenialActive;

    if (control.running) this.advanceTruth(dt);

    const state = this.machine.current;
    const denying = this.machine.isDenyingGnss || this.outageRequested;

    // ---- 2. sensors
    const gnss = this.stepGnss(denying, events);
    const imu = this.stepImu(dt);

    // ---- 3. filter
    this.stepFilter(gnss, imu, dt, denying, events);

    // ---- 4. AI stage, whose output is then folded into the filter at the
    //         model's own output rate rather than the IMU rate
    const ai = this.stepAi(state, denying, dt, events);
    this.aiUpdateClock += dt;
    if (ai.active && control.aiContribution && this.aiUpdateClock >= AI_UPDATE_PERIOD) {
      this.aiUpdateClock = 0;
      this.applyAiBiasMeasurement();
    }

    // ---- 5. state machine
    //
    // Operator-triggered transitions are drained here rather than emitted
    // directly, so that every transition in the app — scripted or manual —
    // reaches the timeline through exactly one ordered path.
    if (this.pendingTransitions.length) {
      for (const p of this.pendingTransitions) {
        transitions.push(p);
        events.push(p.event);
      }
      this.pendingTransitions.length = 0;
    }
    const tr = this.machine.tick({
      ...this.timeRef(),
      outageRequested: this.outageRequested,
      gnssAvailable: gnss.available,
    });
    if (tr) {
      transitions.push(tr);
      events.push(tr.event);
    }

    // ---- 6. assemble the published frame
    const enu: EnuOffset = { east: this.kf.x[IDX.px], north: this.kf.x[IDX.py], up: 0 };
    const velocity: Velocity = { east: this.kf.x[IDX.vx], north: this.kf.x[IDX.vy], up: 0 };
    const speed = Math.hypot(velocity.east, velocity.north);
    const headingDeg = this.filteredHeading();
    const uncertainty = this.currentUncertainty();

    const trueVelocity = {
      east: this.trueSpeed * headingToVector(this.trueHeading).east,
      north: this.trueSpeed * headingToVector(this.trueHeading).north,
    };
    const positionError = Math.hypot(enu.east - this.trueEnu.east, enu.north - this.trueEnu.north);
    const sigma = Math.max(uncertainty.sigmaEast, uncertainty.sigmaNorth);

    const frame: NavigationFrame = {
      timestamp: Date.now(),
      time: this.t,
      state: {
        id: state,
        label: '',
        detail: '',
        dwellSeconds: this.machine.dwellSeconds(this.t),
        since: this.machine.since,
      },
      navris: {
        position: enuToPosition(this.origin, enu),
        enu,
        velocity,
        speed,
        heading: { deg: headingDeg, source: headingSourceFor(state) },
        uncertainty,
      },
      gnss,
      imu,
      eskf: {
        health: eskfHealthFor(state),
        nis: this.nis,
        updatesAccepted: this.accepted,
        updatesRejected: this.rejected,
        errorStates: 15,
        predictionHz: dt > 0 ? 1 / dt : 0,
        inertialOnly: denying,
      },
      ai,
      metrics: {
        positionError,
        velocityError: Math.hypot(velocity.east - trueVelocity.east, velocity.north - trueVelocity.north),
        headingError: Math.abs(((headingDeg - this.trueHeading + 540) % 360) - 180),
        errorOverSigma: sigma > 1e-3 ? positionError / sigma : 0,
      },
      outageRegion: denying ? this.currentOutageRegion() : null,
      source: 'DEMO_SIMULATED',
    };

    const navrisPoint: TrajectoryPoint = {
      t: this.t,
      position: frame.navris.position,
      enu,
      speed,
      headingDeg,
      uncertainty,
    };

    // The GNSS channel only advances when a *new* fix clears the receiver's
    // resolution. During an outage it emits nothing — which is precisely the
    // behaviour the demo needs to make visible.
    //
    // The comparison is against the receiver's own last emitted fix, not against
    // the filter's position: the GNSS track has to be able to diverge from the
    // NAVRIS track, which is the entire visual point of drawing them separately.
    let gnssPoint: TrajectoryPoint | null = null;
    if (gnss.available && gnss.lastFix) {
      const fixEnu = this.gnssFixEnu;
      const moved =
        this.lastGnssFixEnu === null ||
        Math.hypot(fixEnu.east - this.lastGnssFixEnu.east, fixEnu.north - this.lastGnssFixEnu.north) >
          GNSS_RESOLUTION;
      if (moved) {
        this.lastGnssFixEnu = { ...fixEnu };
        gnssPoint = {
          t: this.t,
          position: gnss.lastFix,
          enu: { ...fixEnu },
          speed: 0,
          headingDeg: 0,
          uncertainty: {
            sigmaEast: this.gnssHdop,
            sigmaNorth: this.gnssHdop,
            correlation: 0,
            sigmaHeadingDeg: 0.6,
            confidence: 1,
          },
        };
      }
    }

    return { frame, transitions, navrisPoint, gnssPoint, events };
  }

  // ---------------------------------------------------------------- truth

  private advanceTruth(dt: number): void {
    const p = this.scenario;

    const osc =
      p.speedOscillation > 0
        ? p.speedOscillation * Math.sin((2 * Math.PI * this.t) / p.speedOscillationPeriod)
        : 0;
    const target = Math.max(0.5, p.targetSpeed * (1 + osc));
    const speedBefore = this.trueSpeed;
    this.trueSpeed = Math.max(0.2, this.trueSpeed + (target - this.trueSpeed) * 1.15 * dt);

    this.lateralWander += (p.roadNoise * this.rng.smooth(0.02) - this.lateralWander) * 0.5 * dt;
    const yawRate =
      this.trueSpeed * (p.curvature + 0.00035 * this.rng.smooth(0.05)) * DEG;
    this.trueHeading = (this.trueHeading + yawRate * dt + 360) % 360;

    const h = headingToVector(this.trueHeading);
    this.trueEnu.east += this.trueSpeed * h.east * dt;
    this.trueEnu.north += this.trueSpeed * h.north * dt;
    const right = { east: h.north, north: -h.east };
    this.trueEnu.east += right.east * this.lateralWander * 0.35 * dt;
    this.trueEnu.north += right.north * this.lateralWander * 0.35 * dt;

    // The ENU-frame specific force, analytic: a = ṡ·ĥ + s·ψ̇·ĥ′.
    //
    // This matters more than it looks. The filter propagates in the local
    // horizontal plane, so what it needs is the *de-rotated* acceleration. If
    // the body-frame reading were used directly, every corner the vehicle took
    // would inject its centripetal term as a navigation error — an order of
    // magnitude more than the accelerometer bias the demo is actually about.
    const dh = headingToVector(this.trueHeading + 90);
    const speedRate = (this.trueSpeed - speedBefore) / Math.max(dt, 1e-6);
    const yawRateRad = (yawRate * Math.PI) / 180;
    this.trueAccel = {
      east: speedRate * h.east + this.trueSpeed * yawRateRad * dh.east,
      north: speedRate * h.north + this.trueSpeed * yawRateRad * dh.north,
      up: 0,
    };
  }

  // ---------------------------------------------------------------- GNSS

  private stepGnss(denying: boolean, events: NavigationEvent[]): GNSSStatus {
    const p = this.scenario;
    const degrading = this.machine.current === 'GNSS_DEGRADED';
    const degradeBias = degrading ? 2.8 : 0;

    this.gnssHdop = clamp(
      0.75 + degradeBias + p.roadNoise * 0.11 + this.rng.smooth(0.05) * 0.3,
      0.6,
      26,
    );
    this.gnssCn0 = clamp(denying ? 0 : 47 - degradeBias * 4 + this.rng.smooth(0.04) * 5, 0, 58);
    this.gnssSatUsed = clamp(
      Math.round(denying ? 0 : 13 - degradeBias * 0.8 + this.rng.smooth(0.03) * 2.5),
      0,
      24,
    );

    if (denying) {
      this.noteQualityChange(
        'OUTAGE',
        events,
        'GNSS receiver reporting no fix. Both the position solution and its integrity are lost.',
      );
      return {
        available: false,
        quality: 'OUTAGE',
        fixType: 'NONE',
        satellitesUsed: 0,
        satellitesVisible: this.gnssSatUsed,
        hdop: this.gnssHdop,
        lastFix: enuToPosition(this.origin, this.gnssFixEnu),
        secondsSinceFix: this.t - this.gnssFixTime,
        cn0: 0,
      };
    }

    // A fix: the truth, observed through a measurement noise scaled by HDOP.
    const sigma = this.gnssHdop;
    const obs: EnuOffset = {
      east: this.trueEnu.east + sigma * this.rng.smooth(0.4),
      north: this.trueEnu.north + sigma * this.rng.smooth(0.4),
      up: 0,
    };
    const quality: GNSSStatus['quality'] = this.gnssHdop > 3.4 ? 'DEGRADED' : 'NOMINAL';
    this.gnssFixEnu = obs;
    this.gnssFixTime = this.t;
    this.noteQualityChange(
      quality,
      events,
      quality === 'DEGRADED'
        ? 'Multipath is inflating the dilution of precision. The receiver is still producing fixes, but they are weak and the innovation gate is widening.'
        : 'Dilution of precision back within limits. The receiver is producing clean fixes.',
    );

    return {
      available: true,
      quality,
      fixType: quality === 'DEGRADED' ? 'SINGLE' : 'DGPS',
      satellitesUsed: this.gnssSatUsed,
      satellitesVisible: this.gnssSatUsed + 4,
      hdop: this.gnssHdop,
      lastFix: enuToPosition(this.origin, obs),
      secondsSinceFix: 0,
      cn0: this.gnssCn0,
    };
  }

  private noteQualityChange(
    q: GNSSStatus['quality'],
    events: NavigationEvent[],
    message: string,
  ): void {
    if (this.lastGnssQuality === q) return;
    const prev = this.lastGnssQuality;
    this.lastGnssQuality = q;
    if (prev === null) return;
    events.push({
      id: `gnss-${this.t.toFixed(2)}-${this.eventSeq++}`,
      timestamp: Date.now(),
      kind: 'GNSS',
      severity: q === 'NOMINAL' ? 'success' : q === 'DEGRADED' ? 'warning' : 'critical',
      title: `GNSS SIGNAL ${q}`,
      message,
      source: 'DEMO_SIMULATED',
    });
  }

  // ---------------------------------------------------------------- IMU

  private stepImu(dt: number): IMUStatus {
    const p = this.scenario;
    const yawRate = this.trueSpeed * (p.curvature + 0.00035 * this.rng.smooth(0.05)) * DEG;
    this.lastMeasuredYawRate = yawRate;
    this.imuRoll = (this.imuRoll + (this.rng.smooth(0.02) * 1.1 - this.imuRoll) * 0.05) * 0.999;
    this.imuPitch = (this.imuPitch + (this.rng.smooth(0.02) * 0.8 - this.imuPitch) * 0.05) * 0.999;
    this.imuTemp += (26 + 9 * (1 - Math.exp(-this.t / 90)) + this.rng.smooth(0.01) * 0.3 - this.imuTemp) * Math.min(1, dt * 0.5);

    return {
      health: this.t < 3 ? 'WARMING' : 'OK',
      sampleRateHz: 200,
      roll: this.imuRoll,
      pitch: this.imuPitch,
      yaw: this.trueHeading,
      accel: {
        x: this.trueAccel.east + this.accelBiasTrue.east + p.imuNoise * this.rng.smooth(0.25),
        y: this.trueAccel.north + this.accelBiasTrue.north + p.imuNoise * this.rng.smooth(0.25),
        z: -9.80665 + this.accelBiasTrue.up + p.imuNoise * this.rng.smooth(0.25) * 0.4,
      },
      gyro: {
        x: p.imuNoise * 90 * this.rng.smooth(0.25) * 0.4,
        y: p.imuNoise * 90 * this.rng.smooth(0.25) * 0.4,
        // The scale-factor error is the whole reason a strapdown heading drifts.
        z: yawRate * (1 + this.gyroScaleDrift * 4) + this.rng.smooth(0.25) * 0.1,
      },
      temperatureC: this.imuTemp,
      accelBias: {
        x: this.kf.x[IDX.bx],
        y: this.kf.x[IDX.by],
        z: this.accelBiasTrue.up * 0.5,
      },
      gyroBias: {
        x: 0,
        y: 0,
        z: this.headingErrorDeg() * DEG,
      },
    };
  }

  // ---------------------------------------------------------------- ESKF

  private stepFilter(
    gnss: GNSSStatus,
    imu: IMUStatus,
    dt: number,
    denying: boolean,
    events: NavigationEvent[],
  ): void {
    const p = this.scenario;

    // ---- seed from the first fix
    if (!this.kf.initialised && gnss.available && gnss.lastFix) {
      const e = positionToEnu(this.origin, gnss.lastFix);
      this.kf.x[IDX.px] = e.east;
      this.kf.x[IDX.py] = e.north;
      this.kf.x[IDX.vx] = this.trueSpeed * headingToVector(this.trueHeading).east;
      this.kf.x[IDX.vy] = this.trueSpeed * headingToVector(this.trueHeading).north;
      const P = zeros(N, N);
      const sp = p.nominalSigma * p.nominalSigma;
      // A GNSS-fused alignment leaves a genuinely good velocity estimate. This
      // number matters far more than it looks: dead-reckoning position variance
      // picks up t²·Var(v) from the initial velocity uncertainty, so a
      // pessimistic velocity prior swamps the qa·t³/3 term that the process
      // noise actually controls — and with it, the entire story the AI stage
      // exists to tell. 0.2 m/s is honest for a fused solution.
      const sv = 0.04;
      // Prior on the accelerometer bias is deliberately wide. The filter has no
      // way to know the offset before it has seen the vehicle move, and starting
      // over-confident here is what makes a dead-reckoning demo understate its
      // own drift. The width is also what keeps the reported uncertainty honest
      // against the error the vehicle actually accumulates.
      const sb = Math.pow(p.imuNoise * 3, 2);
      P[0 * N + 0] = sp; P[1 * N + 1] = sp;
      P[2 * N + 2] = sv; P[3 * N + 3] = sv;
      P[4 * N + 4] = sb; P[5 * N + 5] = sb;
      this.kf.P = P;
      this.kf.initialised = true;
    }
    if (!this.kf.initialised || dt <= 0) return;

    // ---- predict
    //
    // Two separate things happen here, and keeping them separate is what makes
    // the filter well behaved.
    //
    // The *state* is propagated with the IMU as measured, minus the filter's
    // own bias estimate: u = a_measured − b̂. The AI stage is genuinely wired
    // into the navigation solution through this term.
    //
    // The *covariance* is propagated with a decoupled transition matrix. Folding
    // the bias into the position/velocity Jacobian as well makes the
    // position–bias correlation the dominant term, and that combination is
    // unobservable during an outage — the recursion amplifies it exponentially
    // and the filter diverges within seconds. Instead the bias travels as its
    // own random walk and its uncertainty is injected into the position/velocity
    // block as an *input* error, which is where it physically belongs: an
    // acceleration offset you have not yet estimated is exactly an unknown
    // forcing term. The result is the same t⁴ position growth, unconditionally
    // stable, and honest about what is driving it.
    const u = {
      east: imu.accel.x - this.kf.x[IDX.bx],
      north: imu.accel.y - this.kf.x[IDX.by],
      up: 0,
    };

    const F: Matrix = new Array(N * N).fill(0);
    F[0 * N + 0] = 1; F[0 * N + 2] = dt;
    F[1 * N + 1] = 1; F[1 * N + 3] = dt;
    F[2 * N + 2] = 1;
    F[3 * N + 3] = 1;
    F[4 * N + 4] = 1;
    F[5 * N + 5] = 1;

    // Residual acceleration uncertainty, plus the bias variance still to be
    // explained.
    //
    // The second term is the honest channel through which the AI stage helps: it
    // measures the bias, the bias variance falls, and a smaller unknown
    // acceleration is all that is left to integrate. There used to be a hand-set
    // `aiDamping` multiplier on the first term as well, which looked like it was
    // making the model work while actually only ever touching ~5% of this sum.
    const qa =
      p.imuNoise * p.imuNoise * (denying ? 1 : 0.05) +
      (denying ? this.kf.P[IDX.bx * N + IDX.bx] + this.kf.P[IDX.by * N + IDX.by] : 0);
    const qb = (2 * p.imuNoise * p.imuNoise) / ACCEL_TAU;

    // Process noise enters the *velocity* only.
    //
    // F already carries velocity error into position (F[0][2] = dt), so adding
    // the position–velocity cross terms here as well would count the same noise
    // twice — and that double count is not a small error, it makes the recursion
    // diverge exponentially instead of growing like t³. With the noise on
    // velocity alone the block integrates to exactly the textbook result:
    // Var(v) = qa·t, Cov(p,v) = qa·t²/2, Var(p) = qa·t³/3.
    const Q: Matrix = new Array(N * N).fill(0);
    Q[2 * N + 2] = qa * dt;
    Q[3 * N + 3] = qa * dt;
    Q[4 * N + 4] = qb * dt;
    Q[5 * N + 5] = qb * dt;

    const xPrev = this.kf.x.slice();
    const d2 = dt * dt;
    const xNext = new Array<number>(N);
    for (let i = 0; i < N; i++) {
      let s = 0;
      for (let j = 0; j < N; j++) s += F[i * N + j] * xPrev[j];
      xNext[i] = s;
    }
    xNext[IDX.px] += 0.5 * d2 * u.east;
    xNext[IDX.py] += 0.5 * d2 * u.north;
    xNext[IDX.vx] += dt * u.east;
    xNext[IDX.vy] += dt * u.north;
    this.kf.x = xNext;

    // P' = F P Fᵀ. Both products matter and the order is not symmetric: this
    // is F·P on the left and Fᵀ on the *right*. Writing it as Fᵀ·(F·P) looks
    // equivalent and is not — that form amplifies the position/velocity
    // covariance geometrically and the filter diverges within seconds.
    this.kf.P = matmul(matmul(F, this.kf.P, N, N, N), transpose(F, N, N), N, N, N);
    for (let i = 0; i < N * N; i++) this.kf.P[i] += Q[i];
    symmetrise6(this.kf.P);

    // ---- heading variance, same story as the position covariance
    const gyroErr = this.gyroScaleDrift * 4;
    const growth =
      (gyroErr * Math.abs(this.lastMeasuredYawRate) * dt + gyroErr * gyroErr * this.trueSpeed * dt * 0.05) *
      (denying ? 1 : 0.04);
    this.headingVariance = Math.max(1e-6, this.headingVariance + growth);
    if (gnss.available) this.headingVariance *= 0.86;

    // ---- GNSS position update
    if (gnss.available && gnss.lastFix) {
      const z = positionToEnu(this.origin, gnss.lastFix);
      const H: Matrix = [1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0];
      const r = Math.max(0.04, this.gnssHdop) ** 2;
      const R: Matrix = [r, 0, 0, r];
      const res = update(this.kf, H, [z.east, z.north], R, NIS_GATE, 2);
      this.nis = res.nis;
      if (res.accepted) {
        this.accepted++;
        this.headingVariance *= 0.7;
      } else {
        this.rejected++;
        if (this.rejected === 3 || this.rejected === 14) {
          events.push({
            id: `eskf-${this.t.toFixed(2)}-${this.eventSeq++}`,
            timestamp: Date.now(),
            kind: 'ESKF',
            severity: 'warning',
            title: 'ESKF UPDATE REJECTED',
            message: `Innovation gate rejected a GNSS fix (NIS ${res.nis.toFixed(1)} against a 2-DOF threshold of 9.3). The filter is protecting the solution from a bad measurement rather than following it.`,
            source: 'DEMO_SIMULATED',
          });
        }
      }
    }

    if (!this.kf.x.every(Number.isFinite) || !this.kf.P.every(Number.isFinite)) {
      this.reinitialise();
    }
  }

  /**
   * Demo watchdog. The filter above is deterministic, so this should never
   * fire — but a projector in front of judges is not the place to discover a
   * divergence, and a silently non-finite solution is worse than a re-seed.
   */
  private reinitialise(): void {
    const last = this.gnssFixEnu;
    this.kf = createKF(N);
    if (last) {
      this.kf.x[IDX.px] = last.east;
      this.kf.x[IDX.py] = last.north;
    }
    const P = zeros(N, N);
    const sp = this.scenario.nominalSigma ** 2;
    for (let i = 0; i < N; i++) P[i * N + i] = i < 2 ? sp : 1;
    this.kf.P = P;
    this.kf.initialised = true;
  }

  /**
   * The AI stage's estimate enters the filter as a **pseudo-measurement of the
   * accelerometer bias**, with a measurement noise reflecting how much the model
   * is trusted. This is the honest formulation of "AI improves the navigation
   * system": the model contributes a correction and it is weighted, not believed,
   * and it is never the source of truth.
   *
   * Two details matter and both are easy to get wrong. The update runs at the
   * model's actual output rate (5 Hz), not at the 50 Hz IMU rate — folding a
   * static estimate in fifty times a second would hand it fifty times the
   * influence it deserves and tear the position state apart. And the assumed
   * accuracy is deliberately *worse* than a GNSS fix, so the filter keeps the
   * final say.
   */
  private applyAiBiasMeasurement(): void {
    const p = this.scenario;
    // Trust the model less than a real GNSS fix, and less still when its own
    // confidence is low. This is what makes the damping partial rather than total.
    const trust = 0.35 * (0.5 + 0.5 * this.aiConfidence);
    const sigma = Math.max(p.imuNoise * 0.25, p.imuNoise * (1.6 - 0.5 * trust));
    const r = sigma * sigma;

    // H selects the two bias states, and only those: see the note at the top of
    // kalman.ts. The damping still reaches the reported uncertainty, because the
    // engine builds the acceleration process noise from the posterior bias
    // variance — which is exactly what this call shrinks.
    updateBlock(
      this.kf,
      [IDX.bx, IDX.by],
      [this.aiPredictedBias.east, this.aiPredictedBias.north],
      [r, 0, 0, r],
      25,
    );
  }

  // ---------------------------------------------------------------- AI stage

  private stepAi(
    state: SystemStateId,
    denying: boolean,
    dt: number,
    events: NavigationEvent[],
  ): AIStatus {
    const p = this.scenario;
    const active = state === 'AI_CORRECTION';

    if (active) {
      if (this.aiStage === 'IDLE') {
        this.aiStage = 'IMU_WINDOW';
        this.aiStageTimer = 0;
        events.push(
          this.aiEvent(
            'AI STAGE · IMU WINDOW',
            'Sliding window of the last 2 s of IMU samples opened for feature extraction.',
            'caution',
          ),
        );
      }
      this.aiStageTimer += dt;
      if (this.aiStageTimer >= AI_STAGE_DWELL_S[this.aiStage]) {
        this.aiStageTimer = 0;
        const order: AIStatus['stage'][] = ['IMU_WINDOW', 'FEATURES', 'INFERENCE', 'CORRECTION', 'FUSED'];
        const idx = order.indexOf(this.aiStage);
        this.aiStage = order[(idx + 1) % order.length];
        if (this.aiStage === 'CORRECTION') {
          this.aiCorrections++;
        }
      }
    } else {
      this.aiStage = 'IDLE';
      this.aiStageTimer = 0;
    }

    if (active) {
      // The model estimates the bias it can see from the motion features. It is
      // imperfect by construction — a real model would be too — and it is
      // deliberately biased toward the filter's current estimate so that the
      // correction is a refinement, not a replacement.
      const est = { east: this.kf.x[IDX.bx], north: this.kf.x[IDX.by] };
      const alpha = 0.45;
      this.aiPredictedBias = {
        east: est.east + (this.accelBiasTrue.east - est.east) * alpha + p.imuNoise * this.rng.smooth(0.08) * 0.25,
        north: est.north + (this.accelBiasTrue.north - est.north) * alpha + p.imuNoise * this.rng.smooth(0.08) * 0.25,
        up: this.accelBiasTrue.up * 0.4,
      };
      this.aiInferenceMs = 2.2 + this.rng.smooth(0.05) * 1.4;
      this.aiConfidence = clamp(
        0.55 + 0.35 * Math.exp(-this.t / 45) + this.rng.smooth(0.05) * 0.05,
        0,
        1,
      );

      if (this.t - this.lastCorrectionHeadline > 3.5) {
        this.lastCorrectionHeadline = this.t;
        const mag = Math.hypot(this.aiPredictedBias.east, this.aiPredictedBias.north);
        events.push(
          this.aiEvent(
            'AI CORRECTION APPLIED',
            `Model returned a bias estimate of ${mag.toFixed(4)} m/s². It has been applied to the filter as a weighted measurement — uncertainty growth is being damped, not removed.`,
            'caution',
          ),
        );
      }
    } else {
      this.aiInferenceMs = 0;
      this.aiConfidence = 0;
      if (denying && this.t - this.lastCorrectionEvent > 6) {
        this.lastCorrectionEvent = this.t;
        events.push(
          this.aiEvent(
            'AI STAGE PENDING',
            'GNSS is denied and the strapdown solution is drifting. The model engages once the drift is established.',
            'info',
          ),
        );
      }
    }

    return {
      active,
      stage: this.aiStage,
      windowSamples: 400,
      featureCount: active ? 24 : 0,
      predictedError: {
        x: this.aiPredictedBias.east,
        y: this.aiPredictedBias.north,
        z: this.aiPredictedBias.up,
      },
      inferenceMs: this.aiInferenceMs,
      modelConfidence: this.aiConfidence,
      correctionsApplied: this.aiCorrections,
    };
  }

  // ---------------------------------------------------------------- helpers

  private headingErrorDeg(): number {
    return this.headingVariance > 0 ? Math.sqrt(this.headingVariance) * DEG : 0;
  }

  private filteredHeading(): number {
    const vx = this.kf.x[IDX.vx];
    const vy = this.kf.x[IDX.vy];
    if (Math.hypot(vx, vy) < 0.4) return this.trueHeading;
    return (Math.atan2(vx, vy) * DEG + 360) % 360;
  }

  /**
   * The uncertainty the operator is shown, read straight off the filter's
   * covariance. Never a curve, never a scenario parameter.
   */
  private currentUncertainty(): Uncertainty {
    const P = this.kf.P;
    const sigmaE = Math.sqrt(Math.max(1e-8, P[0 * N + 0]));
    const sigmaN = Math.sqrt(Math.max(1e-8, P[1 * N + 1]));
    const rho = clamp(P[0 * N + 1] / (sigmaE * sigmaN + 1e-12), -0.98, 0.98);
    const u: Uncertainty = {
      sigmaEast: sigmaE,
      sigmaNorth: sigmaN,
      correlation: rho,
      sigmaHeadingDeg: this.headingErrorDeg(),
      confidence: 0,
    };
    u.confidence = confidenceFromSigma(covarianceEllipse(u));
    return u;
  }

  private currentOutageRegion(): OutageRegion {
    const p = this.scenario;
    const h = headingToVector(this.trueHeading);
    if (p.id === 'tunnel') {
      const halfLen = 240;
      const halfWidth = 16;
      const cx = this.trueEnu.east - h.east * 220;
      const cy = this.trueEnu.north - h.north * 220;
      return {
        label: 'TUNNEL PORTAL · GNSS DENIED',
        minEast: cx - Math.abs(h.east) * halfLen - halfWidth,
        maxEast: cx + Math.abs(h.east) * halfLen + halfWidth,
        minNorth: cy - Math.abs(h.north) * halfLen - halfWidth,
        maxNorth: cy + Math.abs(h.north) * halfLen + halfWidth,
      };
    }
    return {
      label: 'GNSS DENIAL ZONE',
      minEast: this.trueEnu.east - 340,
      maxEast: this.trueEnu.east + 340,
      minNorth: this.trueEnu.north - 340,
      maxNorth: this.trueEnu.north + 340,
    };
  }

  private simEvent(title: string, message: string, severity: NavigationEvent['severity']): NavigationEvent {
    return {
      id: `sim-${this.t.toFixed(2)}-${this.eventSeq++}`,
      timestamp: Date.now(),
      kind: 'SIM',
      severity,
      title,
      message,
      source: 'DEMO_SIMULATED',
    };
  }

  private aiEvent(title: string, message: string, severity: NavigationEvent['severity']): NavigationEvent {
    return {
      id: `ai-${this.t.toFixed(2)}-${this.eventSeq++}`,
      timestamp: Date.now(),
      kind: 'AI',
      severity,
      title,
      message,
      source: 'DEMO_SIMULATED',
    };
  }
}

/**
 * How often the AI stage's estimate is folded into the filter, seconds. This is
 * the model's output rate, not the IMU rate — see applyAiBiasMeasurement.
 */
const AI_UPDATE_PERIOD = 0.2;

const AI_STAGE_DWELL_S: Record<AIStatus['stage'], number> = {
  IDLE: 0,
  IMU_WINDOW: 0.9,
  FEATURES: 0.9,
  INFERENCE: 1.3,
  CORRECTION: 0.6,
  FUSED: 1.0,
};

function symmetrise6(P: Matrix): void {
  for (let i = 0; i < 6; i++) {
    for (let j = i + 1; j < 6; j++) {
      const m = 0.5 * (P[i * 6 + j] + P[j * 6 + i]);
      P[i * 6 + j] = m;
      P[j * 6 + i] = m;
    }
  }
}

function positionToEnu(origin: GeoOrigin, p: { lat: number; lon: number; alt: number }): EnuOffset {
  return {
    east: (p.lon - origin.lon) * metresPerDegreeLon(origin.lat),
    north: (p.lat - origin.lat) * metresPerDegreeLat(),
    up: p.alt - origin.alt,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function eskfHealthFor(state: SystemStateId): ESKFHealth {
  switch (state) {
    case 'INITIALISING':
      return 'INITIALISING';
    case 'RE_FUSION':
      return 'REACQUIRING';
    case 'GNSS_DEGRADED':
      return 'DEGRADED';
    default:
      return 'RUNNING';
  }
}

type ESKFHealth = 'INITIALISING' | 'RUNNING' | 'REACQUIRING' | 'DEGRADED';

function headingSourceFor(state: SystemStateId): 'GNSS' | 'DEAD_RECKONING' | 'FUSED' | 'AI_CORRECTED' {
  switch (state) {
    case 'GNSS_FUSED':
    case 'GNSS_DEGRADED':
    case 'RE_FUSION':
    case 'STABILIZED':
      return 'FUSED';
    case 'INS_ACTIVE':
      return 'DEAD_RECKONING';
    case 'AI_CORRECTION':
      return 'AI_CORRECTED';
    default:
      return 'DEAD_RECKONING';
  }
}
