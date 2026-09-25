# NAVRIS Frontend — Master Strategy

**Document status:** Master strategy. This is the implementation source of truth for the NAVRIS frontend.
**Scope:** Architecture and forward seams. It authorises no feature work beyond the milestones defined here.
**Audience:** Frontend implementers (including Gemini Antigravity), backend integrators, and reviewers.

---

## 1. Product vision

NAVRIS is an **Intelligent Navigation & Inertial System**: a GNSS/INS fusion navigation
engine that maintains a position solution when GNSS is degraded or unavailable, with an
AI stage that estimates IMU bias during GNSS denial and feeds it back to the filter.

The frontend is the **first milestone** of a real navigation application. It exists to
demonstrate the navigation behaviour honestly and legibly, and to establish the seams
along which real data sources will later be attached.

### Milestone ladder

| # | Milestone | Navigation data | Map |
| --- | --- | --- | --- |
| M1 | **SIH 2026 demo (this document)** | `MockAdapter` (simulated) | **Real geographic map** |
| M2 | Live navigation app | `DeviceAdapter` (phone GNSS/IMU) | Real geographic map |
| M3 | Research / replay | `ReplayAdapter` (recorded datasets) | Real geographic map + reference overlay |

Nothing about M1 is throwaway. Every M1 seam must survive contact with M2 and M3.

---

## 2. Non-negotiable principles

These rank above all feature requests. A change that violates one is not a change request.

### 2.1 Scientific honesty

1. **Simulated data is always labelled as simulated.** Every frame and every event carries
   provenance. In M1 nothing may be labelled measured.
2. **Never fabricate an accuracy claim.** The uncertainty shown to the operator is the
   filter's own covariance. It is not a quality-of-service score, not a probability of
   correctness, and is never compared against ground truth in the UI.
3. **A model's self-reported confidence is not navigation accuracy.** It describes the
   model's belief about *its own output*. It must be visually and verbally distinct from
   solution confidence.
4. **No result may be improved cosmetically.** The visualisation layer may not alter,
   smooth, snap, or conceal navigation output. See §6.
5. **The simulation is deterministic.** Seeded, reproducible. A judge who resets the demo
   must see the identical run twice. No `Math.random()` anywhere in the navigation path.

### 2.2 Architectural discipline

6. **The UI never knows where data came from.** Components consume navigation state, not
   adapters. §4.
7. **The map is a visualisation layer, not an estimator.** §6.
8. **The navigation engine is a navigation problem, not a connectivity problem.** Loss of
   GNSS is not loss of internet. §7.

---

## 3. Layer architecture

```
┌──────────────────────────────────────────────────────────────┐
│  PRESENTATION                                                │
│  Map view · HUD · Panels · Timeline · Simulation drawer     │
│  Analytics                                                  │
│         ▲ reads                                            │
├─────────┼────────────────────────────────────────────────────┤
│  APPLICATION  (React context + external store)              │
│  NavigationProvider · commands · selectors · high-freq      │
│  frame routing                                              │
│         ▲ writes NavigationState                            │
├─────────┼────────────────────────────────────────────────────┤
│  NAVIGATION DATA SOURCE                                      │
│  DataAdapter                                                │
│    ├── MockAdapter      (M1, simulated)                      │
│    ├── DeviceAdapter    (M2, phone GNSS + IMU)               │
│    ├── ApiAdapter                                              │
│    ├── WebSocketAdapter (M2, live backend)                   │
│    └── ReplayAdapter    (M3, recorded datasets)              │
│         │                                                    │
│         │  SimulationEngine + ESKF + state machine          │
│         │  (the filter/navigation logic itself)              │
├─────────┼────────────────────────────────────────────────────┤
│  MAP PROVIDER                                                │
│    ├── geographic data / tile source  (OSM-derived)         │
│    └── rendering implementation        (MapLibre GL JS)     │
└──────────────────────────────────────────────────────────────┘
```

The critical structural point: **the map provider and the navigation data source are
independent layers.** See §5.

---

## 4. Navigation data source architecture

### 4.1 Adapter family

```text
DataAdapter
├── MockAdapter          simulated; drives SimulationEngine   [M1, implemented]
├── DeviceAdapter        phone GNSS + IMU                     [M2, seam only]
├── ApiAdapter           HTTP poll                            [M1, implemented]
├── WebSocketAdapter     live backend stream                  [M1, implemented]
└── ReplayAdapter        recorded datasets, research replay   [M3, seam only]
```

