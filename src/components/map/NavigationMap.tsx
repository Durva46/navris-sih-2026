import { getMapProvider } from '@/map/provider';
import { useTelemetry, useTrajectories } from '@/nav/hooks';
import { selectIsDenyingGnss, selectStateVisual } from '@/nav/selectors';
import { TRAJECTORY_COLORS } from '@/theme/stateColors';
import type { NavigationFrame } from '@/types/navigation';
import { lazy, Suspense } from 'react';

/**
 * MapLibre is roughly 800 kB of the bundle and is only needed on the live
 * navigation screen, so it is code-split. Every other page — analytics, the
 * system panel, the timeline — loads without paying for a renderer it never
 * draws with.
 */
const MapLibreView = lazy(() =>
  import('@/components/map/MapLibreView').then((m) => ({ default: m.MapLibreView })),
);

/**
 * The map viewport: a real geographic basemap carrying the navigation solution.
 *
 * The composition is deliberately thin. `MapLibreView` owns the renderer, the 50 Hz
 * data path, and the map's own chrome (scale bar, tile-health notice, recentre
 * control). This component owns only the furniture that frames the viewport — the
 * legend, the provenance strip, the state wash, and the corner marks.
 *
 * The real basemap comes from `getMapProvider()`; the geographic frame comes from
 * the navigation side. Neither knows about the other beyond the coordinate
 * conversion in `lib/geo.ts`, which is a fixed rigid translation and not a
 * correction of any kind.
 *
 * `children` is the page's own top-of-map furniture (the live mode strip). It is
 * rendered here rather than beside the map so that it and the legend are laid out
 * by a single flex column. They used to be positioned independently against the
 * same corner, which guaranteed a collision: the strip is full-width and wraps to
 * two rows at 320px, so no fixed offset for the legend was correct at every width.
 */
