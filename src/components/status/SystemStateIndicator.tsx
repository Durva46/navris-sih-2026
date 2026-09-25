import { useTelemetry } from '@/nav/hooks';
import { selectStateDescriptor, selectStateVisual } from '@/nav/selectors';
import { StatusDot } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';
import { formatDuration } from '@/lib/format';

/**
 * The system state indicator.
 *
 * This is the single most important element in the product. It is the largest
 * piece of text on screen besides the map, it is readable from across a room on
 * a projector, and it is backed by both colour *and* wording and motion — so it
 * still communicates to a viewer who cannot distinguish the colours, or who is
 * looking at a washed-out projector.
 *
 * It publishes its state to an aria-live region, so a screen-reader user learns
 * about an outage at the same moment a judge sees the screen turn red.
 */
export function SystemStateIndicator({ compact = false }: { compact?: boolean }) {
  const frame = useTelemetry(120);
  const stateId = frame?.state.id ?? 'INITIALISING';
  const visual = selectStateVisual(frame);
  const descriptor = selectStateDescriptor(frame);
  const dwell = frame?.state.dwellSeconds ?? 0;

  return (
    <div
      className="flex min-w-0 items-center gap-3"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div
        className="relative flex h-9 w-9 shrink-0 items-center justify-center"
        style={{ color: visual.accent }}
      >
        {visual.pulse && (
          <span
            aria-hidden
            className="absolute inset-0 animate-pulse-ring rounded-full border"
            style={{ borderColor: visual.accent }}
          />
        )}
        <span
          aria-hidden
          className="absolute inset-[3px] rotate-45 border"
          style={{ borderColor: visual.border, background: visual.wash }}
        />
        <StatusDot color={visual.accent} pulse={false} size={9} />
      </div>

      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <span
            className={cn(
              'font-mono font-bold uppercase leading-none tracking-[0.06em] tabular-nums',
              compact ? 'text-state-lg' : 'text-state-xl',
            )}
            style={{ color: visual.text }}
          >
            {descriptor.label}
          </span>
          {dwell > 0.4 && (
            <span className="readout text-[11px] text-ink-dim">{formatDuration(dwell)}</span>
          )}
        </div>
        {!compact && (
          <p className="mt-1 max-w-[62ch] truncate text-[12px] leading-snug text-ink-muted">
            {descriptor.detail}
          </p>
        )}
      </div>

      <span className="sr-only">
        System state {stateId}. {descriptor.detail}
      </span>
    </div>
  );
}
