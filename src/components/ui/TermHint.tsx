import { termDefinition } from '@/content/technicalTerms';
import { useId, useState } from 'react';

/**
 * An inline definition for a technical term.
 *
 * The cockpit is dense with terms that mean nothing to a first-time viewer, but
 * the cockpit is also the thing that must stay clean. This is the compromise: the
 * term itself is styled as a term (dotted underline, no colour change, so it does
 * not compete with the state language), and the definition is reachable by hover,
 * by keyboard focus, or by tap — without adding permanent chrome.
 *
 * `title` is deliberately not used for the tooltip. Native tooltips cannot be
 * opened by keyboard or tap, which would make the explanation unreachable to
 * exactly the users most likely to need it. This is a real popover with a
 * dismissible state, and it is wired to `aria-describedby` so a screen reader
 * announces the definition with the term.
 */
export function TermHint({ term, children }: { term: string; children?: React.ReactNode }) {
  const definition = termDefinition(term);
  const [open, setOpen] = useState(false);
  const id = useId();

  if (!definition) return <>{children ?? term}</>;

  return (
    <span className="relative inline-block">
      <button
        type="button"
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onBlur={(e) => {
          if (!e.currentTarget.parentElement?.contains(e.relatedTarget as Node | null)) setOpen(false);
        }}
        className="cursor-help decoration-1 underline-offset-2 hover:underline focus-visible:underline"
        style={{ borderBottom: '1px dotted var(--state-accent)', paddingBottom: '1px' }}
      >
        {children ?? definition.term}
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className="absolute left-0 top-full z-50 mt-1.5 block w-[min(19rem,72vw)] rounded border border-hairline-strong bg-base-900 p-2 text-left font-sans text-[10.5px] font-normal normal-case leading-relaxed tracking-normal text-ink-muted shadow-lg"
        >
          {definition.short}
        </span>
      )}
    </span>
  );
}
