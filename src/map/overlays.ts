import { covarianceEllipse, enuToPosition, headingToVector, type GeoOrigin } from '@/lib/geo';
import type { EnuOffset, OutageRegion, TrajectoryPoint, Uncertainty } from '@/types/navigation';
import type { Feature, LineString, Point, Polygon, Position as GeoPosition } from 'geojson';

/**
 * Navigation geometry → GeoJSON, in real WGS-84 coordinates.
 *
 * This module is the only place that converts navigation quantities into map
 * geometry, and it is deliberately ignorant of what a map is. It takes ENU
 * offsets and uncertainties and emits latitude/longitude. It has no basemap, no
 * tile source, no road network, and no notion of where a road *should* be.
 *
 * That is not a stylistic preference — it is the scientific boundary the whole
 * product rests on. If a function here ever needed to know a road's location in
 * order to place a vehicle, the visualisation layer would have become part of the
 * navigation estimator, and every number on screen would stop meaning what it
 * claims to mean. The transform below is a fixed rigid translation at a constant
 * origin. It cannot snap, cannot correct, and cannot hide drift.
 *
 * Nothing in this file mutates navigation state. It reads frames and returns new
 * geometry.
 */

/** Coordinate order for a GeoJSON position. */
function toGeo(origin: GeoOrigin, enu: EnuOffset): GeoPosition {
  const p = enuToPosition(origin, enu);
  return [p.lon, p.lat];
}

/** Closed ring: GeoJSON requires the first and last position to be identical. */
function closeRing(ring: GeoPosition[]): GeoPosition[] {
  if (ring.length === 0) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return ring;
  return [...ring, first];
}

export function emptyFeatureCollection<T extends Point | LineString | Polygon>(): FeatureCollection<T> {
  return { type: 'FeatureCollection', features: [] };
}

export interface FeatureCollection<T extends Point | LineString | Polygon> {
  type: 'FeatureCollection';
  features: Feature<T>[];
}

export function pointFeature(origin: GeoOrigin, enu: EnuOffset, properties: Record<string, unknown> = {}): Feature<Point> {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: toGeo(origin, enu) },
    properties,
  };
}

/** A heading vector of `lengthM` metres, for the vehicle's nose direction. */
export function headingFeature(
  origin: GeoOrigin,
  enu: EnuOffset,
  headingDeg: number,
  lengthM: number,
  properties: Record<string, unknown> = {},
): Feature<LineString> {
  const v = headingToVector(headingDeg);
  return {
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: [toGeo(origin, enu), toGeo(origin, { east: enu.east + v.east * lengthM, north: enu.north + v.north * lengthM, up: enu.up })],
    },
    properties,
  };
}

/** A straight connector between two ENU points, e.g. held-fix divergence. */
export function connectorFeature(
  origin: GeoOrigin,
  from: EnuOffset,
  to: EnuOffset,
  properties: Record<string, unknown> = {},
): Feature<LineString> {
  return {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [toGeo(origin, from), toGeo(origin, to)] },
    properties,
  };
}

/**
 * The 95% position-uncertainty ellipse, as a polygon.
 *
 * The covariance maths happens in ENU, where the 2x2 correlation is meaningful,
 * and the resulting vertices are then projected. The polygon is a faithful
 * rendering of the filter's own covariance — not a confidence band, not a
 * smoothed hull, and not clipped to anything on the map.
 */
export function ellipseFeature(
  origin: GeoOrigin,
  enu: EnuOffset,
  uncertainty: Uncertainty,
  segments = 48,
): Feature<Polygon> {
  const ell = covarianceEllipse(uncertainty);
  const ring: GeoPosition[] = [];
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    // Ellipse parametrised along its own axes, then rotated by the major-axis
    // bearing measured clockwise from East.
    const a = ell.semiMajor * Math.cos(t);
    const b = ell.semiMinor * Math.sin(t);
    const rad = (ell.angleDeg * Math.PI) / 180;
    const east = enu.east + a * Math.cos(rad) - b * Math.sin(rad);
    const north = enu.north + a * Math.sin(rad) + b * Math.cos(rad);
    ring.push(toGeo(origin, { east, north, up: enu.up }));
  }
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [closeRing(ring)] },
    properties: { semiMajor: ell.semiMajor, semiMinor: ell.semiMinor, angleDeg: ell.angleDeg },
  };
}

