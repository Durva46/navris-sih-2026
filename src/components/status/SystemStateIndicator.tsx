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
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span
            className={cn(
              'min-w-0 break-words font-mono font-bold uppercase leading-none tracking-[0.04em] tabular-nums',
              // JetBrains Mono advances 0.6em per glyph (measured: 20 "M" at
              // 36px = 432px), so the width is predictable:
              //   "AI CORRECTION"   14 chars = 297px at 36px, 182px at 22px
              //   "RECKONING"       10 chars = 216px at 36px, 132px at 22px
              // and the state column it has to fit in is not a function of the
              // viewport. It is whatever is left after the wordmark (209px), the
              // divider, the provenance badge, the Sim/System buttons, the view
              // switcher (182px) and the scenario readout: measured 138px at
              // 1024, 117px at 1280, 203px at 1366, 277px at 1440. So at 36px the
              // longest single word (216px) does not fit the narrowest column, and
              // `break-words` cut "CORRECTION" into fragments — seven lines and a
              // 193px header in the state the demo spends most of its outage in.
              //
              // 22px from `lg` is the size that fits: the longest word is 132px
              // against 138px, so the label reads as two clean lines
              // ("INS · DEAD" / "RECKONING") with no truncation and no mid-word
              // break, and it is still the largest text in the header by a wide
              // margin. The full 36px returns at `2xl`, the first width where the
              // column (700px+) is wider than the longest label at that size.
              //
              // `lg:line-clamp-2` is the backstop, not the mechanism: it bounds
              // the header's height if the row is ever over-subscribed again.
              // It is not applied below `lg` because there the state has a row of
              // its own — 228px of label against 296px available at 320, and less
              // than half the width at 640 — so there is nothing to clamp, and an
              // unclamped line box avoids the 3px descender overflow that a
              // `-webkit-box` line-clamp reports as clipped content.
              compact ? 'text-state-lg' : 'text-[19px] xs:text-[22px] sm:text-state-lg lg:text-[22px] lg:line-clamp-2 2xl:text-state-xl',
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