Every adapter implements the same `DataAdapter` contract and emits the same
`NavigationFrame`. **The contract is the product.** A component that consumes
`NavigationFrame` from `MockAdapter` must work unmodified against any other adapter.

`ReplayAdapter` is an **architectural seam only in this milestone. Do not implement it.**
It exists in the documented architecture so that M3 is a config change rather than a
redesign. When built, it replays recorded navigation data — for example IO-VNBD-style
runs — through the identical `NavigationFrame` interface, with the identical state
machine, at a controllable playback rate.

### 4.2 The contract

`src/adapters/DataAdapter.ts` is the single boundary. Its obligations:

- `connect(handlers) => teardown` — push-based. The adapter emits; the app subscribes.
- `readonly source: DataSourceLabel` — provenance of everything emitted.
- `readonly mode: DataSourceMode` — see §4.3.
- `setControl(patch)` — operator control flows *down* to the source.
- `requestOutage()` / `requestRecovery()` / `reset()` — operator intent.

One adapter instance, selected in exactly one place:

```ts
// src/adapters/index.ts
export const ACTIVE_ADAPTER: AdapterId = 'mock';
```

**Rule:** if a component ever wants to `fetch` something, or needs to know *which*
adapter is running, the interface is wrong. Extend the contract here instead. No
component may import a concrete adapter.

### 4.3 `dataSourceMode` is first-class

The UI must not branch on adapter identity. It branches on **mode**.

```ts
export type DataSourceMode = 'demo' | 'live' | 'research';
```

| Adapter | `dataSourceMode` | Operator-facing label |
| --- | --- | --- |
| `MockAdapter` | `demo` | Simulation / Demo Mode |
| `DeviceAdapter`, `ApiAdapter`, `WebSocketAdapter` (live) | `live` | Live / Measured |
| `ReplayAdapter` | `research` | Research / Replay |

**Forbidden:**

```ts
if (adapter === MockAdapter) ...        // ✗ UI knows the implementation
if (adapter instanceof DeviceAdapter)   // ✗ UI knows the implementation
```

**Required:**

```ts
if (dataSourceMode === 'demo') ...      // ✓ UI knows only the data's nature
```

Implementation requirements:

1. `DataSourceMode` lives in `src/types/navigation.ts`, alongside `DataSourceLabel`, so
   both adapters and UI import it without a cycle.
2. `DataAdapter` exposes `readonly mode: DataSourceMode`. This is the single source of
   truth.
3. `NavigationFrame` **also** carries `sourceMode: DataSourceMode`. A frame recorded to
   disk must be self-describing; provenance cannot depend on the adapter that later
   replays it.
4. `NavigationContext` is the **only** place permitted to know adapter identity, and only
   in order to map identity → mode once. Everything downstream receives the mode.
5. Every visible label, badge, and banner is derived from the mode. Adding a fifth adapter
   must require no UI edit.

`DataSourceLabel` (`DEMO_SIMULATED` | `MEASURED`) remains a **separate, per-value**
provenance field and is not replaced by the mode. Mode describes the *stream*; label
describes *a value's* origin.

### 4.4 Frame contract

`NavigationFrame` is the complete unit crossing the boundary: `state`, `navris` position
/ velocity / heading / uncertainty, `gnss` status, `imu` status, `eskf` status, `ai` status,
`metrics`, and `source` + `sourceMode`.

Two clocks, deliberately:

- `time` — monotonic seconds since stream start. Drives dwell logic and simulation timing.
- `timestamp` — wall-clock epoch ms. Drives the event timeline.

Conflating them is a bug. A replayed dataset has a recording timestamp and its own stream
time, and both are meaningful.

---

## 5. Map architecture

### 5.1 Requirement: a real geographic map

The frontend uses a **real geographic map**. Roads, intersections, locations, and
coordinates are real. An abstract or invented basemap is not acceptable for the product
direction.

### 5.2 Three independent layers

This distinction is the heart of the map architecture and must be preserved in code review.

#### Layer A — Map rendering

```text
MapLibre GL JS
```

Chosen because it is open source (BSD), vendor-independent, and renders both raster and
vector sources. It is the presentation engine only. It knows nothing about navigation.

#### Layer B — Geographic map data

```text
OpenStreetMap, or a legitimate OSM-derived tile / vector-tile provider
```

Requirements:

