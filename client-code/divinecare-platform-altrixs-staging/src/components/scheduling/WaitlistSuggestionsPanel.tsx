'use client';

import Link from 'next/link';
import { X } from 'lucide-react';
import type { WaitlistSuggestion } from '@/lib/scheduling/waitlistSuggest';
import { cx, FOCUS_RING, IconButton } from '@/components/ui';

/**
 * Shown after a cancellation: waitlist entries that could take the freed time. Suggestion only;
 * staff contact the person and book through the normal form.
 */
export function WaitlistSuggestionsPanel({
  suggestions,
  onClose,
}: {
  suggestions: WaitlistSuggestion[];
  onClose: () => void;
}) {
  if (!suggestions.length) return null;
  return (
    <section
      aria-label="Waitlist suggestions"
      className="fixed inset-x-4 bottom-4 z-50 rounded-xl border border-slate-200 bg-white p-4 shadow-xl sm:left-auto sm:right-4 sm:w-full sm:max-w-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900">Waitlist could fill this time</p>
          <p className="text-xs text-slate-500">Suggestions only. Nothing has been booked or sent.</p>
        </div>
        <IconButton label="Close" icon={<X className="h-4 w-4" />} onClick={onClose} className="p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700" />
      </div>
      <ul className="mt-3 space-y-2">
        {suggestions.map((s) => (
          <li key={`${s.appointmentId}:${s.entryId}`} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
            <p className="font-semibold text-slate-900">
              {s.name} <span className="font-normal text-slate-500">· {s.urgency.toLowerCase()}</span>
            </p>
            <p className="text-slate-600">
              {s.match === 'same_clinician' ? 'Asked for this clinician' : `Needs ${s.specialty}`} · waiting since{' '}
              {s.waitingSince.slice(0, 10)}
            </p>
          </li>
        ))}
      </ul>
      <Link href="/dashboard/clients/waitlist" className={cx('mt-3 inline-block rounded text-xs font-semibold text-blue-700 hover:underline', FOCUS_RING)}>
        Open waitlist
      </Link>
    </section>
  );
}
