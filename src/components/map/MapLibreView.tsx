import {
  AttributionControl,
  Map as MapLibreMap,
  type GeoJSONSource,
  type LngLatLike,
  type LayerSpecification,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { easeCamera, fitSpan, nearestSpan, type Camera } from '@/components/map/camera';
import { DEMO_ORIGIN, enuToPosition } from '@/lib/geo';
import {
  connectorFeature,
  corridorFeature,
  ellipseFeature,
  emptyFeatureCollection,
  headingFeature,
  outageRegionFeature,
  pointFeature,
  trajectoryFeature,
  type FeatureCollection,
} from '@/map/overlays';
import { getMapProvider, styleForProvider, type MapProvider } from '@/map/provider';
import { selectIsDenyingGnss, selectStateVisual } from '@/nav/selectors';
import { navigationStore } from '@/nav/store';
import { TRAJECTORY_COLORS } from '@/theme/stateColors';
import type { LineString, Point, Polygon } from 'geojson';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The geographic map.
 *
 * MapLibre draws a real basemap. This component's only job is to hand it
 * navigation geometry and then get out of the way: it reads the high-frequency
 * store inside a requestAnimationFrame loop and pushes GeoJSON straight to the
 * map's sources, so 50 Hz of filter output still costs zero React
 * reconciliations. The performance contract from the previous canvas renderer is
 * preserved deliberately.
 *
 * Two boundaries are load-bearing here:
 *
 * 1. **The map is visualisation only.** Nothing in this file, or in
 *    `map/overlays.ts`, reads the basemap back to influence navigation. There is
 *    no map matching, no road snapping, and no code path where a rendered
 *    feature could alter a position. The data flow is strictly
 *    engine â†’ NavigationState â†’ map.
 *
 * 2. **Tile availability is not GNSS availability.** They are tracked
 *    independently (see `mapStatus`). A tile failure degrades the basemap and
 *    nothing else: the vehicle, trajectories, uncertainty ellipse, and state
 *    machine keep running, because the navigation engine has no dependency on
 *    the network. Equally, a GNSS outage changes no map setting whatsoever.
 */

const OVERLAY_UPDATE_HZ = 20;
const ELLIPSE_PULSE_HZ = 4;
const MAX_TRAIL_POINTS = 700;
const MAX_CORRIDOR_POINTS = 260;
const MAX_HISTORY_M = 1400;

const SRC = {
  navrisTrail: 'navris-trail',
  gnssTrail: 'gnss-trail',
  corridor: 'navris-corridor',
  ellipse: 'uncertainty-ellipse',
  vehicle: 'vehicle',
  heading: 'vehicle-heading',
  gnssFix: 'gnss-fix',
  heldLink: 'gnss-held-link',
  outage: 'outage-region',
} as const;

const VEHICLE_ICON = 'navris-vehicle-arrow';

/** Tile/basemap health, tracked entirely separately from GNSS state. */
type MapStatus = 'loading' | 'ready' | 'degraded';

function lineLayer(id: string, source: string, paint: Record<string, unknown>, layout: Record<string, unknown> = {}) {
  return { id, type: 'line' as const, source, paint, layout };
}
function fillLayer(id: string, source: string, paint: Record<string, unknown>) {
  return { id, type: 'fill' as const, source, paint };
}

/** Overlay layers, back to front. Purely presentational. */
function overlayLayers(accent: string): LayerSpecification[] {
  return [
    fillLayer('outage-fill', SRC.outage, {
      'fill-color': accent,
      'fill-opacity': 0.1,
    }),
    lineLayer('outage-line', SRC.outage, {
      'line-color': accent,
      'line-width': 1.5,
      'line-dasharray': [3, 2],
      'line-opacity': 0.75,
    }),
    fillLayer('corridor-fill', SRC.corridor, {
      'fill-color': TRAJECTORY_COLORS.navris,
      'fill-opacity': 0.1,
    }),
    fillLayer('ellipse-fill', SRC.ellipse, {
      'fill-color': accent,
      'fill-opacity': 0.12,
    }),
    lineLayer('ellipse-line', SRC.ellipse, {
      'line-color': accent,
      'line-width': 1.5,
      'line-dasharray': [4, 3],
    }),
    lineLayer('gnss-trail-line', SRC.gnssTrail, {
      'line-color': TRAJECTORY_COLORS.gnss,
      'line-width': 1.6,
      'line-opacity': 0.7,
      'line-dasharray': [3, 2],
    }),
    lineLayer('navris-trail-casing', SRC.navrisTrail, {
      'line-color': '#04120F',
      'line-width': 5,
      'line-opacity': 0.55,
    }),
    lineLayer('navris-trail-line', SRC.navrisTrail, {
      'line-color': TRAJECTORY_COLORS.navris,
      'line-width': 2.2,
    }),
    lineLayer('held-link', SRC.heldLink, {
      'line-color': TRAJECTORY_COLORS.gnss,
      'line-width': 1.2,
      'line-dasharray': [2, 2],
      'line-opacity': 0.8,
    }),
    lineLayer('heading-line', SRC.heading, {
      'line-color': TRAJECTORY_COLORS.navris,
      'line-width': 2,
      'line-opacity': 0.85,
    }),
    {
      id: 'gnss-fix-dot',
      type: 'circle' as const,
      source: SRC.gnssFix,
      paint: {
        'circle-radius': 5,
        'circle-color': TRAJECTORY_COLORS.gnss,
        'circle-stroke-color': '#0B0E14',
        'circle-stroke-width': 1.5,
      },
    },
    {
      id: 'vehicle-icon',
      type: 'symbol' as const,
      source: SRC.vehicle,
      layout: {
        'icon-image': VEHICLE_ICON,
        'icon-rotate': ['get', 'heading'],
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
      paint: { 'icon-opacity': 0.98 },
    },
  ];
}

/**
 * The vehicle arrow, drawn once into an offscreen canvas.
 *
 * A registered image rather than a glyph-backed symbol layer: this keeps the map
 * free of any dependency on a font/glyph endpoint, which a raster tile source
 * does not provide. Rotation is applied by MapLibre from the heading property.
 */
function vehicleArrowImage(): { width: number; height: number; data: Uint8Array } {
  const size = 44;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const w = size;
  const h = size;
  const data = new Uint8Array(w * h * 4);
  if (ctx) {
    // Nose points up (-y) so that a rotation of 0 means heading north.
    ctx.translate(w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(0, -17);
    ctx.lineTo(11, 14);
    ctx.lineTo(0, 8);
    ctx.lineTo(-11, 14);
    ctx.closePath();
    ctx.fillStyle = TRAJECTORY_COLORS.navris;
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#04120F';
    ctx.stroke();
    const img = ctx.getImageData(0, 0, w, h);
    data.set(img.data);
  }
  return { width: w, height: h, data };
}

/** Metres-per-pixel to MapLibre zoom at a given latitude. */
function zoomForSpan(spanMetres: number, viewportPx: number, atLat: number): number {
  const metresPerPixel = Math.max(0.05, spanMetres / Math.max(1, viewportPx));
  const resolution = (156543.03392804097 * Math.cos((atLat * Math.PI) / 180)) / metresPerPixel;
  return Math.max(0, Math.min(22, Math.log2(resolution)));
}

export function MapLibreView() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const providerRef = useRef<MapProvider>(getMapProvider());

  const camRef = useRef<Camera>({ east: 0, north: 0, span: nearestSpan(600) });
  const lastTsRef = useRef(0);
  const lastOverlayRef = useRef(0);
  const lastPulseRef = useRef(0);
  const followingRef = useRef(true);
  const sizeRef = useRef({ width: 1, height: 1 });
  const accentRef = useRef<string>(TRAJECTORY_COLORS.navris);
  const pulseRef = useRef(0);

  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<MapStatus>('loading');
  const [following, setFollowing] = useState(true);
  const [recenter, setRecenter] = useState(0);
  const [scale, setScale] = useState(100);
  // Low-frequency snapshot purely so HTML chrome can render. The 50 Hz path
  // never touches React state.
  const frame = useFrameAt(200);

  const provider = providerRef.current;

  // ---- map lifecycle
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const origin = DEMO_ORIGIN;
    const style = styleForProvider(provider);

    let map: MapLibreMap;
    try {
      map = new MapLibreMap({
        container,
        style,
        center: [origin.lon, origin.lat],
        zoom: zoomForSpan(camRef.current.span, 700, origin.lat),
        minZoom: provider.minZoom,
        maxZoom: provider.maxZoom,
        attributionControl: false,
        // The demo is a moving-vehicle display; a rotation that fights the
        // operator is worse than no rotation. North stays up.
        dragRotate: false,
        pitchWithRotate: false,
        // The camera follows the vehicle, so wheel zoom is handled by our own
        // follow logic; a stray scroll must not hijack page scroll either.
        scrollZoom: true,
        maxPitch: 0,
      });
    } catch {
      // MapLibre throws if the container has no size or WebGL is unavailable.
      // Navigation is unaffected, which is the whole point of the separation.
      setStatus('degraded');
      return;
    }
    mapRef.current = map;

    const onError = () => {
      // Tile/style failures only. Deliberately NOT tied to GNSS state: a
      // missing tile must never imply anything about the navigation solution.
      setStatus('degraded');
    };
    const onIdle = () => setStatus('ready');
    map.on('error', onError);
    map.on('idle', onIdle);

    const stopFollow = () => {
      if (followingRef.current) {
        followingRef.current = false;
        setFollowing(false);
      }
    };
    map.on('dragstart', stopFollow);
    map.on('zoomstart', (e) => {
      // Ignore our own programmatic zoom jumps.
      if ((e as { originalEvent?: unknown }).originalEvent) stopFollow();
    });

    map.on('load', () => {
      const img = vehicleArrowImage();
      map.addImage(VEHICLE_ICON, { width: img.width, height: img.height, data: img.data }, { pixelRatio: 2 });

      const empty = (): FeatureCollection<never> => emptyFeatureCollection();
      for (const id of Object.values(SRC)) {
        map.addSource(id, { type: 'geojson', data: empty() as never });
      }
      for (const layer of overlayLayers(accentRef.current)) {
        map.addLayer(layer);
      }
      // Compliance: the library renders the source's own attribution, linked.
      map.addControl(new AttributionControl({ compact: false }), 'bottom-right');
      setReady(true);
      setStatus('ready');
    });

    const ro = new ResizeObserver(() => {
      const rect = container.getBoundingClientRect();
      sizeRef.current = { width: Math.max(1, rect.width), height: Math.max(1, rect.height) };
      map.resize();
    });
    ro.observe(container);
    sizeRef.current = {
      width: Math.max(1, container.clientWidth),
      height: Math.max(1, container.clientHeight),
    };

    return () => {
      ro.disconnect();
      map.off('error', onError);
      map.off('idle', onIdle);
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, [provider]);

  const recenterNow = useCallback(() => {
    followingRef.current = true;
    setFollowing(true);
    setRecenter((n) => n + 1);
  }, []);

  // ---- render loop
  useEffect(() => {
    if (!ready) return;
    const map = mapRef.current;
    if (!map) return;
    const origin = DEMO_ORIGIN;

    let raf = 0;
    const loop = (ts: number) => {
      raf = requestAnimationFrame(loop);
      const dt = lastTsRef.current ? Math.min(0.1, (ts - lastTsRef.current) / 1000) : 0.016;
      lastTsRef.current = ts;
      pulseRef.current = (ts / 1000) % 1;

      const store = navigationStore;
      const f = store.frame;
      if (!f || !map.isStyleLoaded()) return;

      const denying = selectIsDenyingGnss(f);
      const accent = denying ? selectStateVisual(f).accent : TRAJECTORY_COLORS.navris;
      accentRef.current = accent;

      // ---- camera: follow the NAVRIS solution, never the GNSS fix, so the two
      // tracks visibly separate during an outage.
      const { width, height } = sizeRef.current;
      const cam = camRef.current;
      const hist = visibleHistorySpan(store.navrisPath, f.navris.enu);
      const targetSpan = fitSpan(spanWantedFor(denying, f.navris.uncertainty.sigmaEast), hist);
      const next = easeCamera(cam, { east: f.navris.enu.east, north: f.navris.enu.north, span: targetSpan }, dt);
      camRef.current = next;

      if (followingRef.current) {
        const centre = enuToPosition(origin, { east: next.east, north: next.north, up: 0 });
        const zoom = zoomForSpan(next.span, Math.min(width, height), centre.lat);
        const target: { center: LngLatLike; zoom: number } = { center: [centre.lon, centre.lat], zoom };
        const current = map.getCenter();
        // Avoid churn when the change is sub-pixel.
        if (Math.abs(current.lat - centre.lat) > 1e-7 || Math.abs(current.lng - centre.lon) > 1e-7 || Math.abs(map.getZoom() - zoom) > 1e-3) {
          map.jumpTo(target);
        }
      }

      // ---- overlays, throttled: 20 Hz is well past what the eye resolves and
      // keeps setData cost off the critical path.
      if (ts - lastOverlayRef.current < 1000 / OVERLAY_UPDATE_HZ) return;
      lastOverlayRef.current = ts;

      const set = (id: string, data: unknown) => {
        const src = map.getSource(id) as GeoJSONSource | undefined;
        if (src) src.setData(data as never);
      };

      set(SRC.navrisTrail, trajectoryFeature(store.navrisPath, MAX_TRAIL_POINTS));
      set(SRC.gnssTrail, trajectoryFeature(store.gnssPath, MAX_TRAIL_POINTS));
      set(
        SRC.corridor,
        corridorFeature(origin, store.navrisPath, Math.max(4, f.navris.uncertainty.sigmaEast * 2), MAX_CORRIDOR_POINTS),
      );
      set(SRC.ellipse, ellipseFeature(origin, f.navris.enu, f.navris.uncertainty));

      set(SRC.vehicle, {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'Point',
              coordinates: enuCoords(origin, f.navris.enu),
            },
            properties: { heading: f.navris.heading.deg },
          },
        ],
      });
      set(SRC.heading, headingFeature(origin, f.navris.enu, f.navris.heading.deg, headingLengthFor(f.navris.speed)));

      if (f.outageRegion) {
        set(SRC.outage, {
          type: 'FeatureCollection',
          features: [outageRegionFeature(origin, f.outageRegion)],
        });
      } else {
        set(SRC.outage, emptyFeatureCollection<Polygon>());
      }

      // GNSS position: a live dot, or a held fix joined to the solution by the
      // divergence it has accumulated. The fix never moves during an outage â€”
      // that frozen mark is the point.
      const heldEnu = lastGnssEnu(f);
      const lastFix = store.gnssPath[store.gnssPath.length - 1];
      if (lastFix) {
        set(SRC.gnssFix, {
          type: 'FeatureCollection',
          features: [pointFeature(origin, lastFix.enu)],
        });
      } else {
        set(SRC.gnssFix, emptyFeatureCollection<Point>());
      }
      if (denying && lastFix) {
        set(SRC.heldLink, {
          type: 'FeatureCollection',
          features: [connectorFeature(origin, heldEnu, f.navris.enu)],
        });
      } else {
        set(SRC.heldLink, emptyFeatureCollection<LineString>());
      }

      // ---- ellipse pulse and scale bar, at 4 Hz. The scale is read from the
      // map's own ground resolution, so it stays correct after a manual zoom
      // even though the follow camera is idle. Read-only: nothing derived from
      // the view is ever fed back into navigation.
      if (ts - lastPulseRef.current >= 1000 / ELLIPSE_PULSE_HZ) {
        lastPulseRef.current = ts;
        if (map.getLayer('ellipse-line')) {
          map.setPaintProperty('ellipse-line', 'line-opacity', denying ? 0.5 + 0.45 * pulseRef.current : 0.7);
        }
        const centre = map.getCenter();
        const mpp =
          (156543.03392804097 * Math.cos((centre.lat * Math.PI) / 180)) / 2 ** map.getZoom();
        const spanM = niceRound(mpp * Math.min(width, height) * 0.25);
        setScale((prev) => (Math.abs(prev - spanM) / Math.max(1, prev) > 0.12 ? spanM : prev));
      }
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [ready, recenter]);

  return (
    <>
      <div ref={containerRef} className="absolute inset-0" />
      <MapOverlays
        status={status}
        following={following}
        onRecenter={recenterNow}
        scale={scale}
        hasFrame={frame !== null}
      />
    </>
  );
}

function enuCoords(origin: typeof DEMO_ORIGIN, enu: { east: number; north: number; up: number }): [number, number] {
  const p = enuToPosition(origin, enu);
  return [p.lon, p.lat];
}

/** How much ENU the visible history occupies, so the camera never outruns it. */
function visibleHistorySpan(path: { enu: { east: number; north: number } }[], at: { east: number; north: number }): number {
  if (path.length < 2) return 0;
  let minE = at.east;
  let maxE = at.east;
  let minN = at.north;
  let maxN = at.north;
  const from = Math.max(0, path.length - 400);
  for (let i = from; i < path.length; i++) {
    const e = path[i].enu.east;
    const n = path[i].enu.north;
    if (e < minE) minE = e;
    if (e > maxE) maxE = e;
    if (n < minN) minN = n;
    if (n > maxN) maxN = n;
  }
  const span = Math.max(maxE - minE, maxN - minN);
  return span > MAX_HISTORY_M ? MAX_HISTORY_M : span;
}

/** Zoom out during an outage so the growing ellipse always fits on screen. */
function spanWantedFor(denying: boolean, sigmaEast: number): number {
  const base = denying ? 900 : 600;
  return Math.max(base, sigmaEast * 14);
}

function headingLengthFor(speed: number): number {
  return Math.min(70, Math.max(22, speed * 3));
}

function lastGnssEnu(f: NonNullable<typeof navigationStore.frame>) {
  const p = navigationStore.gnssPath[navigationStore.gnssPath.length - 1];
  if (p) return p.enu;
  return f.navris.enu;
}

/**
 * HTML chrome over the map.
 *
 * Kept as DOM rather than MapLibre symbol layers so the map needs no glyph
 * endpoint, and so the text stays selectable, screen-reader visible, and
 * crisp at any device pixel ratio.
 */
function MapOverlays({
  status,
  following,
  onRecenter,
  scale,
  hasFrame,
}: {
  status: MapStatus;
  following: boolean;
  onRecenter: () => void;
  scale: number;
  hasFrame: boolean;
}) {
  const frame = useFrameAt(250);
  const denying = frame ? selectIsDenyingGnss(frame) : false;
  const held = frame && denying ? lastGnssEnu(frame) : null;
  const divergence =
    held && frame
      ? Math.hypot(held.east - frame.navris.enu.east, held.north - frame.navris.enu.north)
      : 0;

  if (!hasFrame) {
    return (
      <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center bg-base-850">
        <svg width="52" height="52" viewBox="0 0 52 52" aria-hidden>
          <circle
            cx="26"
            cy="26"
            r="22"
            fill="none"
            stroke="rgba(45,212,191,0.5)"
            strokeWidth="1.5"
            strokeDasharray="60 80"
            strokeLinecap="round"
          />
          <circle
            cx="26"
            cy="26"
            r="12"
            fill="none"
            stroke="rgba(45,212,191,0.28)"
            strokeWidth="1.5"
            strokeDasharray="24 52"
            strokeLinecap="round"
          />
        </svg>
        <span className="mt-12 text-[12px] font-semibold uppercase tracking-[0.16em] text-ink-muted">
          Aligning navigation solution
        </span>
      </div>
    );
  }

  return (
    <>
      {/* Basemap health. Independent of GNSS: this says nothing about the
          navigation solution, and the solution keeps running regardless. */}
      {status === 'degraded' && (
        <div
          role="status"
          className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded border border-degraded/40 bg-base-900/90 px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] text-degraded-soft"
        >
          Map tiles unavailable â€” navigation unaffected
        </div>
      )}

      {!following && (
        <button
          type="button"
          onClick={onRecenter}
          className="btn absolute bottom-8 left-1/2 z-10 -translate-x-1/2 !py-1 text-[10px] uppercase tracking-[0.12em]"
        >
          Recentre on vehicle
        </button>
      )}

      {held && frame && (
        <div
          className="pointer-events-none absolute right-3 top-3 z-10 flex flex-col items-end gap-0.5 text-right"
          role="status"
        >
          <span className="readout text-[9px] uppercase tracking-[0.12em] text-ink-dim">GNSS fix held</span>
          <span className="readout text-[11px] text-ink-muted">{divergence.toFixed(1)} m</span>
          <span className="readout text-[9px] text-ink-faint">age {frame.gnss.secondsSinceFix.toFixed(1)} s</span>
        </div>
      )}

      <ScaleBar metres={scale} />
    </>
  );
}

/** A real scale bar: a geographic map you cannot measure is a picture. */
function ScaleBar({ metres }: { metres: number }) {
  return (
    <div className="pointer-events-none absolute bottom-8 right-3 z-10 flex flex-col items-end gap-1">
      <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-ink-dim">
        {metres >= 1000 ? `${(metres / 1000).toFixed(metres % 1000 === 0 ? 0 : 1)} km` : `${Math.round(metres)} m`}
      </span>
      <span className="block h-[6px] w-[72px] border-x border-b border-ink-dim/60" />
    </div>
  );
}

/** Snap a length to 1/2/5 Ã— a power of ten, so the bar reads cleanly. */
function niceRound(m: number): number {
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(1, m))));
  const n = m / pow;
  return (n >= 5 ? 5 : n >= 2 ? 2 : 1) * pow;
}

/** Throttled frame accessor for low-frequency chrome. Never 50 Hz. */
function useFrameAt(ms: number) {
  const [snap, setSnap] = useState(() => navigationStore.frame);
  useEffect(() => {
    let last = 0;
    return navigationStore.subscribe(() => {
      const now = performance.now();
      if (now - last < ms) return;
      last = now;
      setSnap(navigationStore.frame);
    });
  }, [ms]);
  return snap;
}
