'use client';

/**
 * Shown on the notes page right after a note is signed: what happened to the claim, whether a
 * co-signature is pending, and the next actions (book the follow-up, next note, back to the
 * schedule) so the clinician does not have to find them.
 */
import Link from 'next/link';
import { CalendarPlus, CheckCircle2, ClipboardList, FileText, Home, Receipt, Stethoscope, X } from 'lucide-react';
import type { AfterSignAction } from '@/lib/notes/afterSign';

export type AfterSignState = {
  clientName: string;
  noteType: string;
  claimMessage: string | null;
  cosignRequired: boolean;
  actions: AfterSignAction[];
};

const ICON: Record<AfterSignAction['id'], React.ReactNode> = {
  book_follow_up: <CalendarPlus size={13} aria-hidden />,
  open_claim: <Receipt size={13} aria-hidden />,
  treatment_plan: <ClipboardList size={13} aria-hidden />,
  review_diagnoses: <Stethoscope size={13} aria-hidden />,
  worklist: <FileText size={13} aria-hidden />,
  schedule: <Home size={13} aria-hidden />,
};

export function AfterSignBanner({ state, onClose }: { state: AfterSignState; onClose: () => void }) {
  return (
    <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-slate-800">
      <div className="flex items-start gap-2">
        <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-700" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-emerald-900">
            {state.noteType || 'Note'} for {state.clientName} signed.
          </p>
          <p className="mt-0.5 text-xs text-slate-700">
            {state.cosignRequired ? 'Sent to your supervisor for co-signature. ' : ''}
            {state.claimMessage ?? ''}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {state.actions.map((a, i) => (
              <Link
                key={a.id}
                href={a.href}
                {...(a.id === 'book_follow_up' ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold ${
                  i === 0 ? 'bg-[#5C2D91] text-white hover:opacity-90' : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {ICON[a.id]}
                {a.label}
              </Link>
            ))}
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="Dismiss" className="rounded-lg p-1 text-slate-500 hover:bg-white">
          <X size={14} aria-hidden />
        </button>
      </div>
    </div>
  );
}
