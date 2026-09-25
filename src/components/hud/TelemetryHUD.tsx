import { useTelemetry } from '@/nav/hooks';
import { selectIsDenyingGnss, selectStateVisual } from '@/nav/selectors';
import {
  formatAlt,
  formatHeading,
  formatLat,
  formatLon,
  formatMissionTime,
  formatSpeed,
  formatSpeedMs,
} from '@/lib/format';

/**
 * The telemetry HUD.
 *
 * A monospace overlay pinned to the map corner rather than a separate card:
 * position, speed, heading and the mission clock, in the arrangement an
 * operator console would use. Numbers are fixed-width and tabular so they never
 * reflow as they change — on a projector, jittering digits are unreadable.
 */
export function TelemetryHUD() {
  const frame = useTelemetry(100);
  const visual = selectStateVisual(frame);
  const denying = selectIsDenyingGnss(frame);

  if (!frame) {
    return (
      <div className="pointer-events-none absolute bottom-3 left-3 border border-hairline bg-surface/90 px-3 py-2 backdrop-blur-[2px]">
        <span className="label-micro">AWAITING FIRST FIX</span>
      </div>
    );
  }

  const p = frame.navris.position;

  return (
    <div
      className="pointer-events-none absolute bottom-3 left-3 flex flex-col gap-2 border border-hairline bg-surface/92 px-3 py-2.5 backdrop-blur-[2px]"
      style={{ borderLeftColor: visual.border, borderLeftWidth: 2 }}
    >
      <div className="flex items-center gap-2">
        <span className="label-micro">Position</span>
        <span
          className="readout ml-1 px-1.5 py-[1px] text-[9px] uppercase tracking-[0.12em]"
          style={{ background: visual.wash, color: visual.text }}
        >
          {frame.navris.heading.source.replace('_', ' ')}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-5 gap-y-1">
        <Field label="LAT" value={formatLat(p.lat)} />
        <Field label="LON" value={formatLon(p.lon)} />
        <Field label="ALT" value={formatAlt(p.alt)} />
        <Field label="CRS" value={frame.imu.health === 'OK' ? 'ETRS89' : 'ETRS89*'} />
      </div>

      <div className="h-px w-full bg-hairline" />

      <div className="grid grid-cols-3 gap-x-4 gap-y-1">
        <Field label="SPD" value={formatSpeed(frame.navris.speed)} emphasis />
        <Field label="M/S" value={formatSpeedMs(frame.navris.speed)} />
        <Field label="HDG" value={formatHeading(frame.navris.heading.deg)} emphasis />
      </div>

      <div className="h-px w-full bg-hairline" />

      <div className="flex items-center justify-between gap-4">
        <Field label="T+" value={formatMissionTime(frame.time)} />
        <Field
          label="σh"
          value={`${frame.navris.uncertainty.sigmaEast.toFixed(2)} m`}
          emphasis={denying}
        />
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex flex-col">
      <span className="label-micro leading-none">{label}</span>
      <span
        className="readout mt-[3px] text-[12px] leading-none text-ink"
        style={emphasis ? { color: '#5EEAD4' } : undefined}
      >
        {value}
      </span>
    </div>
  );
}
