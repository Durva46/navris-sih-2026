import { Panel, StatusDot } from '@/components/ui/primitives';
import { useEvents, useTelemetry } from '@/nav/hooks';
import { useNavigationUi } from '@/nav/NavigationContext';
import { formatClock } from '@/lib/format';
import { AI_STAGE_COLORS, AI_STAGE_LABELS, GNSS_QUALITY_COLORS, SEVERITY_COLORS } from '@/theme/stateColors';
import { AI_PIPELINE_STAGES, type NavigationEvent } from '@/types/navigation';
import { Activity, AlertTriangle, Cpu, Satellite, Sparkles } from 'lucide-react';

/**
 * The right rail: a glanceable health summary, not full sensor detail.
 *
 * Everything here is "is it working, and how badly". Numbers that only matter
 * to someone debugging belong in the System panel, which this opens.
 */
export function SensorSnapshot({ onExpand }: { onExpand: () => void }) {
  const frame = useTelemetry(200);
  if (!frame) return null;

  const gnssColor = GNSS_QUALITY_COLORS[frame.gnss.quality];
  const eskfColor =
    frame.eskf.health === 'RUNNING'
      ? '#2DD4BF'
      : frame.eskf.health === 'REACQUIRING'
        ? '#4ADE80'
        : frame.eskf.health === 'DEGRADED'
          ? '#F5A524'
          : '#8C9AB2';
  const aiColor = frame.ai.active ? '#8B7BF7' : '#3A4557';
  const imuColor = frame.imu.health === 'OK' ? '#2DD4BF' : frame.imu.health === 'WARMING' ? '#F5A524' : '#F04E3E';

  return (
    <Panel
      title="Sensor Snapshot"
      accent="#2DD4BF"
      aside={
        <button type="button" onClick={onExpand} className="btn btn-ghost !px-2 !py-1">
          Expand
        </button>
      }
    >
      <div className="divide-y divide-hairline">
        <Row
          icon={<Satellite size={13} strokeWidth={1.6} />}
          label="GNSS"
          value={
            frame.gnss.available
              ? `FIX ${frame.gnss.fixType}`
              : frame.gnss.secondsSinceFix < 1
                ? 'NO FIX'
                : `LOST ${frame.gnss.secondsSinceFix.toFixed(0)}s`
          }
          color={gnssColor}
          sub={
            frame.gnss.available
              ? `${frame.gnss.satellitesUsed} sats · HDOP ${frame.gnss.hdop.toFixed(1)} · C/N₀ ${frame.gnss.cn0.toFixed(0)}`
              : 'Receiver integrated. No position output.'
          }
        />
        <Row
          icon={<Activity size={13} strokeWidth={1.6} />}
          label="IMU"
          value={frame.imu.health}
          color={imuColor}
          sub={`${frame.imu.sampleRateHz} Hz · ${frame.imu.temperatureC.toFixed(1)} °C · gyro ${frame.imu.gyro.z.toFixed(2)} °/s`}
        />
        <Row
          icon={<Cpu size={13} strokeWidth={1.6} />}
          label="ESKF"
          value={frame.eskf.health}
          color={eskfColor}
          sub={`NIS ${frame.eskf.nis.toFixed(2)} · ${frame.eskf.updatesAccepted} acc / ${frame.eskf.updatesRejected} rej · ${frame.eskf.errorStates} states`}
        />
        <Row
          icon={<Sparkles size={13} strokeWidth={1.6} />}
          label="AI"
          value={frame.ai.active ? 'ACTIVE' : 'STANDBY'}
          color={aiColor}
          sub={
            frame.ai.active
              ? `${AI_STAGE_LABELS[frame.ai.stage]} · ${frame.ai.inferenceMs.toFixed(1)} ms · ${frame.ai.correctionsApplied} applied`
              : 'Model idle — not required while GNSS is healthy.'
          }
          pulse={frame.ai.active}
        />
      </div>
    </Panel>
  );
}

function Row({
  icon,
  label,
  value,
  sub,
  color,
  pulse,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  color: string;
  pulse?: boolean;
}) {
  return (
    <div className="flex items-start gap-2.5 px-3 py-2">
      <span className="mt-[3px] shrink-0" style={{ color }}>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-ink-dim">
            {label}
          </span>
          <span className="readout truncate text-[11px] font-medium" style={{ color }}>
            {value}
          </span>
          {pulse && <StatusDot color={color} size={5} />}
        </div>
        {/* Two lines rather than a hard truncate: at 320px a single truncated
            line was cutting the tail off the explanation, and this text is the
            only thing that says what actually happened. */}
        <p className="readout mt-[3px] line-clamp-2 break-words text-[10px] leading-snug text-ink-dim">
          {sub}
        </p>
      </div>
    </div>
  );
}

/**
 * The AI pipeline indicator.
 *
 * AI is shown as a *stage inside a pipeline*, never as a bare accuracy number,
 * because the product claim is about what the model contributes, not about a
 * headline percentage. When the stage is idle the pipeline still renders — a
 * system that only appears when it is working looks like a demo reel.
 */
