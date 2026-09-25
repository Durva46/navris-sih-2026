/** Presentation-only formatting. Every numeric readout in the UI goes through here
 *  so the instrument reads consistently: fixed widths, fixed decimals, units. */

const DMS = 2.5e-6; // ~0.25 m, the resolution we pretend our mock GNSS has.

export function pad(value: number, width: number, decimals = 0): string {
  return value.toFixed(decimals).padStart(width, '0');
}

/** 12.971600° N — signed, fixed width, zero-padded. Instrument style. */
export function formatLat(lat: number): string {
  const hemi = lat >= 0 ? 'N' : 'S';
  return `${pad(Math.abs(lat), 9, 6)}° ${hemi}`;
}

export function formatLon(lon: number): string {
  const hemi = lon >= 0 ? 'E' : 'W';
  return `${pad(Math.abs(lon), 10, 6)}° ${hemi}`;
}

export function formatAlt(alt: number): string {
  return `${alt.toFixed(1)} m`;
}

export function formatSpeed(mps: number): string {
  return `${(mps * 3.6).toFixed(1)} km/h`;
}

export function formatSpeedMs(mps: number): string {
  return `${mps.toFixed(2)} m/s`;
}

export function formatHeading(deg: number): string {
  return `${pad(deg, 3, 1)}°`;
}

export function formatMetres(m: number, decimals = 1): string {
  return `${m.toFixed(decimals)} m`;
}

export function formatSignedMetres(m: number, decimals = 1): string {
  return `${m >= 0 ? '+' : ''}${m.toFixed(decimals)} m`;
}

export function formatSigma(m: number): string {
  if (m < 0.1) return `${(m * 100).toFixed(1)} cm`;
  if (m < 10) return `${m.toFixed(2)} m`;
  return `${m.toFixed(1)} m`;
}

export function formatPercent(fraction: number, decimals = 0): string {
  return `${(fraction * 100).toFixed(decimals)}%`;
}

/** Monotonic mission clock, T+HH:MM:SS. */
export function formatMissionTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `T+${pad(h, 2)}:${pad(m, 2)}:${pad(sec, 2)}`;
}

/** Wall-clock time-of-day for timeline rows. */
export function formatClock(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours(), 2)}:${pad(d.getMinutes(), 2)}:${pad(d.getSeconds(), 2)}.${pad(
    d.getMilliseconds(),
    3,
  )}`;
}

export function formatDuration(seconds: number): string {
  if (seconds < 1) return `${(seconds * 1000).toFixed(0)} ms`;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const m = Math.floor(seconds / 60);
  return `${m}m ${(seconds % 60).toFixed(0)}s`;
}

/**
 * Position resolution gate. Below this the mock GNSS is treated as a repeat of
 * its previous fix, which is what gives the "frozen trajectory" its meaning.
 */
export const GNSS_RESOLUTION = DMS;
