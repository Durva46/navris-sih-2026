import { project, type Camera, type Viewport } from '@/components/map/camera';
import type { EnuOffset, OutageRegion, TrajectoryPoint } from '@/types/navigation';

/**
 * Canvas drawing routines for the local tangent-plane display.
 *
 * Kept as pure functions over a CanvasRenderingContext2D so they are trivially
 * testable and so the component file stays about lifecycle, not pixels.
 */

export const GRID_COLORS = {
  minor: 'rgba(27, 37, 55, 0.55)',
  major: 'rgba(36, 49, 70, 0.9)',
  ring: 'rgba(92, 106, 133, 0.45)',
  ringLabel: 'rgba(140, 154, 178, 0.75)',
  cardinal: 'rgba(140, 154, 178, 0.9)',
  text: 'rgba(140, 154, 178, 0.85)',
  scaleBar: 'rgba(140, 154, 178, 0.9)',
};

/** Choose a grid spacing in metres that lands near 60–140 px on screen. */
export function gridStep(cam: Camera, view: Viewport): number {
  const px = Math.min(view.width, view.height) / cam.span;
  const targetPx = 90;
  const rawM = targetPx / px;
  const pow = Math.pow(10, Math.floor(Math.log10(rawM)));
  const candidates = [1, 2, 5, 10].map((m) => m * pow);
  for (const c of candidates) if (c >= rawM) return c;
  return 10 * pow;
}

export function drawGrid(ctx: CanvasRenderingContext2D, cam: Camera, view: Viewport): void {
  const step = gridStep(cam, view);
  const tl = { east: cam.east - (view.width / 2) / pxPerM(cam, view), north: cam.north + (view.height / 2) / pxPerM(cam, view) };
  const br = { east: cam.east + (view.width / 2) / pxPerM(cam, view), north: cam.north - (view.height / 2) / pxPerM(cam, view) };

  ctx.save();
  ctx.lineWidth = 1;

  const startE = Math.floor(tl.east / step) * step;
  const startN = Math.floor(br.north / step) * step;
  for (let e = startE; e <= br.east; e += step) {
    const p = project(cam, view, e, 0);
    const isMajor = Math.abs(e % (step * 5)) < 1e-6;
    ctx.strokeStyle = isMajor ? GRID_COLORS.major : GRID_COLORS.minor;
    ctx.beginPath();
    ctx.moveTo(Math.round(p.x) + 0.5, 0);
    ctx.lineTo(Math.round(p.x) + 0.5, view.height);
    ctx.stroke();
  }
  for (let n = startN; n <= tl.north; n += step) {
    const p = project(cam, view, 0, n);
    const isMajor = Math.abs(n % (step * 5)) < 1e-6;
    ctx.strokeStyle = isMajor ? GRID_COLORS.major : GRID_COLORS.minor;
    ctx.beginPath();
    ctx.moveTo(0, Math.round(p.y) + 0.5);
    ctx.lineTo(view.width, Math.round(p.y) + 0.5);
    ctx.stroke();
  }
  ctx.restore();
}

function pxPerM(cam: Camera, view: Viewport): number {
  return Math.min(view.width, view.height) / Math.max(1, cam.span);
}

/** Range rings centred on the vehicle, with metre labels. */
export function drawRangeRings(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  view: Viewport,
  origin: EnuOffset,
): void {
  const step = gridStep(cam, view);
  const s = pxPerM(cam, view);
  const centre = project(cam, view, origin.east, origin.north);
  const maxR = Math.hypot(view.width, view.height) / 2;

  ctx.save();
  ctx.setLineDash([2, 6]);
  ctx.lineWidth = 1;
  for (let r = step; r * s < maxR * 1.4; r += step) {
    const major = Math.abs(r % (step * 5)) < 1e-6;
    ctx.strokeStyle = major ? GRID_COLORS.ring : 'rgba(92, 106, 133, 0.22)';
    ctx.beginPath();
    ctx.arc(centre.x, centre.y, r * s, 0, Math.PI * 2);
    ctx.stroke();
    if (major) {
      ctx.setLineDash([]);
      ctx.fillStyle = GRID_COLORS.ringLabel;
      ctx.font = '500 9px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${formatMetresShort(r)}`, centre.x + r * s * 0.7071 + 3, centre.y - r * s * 0.7071 - 3);
      ctx.setLineDash([2, 6]);
    }
  }
  ctx.restore();
}

