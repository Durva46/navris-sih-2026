/**
 * Plain-language definitions for the terms a judge is most likely to meet.
 *
 * Kept as data rather than inline prose for three reasons: the same definition
 * can be reused in a tooltip and in the glossary, the wording stays consistent
 * wherever a term appears, and adding a term cannot mean editing a component.
 *
 * The definitions are deliberately short. Each answers "what is this and why
 * does it exist" in one sentence — enough for a non-specialist to follow the
 * cockpit, not enough to become a second thing to read.
 */
export interface TechnicalTerm {
  /** The term as it appears in the UI. */
  term: string;
  /** One-sentence definition, no jargon, no equations. */
  short: string;
  /** A little more context, for the expandable glossary. */
  long: string;
}

export const TECHNICAL_TERMS: readonly TechnicalTerm[] = [
  {
    term: 'GNSS outage',
    short: 'A period in which usable GNSS positioning is unavailable or rejected.',
    long:
      'A GNSS outage is a stretch of time when the receiver cannot produce a position the navigation system is willing to trust — either because the satellites are genuinely out of reach, as in a tunnel, or because the signals are being reflected or blocked, as in a dense city centre. NAVRIS treats the two cases the same way: it stops fusing and starts dead reckoning.',
  },
  {
    term: 'Dead reckoning',
    short:
      'Estimating motion forward from a previously known state using inertial measurements when external positioning is unavailable.',
    long:
      'Dead reckoning integrates the readings of the accelerometers and gyroscopes over time to project the last known position forward. It is the oldest navigation technique there is, and it is entirely dependent on those sensors being accurate — small errors in acceleration compound quickly with distance, which is exactly what the growing uncertainty ellipse on the map is showing.',
  },
  {
    term: 'ESKF',
    short:
      'Error-State Kalman Filter — a state-estimation method used to combine inertial measurements with navigation corrections.',
    long:
      'An ESKF estimates the error in a navigation solution rather than the solution itself, which keeps the filter well-behaved and makes the filter\'s own uncertainty estimate meaningful. It takes the inertial solution as its prediction and folds in whatever external corrections are available — here, GNSS fixes, and zero-velocity updates — and its reported covariance is what drives the uncertainty ellipse.',
  },
  {
    term: 'Covariance',
    short: "A measure of the estimator's uncertainty in its current state.",
    long:
      'Covariance describes how uncertain the filter is about each direction of its solution, and how those uncertainties relate to one another. When the filter is confident, covariance is small and the ellipse on the map is tight. When it is coasting on inertial data alone, covariance grows — and that growth is not a flaw to be hidden, it is the honest report of how much the answer should be trusted.',
  },
  {
    term: 'IMU',
    short:
      'Inertial Measurement Unit — the accelerometers and gyroscopes that measure motion independently of GNSS.',
    long:
      'An IMU measures specific force and angular rate rather than position. That independence is precisely what makes it valuable during an outage: it is the only sensor that keeps reporting when everything else goes quiet. It is also the reason the solution drifts, since errors in its readings accumulate.',
  },
  {
    term: 'ZUPT',
    short:
      'Zero-Velocity Update — declaring that the platform is stationary, which lets the filter correct its drift.',
    long:
      'When a vehicle is known to be stopped, every measurement can be used to estimate and remove accumulated drift. ZUPT is one of the strongest constraints available to an inertial navigator, and applying it when the vehicle is actually moving is a serious error — which is why it needs a real stationary check rather than an assumption.',
  },
  {
    term: 'NHC',
    short:
      'Non-Holonomic Constraint — a vehicle\'s wheels cannot slip sideways, which constrains its motion.',
    long:
      'A wheeled vehicle is not free to move in every direction at every moment. Encoding that restriction as a constraint on the filter narrows the set of states it will accept, and can correct lateral drift that a purely inertial update would leave in place.',
  },
  {
    term: 'HDOP',
    short:
      'Horizontal Dilution of Precision — a satellite geometry score; lower is better.',
    long:
      'HDOP describes how well the positions of the visible satellites are arranged in the sky. Even with a strong signal, badly arranged satellites give a geometrically poor position. It is one of the inputs to deciding whether a fix is good enough to fuse, and a primary cause of the "degraded" state short of a full outage.',
  },
  {
    term: 'NIS',
    short: 'Normalised Innovation Squared — a consistency check on whether an incoming fix agrees with the filter.',
    long:
      'Every time a new measurement arrives, the filter compares it against what it predicted and asks whether the difference is plausible. NIS summarises that difference, scaled so that a well-behaved filter sits near the number of measurements being checked. A value above the gate threshold means the measurement and the prediction disagree by more than expected, and the filter rejects the update instead of degrading its own state.',
  },
  {
    term: 'C/N₀',
    short: 'Carrier-to-noise density ratio — the strength of a satellite signal; higher is better.',
    long:
      'C/N₀ reports how cleanly a satellite signal stands out from background noise, in decibels per hertz. It is the closest thing GNSS has to a signal-strength meter, and it is what tells the receiver that a satellite is present but unusable — which is how a degrading link turns into a degraded state before it becomes an outage.',
  },
  {
    term: 'Re-fusion',
    short:
      'The moment the filter accepts a fresh external fix again and corrects its accumulated error.',
    long:
      'After a denial the inertial solution has drifted, and the covariance with it. When a usable fix returns, the filter does not simply switch back — it folds the new information in, the error collapses, and the uncertainty ellipse contracts. The collapse is the visible proof that the estimator was honest about its own error while it was guessing.',
  },
];

/** Look up a term by name, for tooltip use. */
export function termDefinition(term: string): TechnicalTerm | undefined {
  return TECHNICAL_TERMS.find((t) => t.term.toLowerCase() === term.toLowerCase());
}
