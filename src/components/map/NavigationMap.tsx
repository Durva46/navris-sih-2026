import { getMapProvider } from '@/map/provider';
import { useTelemetry } from '@/nav/hooks';
import { selectIsDenyingGnss, selectStateVisual } from '@/nav/selectors';
import { TRAJECTORY_COLORS } from '@/theme/stateColors';
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
 */
export function NavigationMap() {
  const frame = useTelemetry(250);
  const frameVisual = selectStateVisual(frame);
  const denying = frame ? selectIsDenyingGnss(frame) : false;
  const provider = getMapProvider();

  return (
    <div
      className="relative h-full w-full overflow-hidden bg-base-850"
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
      <MapLegend />
      <Attribution provider={provider} />
    </div>
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
 *  which line is the product and which is the receiver. */
function MapLegend() {
  return (
    <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-1.5">
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
    <div className="flex items-center gap-2">
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
      <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-ink-dim">{label}</span>
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
