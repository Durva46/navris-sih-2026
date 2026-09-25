/**
 * Camera follow for the geographic map.
 *
 * The camera is expressed in ENU metres and only converted to a map centre at
 * the last moment, in `MapLibreView`. Keeping it in local metres means the
 * easing, the span ladder and the fit logic stay simple and testable, and it
 * keeps the one behaviour that matters most out of MapLibre's hands:
 *
 * **The camera follows the NAVRIS solution, never the GNSS fix.** During an
 * outage the two tracks must visibly separate on screen. A camera that tracked
 * the average, or that re-centred on the frozen fix, would hide the exact thing
 * the demo exists to show.
 *
 * There is no map matching here, and no code in this file reads the basemap.
 */

export interface Camera {
  /** Camera centre in ENU metres. */
  east: number;
  north: number;
  /** Metres visible across the smaller viewport dimension. */
  span: number;
}

/** Camera follow. Eases toward the vehicle. */
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
export const SPAN_LADDER = [50, 100, 200, 400, 800, 1600, 3200, 6400] as const;

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
