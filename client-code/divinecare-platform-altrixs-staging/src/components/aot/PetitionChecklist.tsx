'use client';

import React, { useState } from 'react';
import { CheckCircle2, ClipboardCheck, Save } from 'lucide-react';
import {
  PETITION_CHECKLIST,
  RESPONDENT_PLAN_OUTCOMES,
  normalizeChecklist,
  type ChecklistEntry,
  type PetitionChecklist as Checklist,
  type RespondentPlanOutcome,
} from '@/lib/aot/mdh';
import { buttonClasses } from '@/components/ui';

/**
 * MDH petition steps (AOT Resource Center) for one respondent. Saved to eligibilityData.petitionChecklist
 * through PATCH /api/aot/participants/[id]; open items flag on the caseboard at the petition / hearing stage.
 */
export default function PetitionChecklist({
  participantId,
  status,
  initial,
  onSaved,
}: {
  participantId: string;
  status: string;
  initial: Checklist;
  onSaved: (c: Checklist) => void;
}) {
  const [draft, setDraft] = useState<Checklist>(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  const update = (id: string, patch: Partial<ChecklistEntry>) =>
    setDraft((prev) => {
      const cur: ChecklistEntry = prev[id] ?? { done: false, date: null, by: null };
      return { ...prev, [id]: { ...cur, ...patch } };
    });

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/aot/participants/${encodeURIComponent(participantId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ petitionChecklist: normalizeChecklist(draft) }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) throw new Error(data?.error || `Save failed (${res.status})`);
      const saved = normalizeChecklist((data.participant?.eligibilityData as Record<string, unknown> | null)?.petitionChecklist);
      setDraft(saved);
      onSaved(saved);
      setMsg({ text: 'Checklist saved.', error: false });
    } catch (err: unknown) {
      setMsg({ text: `Not saved: ${err instanceof Error ? err.message : 'request failed'}`, error: true });
    } finally {
      setBusy(false);
    }
  };

  const openCount = PETITION_CHECKLIST.filter((s) => !normalizeChecklist(draft)[s.id]?.done).length;
  const flagged = ['petition', 'hearing'].includes(status);

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <h3 className="text-sm font-semibold text-slate-700 mb-1 flex items-center gap-2">
        <ClipboardCheck className="h-4 w-4 text-blue-600" /> Petition Checklist (MDH AOT Resource Center)
      </h3>
      <p className="text-[11px] text-slate-500 mb-3">
        {openCount === 0 ? 'All steps recorded.' : `${openCount} open.`}{' '}
        {flagged ? 'Open steps show as caseboard flags while the case is at the petition or hearing stage.' : 'Flags show at the petition and hearing stages.'}
      </p>
      <div className="space-y-2">
        {PETITION_CHECKLIST.map((spec) => {
          const e = draft[spec.id] ?? { done: false, date: null, by: null };
          const done = spec.outcome ? !!e.outcome : e.done;
          return (
            <div key={spec.id} className={`rounded-lg border p-2.5 ${done ? 'border-emerald-200 bg-emerald-50/40' : 'border-slate-200'}`}>
              <div className="flex items-start gap-2">
                {spec.outcome ? (
                  <CheckCircle2 className={`h-4 w-4 mt-0.5 shrink-0 ${done ? 'text-emerald-700' : 'text-slate-500'}`} />
                ) : (
                  <input
                    type="checkbox"
                    checked={e.done}
                    onChange={(ev) => update(spec.id, { done: ev.target.checked, date: ev.target.checked ? e.date || today : e.date })}
                    aria-label={spec.label}
                    className="mt-0.5 w-4 h-4 rounded text-blue-600 focus:ring-blue-500"
                  />
                )}
                <p className="text-xs text-slate-800 flex-1">{spec.label}</p>
              </div>
              <div className="mt-2 ml-6 grid grid-cols-1 sm:grid-cols-3 gap-2">
                {spec.outcome && (
                  <select
                    value={e.outcome ?? ''}
                    onChange={(ev) => {
                      const v = ev.target.value as RespondentPlanOutcome | '';
                      update(spec.id, { outcome: v || null, done: !!v, date: v ? e.date || today : e.date });
                    }}
                    aria-label="Respondent response"
                    className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
                  >
                    <option value="">Response…</option>
                    {RESPONDENT_PLAN_OUTCOMES.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                )}
                <input
                  type="date"
                  value={e.date ?? ''}
                  onChange={(ev) => update(spec.id, { date: ev.target.value || null })}
                  aria-label="Date"
                  className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
                />
                <input
                  value={e.by ?? ''}
                  onChange={(ev) => update(spec.id, { by: ev.target.value })}
                  placeholder="By (defaults to you when saved)"
                  aria-label="By"
                  className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs placeholder:text-slate-500"
                />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex items-center justify-end gap-3">
        {msg && <p className={`text-xs ${msg.error ? 'text-rose-600' : 'text-emerald-700'}`}>{msg.text}</p>}
        <button
          onClick={save}
          disabled={busy}
          className={buttonClasses({ size: 'sm' })}
        >
          <Save className="h-3.5 w-3.5" /> {busy ? 'Saving…' : 'Save checklist'}
        </button>
      </div>
    </div>
  );
}
