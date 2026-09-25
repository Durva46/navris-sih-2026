import type { StyleSpecification } from 'maplibre-gl';

/**
 * Geographic map data source, isolated from application logic.
 *
 * This module answers exactly one question: *where do basemap tiles come from.*
 * It knows nothing about navigation, the filter, the state machine, or React.
 * That separation is the point — the navigation stack must never be able to
 * influence which basemap is drawn, and a provider swap must never require
 * editing a navigation component.
 *
 * The strategy splits the map into two independent halves:
 *
 *   MapProvider  →  which geographic data (this file)
 *   MapLibre GL  →  how it is rendered (src/components/map)
 *
 * and keeps both of them independent of the navigation data source
 * (MockAdapter / ReplayAdapter / ApiAdapter / …). A real basemap can therefore
 * carry a simulated vehicle, a live one, or a recorded replay, with no change
 * here or in the engine.
 */

export interface MapProvider {
  /** Stable identifier, e.g. `osm-raster`. */
  id: string;
  /** Human-readable name for the system panel. */
  label: string;
  /**
   * Legally required credit line, rendered on the map at all times.
   * Never optional and never hard-coded downstream: a provider swap that
   * silently dropped the credit would be a licence violation.
   */
  attribution: string;
  /** Where the credit links to. Shown alongside the credit. */
  attributionUrl: string;
  /** Provider's terms-of-use / usage-policy URL. */
  termsUrl: string;
  /**
   * Raster tile URL template with `{z}`, `{x}`, `{y}` placeholders, or a full
   * MapLibre style URL when `styleUrl` is used instead.
   */
  tileUrl?: string;
  /** Fully specified MapLibre style, used when no `styleUrl` is given. */
  style?: StyleSpecification;
  /** Remote style URL. Takes precedence over `tileUrl`/`style`. */
  styleUrl?: string;
  minZoom: number;
  maxZoom: number;
  tileSize: number;
  /**
   * Whether this provider's tiles may be cached for offline use.
   *
   * False for every provider configured here. Offline maps are future work, and
   * enabling this flag without a cache-invalidation policy and a licence review
   * of bulk tile storage would be a compliance problem, not a feature.
   */
  offlineCapable: false;
}

/**
 * OpenStreetMap standard raster tiles.
 *
 * Legitimate, keyless, and appropriate for a low-volume demonstration. The
 * official tile infrastructure carries a usage policy that forbids production
 * and high-volume use, so this is a demo configuration, not a deployment one.
 * For anything real, point the VITE_MAP_* variables at a commercial OSM tile or
 * vector-tile provider; no code change is required.
 *
 * @see https://operations.osmfoundation.org/policies/tiles/
 */
export const OSM_RASTER: MapProvider = {
  id: 'osm-raster',
  label: 'OpenStreetMap (raster)',
  attribution: '© OpenStreetMap contributors',
  attributionUrl: 'https://www.openstreetmap.org/copyright',
  termsUrl: 'https://operations.osmfoundation.org/policies/tiles/',
  tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  minZoom: 0,
  maxZoom: 19,
  tileSize: 256,
  offlineCapable: false,
};

/**
 * Build the style MapLibre consumes.
 *
 * Returns either an inline style object or a remote style URL — both are valid
 * MapLibre `style` inputs, and returning the URL verbatim is what lets a
 * vector-tile provider be dropped in without rewriting the style here.
 *
 * The tile source carries the attribution string as well, so the library's own
 * attribution control can render it even if the custom credit bar is ever
 * removed or fails to mount. Belt and braces on a legal requirement.
 */
export function styleForProvider(provider: MapProvider): StyleSpecification | string {
  if (provider.styleUrl) return provider.styleUrl;
  if (provider.style) return provider.style;
  return {
    version: 8,
    sources: {
      basemap: {
        type: 'raster',
        tiles: [provider.tileUrl as string],
        tileSize: provider.tileSize,
        minzoom: provider.minZoom,
        maxzoom: provider.maxZoom,
        attribution: provider.attribution,
      },
    },
    layers: [
      {
        id: 'basemap',
        type: 'raster',
        source: 'basemap',
        minzoom: provider.minZoom,
        maxzoom: provider.maxZoom,
      },
    ],
  };
}

/**
 * Resolve the active provider.
 *
 * Environment overrides exist so a deployment can point at a different
 * tile source — including a commercial provider that needs a key — without a
 * code change and without a key ever entering version control. Nothing secret
 * is read here: only the tile template, the credit line, and the terms URL.
 */
export function getMapProvider(): MapProvider {
  const tileUrl = import.meta.env.VITE_MAP_TILE_URL as string | undefined;
  const attribution = import.meta.env.VITE_MAP_ATTRIBUTION as string | undefined;
  const attributionUrl = import.meta.env.VITE_MAP_ATTRIBUTION_URL as string | undefined;
  const termsUrl = import.meta.env.VITE_MAP_TERMS_URL as string | undefined;

  if (!tileUrl) return OSM_RASTER;

  return {
    ...OSM_RASTER,
    id: (import.meta.env.VITE_MAP_PROVIDER_ID as string | undefined) ?? 'custom',
    label: (import.meta.env.VITE_MAP_PROVIDER_LABEL as string | undefined) ?? 'Custom tile source',
    tileUrl,
    // Attribution is never allowed to be blank: an override that omits it
    // falls back to the OSM credit rather than rendering nothing.
    attribution: attribution ?? OSM_RASTER.attribution,
    attributionUrl: attributionUrl ?? OSM_RASTER.attributionUrl,
    termsUrl: termsUrl ?? OSM_RASTER.termsUrl,
  };
}
