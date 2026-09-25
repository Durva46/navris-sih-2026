import { navigationStore } from '@/nav/store';
import { useTelemetry } from '@/nav/hooks';
import { TRAJECTORY_COLORS } from '@/theme/stateColors';
import { useEffect, useMemo, useRef } from 'react';

/**
 * Confidence trend sparkline.
 *
 * Two things are encoded, both real: the *shape* of the confidence curve, and a
 * shaded band wherever GNSS was unavailable. A judge can see the whole story of
 * an outage in a 200-pixel strip: the curve bends down, the red band appears,
 * the curve comes back.
 *
 * Canvas rather than SVG, for the same reason as the map — this updates at
 * 5 Hz behind a 200-sample window and has no business in the React tree.
 */
export function ConfidenceSparkline({ height = 54 }: { height?: number }) {
  const frame = useTelemetry(500);
  const denying =
    frame?.state.id === 'GNSS_OUTAGE' ||
    frame?.state.id === 'INS_ACTIVE' ||
    frame?.state.id === 'AI_CORRECTION';

  const series = useMemo(() => {
    const h = navigationStore.history.slice(-240);
    return {
      t: h.map((s) => s.t),
      confidence: h.map((s) => s.confidence),
      sigma: h.map((s) => Math.max(s.sigmaEast, s.sigmaNorth)),
      gnss: h.map((s) => s.gnssAvailable),
    };
  }, [frame?.timestamp]);

  return (
    <div className="px-3 py-2">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="label-micro">Confidence trend</span>
        <span
          className="readout text-[11px]"
          style={{ color: denying ? '#FDBA74' : '#5EEAD4' }}
        >
          {((frame?.navris.uncertainty.confidence ?? 0) * 100).toFixed(1)}%
        </span>
      </div>

      <SparkCanvas series={series} height={height} />

      <div className="mt-1.5 flex items-center justify-between">
        <span className="label-micro">σh</span>
        <span className="readout text-[11px] text-ink-muted">
          {frame ? `${Math.max(frame.navris.uncertainty.sigmaEast, frame.navris.uncertainty.sigmaNorth).toFixed(2)} m` : '—'}
        </span>
      </div>
    </div>
  );
}

function SparkCanvas({
  series,
  height,
}: {
  series: { t: number[]; confidence: number[]; sigma: number[]; gnss: number[] };
  height: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const latest = useRef(series);
  latest.current = series;

  // Repaint on a slow timer; the underlying data only changes at 5 Hz.
  useEffect(() => {
    const id = window.setInterval(() => {
      paint(canvasRef.current, wrapRef.current, latest.current, height);
    }, 250);
    paint(canvasRef.current, wrapRef.current, series, height);
    return () => window.clearInterval(id);
  }, [height, series]);

  return (
    <div ref={wrapRef} className="w-full">
      <canvas ref={canvasRef} style={{ height }} className="block w-full" />
    </div>
  );
}

function paint(
  canvas: HTMLCanvasElement | null,
  wrap: HTMLDivElement | null,
  series: { t: number[]; confidence: number[]; sigma: number[]; gnss: number[] },
  height: number,
): void {
  if (!canvas || !wrap) return;
  const w = wrap.clientWidth;
  if (w === 0) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${w}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, height);

  // Baseline grid.
  ctx.strokeStyle = 'rgba(27, 37, 55, 0.9)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const y = Math.round((height / 4) * i) + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  const n = series.confidence.length;
  if (n < 2) {
    ctx.fillStyle = 'rgba(92, 106, 133, 0.7)';
    ctx.font = '500 9px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('ACQUIRING…', w / 2, height / 2);
    ctx.restore();
    return;
  }

  const x = (i: number) => (i / (n - 1)) * w;
  const yc = (v: number) => height - 3 - Math.max(0, Math.min(1, v)) * (height - 6);

  // GNSS-unavailable bands.
  ctx.fillStyle = 'rgba(240, 78, 62, 0.14)';
  let runStart = -1;
  for (let i = 0; i < n; i++) {
    const out = series.gnss[i] === 0;
    if (out && runStart < 0) runStart = i;
    if ((!out || i === n - 1) && runStart >= 0) {
      ctx.fillRect(x(runStart), 0, Math.max(1.5, x(i) - x(runStart)), height);
      runStart = -1;
    }
  }

  // Filled confidence area.
  ctx.beginPath();
  ctx.moveTo(0, height);
  for (let i = 0; i < n; i++) ctx.lineTo(x(i), yc(series.confidence[i]));
  ctx.lineTo(w, height);
  ctx.closePath();
  ctx.fillStyle = 'rgba(45, 212, 191, 0.13)';
  ctx.fill();

  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    if (i === 0) ctx.moveTo(x(i), yc(series.confidence[i]));
    else ctx.lineTo(x(i), yc(series.confidence[i]));
  }
  ctx.strokeStyle = TRAJECTORY_COLORS.navris;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // Uncertainty on a log axis — it spans three decades over a demo.
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const s = Math.log10(Math.max(0.2, series.sigma[i]));
    const norm = (s + 0.3) / 3.2; // 0.2 m .. ~400 m
    const y = height - 3 - Math.max(0, Math.min(1, norm)) * (height - 6);
    if (i === 0) ctx.moveTo(x(i), y);
    else ctx.lineTo(x(i), y);
  }
  ctx.strokeStyle = 'rgba(245, 165, 36, 0.75)';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.stroke();
  ctx.restore();
}