- Must be a **legitimate tile or vector-tile source**. Do not describe this as "the free
  OpenStreetMap API"; there is no such thing, and the official `tile.openstreetmap.org`
  endpoints carry a usage policy that forbids production and high-volume use. For a demo
  they are acceptable **with attribution**; for anything real, use a commercial OSM tile
  or vector-tile provider (for example MapTiler, Protomaps, or an equivalent).
- **Attribution is a legal requirement, not a nicety.** `© OpenStreetMap contributors` must
  be rendered and visible on the map at all times. The provider's own attribution and terms
  link must also be shown.
- Attribution must be driven by the provider configuration (§5.4), never hard-coded, so
  that changing provider cannot leave a stale or missing credit.

#### Layer C — Navigation data

```text
MockAdapter · DeviceAdapter · ApiAdapter/WebSocketAdapter · ReplayAdapter
        ↓
  NavigationState
```

This is Layer §4. It is **completely independent of Layers A and B.** The navigation
source can be simulated while the basemap is real; the basemap can be real while the
navigation source is simulated, live, or replayed.

### 5.3 The composition

```text
REAL GEOGRAPHIC MAP  (Layers A + B)
        +
NAVIGATION DATA SOURCE  (Layer C)
        ↓
     NAVRIS UI
```

The map shows where the vehicle *is*. The navigation state decides where the vehicle
*should be shown as being*, and whether that is a simulation. The two meet only at the
final render step.

### 5.4 `MapProvider` abstraction

The provider is selected by configuration, and separates **geographic data** from
**rendering implementation**:

```text
MapProvider
   ├── geographic data / tile source   (which basemap, from whom, under what terms)
   └── rendering implementation        (how it is drawn)
```

Proposed shape:

```ts
export interface MapProvider {
  id: string;
  label: string;
  /** Legally required credit string, rendered on the map. Not optional. */
  attribution: string;
  /** Terms-of-use URL surfaced with the attribution. */
  termsUrl: string;
  /** MapLibre style: source, layers, glyphs, sprites. */
  style: StyleSpecification;
  minZoom: number;
  maxZoom: number;
  /** Whether tiles can be cached for offline use. False in this milestone. */
  offlineCapable: boolean;
}
```

Swapping provider — raster to vector, demo tiles to a commercial provider, or a different
basemap entirely — **must not require any change to the navigation UI or the navigation
state handling.** If changing provider requires editing a navigation component, the
abstraction has leaked.

### 5.5 M1 implementation status

The current codebase contains a hand-painted Canvas2D abstract grid
(`src/components/map/NavigationMap.tsx` + `draw.ts`). **This is a placeholder and is to be
replaced** by the Layer A + Layer B stack described above. It is explicitly not a real map
and must not ship as the product map.

The existing code does have useful groundwork to preserve:

- A real geodetic origin (`DEMO_ORIGIN` in `src/lib/geo.ts`, lat/lon/alt in Bengaluru).
- `enuToPosition` / `positionToEnu` conversions between WGS-84 and local ENU.
- A `camera` module and a 50 Hz render path that keeps filter output out of React.

When the real map lands, the camera concept carries over; a real slippy-map camera
becomes zoom/centre/bearing over lat/lon instead of a synthetic pan/zoom.

---

## 6. The scientific map boundary

This boundary is a correctness and honesty rule, and it is not negotiable.

### 6.1 Permitted data flow

```text
GNSS / IMU / NAVRIS Navigation Engine
                ↓
          NavigationState
                ↓
             Map UI
```

### 6.2 Forbidden data flow

```text
NavigationState
      ↓
Map
      ↓
modify trajectory to fit road
```

### 6.3 Explicitly out of scope for M1

The map must **not**:

- perform map matching;
- snap positions or trajectories to roads;
- apply any fabricated trajectory correction;
- hide or smooth navigation drift;
- modify coordinates so the vehicle appears to follow roads;
- compute routes;
- provide turn-by-turn navigation.

A drifting vehicle **must be allowed to visibly drift.** That drift is the phenomenon the
whole project is about; concealing it would destroy the demonstration. If a trajectory
appears to hug a road, that must be because the navigation data actually put it there.

These are legitimate future capabilities. If any is introduced later it **must be evaluated
separately**, because each one changes the meaning of every number on screen and requires
its own scientific justification. They are not on the M1 roadmap.

---

## 7. GNSS outage ≠ internet outage

These are **three independent availability concerns**:

```text
GNSS availability
        ≠
Internet availability
        ≠
Map tile availability
```

