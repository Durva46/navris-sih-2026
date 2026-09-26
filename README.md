# NAVRIS Frontend

NAVRIS — Intelligent Navigation & Inertial System. React + TypeScript front end for SIH 2026 (ISRO 26168).

> **Architecture & roadmap:** [`NAVRIS_FRONTEND_STRATEGY.md`](./NAVRIS_FRONTEND_STRATEGY.md) is the
> implementation source of truth — the adapter family, `dataSourceMode`, the map layering, and
> the scientific boundary between navigation and visualisation. This README describes only what
> is built and working today.

**Repository status.** This repository is the frontend and is self-contained: it
builds, runs, and passes its acceptance suite with no backend and no network
service. The backend and research (recorded-dataset replay) repositories are not
published yet. The integration point is `DataAdapter` in
[`src/adapters/DataAdapter.ts`](./src/adapters/DataAdapter.ts) and nothing else —
see [Swapping in real data](#swapping-in-real-data) for the contract a backend
has to satisfy.

**Everything this app shows is simulated.** There is no real sensor, no real GNSS
receiver, and no trained model behind the numbers. Every frame and every event is
stamped `DEMO_SIMULATED`, and the UI labels it as such in the top bar. The
simulation is deterministic (seeded, no `Math.random()`), so a judge who resets the
demo sees the exact same run twice.

**The map is a real geographic map.** It is MapLibre GL with OpenStreetMap standard
raster tiles, drawn under the vehicle's local ENU frame. The tile source is isolated
in [`src/map/provider.ts`](./src/map/provider.ts), which knows nothing about
navigation, the filter, or React, so a provider swap is a config change. The
OpenStreetMap credit is rendered on the map at all times and the official tile
infrastructure's usage policy forbids production use — this is a demonstration
configuration, and pointing `VITE_MAP_*` at a commercial tile provider needs no
code change (see [Configuration](#configuration)). If tiles fail to load, the map
says so and the navigation stack is unaffected.

## The demo, in one sentence

GNSS degrades and then fails; the strapdown inertial solution keeps flying on
accelerometer bias it does not know it has; an AI model watching the IMU window
estimates that bias and feeds it back as a weighted pseudo-measurement; the
uncertainty ellipse stops growing; then GNSS returns and the filter re-fuses.

The state machine is the spine of the demo, and it is only ever traversed in this
order:

```
GNSS_FUSED → GNSS_DEGRADED → GNSS_OUTAGE → INS_ACTIVE → AI_CORRECTION
          → RE_FUSION → STABILIZED → GNSS_FUSED
```

## Running it

```bash
npm install
npm run dev        # dev server
npm run build      # typecheck + production build
npm run verify     # headless acceptance suite (see below)
```

On Windows use `npm.cmd` if PowerShell blocks `npm.ps1` with a script-policy error.

## Configuration

There is no configuration file and no secret in this repository. The only optional
settings are environment variables, all optional, all read at build time:

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_MAP_TILE_URL` | OSM standard raster tiles | Raster tile template with `{z}/{x}/{y}`, or point `VITE_MAP_STYLE_URL` at a vector style instead |
| `VITE_MAP_PROVIDER_ID` | `osm-raster` | Stable identifier for the active provider |
| `VITE_MAP_PROVIDER_LABEL` | `OpenStreetMap (raster)` | Name shown in the system panel |
| `VITE_MAP_ATTRIBUTION` | `© OpenStreetMap contributors` | Credit line. Never blank — an override that omits it falls back to the OSM credit rather than rendering nothing, because dropping the credit is a licence violation |
| `VITE_MAP_ATTRIBUTION_URL` | OSM copyright page | Where the credit links to |
| `VITE_MAP_TERMS_URL` | OSM tile usage policy | Provider terms, shown alongside the credit |

The default is appropriate for a low-volume demonstration and **not** for
deployment: the OpenStreetMap Foundation's
[tile usage policy](https://operations.osmfoundation.org/policies/tiles/) forbids
production and high-volume use. Bulk offline tile caching is deliberately not
implemented — it would need its own cache-invalidation policy and licence review.

## The product claim, and how it is checked

The claim this demo has to defend is *"the AI measurably reduces drift"*. It is
easy to fake that with a hand-tuned noise multiplier, so nothing like that exists
in the code. The mechanism is real and it is small:

The filter carries `[px, py, vx, vy, bx, by]` — position, velocity, and
accelerometer bias, in a local ENU frame. A time-varying accelerometer bias is
unobservable to an INS on its own, so the position error integrates it. The AI
observes the last few seconds of IMU samples and estimates that bias. That estimate
is applied as a **bias-only measurement update**.

It looks like it should barely touch the operator's uncertainty ellipse, and it
does not — directly. The reason it works is indirect and worth stating precisely:

> The engine builds the accelerometer process noise from the *posterior* bias
> variance. So when the model reduces `P[bx,by]`, the process noise in the
> position/velocity propagation shrinks on the very next tick. Damping the
> uncertainty is a **consequence** of a better bias estimate, not a number that
> was scaled by hand.

Two consequences that cost real debugging time, and should not be undone:

- **The AI update must stay block-local to `[bx, by]`.** A full-state update
  (correction applied to position and velocity as well as bias) was tried and
  destabilised the run into hundreds of metres of error, because this model both
  carries bias as explicit states *and* folds bias uncertainty into acceleration
  process noise. Handing that same bias straight to the position state double-counts
  it.
- **Covariance must be predicted as `(F·P)·Fᵀ`,** not `Fᵀ·(F·P)`. The wrong
  ordering is not a subtle error; it grows exponentially and takes the run to
  hundreds of metres within a minute.

`npm run verify` bundles the real engine and asserts 21 behaviours headlessly, at
the real 50 Hz tick rate, with no renderer. The one that matters most is check 4,
which runs the scenario twice at matched timestamps — once with the model feeding
the filter and once with its output displayed but ignored — and requires that the
AI-engaged run is genuinely better on three separate measures:

| Measure | No AI | AI engaged |
| --- | --- | --- |
| Uncertainty growth rate over the outage | 0.439 m/s | 0.323 m/s |
| Peak 1σ during the outage | 8.68 m | 6.66 m |
| True position error over the same window | 12.85 m | 10.39 m |

The last row is the important one: the reported uncertainty is not just a smaller
number, the actual error is smaller too.

## Things that are deliberately *not* claimed

- **The model's "confidence" is a self-report, not accuracy.** The model is
  estimating its own confidence in its bias estimate. It is not a probability that
  the navigation solution is correct, and it is never compared against GNSS truth.
  The UI labels it "Model self-report" for exactly this reason.
- **The AI does not produce a position fix.** It produces an accelerometer bias
  estimate. The navigation solution is still the filter's.
- **`DEMO_SIMULATED` is not decoration.** It is the whole framing of the project.

## Proving the claim to a judge in the browser

Open the simulation drawer and turn **"Feed AI output to filter"** off. The model
keeps running and keeps displaying its output; the filter just stops using it.
Trigger an outage and watch the uncertainty ellipse grow unchecked. Turn it back on
and trigger the outage again. The same run, with and without the model, is the
clearest evidence the demo has.

## Layout

```
src/
  sim/          deterministic simulation: engine, ESKF, state machine, scenarios
  adapters/     the data-source boundary (see below)
  nav/          store, hooks, React context — the app talks only to this
  map/          basemap tile provider — which geographic data, and nothing else
  components/   map, HUD, panels, simulation drawer, analytics
  pages/        LiveNavigation, Analytics, and the other routes
  theme/        state → colour and label mapping, shared by every layer
  content/      copy: scenario descriptions, glossary, research notes
  lib/          small shared helpers
  types/        the shared vocabulary every layer agrees on
scripts/
  verify-demo.mjs   headless acceptance suite
```

`NavigationProvider` talks to the adapter and writes to the store. No component
imports an adapter, and no component imports the simulation. That is what makes
the next step a config change instead of a refactor.

### Adapter family

`MockAdapter` (simulated), `ApiAdapter`, and `WebSocketAdapter` are implemented.
`DeviceAdapter` (phone GNSS + IMU) and `ReplayAdapter` (recorded datasets for
research) are documented seams in the strategy and **do not exist yet** — they are
not required for this milestone. The strategy also specifies a first-class
`dataSourceMode` (`demo` | `live` | `research`) so the UI branches on the nature
of the data rather than on adapter identity; today the UI reads the per-value
`DataSourceLabel` instead.

## Swapping in real data

Everything goes through one value in `src/adapters/index.ts`:

```ts
export const ACTIVE_ADAPTER: AdapterId = 'mock';
```

`ApiAdapter` and `WebSocketAdapter` already implement the same `DataAdapter`
contract, so a backend can be attached without touching a single component. The
contract is in `src/adapters/DataAdapter.ts`; it is push-based (the adapter emits
frames and the UI subscribes) and every payload carries a `source` label, which is
how the `DEMO_SIMULATED` discipline is enforced structurally rather than by
remembering.

**For the backend team:** the adapter must emit `NavigationFrame` at 50 Hz with a
`sim` time and a wall-clock `timestamp` (the UI runs simulation time for dwell
logic and wall time for the timeline, and conflating them is a bug). The
uncertainty the operator sees is the filter's own covariance, so a real backend
should send real GNSS measurement noise; a covariance that is not derived from
something the filter actually fused is decoration.

## Scenarios

`highway`, `urban`, `tunnel`, `sharp-turn`, and `gnss-blackout` — the last being
the SIH demo scenario that runs the full ladder on a timer. `Trigger Outage` in the
drawer runs the same ladder manually from any healthy state, and `Trigger
Recovery` short-circuits straight to re-fusion for when a judge wants to skip
ahead.
