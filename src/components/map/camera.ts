/**
 * Local tangent-plane (ENU) renderer.
 *
 * The frontend never needs street tiles to make its point. A GNSS-denied
 * trajectory, a growing uncertainty ellipse and a frozen fix are all
 * comprehensible on a range-ring local display — and that display works with
 * the venue's wifi switched off, which is the difference between a demo and a
 * liability on demo day.
 *
 * The projection is a simple scale-and-offset from ENU metres to pixels, with
 * a camera that follows the vehicle and eases between frames.
 */

export interface Camera {
  /** Camera centre in ENU metres. */
  east: number;
  north: number;
  /** Metres visible across the smaller viewport dimension. */
  span: number;
}

export interface Viewport {
  width: number;
  height: number;
  dpr: number;
}

/** Pixels per metre at the current camera. */
export function metresToPixels(cam: Camera, view: Viewport): number {
  return Math.min(view.width, view.height) / Math.max(1, cam.span);
}

/**
 * Project ENU metres to pixels. North is up on screen; East is right.
 * The camera is centred, and the scale is derived from the *smaller* viewport
 * dimension so the horizontal field never overflows a 4:3 projector.
 */
export function project(
  cam: Camera,
  view: Viewport,
  east: number,
  north: number,
): { x: number; y: number } {
  const s = metresToPixels(cam, view);
  return {
    x: view.width / 2 + (east - cam.east) * s,
    y: view.height / 2 - (north - cam.north) * s,
  };
}

/** Inverse projection, for hit-testing and the scale bar. */
export function unproject(
  cam: Camera,
  view: Viewport,
  x: number,
  y: number,
): { east: number; north: number } {
  const s = metresToPixels(cam, view);
  return {
    east: cam.east + (x - view.width / 2) / s,
    north: cam.north - (y - view.height / 2) / s,
  };
}

/**
 * Camera follow. Eases toward the vehicle, and — critically during an outage —
 * does NOT re-centre on the GNSS fix, so the two trajectories visibly separate
 * on screen. A camera that tracked the average would hide the very thing the
 * demo exists to show.
 */
export function easeCamera(cam: Camera, target: Camera, dt: number): Camera {
  // Frame-rate independent exponential smoothing.
  const k = 1 - Math.exp(-dt * 3.2);
  const kZoom = 1 - Math.exp(-dt * 1.6);
  return {
    east: cam.east + (target.east - cam.east) * k,
    north: cam.north + (target.north - cam.north) * k,
    span: cam.span + (target.span - cam.span) * kZoom,
  };
}

/** Human-friendly span ladder, in metres. Keeps the scale stable and readable. */
export const SPAN_LADDER = [50, 100, 200, 400, 800, 1600, 3200] as const;

export function nearestSpan(target: number): number {
  let best: number = SPAN_LADDER[0];
  let bestErr = Infinity;
  for (const s of SPAN_LADDER) {
    const err = Math.abs(Math.log(s) - Math.log(target));
    if (err < bestErr) {
      bestErr = err;
      best = s;
    }
  }
  return best;
}

/** Choose a span that keeps the whole visible history on screen, but never so
 *  wide that the uncertainty ellipse becomes invisible. */
export function fitSpan(spanWanted: number, pathSpan: number): number {
  const wanted = nearestSpan(spanWanted);
  const needed = pathSpan > 0 ? nearestSpan(pathSpan * 1.15) : wanted;
  return Math.max(wanted, needed);
}