- **GNSS availability** is a radio/satellite problem: sky visibility, multipath, jamming,
  tunnels, urban canyons. It is what NAVRIS is designed to survive.
- **Internet availability** is a transport concern. It affects how data reaches the app.
- **Map tile availability** is a basemap concern. It affects whether the *visual
  background* can be drawn.

The architectural requirement:

> The NAVRIS navigation engine must be **conceptually capable** of continuing its
> navigation state through GNSS loss even when network and map-tile availability are also
> unavailable. Navigation must never be modelled as a function of connectivity.

Design consequences:

1. The navigation state machine and the ESKF know nothing about the network. There is no
   code path in which a tile fetch failure, a socket drop, or an HTTP error alters the
   navigation solution.
2. A tile load failure degrades **the basemap only** — the vehicle marker, trajectory,
   uncertainty ellipse, HUD, and state machine continue uninterrupted.
3. The data-source boundary (§4) is defined in terms of navigation frames, not
   connectivity. A WebSocket dropping mid-flight is a transport fault, not a GNSS outage,
   and the UI must not conflate them.

### 7.1 Offline maps — future work only

**Do not implement offline or cached maps in this milestone.** Documented as future work.

Offline maps would require a tile-persistence layer, a cache-invalidation policy, a
storage strategy, and a licence review of bulk tile caching — a project in its own right.
Note the interaction with the constraint above: offline maps are a **map-layer** concern
and would not change the navigation engine's ability to run without GNSS.

---

## 8. SIH demo: real map, simulated navigation

M1 is a real geographic basemap carrying a simulated navigation stream. This is
intentional and scientifically honest, provided the distinction is visible to the viewer.

### 8.1 What is REAL in M1

- Geographic roads, intersections, and place geometry.
- Real coordinates and a real coordinate reference frame.
- Real map tiles / vector data from a legitimate OSM-derived source.
- Real geodesy: WGS-84, ENU conversion, ellipsoidal height.

### 8.2 What is SIMULATED in M1

- Vehicle movement and dynamics.
- GNSS availability, degradation, and outage.
- The NAVRIS trajectory itself.
- All telemetry: IMU, GNSS, ESKF, AI internals.
- Navigation state wherever real device data does not yet exist.
- The uncertainty demonstration.

### 8.3 Disclosure requirement

The UI must **clearly and continuously indicate that the navigation stream is
simulated**, driven by `dataSourceMode === 'demo'`. A prominent mode badge is mandatory,
not decorative, and is the same control that governs §4.3.

The geographic map being real does **not** license the navigation stream to look real. A
real basemap makes simulated movement *more* persuasive, not less — which raises, rather
than lowers, the disclosure obligation.

The same honesty principle applies to the AI stage: it is a deterministic simulation of a
bias estimator. The demo's A/B capability (§10) must never be presented as a benchmark
against a trained model.

---

## 9. GNSS outage visualisation

The outage/recovery UX is preserved. It is the centrepiece of the demonstration.

### 9.1 Normal

GNSS trajectory and NAVRIS trajectory both update according to the active navigation data
source. They are drawn as distinct channels and may be visually distinguished.

### 9.2 GNSS outage

- **GNSS stops providing new fixes.** The GNSS trajectory *stops advancing* and visibly
  freezes. This is the single most important visual in the demo and it must be unambiguous.
- **NAVRIS continues**, propagating from its state, and its uncertainty grows because the
  error it is carrying is now unconstrained.
- **The map does not change and does not fabricate a route.** No new road is drawn, no
  path is suggested, no deviation is "corrected".

### 9.3 Recovery

GNSS updates resume and the UI visualises the **actual** re-fusion: the filter's
re-acquisition, the collapse of the uncertainty ellipse as covariance is re-constrained,
and the state transition to stabilised.

### 9.4 Convergence must be earned

**Do not force trajectories to converge visually unless the underlying navigation data
actually produces convergence.**

If the filter genuinely re-converges, draw that. If it does not, draw that too. A
visually stitched or eased "convergence" is a fabricated result and is prohibited by §2.1
and §6.2. Cosmetic easing of a displayed quantity is the same class of error as map
matching.

### 9.5 The state machine

Visual state must follow the declared state machine, not a free-running animation:

```text
GNSS_FUSED → GNSS_DEGRADED → GNSS_OUTAGE → INS_ACTIVE → AI_CORRECTION
          → RE_FUSION → STABILIZED → GNSS_FUSED
```