function formatMetresShort(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(m % 1000 === 0 ? 0 : 1)}km`;
  return `${m}m`;
}

/** North arrow. Small, fixed, top-left of the map body. */
export function drawNorthArrow(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = GRID_COLORS.cardinal;
  ctx.fillStyle = GRID_COLORS.cardinal;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, -13);
  ctx.lineTo(4.5, 6);
  ctx.lineTo(0, 2.5);
  ctx.lineTo(-4.5, 6);
  ctx.closePath();
  ctx.stroke();
  ctx.font = '500 8px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('N', 0, 9);
  ctx.restore();
}

/** Scale bar. Reads in metres and kilometres so it stays honest at any zoom. */
export function drawScaleBar(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  view: Viewport,
): void {
  const s = pxPerM(cam, view);
  const targetPx = 110;
  const rawM = targetPx / s;
  const pow = Math.pow(10, Math.floor(Math.log10(rawM)));
  const nice = [1, 2, 5, 10].map((m) => m * pow).find((c) => c >= rawM) ?? 10 * pow;
  const w = nice * s;
  const x = view.width - w - 18;
  const y = view.height - 18;

  ctx.save();
  ctx.strokeStyle = GRID_COLORS.scaleBar;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y - 4);
  ctx.lineTo(x, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y - 4);
  ctx.stroke();
  ctx.fillStyle = GRID_COLORS.text;
  ctx.font = '500 9px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(formatMetresShort(nice), x + w / 2, y - 5);
  ctx.restore();
}

/** The GNSS-denied region, hatched in the outage colour. */
export function drawOutageRegion(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  view: Viewport,
  region: OutageRegion,
  accent: string,
): void {
  const a = project(cam, view, region.minEast, region.maxNorth);
  const b = project(cam, view, region.maxEast, region.minNorth);
  const w = b.x - a.x;
  const h = b.y - a.y;
  if (w <= 0 || h <= 0) return;

  ctx.save();
  ctx.beginPath();
  ctx.rect(a.x, a.y, w, h);
  ctx.clip();

  ctx.fillStyle = hexToRgba(accent, 0.07);
  ctx.fillRect(a.x, a.y, w, h);

  // 45-degree hatch, drawn in device space so it does not swim with the camera.
  const spacing = 9;
  ctx.strokeStyle = hexToRgba(accent, 0.16);
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let d = -h; d < w + h; d += spacing) {
    ctx.moveTo(a.x + d, a.y);
    ctx.lineTo(a.x + d + h, a.y + h);
  }
  ctx.stroke();

  ctx.strokeStyle = hexToRgba(accent, 0.45);
  ctx.lineWidth = 1;
  ctx.strokeRect(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5, Math.round(w), Math.round(h));
  ctx.restore();

  ctx.save();
  ctx.fillStyle = hexToRgba(accent, 0.9);
  ctx.font = '500 9px "JetBrains Mono", monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(region.label, a.x + 6, a.y + 6);
  ctx.restore();
}

/**
 * The uncertainty corridor: a translucent ribbon either side of the NAVRIS
 * path, whose half-width is the local 95% ellipse. During an outage this is
 * what visibly widens, and it is the most honest way to show a growing error
 * bound — the ribbon is derived from the covariance, not animated by hand.
 */
export function drawUncertaintyCorridor(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  view: Viewport,
  path: TrajectoryPoint[],
  color: string,
  multiplier = 1.96,
): void {
  if (path.length < 2) return;
  const left: { x: number; y: number }[] = [];
  const right: { x: number; y: number }[] = [];

  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    const hRad = (p.headingDeg * Math.PI) / 180;
    // Right-hand normal in ENU.
    const nx = Math.cos(hRad);
    const ny = -Math.sin(hRad);
    const w = p.uncertainty.sigmaEast * multiplier;
    const a = project(cam, view, p.enu.east + nx * w, p.enu.north + ny * w);
    const b = project(cam, view, p.enu.east - nx * w, p.enu.north - ny * w);
    left.push(a);
    right.push(b);
  }

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(left[0].x, left[0].y);
  for (let i = 1; i < left.length; i++) ctx.lineTo(left[i].x, left[i].y);
  for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
  ctx.closePath();
  ctx.fillStyle = hexToRgba(color, 0.1);
  ctx.fill();
  ctx.strokeStyle = hexToRgba(color, 0.16);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

export interface PathStyle {
  color: string;
  width: number;
  dash?: number[];
  alpha?: number;
  /** Draw only the most recent `tail` points. */
  tail?: number;
  glow?: boolean;
}

export function drawPath(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  view: Viewport,
  path: TrajectoryPoint[],
  style: PathStyle,
): void {
  if (path.length < 2) return;
  const pts = style.tail ? path.slice(-style.tail) : path;

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.globalAlpha = style.alpha ?? 1;
  if (style.dash) ctx.setLineDash(style.dash);

  const trace = () => {
    ctx.beginPath();
    const p0 = project(cam, view, pts[0].enu.east, pts[0].enu.north);
    ctx.moveTo(p0.x, p0.y);
    for (let i = 1; i < pts.length; i++) {
      const p = project(cam, view, pts[i].enu.east, pts[i].enu.north);
      ctx.lineTo(p.x, p.y);
    }
  };

  if (style.glow) {
    trace();
    ctx.strokeStyle = hexToRgba(style.color, 0.16);
    ctx.lineWidth = style.width * 3.2;
    ctx.stroke();
  }
  trace();
  ctx.strokeStyle = style.color;
  ctx.lineWidth = style.width;
  ctx.stroke();
  ctx.restore();
}

/** The live uncertainty ellipse at the current solution. */
export function drawUncertaintyEllipse(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  view: Viewport,
  enu: EnuOffset,
  ellipse: { semiMajor: number; semiMinor: number; angleDeg: number },
  color: string,
  pulse: number,
): void {
  const s = pxPerM(cam, view);
  const a = Math.max(2, ellipse.semiMajor * s);
  const b = Math.max(1.2, ellipse.semiMinor * s);
  const centre = project(cam, view, enu.east, enu.north);

  ctx.save();
  ctx.translate(centre.x, centre.y);
  ctx.rotate((-ellipse.angleDeg * Math.PI) / 180);

  // Soft fill so the ellipse reads as a *region of belief*, not an outline.
  const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, a);
  grad.addColorStop(0, hexToRgba(color, 0.2 + 0.08 * pulse));
  grad.addColorStop(0.65, hexToRgba(color, 0.08 + 0.05 * pulse));
  grad.addColorStop(1, hexToRgba(color, 0.01));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.ellipse(0, 0, a, b, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.setLineDash([5, 4]);
  ctx.lineDashOffset = -pulse * 24;
  ctx.strokeStyle = hexToRgba(color, 0.75);
  ctx.lineWidth = 1.25;
  ctx.stroke();

  // Principal axes — a real instrument cue, and they show the correlation.
  ctx.setLineDash([]);
  ctx.strokeStyle = hexToRgba(color, 0.4);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-a, 0);
  ctx.lineTo(a, 0);
  ctx.moveTo(0, -b);
  ctx.lineTo(0, b);
  ctx.stroke();
  ctx.restore();
}

/** Vehicle marker: a heading triangle plus a short velocity vector. */
export function drawVehicle(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  view: Viewport,
  enu: EnuOffset,
  headingDeg: number,
  color: string,
): void {
  const p = project(cam, view, enu.east, enu.north);
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate((-headingDeg * Math.PI) / 180);

  // Heading vector.
  ctx.strokeStyle = hexToRgba(color, 0.55);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -34);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(0, -4);
  ctx.lineTo(0, -34);
  ctx.lineTo(5, -28);
  ctx.moveTo(0, -34);
  ctx.lineTo(-5, -28);
  ctx.stroke();

  // Body.
  ctx.beginPath();
  ctx.moveTo(0, -11);
  ctx.lineTo(7.5, 9);
  ctx.lineTo(0, 5);
  ctx.lineTo(-7.5, 9);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = 'rgba(5, 8, 15, 0.85)';
  ctx.lineWidth = 1.25;
  ctx.stroke();

  ctx.restore();

  ctx.save();
  ctx.strokeStyle = hexToRgba(color, 0.25);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 20, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/**
 * The held GNSS fix.
 *
 * During an outage this is the most important mark on the map: a hollow
 * crosshair parked where the receiver last had a solution, with a lead line to
 * where NAVRIS now believes the vehicle is. The gap between them *is* the
 * navigation error, drawn to scale.
 */
export function drawHeldFix(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  view: Viewport,
  fixEnu: EnuOffset,
  navrisEnu: EnuOffset,
  divergence: number,
  color: string,
  ageSeconds: number,
): void {
  const p = project(cam, view, fixEnu.east, fixEnu.north);
  const n = project(cam, view, navrisEnu.east, navrisEnu.north);

  ctx.save();
  // Lead line from the held fix to the current solution.
  ctx.setLineDash([3, 4]);
  ctx.strokeStyle = hexToRgba(color, 0.65);
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(n.x, n.y);
  ctx.stroke();
  ctx.setLineDash([]);

  // Hollow crosshair = a fix that is no longer being updated.
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
  ctx.moveTo(p.x - 14, p.y);
  ctx.lineTo(p.x + 14, p.y);
  ctx.moveTo(p.x, p.y - 14);
  ctx.lineTo(p.x, p.y + 14);
  ctx.stroke();

  // Label sits beside the held fix and never overlaps the vehicle.
  const flip = p.x > n.x ? -1 : 1;
  ctx.textAlign = flip < 0 ? 'right' : 'left';
  ctx.textBaseline = 'middle';
  ctx.font = '500 9px "JetBrains Mono", monospace';
  ctx.fillStyle = color;
  ctx.fillText('GNSS FIX HELD', p.x + flip * 18, p.y - 8);
  ctx.fillStyle = 'rgba(230, 236, 245, 0.92)';
  ctx.font = '700 11px "JetBrains Mono", monospace';
  ctx.fillText(`${divergence.toFixed(1)} m`, p.x + flip * 18, p.y + 6);
  ctx.fillStyle = 'rgba(140, 154, 178, 0.8)';
  ctx.font = '500 9px "JetBrains Mono", monospace';
  ctx.fillText(`age ${ageSeconds.toFixed(1)} s`, p.x + flip * 18, p.y + 19);
  ctx.restore();
}

/** A small glowing point marking the most recent accepted GNSS position. */
export function drawGnssFix(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  view: Viewport,
  enu: EnuOffset,
  color: string,
): void {
  const p = project(cam, view, enu.east, enu.north);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 5.5, 0, Math.PI * 2);
  ctx.moveTo(p.x - 9, p.y);
  ctx.lineTo(p.x + 9, p.y);
  ctx.moveTo(p.x, p.y - 9);
  ctx.lineTo(p.x, p.y + 9);
  ctx.stroke();
  ctx.restore();
}

/** Trail of fading tick marks behind the vehicle, reading as elapsed time. */
export function drawHistoryTicks(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  view: Viewport,
  path: TrajectoryPoint[],
  color: string,
): void {
  const stride = Math.max(1, Math.floor(path.length / 40));
  ctx.save();
  ctx.fillStyle = hexToRgba(color, 0.35);
  for (let i = 0; i < path.length; i += stride) {
    const p = project(cam, view, path[i].enu.east, path[i].enu.north);
    ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
  }
  ctx.restore();
}

export function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
