import {
  easeCamera,
  fitSpan,
  nearestSpan,
  type Camera,
  type Viewport,
} from '@/components/map/camera';
import {
  drawGnssFix,
  drawGrid,
  drawHeldFix,
  drawHistoryTicks,
  drawNorthArrow,
  drawOutageRegion,
  drawPath,
  drawRangeRings,
  drawScaleBar,
  drawUncertaintyCorridor,
  drawUncertaintyEllipse,
  drawVehicle,
  hexToRgba,
} from '@/components/map/draw';
import { useTelemetry } from '@/nav/hooks';
import { selectIsDenyingGnss, selectStateVisual } from '@/nav/selectors';
import { navigationStore } from '@/nav/store';
import { covarianceEllipse } from '@/lib/geo';
import { TRAJECTORY_COLORS } from '@/theme/stateColors';
import type { EnuOffset } from '@/types/navigation';
import { useEffect, useRef } from 'react';

/**
 * The navigation map.
 *
 * Performance contract: this component re-renders only when the *state* changes,
 * never on a telemetry tick. The animation loop reads the mutable store
 * directly and paints with Canvas2D, so 50 Hz of filter output costs zero React
 * reconciliations. `frame` is intentionally read once per render for the handful
 * of derived values that decide how the scene is composed (span, tint), never
 * inside the loop.
 */

const MAX_VISIBLE_HISTORY_M = 1400;

export function NavigationMap() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const frame = useTelemetry(250);

  const camRef = useRef<Camera>({ east: 0, north: 0, span: nearestSpan(600) });
  const viewRef = useRef<Viewport>({ width: 0, height: 0, dpr: 1 });
  const lastTsRef = useRef<number>(0);
  const pulseRef = useRef<number>(0);

  // The map frame itself takes the state colour, so the crop marks and the
  // legend shift with the system rather than sitting inertly.
  const frameVisual = selectStateVisual(frame);
  const denying = frame ? selectIsDenyingGnss(frame) : false;

  // ---- sizing
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      viewRef.current = { width: rect.width, height: rect.height, dpr };
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  // ---- paint loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    let raf = 0;
    const loop = (ts: number) => {
      raf = requestAnimationFrame(loop);
      const dt = lastTsRef.current ? Math.min(0.1, (ts - lastTsRef.current) / 1000) : 0.016;
      lastTsRef.current = ts;
      pulseRef.current = (ts / 1000) % 1;

      const view = viewRef.current;
      if (view.width === 0) return;
      const store = navigationStore;
      const f = store.frame;
      if (!f) {
        // Pre-first-frame: an explicit initialising plate, never a blank screen.
        paintBootPlate(ctx, view);
        return;
      }

      const denying = selectIsDenyingGnss(f);
      const visual = selectStateVisual(f);
      const navrisPath = store.navrisPath;
      const gnssPath = store.gnssPath;

      // ---- camera: follow the NAVRIS solution, never the GNSS fix, so the
      // two paths visibly separate during an outage.
      const cam = camRef.current;
      const hist = visibleHistorySpan(navrisPath, f.navris.enu);
      const targetSpan = fitSpan(spanWantedFor(denying, f.navris.uncertainty.sigmaEast), hist);
      const next = easeCamera(cam, { east: f.navris.enu.east, north: f.navris.enu.north, span: targetSpan }, dt);
      camRef.current = next;

      ctx.save();
      ctx.scale(view.dpr, view.dpr);
      ctx.clearRect(0, 0, view.width, view.height);
      ctx.fillStyle = '#070C16';
      ctx.fillRect(0, 0, view.width, view.height);

      // Ambient state wash — the whole map shifts character on a transition.
      const grad = ctx.createLinearGradient(0, 0, 0, view.height);
      grad.addColorStop(0, hexToRgba(visual.accent, denying ? 0.07 : 0.035));
      grad.addColorStop(0.55, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, view.width, view.height);

      drawGrid(ctx, next, view);
      drawRangeRings(ctx, next, view, f.navris.enu);

      if (f.outageRegion) {
        drawOutageRegion(ctx, next, view, f.outageRegion, visual.accent);
      }

      // ---- trajectories
      drawUncertaintyCorridor(ctx, next, view, navrisPath, TRAJECTORY_COLORS.navris);
      drawHistoryTicks(ctx, next, view, navrisPath, TRAJECTORY_COLORS.navris);

      // GNSS path: grey, thinner, and visibly STOPPED during an outage.
      drawPath(ctx, next, view, gnssPath, {
        color: TRAJECTORY_COLORS.gnss,
        width: 1.4,
        alpha: denying ? 0.85 : 0.6,
        dash: [6, 4],
      });
      drawPath(ctx, next, view, navrisPath, {
        color: TRAJECTORY_COLORS.navris,
        width: 2,
        glow: true,
      });

      // ---- uncertainty ellipse
      const ell = covarianceEllipse(f.navris.uncertainty);
      drawUncertaintyEllipse(
        ctx,
        next,
        view,
        f.navris.enu,
        ell,
        denying ? visual.accent : TRAJECTORY_COLORS.navris,
        pulseRef.current,
      );

      // ---- GNSS position handling
      if (!denying && f.gnss.lastFix) {
        drawGnssFix(ctx, next, view, lastGnssEnu(f), TRAJECTORY_COLORS.gnss);
      } else if (f.gnss.lastFix) {
        const fixEnu = lastGnssEnu(f);
        const divergence = Math.hypot(
          fixEnu.east - f.navris.enu.east,
          fixEnu.north - f.navris.enu.north,
        );
        drawHeldFix(
          ctx,
          next,
          view,
          fixEnu,
          f.navris.enu,
          divergence,
          TRAJECTORY_COLORS.gnss,
          f.gnss.secondsSinceFix,
        );
      }

      // ---- vehicle last, so it is never occluded
      drawVehicle(ctx, next, view, f.navris.enu, f.navris.heading.deg, TRAJECTORY_COLORS.navris);

      drawNorthArrow(ctx, 30, 34);
      drawScaleBar(ctx, next, view);

      // Corner frame: a subtle crop mark that keeps the map reading as a
      // viewport inside a console rather than a web page.
      ctx.strokeStyle = hexToRgba(visual.accent, 0.16);
      ctx.lineWidth = 1;
      const c = 18;
      const len = 14;
      for (const [sx, sy] of [
        [1, 1],
        [-1, 1],
        [1, -1],
        [-1, -1],
      ] as const) {
        const x = sx > 0 ? c : view.width - c;
        const y = sy > 0 ? c : view.height - c;
        ctx.beginPath();
        ctx.moveTo(x + sx * len, y);
        ctx.lineTo(x, y);
        ctx.lineTo(x, y + sy * len);
        ctx.stroke();
      }

      ctx.restore();
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      ref={wrapRef}
      className="relative h-full w-full overflow-hidden bg-base-850"
      style={
        {
          '--map-accent': frameVisual.accent,
          '--map-wash': denying ? frameVisual.wash : 'rgba(45,212,191,0.03)',
        } as React.CSSProperties
      }
    >
      <canvas
        ref={canvasRef}
        className="block h-full w-full"
        role="img"
        aria-label={
          frame
            ? `Local navigation display. System state ${frame.state.id}. Vehicle at ${frame.navris.position.lat.toFixed(5)}, ${frame.navris.position.lon.toFixed(5)} degrees, speed ${(frame.navris.speed * 3.6).toFixed(0)} kilometres per hour, horizontal 1-sigma uncertainty ${frame.navris.uncertainty.sigmaEast.toFixed(1)} metres.`
            : 'Local navigation display initialising.'
        }
      />
      <MapLegend />
    </div>
  );
}

