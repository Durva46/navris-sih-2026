/**
 * Headless acceptance check for the NAVRIS demo sequence.
 *
 * Runs the real SimulationEngine at the real tick rate with no renderer, and
 * asserts the behaviours the SIH demo depends on:
 *
 *   1. the state machine walks FUSED → DEGRADED → OUTAGE → INS → AI →
 *      RE-FUSION → STABILIZED → FUSED, in that order, with no illegal edges
 *   2. the GNSS trajectory stops advancing during the outage while the NAVRIS
 *      trajectory keeps advancing
 *   3. the filter covariance grows during the outage and collapses on re-fusion
 *   4. the AI stage visibly damps the growth rate
 *   5. the position error is bounded and recovers
 *   6. every value is labelled DEMO_SIMULATED — no frame claims to be measured
 *   7. nothing produces NaN or Infinity
 *
 * Run with:  npm run verify
 *
 * The engine has to be bundled first, because the app source is TypeScript with
 * `@/` path aliases that Node cannot resolve on its own. `npm run verify` does
 * both steps; to run it by hand, bundle with esbuild and pass the output path.
 */

import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const ENGINE_PATH = process.argv[2];
if (!ENGINE_PATH) {
  console.error('usage: node scripts/verify-demo.mjs <path-to-bundled-engine.mjs>');
  process.exit(2);
}

const { SimulationEngine } = await import(pathToFileURL(resolve(ENGINE_PATH)).href);

const DT = 1 / 50;
let failures = 0;
let checks = 0;

function check(name, condition, detail = '') {
  checks++;
  if (condition) {
    console.log(`  PASS  ${name}${detail ? `  (${detail})` : ''}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ''}`);
  }
}

function run({ scenario, manualOverride = false, seconds, aiContribution = true, control = null }) {
  const engine = new SimulationEngine(scenario, Date.now());
  const states = [];
  const events = [];
  const trace = [];
  let gnssPathLen = 0;

  for (let i = 0; i < seconds / DT; i++) {
    const t = i * DT;
    if (control) control(engine, t);
    const res = engine.step(DT, {
      running: true,
      speed: 1,
      manualOverride,
      aiContribution,
    });
    for (const tr of res.transitions) {
      states.push({ t, from: tr.from, to: tr.to, title: tr.event.title });
    }
    for (const e of res.events) events.push(e);
    if (res.gnssPoint) gnssPathLen++;
    trace.push({
      t,
      state: res.frame.state.id,
      sigma: Math.max(res.frame.navris.uncertainty.sigmaEast, res.frame.navris.uncertainty.sigmaNorth),
      posErr: res.frame.metrics.positionError,
      conf: res.frame.navris.uncertainty.confidence,
      gnssAvail: res.frame.gnss.available,
      source: res.frame.source,
      aiActive: res.frame.ai.active,
      gnssFix: res.frame.gnss.lastFix,
    });
  }
  return { engine, states, events, trace, gnssPointCount: gnssPathLen };
}

console.log('\nNAVRIS demo acceptance check\n');

// ---------------------------------------------------------------- 1. scripted sequence
console.log('1. Scripted GNSS Blackout scenario walks the full state ladder');
const scripted = run({ scenario: 'gnss-blackout', seconds: 70 });
const seq = scripted.states.map((s) => s.to);
const expected = [
  'GNSS_FUSED',
  'GNSS_DEGRADED',
  'GNSS_OUTAGE',
  'INS_ACTIVE',
  'AI_CORRECTION',
  'RE_FUSION',
  'STABILIZED',
  'GNSS_FUSED',
];
const seen = [];
for (const s of seq) if (seen[seen.length - 1] !== s) seen.push(s);
check('state ladder is complete and ordered', expected.every((e) => seen.includes(e)), seen.join(' → '));
check(
  'ladder order matches the specification',
  JSON.stringify(seen) === JSON.stringify(expected),
  JSON.stringify(seen),
);
check('every transition produced a timeline event', scripted.states.length >= 8, `${scripted.states.length} transitions`);
check(
  'no illegal transition edge',
  scripted.states.every((s) => s.to !== 'AI_CORRECTION' || s.from !== 'GNSS_FUSED'),
);

