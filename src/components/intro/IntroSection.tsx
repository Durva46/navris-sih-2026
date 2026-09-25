import { TECHNICAL_TERMS } from '@/content/technicalTerms';
import { ChevronDown, FlaskConical, Gauge, HelpCircle, MapPin, MonitorPlay } from 'lucide-react';

/**
 * The judge-facing introduction.
 *
 * This exists to answer four questions before anyone has to ask them: what
 * problem does this solve, who has the problem, what is actually built versus
 * simulated, and how do I run it. A demonstration that has to be verbally
 * explained has already lost half its room, and a demonstration whose
 * simulated status is unclear is worse than no demonstration.
 *
 * Two rules govern the copy, and both are load-bearing:
 *
 * 1. **The built/simulated split is stated explicitly and up front.** Everything
 *    in the cockpit is generated in the browser. Saying so plainly is what
 *    makes the rest of the claim credible.
 * 2. **No result is presented as validation.** The research baseline is
 *    described as a separate body of work maintained outside this app. Nothing
 *    on this screen asks the reader to treat a simulated trajectory as evidence
 *    of navigation accuracy.
 *
 * Open by default. A judge-facing introduction that has to be discovered behind a
 * chevron is an introduction most people never read, and the first thirty seconds
 * of a demonstration are the ones that decide how it lands. It is safe to be open
 * on a phone because the body carries its own `max-h` and scroll, so the cockpit
 * below always keeps the remaining viewport rather than being pushed off-screen.
 *
 * Native <details> rather than a JS disclosure: it is keyboard-operable and
 * announced correctly with no script, and it costs nothing when closed.
 */
export function IntroSection() {
  return (
    <section
      aria-labelledby="intro-heading"
      data-qa="intro"
      className="shrink-0 border-b border-hairline bg-surface"
    >
      <details open className="group">
        <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2.5 px-3 py-2.5 sm:px-4 [&::-webkit-details-marker]:hidden">
          <HelpCircle size={13} className="shrink-0 text-ink-dim" aria-hidden />
          <h2
            id="intro-heading"
            className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted sm:text-micro"
          >
            About NAVRIS
          </h2>
          <span className="hidden text-[10.5px] text-ink-dim sm:inline">
            What it does, what is real, and how to run it
          </span>
          <ChevronDown
            size={13}
            aria-hidden
            className="ml-auto shrink-0 text-ink-dim transition-transform duration-150 group-open:rotate-180"
          />
        </summary>

        {/* The body scrolls independently so the intro can never squeeze the
            cockpit out of the viewport on a short screen. */}
        <div className="max-h-[52vh] overflow-y-auto border-t border-hairline px-3 py-3 sm:px-4 lg:max-h-[38vh]">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Card icon={MapPin} title="The problem">
              <p>
                Navigation becomes unreliable whenever GNSS is degraded or unavailable — a tunnel, an
                urban canyon, a temporary outage. Position is still needed, and losing it is worse
                than a wrong answer because the driver does not know it has happened.
              </p>
              <p>
                NAVRIS maintains navigation continuity by combining inertial sensing with an
                explicit estimate of navigation state, so the system knows what it is doing and how
                much to trust it.
              </p>
            </Card>

            <Card icon={Gauge} title="Who needs it">
              <p>
                Any vehicle that must keep navigating when satellites do not: road and rail
                vehicles in tunnels and cuttings, warehouse and port equipment indoors, drones
                operating below or between obstructions, and surveyors working where the sky is
                blocked.
              </p>
              <p>
                The common requirement is not a better fix. It is a position that keeps arriving,
                and an honest measure of its own error while it does.
              </p>
            </Card>

            <Card icon={FlaskConical} title="What is actually built">
              <ScopeList
                tone="built"
                items={[
                  'Navigation-state architecture and the full state ladder',
                  'GNSS/INS fusion research baseline',
                  'ESKF-based inertial navigation research',
                  'Calibrated sensor processing',
                  'Causal ZUPT research',
                  'NHC research implementation',
                  'Real-data research and benchmarking, maintained separately',
                ]}
              />
              <ScopeList
                tone="simulated"
                items={[
                  'This cockpit interface and its visualisation',
                  'The GNSS degradation and outage progression',
                  'The navigation-state transitions shown here',
                  'The AI correction state',
                  'All telemetry on this screen',
                ]}
              />
              <p className="text-ink-dim">
                This page is a demonstration layer. It does not read your phone&rsquo;s sensors, and
                it runs no inference on your device.
              </p>
            </Card>

            <Card icon={MonitorPlay} title="How to run it">
              <ol className="space-y-1.5">
                <Step n={1}>
                  Press <Control name="Sim" /> to open the simulation controls, and pick a scenario.
                </Step>
                <Step n={2}>
                  Watch the state move from <strong>fused</strong> to <strong>degraded</strong> to{' '}
                  <strong>GNSS lost</strong>.
                </Step>
                <Step n={3}>
                  The fix freezes while NAVRIS keeps moving: this is <strong>dead reckoning</strong>,
                  and the gap between the two lines is the error accumulating.
                </Step>
                <Step n={4}>
                  The ellipse grows because the filter is admitting it does not know. This is the
                  behaviour being demonstrated.
                </Step>
                <Step n={5}>
                  When a fix returns, watch the <strong>re-fusion</strong> collapse both the error
                  and the ellipse.
                </Step>
              </ol>
              <p className="text-ink-dim">
                Use <Control name="Trigger Outage" /> and{' '}
                <Control name="Trigger Recovery" /> to drive the sequence by hand instead of waiting
                for the script.
              </p>
            </Card>
          </div>

          <ResearchStatus />
          <TechnicalGlossary />
        </div>
      </details>
    </section>
  );
}