Transitions are explicit and ordered, each produces a timeline event, and illegal
transitions are not representable. Dwell timing uses the monotonic stream clock (§4.4), not
wall time.

---

## 10. The product claim, and how it is defended

The claim the demo exists to support is: **the AI stage measurably reduces navigation
drift.**

This claim must be falsifiable and verified, not asserted. Requirements:

1. **No hand-tuned constants may manufacture the result.** No multiplier, damping factor,
   or fudge may be applied to the reported uncertainty to make it look better.
2. **The mechanism is real and must be documented as such.** A time-varying accelerometer
   bias is unobservable to an INS alone, so position error integrates it. The AI estimates
   that bias from the IMU window and applies it as a **bias-only weighted pseudo-measurement**.
   Damping the reported uncertainty is a *consequence* — the engine derives acceleration
   process noise from the posterior bias variance, so a better bias estimate shrinks the
   position/velocity propagation on the following tick. It is not a scaled number.
3. **The AI output must be presented as a correction input, never as a position fix or an
   accuracy figure.**
4. **The claim must be verifiable A/B, on demand, in the UI.** A `demo`-mode control that
   lets the operator feed or withhold the model's output from the filter *on the same run*
   is required. With the model withheld, the stage still runs and still displays its output;
   only the filter ignores it. This is the most persuasive evidence the product has, and it
   is a first-class feature, not a debug affordance.
5. **Automated acceptance must include a controlled A/B** that runs the scenario twice at
   matched timestamps and requires improvement on multiple independent measures — growth
   rate, peak uncertainty, and true position error. Improving the reported number while
   leaving the true error unchanged is a **failure**, not a pass.
6. **A model's self-reported confidence is never an accuracy claim** (§2.1.3).

---

## 11. Future: real navigation application (M2)

Product direction, preserved but **not implemented** in this milestone.

```text
Smartphone GNSS
      +
Smartphone IMU
      ↓
NAVRIS Navigation Engine
      ↓
NavigationState
      ↓
Real Geographic Map
      ↓
NAVRIS Navigation UI
```

Against the current milestone:

```text
Real Geographic Map
      +
MockAdapter
      ↓
SIH Demo
```

### 11.1 Not in this update

Explicitly **out of scope** — do not implement, do not scaffold, do not add dependencies
for:

- Android or iOS code of any kind.
- Native sensor APIs or any device-sensor collection.
- Background location services.
- Native mobile UI or mobile-specific design work.
- Real-time smartphone sensor integration.
- Backend implementation.
- AI/ML implementation or model integration.
- Offline map implementation.
- Map matching, routing, or turn-by-turn navigation (§6.3).

### 11.2 What must be preserved so M2 is cheap

- The adapter contract (§4.2) must remain satisfiable by a device-backed adapter without
  modification. `DeviceAdapter` is documented as a seam, not written.
- The navigation engine must remain reachable **without** a browser in the loop, so a
  native host can drive it. The engine consumes frames and emits frames; it has no DOM
  dependency.
- The UI must remain oblivious to data origin (§4.3), so switching to `live` mode is a
  configuration and labelling change, not a rewrite.
- All `DEMO_SIMULATED` provenance must remain structural (§4.2), so a `live` adapter
  cannot accidentally inherit demo labelling.

---

## 12. Future: research and replay (M3)

```text
Real Geographic Map
        +
ReplayAdapter
        +
Recorded NAVRIS / IO-VNBD data
        +
Optional VBOX / reference overlay
```

### 12.1 Replay requirements

- Recorded datasets replay through the **identical** `NavigationFrame` interface (§4.2) and
  the identical state machine (§9.5). A replay is not a special rendering path.
- Playback rate is operator-controlled, and the simulation clock (§4.4) must support
  faster-than-realtime and step-wise inspection without corrupting filter timing.
- `dataSourceMode === 'research'` drives the labelling (§4.3).
- A recorded frame carries its own `sourceMode` and `source` (§4.3.3), so provenance
  survives the round trip through storage.

### 12.2 Reference data labelling — mandatory

Research and reference data **must be clearly labelled**, distinctly from both the
navigation solution and from measured truth.

**VBOX is reference equipment, not absolute truth.** A VBOX reference must always be
presented as a *reference* channel with its own label, its own uncertainty, and its known
limitations (for example multipath in urban environments, and latency between the reference
and the vehicle). It is the yardstick, not the definition of correct. Any comparison view
must state which channel is the reference and must not silently treat reference error as
navigation error.

---