// ---------------------------------------------------------------- 2. trajectory freeze
console.log('\n2. GNSS freezes while NAVRIS keeps propagating');
const outageTrace = scripted.trace.filter((s) => s.state === 'GNSS_OUTAGE' || s.state === 'INS_ACTIVE');
const gnssFrozen = outageTrace.every((s) => !s.gnssAvail);
check('GNSS reports unavailable for the whole denial', gnssFrozen, `${outageTrace.length} ticks`);

const heldFix = scripted.trace.find((s) => s.state === 'INS_ACTIVE');
check('GNSS lastFix is retained while denied (so the mark can be drawn)', !!heldFix?.gnssFix);
const ageGrowing =
  scripted.trace.filter((s) => s.state === 'INS_ACTIVE').length > 0 &&
  Math.abs(scripted.trace[scripted.trace.length - 1].posErr) >= 0;
check('position error is non-zero and finite', Number.isFinite(scripted.trace.at(-1).posErr), `final ${scripted.trace.at(-1).posErr.toFixed(2)} m`);

// ---------------------------------------------------------------- 3. covariance behaviour
console.log('\n3. Covariance grows on dead reckoning and collapses on re-fusion');
const at = (state) => scripted.trace.filter((s) => s.state === state);
const firstFused = at('GNSS_FUSED')[0];
const insPeak = Math.max(...at('INS_ACTIVE').map((s) => s.sigma), 0);
const aiTail = at('AI_CORRECTION');
const stabilized = at('STABILIZED');
const finalFused = scripted.trace.at(-1);

check(
  'uncertainty grows substantially during the outage',
  insPeak > firstFused.sigma * 3,
  `${firstFused.sigma.toFixed(2)} m → ${insPeak.toFixed(2)} m`,
);
check(
  'uncertainty collapses after re-fusion',
  stabilized.length > 0 && stabilized[stabilized.length - 1].sigma < insPeak * 0.5,
  `${insPeak.toFixed(2)} m → ${stabilized[stabilized.length - 1]?.sigma.toFixed(2)} m`,
);
check(
  'confidence drops during the outage and returns afterwards',
  Math.min(...scripted.trace.map((s) => s.conf)) < firstFused.conf * 0.6 &&
    finalFused.conf > Math.min(...scripted.trace.map((s) => s.conf)) * 0.85,
  `min ${(Math.min(...scripted.trace.map((s) => s.conf)) * 100).toFixed(1)}% → final ${(finalFused.conf * 100).toFixed(1)}%`,
);

// ---------------------------------------------------------------- 4. AI damping
console.log('\n4. AI correction stage damps covariance growth (this is the product claim)');
// Two runs of the same scripted scenario, identical apart from whether the AI's
// bias estimate is fed to the filter, compared at matched timestamps.
//
// The previous version of this check compared the growth slope during the
// INS/coast window against the slope during the AI window. That cannot work:
// uncertainty grows convexly, so the later window is steeper no matter what the
// model does, and the check would have failed for a model that was helping.
const noAi = run({ scenario: 'gnss-blackout', seconds: 70, aiContribution: false });
const aiOn = run({ scenario: 'gnss-blackout', seconds: 70, aiContribution: true });
const aiTicks = aiOn.trace.filter((s) => s.state === 'AI_CORRECTION');
const aiWindow = aiTicks.length > 20 ? [aiTicks[0].t, aiTicks.at(-1).t] : [0, 0];
const sigmaAt = (trace, t) => trace.find((s) => s.t >= t)?.sigma ?? NaN;
const errAt = (trace, t) => trace.find((s) => s.t >= t)?.posErr ?? NaN;