export function AIPipelineIndicator() {
  const frame = useTelemetry(200);
  const { aiContribution } = useNavigationUi();
  const active = frame?.ai.active ?? false;
  const stage = frame?.ai.stage ?? 'IDLE';

  return (
    <Panel
      title="AI Correction Pipeline"
      accent={active ? '#8B7BF7' : '#3A4557'}
      aside={
        <span
          className="readout text-[10px] uppercase tracking-[0.12em]"
          style={{ color: active ? '#A99BFF' : '#5A6781' }}
        >
          {active ? 'Engaged' : 'Idle'}
        </span>
      }
    >
      <div className="px-3 py-2.5">
        <ol className="flex flex-col gap-0.5">
          {AI_PIPELINE_STAGES.map((s, i) => {
            const isCurrent = active && s === stage;
            const isPast = active && AI_PIPELINE_STAGES.indexOf(stage) > i;
            const color = isCurrent || isPast ? AI_STAGE_COLORS[s] : '#3A4557';
            return (
              <li key={s} className="relative flex items-center gap-2 py-[3px]">
                <span className="relative flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                  {isCurrent && (
                    <span
                      aria-hidden
                      className="absolute inset-0 animate-pulse-ring rounded-full"
                      style={{ background: color }}
                    />
                  )}
                  <span
                    className="h-[7px] w-[7px] rounded-full transition-colors duration-200"
                    style={{ background: color, boxShadow: isCurrent ? `0 0 8px ${color}` : undefined }}
                  />
                </span>
                {i < AI_PIPELINE_STAGES.length - 1 && (
                  <span
                    aria-hidden
                    className="absolute left-[6.5px] top-[19px] h-[6px] w-px"
                    style={{ background: isPast ? AI_STAGE_COLORS[s] : '#243146' }}
                  />
                )}
                <span
                  className="font-mono text-[10px] uppercase tracking-[0.1em] transition-colors duration-200"
                  style={{ color: isCurrent ? color : isPast ? '#8C9AB2' : '#3A4557' }}
                >
                  {AI_STAGE_LABELS[s]}
                </span>
              </li>
            );
          })}
        </ol>

        <div className="mt-2.5 border-t border-hairline pt-2">
          {active && frame ? (
            <>
              <div className="flex items-baseline justify-between">
                <span className="label-micro">Predicted IMU error</span>
                <span className="readout text-[11px]" style={{ color: '#A99BFF' }}>
                  {Math.hypot(frame.ai.predictedError.x, frame.ai.predictedError.y).toFixed(3)} m/s²
                </span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="label-micro">Model self-report</span>
                <span className="readout text-[11px] text-ink-muted">
                  {(frame.ai.modelConfidence * 100).toFixed(0)}% sure of its own estimate
                </span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="label-micro">Features / window</span>
                <span className="readout text-[11px] text-ink-muted">
                  {frame.ai.featureCount} / {frame.ai.windowSamples}
                </span>
              </div>
              {!aiContribution && (
                <p className="mt-2 border-t border-hairline pt-2 text-[11px] leading-snug text-[#FFB86B]">
                  Output is being displayed but not fed to the filter. Watch the uncertainty
                  ellipse grow with the model switched off, then turn it back on and trigger the
                  outage again.
                </p>
              )}
            </>
          ) : (
            <p className="text-[11px] leading-snug text-ink-dim">
              The model is not running. It engages only when GNSS is denied and the strapdown
              estimate is drifting — which is the honest division of labour.
            </p>
          )}
        </div>
      </div>
    </Panel>
  );
}

/**
 * The Event Timeline.
 *
 * Every state transition lands here with a timestamp. During a demo this doubles
 * as the narrative: it is the artefact a judge can read afterwards to see
 * exactly what the system did and in what order.
 */
export function EventTimeline({ limit = 60 }: { limit?: number }) {
  const frame = useTelemetry(500);
  const events = useEvents();

  return (
    <Panel
      title="Event Timeline"
      accent="#8C9AB2"
      bodyClassName="overflow-y-auto"
      aside={
        <span className="readout text-[10px] text-ink-dim">
          {events.length} entries · {formatClock(frame?.timestamp ?? Date.now())}
        </span>
      }
    >
      <ol className="divide-y divide-hairline/70">
        {events.slice(0, limit).map((e) => (
          <EventRow key={e.id} event={e} />
        ))}
        {events.length === 0 && (
          <li className="flex items-center gap-2 px-3 py-3 text-[11px] text-ink-dim">
            <AlertTriangle size={12} />
            No events yet. The first fix is still aligning.
          </li>
        )}
      </ol>
    </Panel>
  );
}

function EventRow({ event }: { event: NavigationEvent }) {
  const color = SEVERITY_COLORS[event.severity];
  return (
    <li className="flex items-start gap-2.5 px-3 py-[7px]">
      <span className="mt-[5px] flex h-2 w-2 shrink-0 items-center justify-center">
        <span
          className="h-[6px] w-[6px] rounded-full"
          style={{ background: color, boxShadow: `0 0 6px ${color}80` }}
        />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span
            className="font-mono text-[10px] font-bold uppercase tracking-[0.1em]"
            style={{ color }}
          >
            {event.title}
          </span>
          <span className="readout text-[9px] text-ink-dim">{formatClock(event.timestamp)}</span>
          <span className="readout text-[9px] uppercase tracking-[0.1em] text-ink-dim">
            {event.kind}
          </span>
        </div>
        <p className="mt-[2px] text-[11px] leading-snug text-ink-muted">{event.message}</p>
      </div>
    </li>
  );
}
