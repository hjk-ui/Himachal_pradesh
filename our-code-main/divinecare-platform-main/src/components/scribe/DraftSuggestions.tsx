'use client';

import { useState } from 'react';
import type { DraftGroups } from '@/lib/scribe-feedback/draftGroups';
import { assignMeasuresLabel } from '@/lib/scribe-feedback/spokenMeasures';
import { INSERT_SUGGESTION_LABEL, INSERTED_LABEL } from '@/lib/scribe-feedback/withheld';

type Props = {
  groups: DraftGroups;
  /** heading ids already inserted into the note */
  insertedIds: string[];
  onInsert: (id: string) => void;
  /** Assign the spoken measures; dueDate is `YYYY-MM-DD` chosen by the clinician (required) */
  onAssignMeasures?: (keys: string[], dueDate: string) => Promise<void> | void;
  readOnly?: boolean;
  className?: string;
};

export function DraftSuggestions({
  groups,
  insertedIds,
  onInsert,
  onAssignMeasures,
  readOnly = false,
  className = '',
}: Props) {
  const [dueDate, setDueDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [assigned, setAssigned] = useState(false);

  if (groups.total === 0) return null;

  const assign = async () => {
    if (!onAssignMeasures || !dueDate) return;
    setBusy(true);
    try {
      await onAssignMeasures(
        groups.measures.map((m) => m.key),
        dueDate
      );
      setAssigned(true);
    } catch {
      // The caller reports the failure; leave the CTA enabled so it can be retried.
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`space-y-4 ${className}`} data-testid="draft-suggestions">
      {groups.withheld.length > 0 && groups.withheldHeader ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-900">{groups.withheldHeader}</h3>
          <ul className="mt-3 space-y-3">
            {groups.withheld.map((s) => {
              const inserted = insertedIds.includes(s.id);
              return (
                <li key={s.id} className="rounded-lg bg-slate-50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-600">{s.heading}</p>
                    <button
                      type="button"
                      disabled={inserted || readOnly}
                      onClick={() => onInsert(s.id)}
                      className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-default disabled:opacity-60"
                    >
                      {inserted ? INSERTED_LABEL : INSERT_SUGGESTION_LABEL}
                    </button>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{s.text}</p>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {groups.measures.length > 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <ul className="flex flex-wrap gap-1.5">
            {groups.measures.map((m) => (
              <li
                key={m.key}
                className="rounded-md bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-800 ring-1 ring-slate-200"
              >
                {m.name}
              </li>
            ))}
          </ul>
          {onAssignMeasures && !readOnly ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <label className="text-xs font-medium text-slate-600" htmlFor="draft-measures-due">
                Due date
              </label>
              <input
                id="draft-measures-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="h-10 rounded-lg border border-slate-300 px-3 text-sm"
              />
              <button
                type="button"
                disabled={!dueDate || busy || assigned}
                onClick={() => void assign()}
                className="min-h-11 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {assigned ? 'Assigned' : assignMeasuresLabel(groups.measures.length, dueDate || null)}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