/** The boot plate. Shown for the ~40 ms before the first frame lands: an
 *  instrument initialising, not a spinner. */
function paintBootPlate(ctx: CanvasRenderingContext2D, view: Viewport): void {
  ctx.save();
  ctx.scale(view.dpr, view.dpr);
  ctx.fillStyle = '#070C16';
  ctx.fillRect(0, 0, view.width, view.height);
  ctx.strokeStyle = 'rgba(45, 212, 191, 0.5)';
  ctx.lineWidth = 1.5;
  const cx = view.width / 2;
  const cy = view.height / 2;
  ctx.beginPath();
  ctx.arc(cx, cy, 26, -Math.PI / 2, Math.PI * 0.6);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, 14, -Math.PI / 2, Math.PI * 1.2);
  ctx.stroke();
  ctx.fillStyle = 'rgba(230, 236, 245, 0.9)';
  ctx.font = '600 12px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('ALIGNING NAVIGATION SOLUTION', cx, cy + 48);
  ctx.fillStyle = 'rgba(92, 106, 133, 0.9)';
  ctx.font = '500 10px "JetBrains Mono", monospace';
  ctx.fillText('SIMULATION / DEMO MODE', cx, cy + 66);
  ctx.restore();
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
  return span > MAX_VISIBLE_HISTORY_M ? MAX_VISIBLE_HISTORY_M : span;
}

/** Zoom out during an outage so the growing ellipse always fits on screen. */
function spanWantedFor(denying: boolean, sigmaEast: number): number {
  const base = denying ? 900 : 600;
  return Math.max(base, sigmaEast * 14);
}

function lastGnssEnu(f: NonNullable<typeof navigationStore.frame>): EnuOffset {
  // The GNSS path's tail is the authoritative last fix; the frame's geodetic
  // fix is converted for display consistency.
  const p = navigationStore.gnssPath[navigationStore.gnssPath.length - 1];
  if (p) return { east: p.enu.east, north: p.enu.north, up: 0 };
  return f.navris.enu;
}

/** Map legend. Static, small, and present from the first frame so a viewer
 *  always knows which line is the product and which is the receiver. */
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
