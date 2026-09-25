import type { ScenarioId, ScenarioProfile } from '@/types/navigation';

/**
 * Scenarios are *parameter sets*, not datasets.
 *
 * Every scenario is fed into the same trajectory + uncertainty generator in
 * `engine.ts`; nothing here contains per-scenario waypoints or hard-coded
 * positions. Adding a scenario means adding a row to this table, not authoring
 * a new animation.
 */
/** Durations of the scripted outage sequence, in seconds. Each stage is long
 *  enough to be *read* by a judge before the next one starts.
 *
 *  The pre-AI stages are deliberately short. Position variance integrates the
 *  velocity variance with weight (T−t), so the acceleration noise injected early
 *  in an outage dominates everything the model can do later: with a 6.5 s grace
 *  period before the model engaged, switching the model on measurably saved
 *  under 2% of the uncertainty, because nearly all of it was already banked.
 *  Engaging the model as soon as it has a motion window to look at — which is all
 *  a real model needs, a couple of seconds of IMU — is both the honest timing and
 *  the only one under which the product claim is true. */
export const SEQUENCE_TIMING = {
  degraded: 1.5,
  outageDetect: 1.0,
  insCoast: 2.0,
  /** Time for the model to fill its sliding IMU window before it can output. */
  aiDelay: 1.0,
  aiActive: 17.5,
  reacquire: 4.0,
  stabilize: 2.5,
} as const;
export const SCENARIOS: Readonly<Record<ScenarioId, ScenarioProfile>> = {
  highway: {
    id: 'highway',
    name: 'Highway',
    summary: 'Constant cruise, open sky. The baseline the other scenarios degrade from.',
    targetSpeed: 24, // ~86 km/h
    curvature: 0.00012,
    imuNoise: 0.012,
    gyroDrift: 0.0011,
    nominalSigma: 1.4,
    driftSigmaPerSec: 0.052,
    speedOscillation: 0.03,
    speedOscillationPeriod: 18,
    roadNoise: 0.9,
    scripted: false,
    scriptedOutageAt: null,
    scriptedOutageDuration: null,
  },

  urban: {
    id: 'urban',
    name: 'Urban Canyon',
    summary: 'Stop-and-go through a street grid. Frequent multipath, intermittent drops.',
    targetSpeed: 11,
    curvature: 0.0016,
    imuNoise: 0.045,
    gyroDrift: 0.0026,
    nominalSigma: 3.1,
    driftSigmaPerSec: 0.088,
    speedOscillation: 0.62,
    speedOscillationPeriod: 26,
    roadNoise: 2.6,
    scripted: true,
    scriptedOutageAt: 26,
    scriptedOutageDuration: 9,
  },

  tunnel: {
    id: 'tunnel',
    name: 'Tunnel',
    summary: 'Sustained GNSS denial inside a portal. Long coast, slow recovery.',
    targetSpeed: 18,
    curvature: 0.00035,
    imuNoise: 0.021,
    gyroDrift: 0.0019,
    nominalSigma: 1.8,
    driftSigmaPerSec: 0.096,
    speedOscillation: 0.08,
    speedOscillationPeriod: 22,
    roadNoise: 1.4,
    scripted: true,
    scriptedOutageAt: 16,
    scriptedOutageDuration: 22,
  },

  'sharp-turn': {
    id: 'sharp-turn',
    name: 'Sharp Turn / Braking',
    summary: 'High lateral dynamics. Stresses the strapdown propagation and the AI features.',
    targetSpeed: 15,
    curvature: 0.0125,
    imuNoise: 0.09,
    gyroDrift: 0.0034,
    nominalSigma: 2.2,
    driftSigmaPerSec: 0.14,
    speedOscillation: 0.24,
    speedOscillationPeriod: 14,
    roadNoise: 2.1,
    scripted: false,
    scriptedOutageAt: null,
    scriptedOutageDuration: null,
  },

  'gnss-blackout': {
    id: 'gnss-blackout',
    name: 'GNSS Blackout',
    summary: 'The SIH demo scenario. Full FUSED → DEGRADED → OUTAGE → AI → RE-FUSION sequence, on a timer.',
    targetSpeed: 17,
    curvature: 0.0009,
    imuNoise: 0.03,
    gyroDrift: 0.0022,
    nominalSigma: 1.6,
    driftSigmaPerSec: 0.105,
    speedOscillation: 0.12,
    speedOscillationPeriod: 20,
    roadNoise: 1.6,
    scripted: true,
    scriptedOutageAt: 12,
    // The denial has to outlast the ladder up to the point where GNSS is
    // actually available again, or the model gets cut off mid-correction.
    scriptedOutageDuration:
      SEQUENCE_TIMING.degraded +
      SEQUENCE_TIMING.outageDetect +
      SEQUENCE_TIMING.insCoast +
      SEQUENCE_TIMING.aiDelay +
      SEQUENCE_TIMING.aiActive,
  },
};

export const SCENARIO_ORDER: readonly ScenarioId[] = [
  'highway',
  'urban',
  'tunnel',
  'sharp-turn',
  'gnss-blackout',
];

export const DEFAULT_SCENARIO: ScenarioId = 'gnss-blackout';