export function NavigationMap({ children }: { children?: React.ReactNode }) {
  const frame = useTelemetry(250);
  const frameVisual = selectStateVisual(frame);
  const denying = frame ? selectIsDenyingGnss(frame) : false;
  const provider = getMapProvider();

  return (
    <div
      data-map-root
      /* `absolute inset-0` rather than `h-full`: this element is the one that
         fills a parent which already owns a definite height. A percentage height
         here would have to resolve against a flex chain that is indefinite below
         `lg` (where `#root` is `height: auto`), and an unresolvable `height: 100%`
         silently becomes 0 — which is exactly how the map used to vanish on
         phones. Absolute fill has no such dependency. */
      className="absolute inset-0 overflow-hidden bg-base-850"
      style={
        {
          '--map-accent': frameVisual.accent,
          '--map-wash': denying ? frameVisual.wash : 'rgba(45,212,191,0.03)',
        } as React.CSSProperties
      }
    >
      <Suspense
        fallback={
          <div className="absolute inset-0 flex items-center justify-center bg-base-850">
            <span className="label-micro">Loading geographic base map</span>
          </div>
        }
      >
        <MapLibreView />
      </Suspense>

      {/* Ambient state wash. Purely a CSS overlay, so it can never touch map data. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: `linear-gradient(180deg, ${
            denying ? 'rgba(255,107,107,0.07)' : 'rgba(45,212,191,0.035)'
          } 0%, rgba(0,0,0,0) 55%)`,
        }}
      />

      <CropMarks color={frameVisual.accent} />

      {/* One overlay column for the whole top of the map: the page's mode strip,
          then the legend and the held-fix note side by side. Everything that used
          to claim a corner of this map now shares one flow, so no two of them can
          land on the same pixels. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col items-start gap-1.5 px-3 py-3">
        {children}
        <div className="flex w-full flex-wrap items-start gap-x-3 gap-y-1.5">
          <MapLegend />
          <HeldFixNote frame={frame} />
        </div>
      </div>

      <Attribution provider={provider} />
    </div>
  );
}

/**
 * The held-fix note: during an outage the receiver stops producing fixes, and
 * the distance between the last fix and the live solution is the clearest single
 * statement of what the system is doing.
 *
 * It used to be pinned to the map's top-right corner, which is also where the mode
 * strip parks the mission clock — measured 84x14px of overlap between the two, plus
 * the legend's right-hand end, whenever the demo reached an outage. Like the legend
 * before it, it belongs in the overlay column: the column is the map's single
 * top-edge occupant, and a note that joins the flow cannot collide with anything.
 *
 * One line, not three. The column's height is subtracted from a map that is only
 * 284px tall at 1024x768, and a three-line note there would reach the telemetry
 * HUD below it.
 */
function HeldFixNote({ frame }: { frame: NavigationFrame | null }) {
  // The last fix is read through the same hook the trajectories use rather than
  // by reaching into the store: components interpret state, they do not own it.
  const { gnss } = useTrajectories(250);
  if (!frame || !selectIsDenyingGnss(frame)) return null;

  const lastFix = gnss[gnss.length - 1];
  if (!lastFix) return null;

  const divergence = Math.hypot(
    lastFix.enu.east - frame.navris.enu.east,
    lastFix.enu.north - frame.navris.enu.north,
  );

  /* Tracking and padding here are sized by a hard constraint: at 1024px the map
     is 688px wide, the legend takes 442px of it, and this note has to fit in what
     is left on the same row — at 0.12em tracking and px-2 padding the pair came
     to 665px against 664px available, so the note wrapped onto a third row and
     pushed the HUD down. 0.08em and px-1.5 buy back the 16px that needs.

     No `ml-auto` here on purpose. It was in the first version of this and Chrome
     resolved the auto margin as if it were content, breaking the line at 1024px
     even when the note fitted. The note reads fine directly after the legend. */
  return (
    <span
      role="status"
      className="readout flex shrink-0 items-center gap-1.5 whitespace-nowrap border border-hairline bg-surface/80 px-1.5 py-[3px] text-[9px] uppercase tracking-[0.08em] text-ink-dim"
    >
      <span className="text-degraded-soft">GNSS fix held</span>
      <span className="text-ink-muted">{divergence.toFixed(1)} m</span>
      <span>age {frame.gnss.secondsSinceFix.toFixed(1)} s</span>
    </span>
  );
}

/**
 * Corner crop marks: a subtle frame that keeps the map reading as a viewport
 * inside a console rather than a web page.
 */
function CropMarks({ color }: { color: string }) {
  const corners: Array<{ sx: -1 | 1; sy: -1 | 1 }> = [
    { sx: 1, sy: 1 },
    { sx: -1, sy: 1 },
    { sx: 1, sy: -1 },
    { sx: -1, sy: -1 },
  ];
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      {corners.map(({ sx, sy }, i) => (
        <svg
          key={i}
          className="absolute h-[32px] w-[32px]"
          style={{
            left: sx > 0 ? 18 : undefined,
            right: sx > 0 ? undefined : 18,
            top: sy > 0 ? 18 : undefined,
            bottom: sy > 0 ? undefined : 18,
          }}
          viewBox="0 0 32 32"
        >
          <path
            d="M14 1 H1 V14"
            fill="none"
            stroke={color}
            strokeOpacity="0.16"
            strokeWidth="1"
            transform={`scale(${sx},${sy}) translate(${sx > 0 ? 0 : -32},${sy > 0 ? 0 : -32})`}
          />
        </svg>
      ))}
    </div>
  );
}

/** Map legend. Static and present from the first frame, so a viewer always knows
 *  which line is the product and which is the receiver.
 *
 *  A wrapping *row*, not a column. In a column the legend was three stacked rows
 *  at every width, which is 53px of the map's scarce vertical budget spent for
 *  information that fits on one line on anything wider than a phone. Laid out as a
 *  row it costs 14px on a desktop map and only falls back to two rows at 320px,
 *  where the map is 318px tall and has the room to spare. */
function MapLegend() {
  return (
    <div className="flex max-w-full flex-wrap items-center gap-x-3 gap-y-1">
      <LegendRow color={TRAJECTORY_COLORS.navris} label="NAVRIS fused solution" />
      <LegendRow color={TRAJECTORY_COLORS.gnss} label="GNSS fixes" dashed />
      <LegendRow color="#5EEAD4" label="95% uncertainty ellipse" ring />
    </div>
  );
}

function LegendRow({
  color,
  label,
  dashed,
  ring,
}: {
  color: string;
  label: string;
  dashed?: boolean;
  ring?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {ring ? (
        <span
          className="inline-block h-[9px] w-[14px] rounded-[50%] border border-dashed"
          style={{ borderColor: color }}
        />
      ) : (
        <svg width="18" height="6" aria-hidden>
          <line
            x1="0"
            y1="3"
            x2="18"
            y2="3"
            stroke={color}
            strokeWidth="2"
            strokeDasharray={dashed ? '4 3' : undefined}
          />
        </svg>
      )}
      <span className="whitespace-nowrap font-mono text-[9px] uppercase tracking-[0.12em] text-ink-dim">
        {label}
      </span>
    </div>
  );
}

/**
 * Attribution. Rendered from provider configuration rather than hard-coded, so a
 * provider swap cannot silently drop a licence-required credit. MapLibre's own
 * attribution control is also enabled, which renders the same string from the
 * tile source — deliberate redundancy on a legal requirement.
 *
 * The bar itself is `pointer-events-none` so it never steals a map drag from the
 * corner it sits in, which means the links have to opt back in individually.
 * Without `pointer-events-auto` they render as a credit but are not clickable,
 * and a credit that cannot be followed does not satisfy the terms it exists to
 * satisfy.
 */
function Attribution({ provider }: { provider: ReturnType<typeof getMapProvider> }) {
  const link =
    'pointer-events-auto font-mono text-[10px] underline underline-offset-2';

  return (
    <div
      data-map-attribution
      className="pointer-events-none absolute bottom-1.5 left-3 z-10 flex items-center gap-2"
    >
      <a
        href={provider.attributionUrl}
        target="_blank"
        rel="noreferrer noopener"
        className={`${link} text-ink-dim decoration-ink-dim/40 hover:text-ink-muted`}
      >
        {provider.attribution}
      </a>
      <span className="text-ink-dim" aria-hidden>
        ·
      </span>
      <a
        href={provider.termsUrl}
        target="_blank"
        rel="noreferrer noopener"
        className={`${link} text-ink-dim decoration-ink-dim/30 hover:text-ink-dim`}
      >
        tile usage
      </a>
    </div>
  );
}
