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
      <div className="pointer-events-none absolute bottom-10 left-2 border border-hairline bg-surface/90 px-2.5 py-1.5 backdrop-blur-[2px] sm:left-3">
        <span className="label-micro">AWAITING FIRST FIX</span>
      </div>
    );
  }

  const p = frame.navris.position;

  return (
    <div
      /* `bottom-10`, not `bottom-2`: the attribution is a licence-required credit
         pinned to the bottom edge, and the HUD was sitting on top of it at every
         width (measured 249x18px of overlap at 1024, and the "·" separator landed
         inside the σh value at 320). The credit occupies the bottom 30px, so the
         HUD starts at 40px and clears it by 10px. */
      className="pointer-events-none absolute bottom-10 left-2 flex flex-col gap-1.5 border border-hairline bg-surface/92 px-2.5 py-2 backdrop-blur-[2px] sm:left-3"
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

      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 sm:gap-x-5">
        <Field label="LAT" value={formatLat(p.lat)} />
        <Field label="LON" value={formatLon(p.lon)} />
        <Field label="ALT" value={formatAlt(p.alt)} />
        <Field label="CRS" value={frame.imu.health === 'OK' ? 'ETRS89' : 'ETRS89*'} />
      </div>

      <div className="h-px w-full bg-hairline" />

      <div className="grid grid-cols-3 gap-x-3 gap-y-0.5 sm:gap-x-4">
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
      {/* `whitespace-nowrap` makes the "never reflow as they change" promise in
          this component's own doc comment actually true. Tabular figures stop the
          digits jittering; they do not stop a value like "123.4 km/h" breaking
          across two lines when a grid column gets tight, which is what made the
          speed readout look jumbled. */}
      <span
        className="readout mt-[3px] whitespace-nowrap text-[11px] leading-none text-ink sm:text-[12px]"
        style={emphasis ? { color: '#5EEAD4' } : undefined}
      >
        {value}
      </span>
    </div>
  );
}
