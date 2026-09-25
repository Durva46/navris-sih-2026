import type { EnuOffset, Heading, Position, Uncertainty, Velocity } from '@/types/navigation';

/**
 * Local tangent-plane (ENU) geodesy.
 *
 * The whole frontend operates on a local East-North frame anchored at a fixed
 * reference origin. A real deployment would use the same interface with a
 * properly seeded origin (UTM zone, or the last GNSS fix) — the maths below is
 * the standard equirectangular approximation, accurate to well under a metre
 * for the few-kilometre extents a drive covers.
 */

export const R_EARTH = 6378137.0;
const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

export interface GeoOrigin {
  lat: number;
  lon: number;
  alt: number;
}

/** NAVRIS demo origin: Bengaluru, ISRO's home city and SIH's most common host. */
export const DEMO_ORIGIN: GeoOrigin = {
  lat: 12.9716,
  lon: 77.5946,
  alt: 920,
};

/**
 * Metres per degree of latitude at a given latitude.
 *
 * The meridian radius of curvature varies with latitude, and this was previously
 * hardcoded to 77.5 degrees while the longitude scale correctly used the origin
 * latitude. That inconsistency was harmless while the map was an abstract canvas
 * in arbitrary units, but it is a real error now that positions are drawn against
 * a real basemap: at the demo origin it skewed every north offset by ~0.6%, which
 * is metres of visible displacement over a single outage. Both scales are now
 * evaluated at the same latitude.
 */
export function metresPerDegreeLat(atLat: number): number {
  return (Math.PI / 180) * (R_EARTH * (1 - 0.00669437999014 * Math.sin(atLat * RAD) ** 2));
}

export function metresPerDegreeLon(atLat: number): number {
  return (Math.PI / 180) * R_EARTH * Math.cos(atLat * RAD);
}

export function enuToPosition(origin: GeoOrigin, enu: EnuOffset): Position {
  const dLat = enu.north / metresPerDegreeLat(origin.lat);
  const dLon = enu.east / metresPerDegreeLon(origin.lat);
  return {
    lat: origin.lat + dLat,
    lon: origin.lon + dLon,
    alt: origin.alt + enu.up,
  };
}

export function positionToEnu(origin: GeoOrigin, p: Position): EnuOffset {
  return {
    east: (p.lon - origin.lon) * metresPerDegreeLon(origin.lat),
    north: (p.lat - origin.lat) * metresPerDegreeLat(origin.lat),
    up: p.alt - origin.alt,
  };
}

export function speedFromVelocity(v: Velocity): number {
  return Math.hypot(v.east, v.north);
}

export function headingFromVelocity(v: Velocity): number {
  const deg = Math.atan2(v.east, v.north) * DEG;
  return (deg + 360) % 360;
}

export function headingToVector(deg: number): { east: number; north: number } {
  return {
    east: Math.sin(deg * RAD),
    north: Math.cos(deg * RAD),
  };
}

/** Shortest signed angular difference a-b, in degrees, in (-180, 180]. */
export function angleDelta(a: number, b: number): number {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/** Interpolate two headings along the shorter arc. */
export function lerpHeading(a: number, b: number, t: number): number {
  return (a + angleDelta(b, a) * t + 360) % 360;
}

/**
 * Semi-axes and rotation of the 2x2 position covariance ellipse, derived from
 * the ENU standard deviations and their correlation.
 *
 *   C = [ sE^2            rho*sE*sN ]
 *       [ rho*sE*sN       sN^2     ]
 *
 * Eigen-decomposition of a symmetric 2x2 gives the semi-major / semi-minor
 * axes and the rotation of the major axis off East.
 */
export interface CovarianceEllipse {
  semiMajor: number;
  semiMinor: number;
  /** Rotation of the semi-major axis, degrees clockwise from East. */
  angleDeg: number;
}

export function covarianceEllipse(u: Uncertainty, multiplier = 1.959964): CovarianceEllipse {
  const sE = Math.max(u.sigmaEast, 1e-4);
  const sN = Math.max(u.sigmaNorth, 1e-4);
  const rho = Math.min(1, Math.max(-1, u.correlation));
  const v11 = sE * sE;
  const v22 = sN * sN;
  const v12 = rho * sE * sN;

  const trace = v11 + v22;
  const det = v11 * v22 - v12 * v12;
  const disc = Math.sqrt(Math.max(0, (trace * trace) / 4 - det));
  const lambda1 = trace / 2 + disc;
  const lambda2 = Math.max(trace / 2 - disc, 0);

  let angle = (0.5 * Math.atan2(2 * v12, v11 - v22) * DEG + 90) % 180;
  if (angle < 0) angle += 180;

  return {
    semiMajor: multiplier * Math.sqrt(lambda1),
    semiMinor: multiplier * Math.sqrt(lambda2),
    angleDeg: angle,
  };
}

/**
 * Solution confidence from the covariance. Monotonic, bounded to (0, 1], and
 * deliberately saturating — it communicates relative health, it is not an
 * accuracy claim and is never rendered as one.
 *
 * The scale is the 95% semi-major axis in metres, because that is the number a
 * reader can check against the map: a 1 m axis is a healthy fused solution, and
 * 16 m is where a 2D fix has stopped being much use for anything on a road. The
 * previous calibration (8 m to 400 m) reported 94% confidence while the ellipse
 * was visibly 20 m across, which is the kind of number that makes a reviewer stop
 * believing the rest of the panel.
 */
export function confidenceFromSigma(ellipse: CovarianceEllipse): number {
  const CONF_HIGH = 1; // metres, 95% semi-major: healthy fused solution
  const CONF_LOW = 16; // metres: the fix is no longer useful
  const norm = (ellipse.semiMajor - CONF_HIGH) / (CONF_LOW - CONF_HIGH);
  const clamped = Math.min(1, Math.max(0, norm));
  return Math.round((1 - clamped) * 1000) / 1000;
}

/** Signed cross-track / along-track decomposition of an ENU offset. */
export function projectOnHeading(enu: EnuOffset, headingDeg: number): { along: number; cross: number } {
  const h = headingToVector(headingDeg);
  return {
    along: enu.east * h.east + enu.north * h.north,
    cross: -enu.east * h.north + enu.north * h.east,
  };
}

export function euclidean2(a: EnuOffset, b: EnuOffset): number {
  return Math.hypot(a.east - b.east, a.north - b.north);
}

export function headingLabel(h: Heading): string {
  return h.deg.toFixed(1).padStart(5, '0');
}
