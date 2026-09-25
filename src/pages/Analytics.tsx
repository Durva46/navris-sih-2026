import { useEvents, useTelemetry } from '@/nav/hooks';
import { navigationStore } from '@/nav/store';
import { Panel } from '@/components/ui/primitives';
import { DATA_SOURCE_LABEL, SEVERITY_COLORS } from '@/theme/stateColors';
import { formatClock } from '@/lib/format';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useMemo, useState } from 'react';
import type { DataSourceLabel } from '@/types/navigation';

/**
 * Analytics / Research.
 *
 * A secondary view for judges who probe deeper and for the team while building.
 * Two rules govern everything here:
 *
 *  1. Every chart header states its data source. Not in a tooltip — in the
 *     header, where it cannot be missed.
 *  2. "Error" is only computable because a simulation has ground truth. On
 *     real hardware these charts are replaced by reference-track comparisons,
 *     which is exactly why the provenance label is not optional.
 */
export default function AnalyticsPage() {
  const frame = useTelemetry(500);
  const events = useEvents();
  const source: DataSourceLabel = frame?.source ?? 'DEMO_SIMULATED';
  const [range, setRange] = useState<60 | 180 | 600>(180);

  const data = useMemo(() => {
    const h = navigationStore.history.slice(-range);
    return h.map((s) => ({
      t: s.t,
      positionError: s.positionError,
      velocityError: s.velocityError,
      headingError: s.headingError,
      sigmaEast: s.sigmaEast,
      sigmaNorth: s.sigmaNorth,
      confidence: s.confidence,
      nis: s.nis,
      rejected: s.updatesRejected,
      speed: s.speed,
      accelMag: s.accelMag,
      gyroMag: s.gyroMag,
      gnss: s.gnssAvailable,
      ai: s.aiActive,
      state: s.state,
    }));
  }, [frame?.timestamp, range]);

  /** Contiguous GNSS-denied spans, drawn as bands behind every time series. */
  const outageBands = useMemo(() => {
    if (data.length < 2) return [] as { from: number; to: number }[];
    const bands: { from: number; to: number }[] = [];
    let start: number | null = null;
    for (let i = 0; i < data.length; i++) {
      const out = data[i].gnss === 0;
      if (out && start === null) start = data[i].t;
      if ((!out || i === data.length - 1) && start !== null) {
        bands.push({ from: start, to: data[i].t });
        start = null;
      }
    }
    return bands;
  }, [data]);

  if (data.length < 2) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <div className="border border-hairline bg-surface px-6 py-4 text-center">
          <p className="label-micro">Acquiring samples</p>
          <p className="mt-2 text-[12px] text-ink-muted">
            Telemetry is being recorded. Charts populate within a few seconds.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex flex-wrap items-center gap-3 border-b border-hairline px-4 py-2.5">
        <div>
          <h1 className="text-[13px] font-semibold tracking-[0.14em] text-ink">ANALYTICS / RESEARCH</h1>
          <p className="mt-0.5 text-[11px] text-ink-dim">
            Post-run technical view. Replay the sequence in Simulation to populate these traces.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="label-micro">Window</span>
          <div className="flex border border-hairline">
            {([60, 180, 600] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                className={`readout px-2.5 py-1 text-[10px] transition-colors ${
                  range === r ? 'bg-surface-hover text-ink' : 'text-ink-dim hover:text-ink-muted'
                }`}
              >
                {r}s
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-px bg-hairline xl:grid-cols-2">
        <Chart
          title="Position Error vs. Time"
          source={source}
          note="Horizontal distance between the NAVRIS solution and the simulation's ground truth."
        >
          <ResponsiveContainer width="100%" height={190}>
            <LineChart data={data} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="#1B2537" strokeDasharray="2 4" />
              <OutageBands bands={outageBands} />
              <XAxis dataKey="t" stroke="#3A4557" tick={{ fill: '#5A6781', fontSize: 9, fontFamily: 'JetBrains Mono' }} tickFormatter={(v: number) => `${v.toFixed(0)}s`} />
              <YAxis stroke="#3A4557" tick={{ fill: '#5A6781', fontSize: 9, fontFamily: 'JetBrains Mono' }} width={40} tickFormatter={(v: number) => `${v.toFixed(1)}`} />
              <Tooltip content={<ChartTooltip unit="m" />} />
              <Legend wrapperStyle={{ fontSize: 10, fontFamily: 'JetBrains Mono' }} />
              <Line type="monotone" dataKey="positionError" name="Position error" stroke="#F04E3E" strokeWidth={1.6} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="sigmaEast" name="σ East (1σ)" stroke="#2DD4BF" strokeWidth={1.2} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="sigmaNorth" name="σ North (1σ)" stroke="#5EEAD4" strokeWidth={1.2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </Chart>

        <Chart
          title="Uncertainty / Covariance Trend"
          source={source}
          note="The filter's own position standard deviation. Growth here is the covariance recursion, not an animation."
        >
          <ResponsiveContainer width="100%" height={190}>
            <LineChart data={data} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="#1B2537" strokeDasharray="2 4" />
              <OutageBands bands={outageBands} />
              <XAxis dataKey="t" stroke="#3A4557" tick={{ fill: '#5A6781', fontSize: 9, fontFamily: 'JetBrains Mono' }} tickFormatter={(v: number) => `${v.toFixed(0)}s`} />
              <YAxis stroke="#3A4557" tick={{ fill: '#5A6781', fontSize: 9, fontFamily: 'JetBrains Mono' }} width={40} tickFormatter={(v: number) => v.toFixed(1)} />
              <Tooltip content={<ChartTooltip unit="m" />} />
              <Legend wrapperStyle={{ fontSize: 10, fontFamily: 'JetBrains Mono' }} />
              <Line type="monotone" dataKey="sigmaEast" name="σ East" stroke="#2DD4BF" strokeWidth={1.6} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="confidence" name="Confidence (0–1)" stroke="#34D399" strokeWidth={1.2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </Chart>

        <Chart
          title="Velocity &amp; Heading Error"
          source={source}
          note="Secondary axes, scaled separately. Left axis is m/s, right axis is degrees."
        >
          <ResponsiveContainer width="100%" height={190}>
            <LineChart data={data} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="#1B2537" strokeDasharray="2 4" />
              <OutageBands bands={outageBands} />
              <XAxis dataKey="t" stroke="#3A4557" tick={{ fill: '#5A6781', fontSize: 9, fontFamily: 'JetBrains Mono' }} tickFormatter={(v: number) => `${v.toFixed(0)}s`} />
              <YAxis yAxisId="l" stroke="#3A4557" tick={{ fill: '#5A6781', fontSize: 9, fontFamily: 'JetBrains Mono' }} width={40} />
              <YAxis yAxisId="r" orientation="right" stroke="#3A4557" tick={{ fill: '#5A6781', fontSize: 9, fontFamily: 'JetBrains Mono' }} width={34} />
              <Tooltip content={<ChartTooltip unit="" />} />
              <Legend wrapperStyle={{ fontSize: 10, fontFamily: 'JetBrains Mono' }} />
              <Line yAxisId="l" type="monotone" dataKey="velocityError" name="Velocity error (m/s)" stroke="#F5A524" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              <Line yAxisId="r" type="monotone" dataKey="headingError" name="Heading error (°)" stroke="#8B7BF7" strokeWidth={1.5} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </Chart>

        <Chart
          title="ESKF Innovation Test"
          source={source}
          note="NIS above 9.3 (2-DOF, χ² 99%) means the gate rejects the measurement. Rejections are the filter protecting the solution."
        >
          <ResponsiveContainer width="100%" height={190}>
            <LineChart data={data} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="#1B2537" strokeDasharray="2 4" />
              <ReferenceArea y1={9.3} y2={9.3} fill="#F04E3E" fillOpacity={0.12} />
              <OutageBands bands={outageBands} />
              <XAxis dataKey="t" stroke="#3A4557" tick={{ fill: '#5A6781', fontSize: 9, fontFamily: 'JetBrains Mono' }} tickFormatter={(v: number) => `${v.toFixed(0)}s`} />
              <YAxis stroke="#3A4557" tick={{ fill: '#5A6781', fontSize: 9, fontFamily: 'JetBrains Mono' }} width={40} />
              <Tooltip content={<ChartTooltip unit="" />} />
              <Legend wrapperStyle={{ fontSize: 10, fontFamily: 'JetBrains Mono' }} />
              <Line type="monotone" dataKey="nis" name="NIS" stroke="#FBBF4C" strokeWidth={1.3} dot={false} isAnimationActive={false} />
              <Line type="stepAfter" dataKey="rejected" name="Cumulative rejections" stroke="#F04E3E" strokeWidth={1.3} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </Chart>

        <Chart
          title="GNSS Availability"
          source={source}
          note="1 = receiver producing fixes, 0 = denied. The gap is the whole product."
        >
          <ResponsiveContainer width="100%" height={150}>
            <LineChart data={data} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="#1B2537" strokeDasharray="2 4" />
              <XAxis dataKey="t" stroke="#3A4557" tick={{ fill: '#5A6781', fontSize: 9, fontFamily: 'JetBrains Mono' }} tickFormatter={(v: number) => `${v.toFixed(0)}s`} />
              <YAxis domain={[0, 1]} stroke="#3A4557" tick={{ fill: '#5A6781', fontSize: 9, fontFamily: 'JetBrains Mono' }} width={40} tickFormatter={(v: number) => (v > 0.5 ? 'LOCK' : 'LOST')} />
              <Tooltip content={<ChartTooltip unit="" />} />
              <OutageBands bands={outageBands} />
              <Line type="stepAfter" dataKey="gnss" name="GNSS available" stroke="#2DD4BF" strokeWidth={1.8} dot={false} isAnimationActive={false} />
              <Line type="stepAfter" dataKey="ai" name="AI stage active" stroke="#8B7BF7" strokeWidth={1.4} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </Chart>

        <Chart
          title="Raw Inertial Signals"
          source={source}
          note="Specific force magnitude and angular rate magnitude straight off the IMU model."
        >
          <ResponsiveContainer width="100%" height={150}>
            <LineChart data={data} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="#1B2537" strokeDasharray="2 4" />
              <OutageBands bands={outageBands} />
              <XAxis dataKey="t" stroke="#3A4557" tick={{ fill: '#5A6781', fontSize: 9, fontFamily: 'JetBrains Mono' }} tickFormatter={(v: number) => `${v.toFixed(0)}s`} />
              <YAxis stroke="#3A4557" tick={{ fill: '#5A6781', fontSize: 9, fontFamily: 'JetBrains Mono' }} width={40} />
              <Tooltip content={<ChartTooltip unit="" />} />
              <Legend wrapperStyle={{ fontSize: 10, fontFamily: 'JetBrains Mono' }} />
              <Line type="monotone" dataKey="accelMag" name="|accel| (m/s²)" stroke="#5EEAD4" strokeWidth={1.2} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="gyroMag" name="|gyro| (°/s)" stroke="#A99BFF" strokeWidth={1.2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </Chart>
      </div>

      <Panel title="State Transition Log" accent="#8C9AB2" bodyClassName="max-h-[280px] overflow-y-auto">
        <ol className="divide-y divide-hairline/70">
          {events
            .filter((e) => e.kind === 'STATE')
            .map((e) => (
              <li key={e.id} className="flex items-start gap-2.5 px-3 py-[6px]">
                <span
                  className="mt-[5px] h-[6px] w-[6px] shrink-0 rounded-full"
                  style={{ background: SEVERITY_COLORS[e.severity] }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-mono text-[10px] font-bold uppercase tracking-[0.1em]" style={{ color: SEVERITY_COLORS[e.severity] }}>
                      {e.title}
                    </span>
                    <span className="readout text-[9px] text-ink-faint">{formatClock(e.timestamp)}</span>
                    <span className="readout text-[9px] text-ink-faint">{e.state}</span>
                  </div>
                  <p className="mt-[2px] text-[11px] leading-snug text-ink-muted">{e.message}</p>
                </div>
              </li>
            ))}
        </ol>
      </Panel>
    </div>
  );
}

function OutageBands({ bands }: { bands: { from: number; to: number }[] }) {
  return (
    <>
      {bands.map((b, i) => (
        <ReferenceArea
          key={i}
          x1={b.from}
          x2={b.to}
          fill="#F04E3E"
          fillOpacity={0.09}
          stroke="#F04E3E"
          strokeOpacity={0.28}
        />
      ))}
    </>
  );
}

function Chart({
  title,
  source,
  note,
  children,
}: {
  title: string;
  source: DataSourceLabel;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <Panel
      title={title}
      accent={source === 'MEASURED' ? '#2DD4BF' : '#F5A524'}
      aside={
        <span
          className="readout border px-1.5 py-[2px] text-[9px] uppercase tracking-[0.1em]"
          style={{
            color: source === 'MEASURED' ? '#6EE7B7' : '#FBBF4C',
            borderColor: source === 'MEASURED' ? 'rgba(52,211,153,0.4)' : 'rgba(245,165,36,0.4)',
          }}
        >
          {DATA_SOURCE_LABEL[source]}
        </span>
      }
    >
      <div className="px-2 pb-1 pt-1">
        {children}
        <p className="px-1 pb-1 pt-1 text-[10px] leading-snug text-ink-faint">{note}</p>
      </div>
    </Panel>
  );
}

function ChartTooltip({
  active,
  payload,
  label,
  unit,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number | string; color?: string }[];
  label?: number | string;
  unit: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="border border-hairline-strong bg-base-850 px-2.5 py-1.5 text-[10px]">
      <div className="readout mb-1 text-ink-dim">t = {Number(label).toFixed(1)} s</div>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <span className="h-[6px] w-[6px]" style={{ background: p.color }} />
          <span className="text-ink-muted">{p.name}</span>
          <span className="readout ml-auto text-ink">
            {typeof p.value === 'number' ? p.value.toFixed(3) : p.value}
            {unit}
          </span>
        </div>
      ))}
    </div>
  );
}