function Card({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof MapPin;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 rounded border border-hairline bg-base-850 p-2.5">
      <h3 className="flex items-center gap-1.5 font-mono text-micro font-medium uppercase tracking-[0.14em] text-ink-muted">
        <Icon size={11} className="shrink-0 text-ink-dim" aria-hidden />
        {title}
      </h3>
      <div className="mt-1.5 space-y-1.5 text-[10.5px] leading-relaxed text-ink-muted [&_code]:text-ink [&_strong]:text-ink">
        {children}
      </div>
    </div>
  );
}

function ScopeList({ tone, items }: { tone: 'built' | 'simulated'; items: string[] }) {
  const isBuilt = tone === 'built';
  return (
    <div>
      <h4
        className={`font-mono text-[9px] font-semibold uppercase tracking-[0.14em] ${
          isBuilt ? 'text-nominal' : 'text-degraded'
        }`}
      >
        {isBuilt ? 'Built / research' : 'Simulated in this demo'}
      </h4>
      <ul className="mt-1 space-y-0.5">
        {items.map((item) => (
          <li key={item} className="flex gap-1.5">
            <span
              aria-hidden
              className={`mt-[6px] h-1 w-1 shrink-0 rounded-full ${
                isBuilt ? 'bg-nominal' : 'bg-degraded'
              }`}
            />
            <span className="text-ink-muted">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-2">
      <span
        aria-hidden
        className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-hairline font-mono text-[9px] text-ink-dim"
      >
        {n}
      </span>
      <span className="text-ink-muted">{children}</span>
    </li>
  );
}

/** Names an actual control, so the instructions can be followed literally. */
function Control({ name }: { name: string }) {
  return <code className="rounded border border-hairline px-1 py-px text-ink">{name}</code>;
}

/**
 * Research status, stated as a boundary rather than as a result.
 *
 * The repository holds a real GNSS/INS research baseline with real-data
 * experiments, but none of it is wired into this page. The honest thing to
 * present is therefore the separation itself: the browser is a demonstration
 * layer, and the benchmark lives elsewhere. Presenting a simulated trajectory
 * here as validation would be the one thing that could discredit the rest.
 */
function ResearchStatus() {
  return (
    <div className="mt-3 rounded border border-ai/30 bg-ai/[0.05] p-2.5">
      <h3 className="flex items-center gap-1.5 font-mono text-micro font-medium uppercase tracking-[0.14em] text-ai-soft">
        <FlaskConical size={11} className="shrink-0" aria-hidden />
        Research status
      </h3>
      <div className="mt-1.5 space-y-1.5 text-[10.5px] leading-relaxed text-ink-muted">
        <p>
          The GNSS/INS research baseline, its ESKF implementation and its real-data benchmark
          experiments are maintained as a separate body of work and are not executed by this page.
        </p>
        <p>
          <strong className="text-ink">Nothing on this screen is a validation result.</strong> The
          trajectories, covariances and state transitions you see are synthetic, produced by a
          scripted scenario. The graphs under{' '}
          <span className="text-ink">Analytics</span> are a visualisation of that simulation and
          are labelled as such; they are not evidence of navigation accuracy.
        </p>
        <p>
          A research result would be reported with its dataset, its metric and whether it came from
          real or synthetic data. Those labels are applied wherever such a result is presented, and
          are absent here precisely because there is none to present.
        </p>
      </div>
    </div>
  );
}

/**
 * The glossary.
 *
 * A native <details>, so it is keyboard-operable and screen-reader-announced with
 * no JavaScript, and so it costs nothing when closed. Terms are also attached
 * inline via <TermHint> where they appear in the cockpit.
 */
function TechnicalGlossary() {
  return (
    <details className="group/terms mt-2 rounded border border-hairline bg-base-850">
      <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 px-2.5 py-2 [&::-webkit-details-marker]:hidden">
        <ChevronDown
          size={11}
          aria-hidden
          className="shrink-0 text-ink-dim transition-transform duration-150 group-open/terms:rotate-90"
        />
        <span className="font-mono text-micro font-medium uppercase tracking-[0.14em] text-ink-muted">
          Technical terms
        </span>
        <span className="ml-auto text-[10px] text-ink-dim">
          {TECHNICAL_TERMS.length} defined
        </span>
      </summary>
      <dl className="grid gap-x-4 gap-y-2 border-t border-hairline px-2.5 py-2.5 sm:grid-cols-2">
        {TECHNICAL_TERMS.map(({ term, short, long }) => (
          <div key={term} className="min-w-0">
            <dt className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-ink">
              {term}
            </dt>
            <dd className="mt-0.5 text-[10.5px] leading-relaxed text-ink-muted">
              {short}
              <span className="mt-0.5 block text-ink-dim">{long}</span>
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