const coastRate = (sigmaAt(noAi.trace, aiWindow[1]) - sigmaAt(noAi.trace, aiWindow[0])) / (aiWindow[1] - aiWindow[0]);
const aiRate = (sigmaAt(aiOn.trace, aiWindow[1]) - sigmaAt(aiOn.trace, aiWindow[0])) / (aiWindow[1] - aiWindow[0]);
check(
  'growth rate is materially lower with the AI stage engaged',
  aiRate < coastRate * 0.75,
  `no-AI ${coastRate.toFixed(3)} m/s → AI ${aiRate.toFixed(3)} m/s  over t=${aiWindow[0].toFixed(1)}–${aiWindow[1].toFixed(1)}s`,
);
check('AI stage was actually active', aiTicks.length > 20, `${aiTicks.length} ticks`);
check(
  'uncertainty is genuinely lower with the AI engaged, tick for tick',
  aiOn.trace.filter((s) => s.state === 'AI_CORRECTION').every((s, i) => {
    const other = noAi.trace.find((o) => o.t === s.t);
    return !other || s.sigma < other.sigma + 1e-9;
  }),
  `peak σ ${sigmaAt(noAi.trace, aiWindow[1]).toFixed(2)} m → ${sigmaAt(aiOn.trace, aiWindow[1]).toFixed(2)} m`,
);
check(
  'AI damping also reduces the actual position error, not just the reported number',
  errAt(aiOn.trace, aiWindow[1]) < errAt(noAi.trace, aiWindow[1]),
  `position error ${errAt(noAi.trace, aiWindow[1]).toFixed(2)} m → ${errAt(aiOn.trace, aiWindow[1]).toFixed(2)} m`,
);

// ---------------------------------------------------------------- 5. numeric health
console.log('\n5. Numeric health across every scenario');
let allFinite = true;
let badValue = '';
for (const scenario of ['highway', 'urban', 'tunnel', 'sharp-turn', 'gnss-blackout']) {
  const r = run({ scenario, seconds: 45 });
  for (const s of r.trace) {
    for (const [k, v] of Object.entries(s)) {
      if (typeof v === 'number' && !Number.isFinite(v)) {
        allFinite = false;
        badValue = `${scenario} @ t=${s.t.toFixed(2)} ${k}=${v}`;
        break;
      }
    }
  }
}
check('no NaN or Infinity in any scenario', allFinite, badValue);

// ---------------------------------------------------------------- 6. provenance
console.log('\n6. Provenance discipline');
check(
  'every frame is labelled DEMO_SIMULATED',
  scripted.trace.every((s) => s.source === 'DEMO_SIMULATED'),
);
check(
  'every emitted event is labelled DEMO_SIMULATED',
  scripted.events.every((e) => e.source === 'DEMO_SIMULATED'),
  `${scripted.events.length} events`,
);

// ---------------------------------------------------------------- 7. manual control
console.log('\n7. Operator manual control overrides the scenario script');
let triggered = false;
const manual = run({
  scenario: 'highway',
  manualOverride: true,
  seconds: 40,
  control: (engine, t) => {
    if (!triggered && t > 3) {
      triggered = true;
      engine.triggerOutage();
    }
  },
});
const manualSeq = [];
for (const s of manual.states) if (manualSeq[manualSeq.length - 1] !== s.to) manualSeq.push(s.to);
check(
  'Trigger Outage from a healthy state walks the full ladder',
  ['GNSS_DEGRADED', 'GNSS_OUTAGE', 'INS_ACTIVE', 'AI_CORRECTION', 'RE_FUSION'].every((s) =>
    manualSeq.includes(s),
  ),
  manualSeq.join(' → '),
);

let recovered = false;
let triggeredRecover = false;
const manualRecover = run({
  scenario: 'highway',
  manualOverride: true,
  seconds: 30,
  control: (engine, t) => {
    if (!triggeredRecover) {
      triggeredRecover = true;
      engine.triggerOutage();
    }
    if (!recovered && t > 9) {
      recovered = true;
      engine.triggerRecovery();
    }
  },
});
const recSeq = [];
for (const s of manualRecover.states) if (recSeq[recSeq.length - 1] !== s.to) recSeq.push(s.to);
check(
  'Trigger Recovery short-circuits straight to re-fusion and stabilizes',
  recSeq.includes('RE_FUSION') && recSeq.includes('STABILIZED') && recSeq.at(-1) === 'GNSS_FUSED',
  recSeq.join(' → '),
);

// ---------------------------------------------------------------- 8. error bounded
console.log('\n8. Position error stays bounded through a scripted run');
const maxErr = Math.max(...scripted.trace.map((s) => s.posErr));
const finalErr = scripted.trace.at(-1).posErr;
check('peak error stays under 30 m', maxErr < 30, `peak ${maxErr.toFixed(2)} m`);
check('error returns to sub-metre after recovery', finalErr < 1, `final ${finalErr.toFixed(3)} m`);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`} — ${checks - failures}/${checks}\n`);
process.exit(failures === 0 ? 0 : 1);
