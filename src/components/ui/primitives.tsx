import { useNavigationUi } from '@/nav/NavigationContext';
import {
  DATA_SOURCE_MODE_DETAIL,
  DATA_SOURCE_MODE_LABEL,
  type DataSourceMode,
} from '@/types/navigation';
import type { ReactNode } from 'react';

/**
 * Base primitives. Deliberately small and unopinionated - the instrument look
 * comes from hairlines, monospace numerals and the state colour table, not from
 * a component library.
 */

export function Panel({
  title,
  aside,
  children,
  className = '',
  bodyClassName = '',
  accent,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  /** Optional left-edge accent, e.g. the system state colour. */
  accent?: string;
}) {
  return (
    <section className={`panel flex min-h-0 flex-col ${className}`}>
      <header className="panel-header shrink-0">
        {accent && (
          <span
            aria-hidden
            className="h-3 w-[2px] shrink-0"
            style={{ background: accent }}
          />
        )}
        <h2 className="panel-title">{title}</h2>
        {aside && <div className="ml-auto flex items-center gap-2">{aside}</div>}
      </header>
      <div className={`min-h-0 flex-1 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

export function PanelRow({
  label,
  value,
  mono = true,
  valueColor,
  hint,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
  valueColor?: string;
  hint?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[3px]">
      <span className="label-micro shrink-0" title={hint}>
        {label}
      </span>
      <span
        className={`readout text-[11px] leading-tight ${mono ? '' : 'font-sans'}`}
        style={valueColor ? { color: valueColor } : undefined}
      >
        {value}
      </span>
    </div>
  );
}

/** A key/value block used across the System panel. */
export function ReadoutGrid({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">{children}</dl>;
}

export function ReadoutTerm({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <dt className="label-micro self-baseline" title={title}>
      {children}
    </dt>
  );
}

export function ReadoutDef({
  children,
  color,
  className = '',
  title,
}: {
  children: ReactNode;
  color?: string;
  className?: string;
  title?: string;
}) {
  return (
    <dd
      className={`readout text-right text-[11px] ${className}`}
      style={color ? { color } : undefined}
      title={title}
    >
      {children}
    </dd>
  );
}

/** A labelled horizontal meter. Used for confidence, correction magnitude, etc. */
export function Meter({
  label,
  value,
  max = 1,
  color,
  suffix,
  formatValue,
}: {
  label: string;
  value: number;
  max?: number;
  color: string;
  suffix?: string;
  formatValue?: (v: number) => string;
}) {
  const pct = Math.max(0, Math.min(1, value / max)) * 100;
  return (
    <div className="py-1">
      <div className="flex items-baseline justify-between">
        <span className="label-micro">{label}</span>
        <span className="readout text-[11px]" style={{ color }}>
          {formatValue ? formatValue(value) : value.toFixed(2)}
          {suffix}
        </span>
      </div>
      <div className="mt-1 h-[3px] w-full bg-hairline">
        <div
          className="h-full transition-[width] duration-200 ease-instrument"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  );
}

/** Small status glyph row. Icon is optional; never decorative-only. */
export function StatusDot({ color, pulse = false, size = 7 }: { color: string; pulse?: boolean; size?: number }) {
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      {pulse && (
        <span
          aria-hidden
          className="absolute inset-0 animate-pulse-ring rounded-full"
          style={{ background: color }}
        />
      )}
      <span
        className="m-auto rounded-full"
        style={{ width: size, height: size, background: color, boxShadow: `0 0 6px ${color}66` }}
      />
    </span>
  );
}

/**
 * The permanent provenance label.
 *
 * This is not a badge you can turn off — it is chrome, and it is the reason a
 * viewer can never mistake a simulated number for a measurement. It reads the
 * mode from the navigation service rather than hard-coding "demo", so a live
 * feed and a research replay each announce themselves correctly, and so a future
 * adapter needs no edit here to be labelled honestly.
 */
export function DataSourceBadge({ compact = false }: { compact?: boolean }) {
  const { dataSourceMode } = useNavigationUi();
  const spec = DATA_SOURCE_BADGE[dataSourceMode];
  return (
    <span
      className={`readout inline-flex shrink-0 items-center gap-1.5 border px-2 py-1
                  text-micro font-medium uppercase tracking-[0.14em] ${spec.className}`}
      title={DATA_SOURCE_MODE_DETAIL[dataSourceMode]}
    >
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${spec.dot}`} />
      {/*
        The full label ("Simulation / Demo Mode") is roughly 200px of unbreakable
        mono at this tracking, which is more than a 320px header can spare. The
        abbreviation is the same fact, and `title` still carries the full
        sentence on hover, so nothing is actually lost.
      */}
      {compact ? (
        spec.short
      ) : (
        <>
          <span className="lg:hidden">{spec.short}</span>
          <span className="hidden lg:inline">{spec.long}</span>
        </>
      )}
    </span>
  );
}

/**
 * Per-mode presentation for the provenance badge.
 *
 * Presentation is keyed on the *mode*, never on an adapter, so a new adapter
 * appears correctly labelled without touching this file. Each mode gets a
 * distinct colour as well as distinct wording, so the distinction survives for
 * anyone who cannot rely on reading the text.
 */
const DATA_SOURCE_BADGE: Readonly<
  Record<DataSourceMode, { short: string; long: string; className: string; dot: string }>
> = {
  demo: {
    short: 'SIM',
    long: DATA_SOURCE_MODE_LABEL.demo,
    className: 'border-degraded/40 bg-degraded/[0.07] text-degraded-soft',
    dot: 'bg-degraded',
  },
  live: {
    short: 'LIVE',
    long: DATA_SOURCE_MODE_LABEL.live,
    className: 'border-nominalGreen/40 bg-nominalGreen/[0.07] text-nominalGreen',
    dot: 'bg-nominalGreen',
  },
  research: {
    short: 'REPLAY',
    long: DATA_SOURCE_MODE_LABEL.research,
    className: 'border-ai/40 bg-ai/[0.07] text-ai-soft',
    dot: 'bg-ai',
  },
};

/** Section divider with an optional label — used inside dense panels. */
export function Divider({ label }: { label?: string }) {
  if (!label) return <div className="my-2 h-px bg-hairline" />;
  return (
    <div className="my-2 flex items-center gap-2">
      <div className="h-px flex-1 bg-hairline" />
      <span className="label-micro">{label}</span>
      <div className="h-px flex-1 bg-hairline" />
    </div>
  );
}
