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
      className="flex min-w-0 items-center gap-2.5 sm:gap-3"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div
        className="relative flex h-7 w-7 shrink-0 items-center justify-center sm:h-9 sm:w-9"
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

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span
            className={cn(
              'font-mono font-bold uppercase leading-none tracking-[0.04em] tabular-nums',
              // JetBrains Mono advances 0.6em per glyph, so the longest label
              // ("INS · DEAD RECKONING", 20 characters) needs roughly
              // 20 x 0.64em of width. At 44px that is ~560px, which overflows
              // every phone. These four steps keep the heading the loudest
              // element in the header at every width without letting it clip:
              //   320px  19px -> ~243px of 296px available
              //   380px  22px -> ~282px of 356px available
              //   640px  28px -> ~358px of 608px available
              //  1024px  36px -> ~460px of ~944px available
              compact ? 'text-state-lg' : 'text-[19px] xs:text-[22px] sm:text-state-lg lg:text-state-xl',
            )}
            style={{ color: visual.text }}
          >
            {descriptor.label}
          </span>
          {dwell > 0.4 && (
            <span className="readout shrink-0 text-[11px] text-ink-dim">{formatDuration(dwell)}</span>
          )}
        </div>
        {!compact && (
          // The explanation is what makes the state legible without relying on
          // colour, so it is never truncated: `lg:max-w-[62ch] lg:truncate`
          // looked tidy but silently dropped the tail of the sentence on a
          // 1366px laptop. Two lines at every width, with a generous cap so it
          // does not stretch across a 1920px header.
          <p className="mt-1 line-clamp-2 max-w-[72ch] text-[11px] leading-snug text-ink-muted sm:text-[12px]">
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