/**
 * The GNSS-denied region as a rectangle, in geographic coordinates.
 *
 * The region is expressed by the simulation in ENU and drawn where it actually
 * is. It is a visualisation of a simulated obstruction, not a query about real
 * map features.
 */
export function outageRegionFeature(origin: GeoOrigin, region: OutageRegion): Feature<Polygon> {
  const ring: GeoPosition[] = [
    toGeo(origin, { east: region.minEast, north: region.minNorth, up: 0 }),
    toGeo(origin, { east: region.maxEast, north: region.minNorth, up: 0 }),
    toGeo(origin, { east: region.maxEast, north: region.maxNorth, up: 0 }),
    toGeo(origin, { east: region.minEast, north: region.maxNorth, up: 0 }),
  ];
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [closeRing(ring)] },
    properties: { label: region.label },
  };
}

/**
 * Reduce a trajectory to at most `maxPoints` vertices, always keeping the most
 * recent point.
 *
 * This is a *rendering* concern only. The stored trajectory is untouched, and the
 * sample is chosen deterministically so two runs of the same scenario draw
 * identical geometry. Nothing here alters the data being visualised, only how
 * many vertices are handed to the renderer.
 */
export function decimate(points: TrajectoryPoint[], maxPoints: number): TrajectoryPoint[] {
  if (points.length <= maxPoints) return points;
  const step = Math.ceil(points.length / maxPoints);
  const out: TrajectoryPoint[] = [];
  for (let i = 0; i < points.length; i += step) out.push(points[i]);
  const last = points[points.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

/**
 * A trajectory as a LineString.
 *
 * Vertices come straight off each point's own `position`. They are deliberately
 * *not* re-derived from the ENU offset, even though that would be equivalent to
 * within rounding: using the position the engine actually produced removes any
 * possibility of a rendering path disagreeing with the navigation solution.
 *
 * No `origin` parameter is needed as a result, and that is a feature of the
 * design rather than an omission.
 */
export function trajectoryFeature(
  points: TrajectoryPoint[],
  maxPoints = 600,
  properties: Record<string, unknown> = {},
): Feature<LineString> {
  const reduced = decimate(points, maxPoints);
  return {
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: reduced.map((p) => [p.position.lon, p.position.lat] as GeoPosition),
    },
    properties,
  };
}

/**
 * A corridor along the trajectory, one uncertainty width either side.
 *
 * Renders the growth of the uncertainty corridor behind the vehicle, which is
 * the clearest visual of drift accumulating over an outage.
 */
export function corridorFeature(
  origin: GeoOrigin,
  points: TrajectoryPoint[],
  widthMetres: number,
  maxPoints = 300,
): Feature<Polygon> {
  const reduced = decimate(points, maxPoints);
  if (reduced.length < 2) {
    return {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [[]] },
      properties: {},
    };
  }
  const left: GeoPosition[] = [];
  const right: GeoPosition[] = [];
  for (let i = 0; i < reduced.length; i++) {
    const p = reduced[i];
    // Local tangent from the neighbouring sample.
    const prev = reduced[Math.max(0, i - 1)];
    const next = reduced[Math.min(reduced.length - 1, i + 1)];
    const dEast = next.enu.east - prev.enu.east;
    const dNorth = next.enu.north - prev.enu.north;
    const len = Math.hypot(dEast, dNorth) || 1;
    const half = widthMetres / 2;
    const nx = (-dNorth / len) * half;
    const ny = (dEast / len) * half;
    left.push(toGeo(origin, { east: p.enu.east + nx, north: p.enu.north + ny, up: p.enu.up }));
    right.push(toGeo(origin, { east: p.enu.east - nx, north: p.enu.north - ny, up: p.enu.up }));
  }
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [closeRing([...left, ...right.reverse()])] },
    properties: {},
  };
}