## 13. Implementation guidance

### 13.1 What exists today

Verified as of this document's writing. The following is **built and passing**:

| Area | State |
| --- | --- |
| Adapter boundary + 3 adapters | `MockAdapter`, `ApiAdapter`, `WebSocketAdapter` implemented |
| `DeviceAdapter`, `ReplayAdapter` | **Do not exist.** Documented seams only |
| `dataSourceMode` | **Does not exist.** Provenance today is `DataSourceLabel` per value |
| `MapProvider` | **Does not exist** |
| Real geographic map | **Does not exist.** Current map is a placeholder Canvas2D abstract grid (§5.5) |
| Geodetic groundwork | Exists: `DEMO_ORIGIN`, ENU ↔ WGS-84 conversion, 50 Hz canvas render path |
| ESKF | 6-state `[px, py, vx, vy, bx, by]`, Joseph-form updates, NIS-gated GNSS fusion |
| State machine | All 8 states, declared transitions, dwell timing |
| AI stage | Simulated bias estimator, bias-only update, A/B contribution control |
| Automated acceptance | 21 headless checks, all passing |

### 13.2 What this strategy requires building

In dependency order:

1. **`dataSourceMode` (§4.3).** Add the type, the `DataAdapter.mode` field, and
   `NavigationFrame.sourceMode`. Map adapter identity → mode exactly once in
   `NavigationContext`. Convert every visible label to read the mode. **A component that
   names a concrete adapter is a defect in this step.**
2. **`MapProvider` (§5.4).** Provider configuration with attribution and terms as required
   data fields, not hard-coded strings.
3. **Real map (§5.1–5.3).** MapLibre GL JS with a legitimate OSM-derived source, replacing
   the placeholder canvas basemap. Navigation state continues to drive the trajectory
   layers; the basemap must not influence them (§6).
4. **Attribution and terms surfacing.** Rendered from provider configuration, always
   visible, compliant with the provider's requirements.
5. **`demo`-mode disclosure (§8.3).** The mode badge is the control that makes §10.4's A/B
   demonstrable.

Steps 1 and 2 are independent of each other. Step 3 depends on 2.

### 13.3 Engineering constraints

- React 18, TypeScript, Vite, Tailwind. Recharts stays lazy-loaded — the live-navigation
  first paint must not pay for the charting bundle.
- 50 Hz navigation rate. **Keep high-frequency frames out of React state.** The existing
  pattern — a framework-agnostic external store with throttled subscription hooks — is the
  reason the demo holds 50 Hz. Do not regress it to per-frame React state.
- No `Math.random()` in the navigation path. Determinism is a feature (§2.1.5).
- The engine must stay free of DOM and browser-API dependencies (§11.2).
- `tsconfig` has `noEmit: true`. **Never** override it (`--noEmit false`) — it writes
  compiled `.js` beside every `.tsx`, and because Vite resolves `.js` before `.tsx`, the
  result silently shadows the real sources and can ship a stale build.
- Preserve the verification suite. A change that cannot be checked is a change that
  should not merge.

### 13.4 Verifying a change

`npm run verify` bundles the real engine and runs 21 headless behavioural checks at the
true tick rate with no renderer. It must stay green. It covers the state ladder, outage
behaviour, covariance growth and collapse, the controlled AI A/B, numeric health,
provenance discipline, operator overrides, and error bounds.

Any new milestone work should extend this suite rather than rely on manual inspection.

---

## 14. Decision log

| Decision | Rationale |
| --- | --- |
| Mode over adapter identity in the UI | UI must not know implementations; adding an adapter must not require UI edits |
| Provenance on the frame, not only the adapter | A recorded frame must be self-describing when replayed later |
| Real basemap with simulated navigation | Product credibility, provided §8.3 disclosure is honoured |
| No map matching | Would fabricate the exact result the demo exists to measure |
| Offline maps deferred | Substantial independent work; a map-layer concern that does not affect GNSS-denied navigation |
| VBOX labelled as reference | Reference equipment is not absolute truth, particularly in urban multipath |
| Deterministic simulation | Reproducibility for judges and reviewers |

---

## 15. Scope rule for this document

This document is a **strategy and architecture** specification. It authorises exactly one
class of implementation: the seams and the real map layer in §13.2.

It does **not** authorise: Android or iOS code, native sensor APIs, offline map
implementation, map matching, routing, turn-by-turn navigation, AI/ML implementation,
backend implementation, or real-time smartphone sensor integration.
