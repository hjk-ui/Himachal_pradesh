'use client';

/**
 * AI section review in the note editor: per-section "Accept" (clears that section's AI DRAFT
 * marker) and "Accept all reviewed". Replaces deleting each marker by hand. Signing stays blocked
 * (server: countAiDraftMarkers) until every AI section is accepted or edited.
 */
import { Check, CheckCheck, Sparkles } from 'lucide-react';
import { ACCEPT_ALL_LABEL, ACCEPT_LABEL, REVIEW_HELP, aiSectionsPending } from '@/lib/scribe/review';

export function AiReviewBar({
  texts,
  order,
  onAccept,
  onAcceptAll,
  onGoTo,
}: {
  texts: Record<string, string>;
  /** Section order of the note type */
  order: readonly string[];
  onAccept: (heading: string) => void;
  onAcceptAll: (headings: string[]) => void;
  /** Scroll to the section */
  onGoTo?: (heading: string) => void;
}) {
  const pending = aiSectionsPending(texts, order);
  if (!pending.length) return null;
  return (
    <div className="rounded-xl border border-[#DDD6FE] bg-[#F5F3FF] p-3 text-sm text-[#4A2475]" aria-label="AI sections to review">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 font-semibold">
          <Sparkles size={14} aria-hidden /> {pending.length} AI section{pending.length === 1 ? '' : 's'} to review
        </p>
        <button
          type="button"
          onClick={() => {
            if (window.confirm(`Accept all ${pending.length} AI section${pending.length === 1 ? '' : 's'}? Confirm you read each one against the session and corrected anything wrong.`)) onAcceptAll(pending);
          }}
          className="inline-flex items-center gap-1 rounded-lg bg-[#5C2D91] px-3 py-1.5 text-xs font-bold text-white"
        >
          <CheckCheck size={13} aria-hidden /> {ACCEPT_ALL_LABEL}
        </button>
      </div>
      <p className="mt-1 text-xs">{REVIEW_HELP}</p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {pending.map((h) => (
          <li key={h} className="inline-flex items-center gap-1 rounded-lg border border-[#DDD6FE] bg-white px-2 py-1 text-xs">
            {onGoTo ? (
              <button type="button" className="font-semibold underline-offset-2 hover:underline" onClick={() => onGoTo(h)}>
                {h}
              </button>
            ) : (
              <span className="font-semibold">{h}</span>
            )}
            <button type="button" onClick={() => onAccept(h)} aria-label={`${ACCEPT_LABEL} ${h}`} className="ml-1 inline-flex items-center gap-0.5 rounded bg-emerald-600 px-1.5 py-0.5 font-bold text-white">
              <Check size={11} aria-hidden /> {ACCEPT_LABEL}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
