'use client';

import { useEffect, useState } from 'react';
import {
  DIAGNOSIS_REVIEW_DAYS_MAX,
  DIAGNOSIS_REVIEW_DAYS_MIN,
  DEFAULT_NOTES_POLICY,
  requiredNoteSectionsNotice,
  type NotesPolicy,
} from '@/lib/notes/notes-policy';

/** Documentation policy — rendered only for leadership roles (the API enforces the same rule). */
export function DocumentationPolicyPanel() {
  const [policy, setPolicy] = useState<NotesPolicy>(DEFAULT_NOTES_POLICY);
  const [canEdit, setCanEdit] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void fetch('/api/practice/notes-policy')
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          setPolicy(d.policy);
          setCanEdit(Boolean(d.canEdit));
        }
      })
      .catch(() => undefined);
  }, []);

  if (!canEdit) return null;

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/practice/notes-policy', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(policy),
      });
      const d = await res.json();
      if (!res.ok || !d.success) throw new Error(d.error || 'Could not save policy');
      setPolicy(d.policy);
      setMessage('Policy saved');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not save policy');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-label="Documentation policy" className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="text-base font-semibold text-slate-900">Documentation policy</h3>
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={policy.requireDiagnosisToSign}
          onChange={(e) => setPolicy({ ...policy, requireDiagnosisToSign: e.target.checked })}
        />
        Require a diagnosis to sign a note
      </label>
      <label className="mt-3 block text-sm">
        Diagnosis review every (days)
        <input
          type="number"
          min={DIAGNOSIS_REVIEW_DAYS_MIN}
          max={DIAGNOSIS_REVIEW_DAYS_MAX}
          value={policy.diagnosisReviewDays}
          onChange={(e) => setPolicy({ ...policy, diagnosisReviewDays: Number(e.target.value) })}
          className="ml-2 w-24 rounded border border-slate-300 px-2 py-1"
        />
        <span className="ml-2 text-xs text-slate-500">
          {DIAGNOSIS_REVIEW_DAYS_MIN}–{DIAGNOSIS_REVIEW_DAYS_MAX}
        </span>
      </label>
      <p className="mt-3 text-sm text-slate-600">{requiredNoteSectionsNotice()}</p>
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          Save policy
        </button>
        {message && <span className="text-sm text-slate-600">{message}</span>}
      </div>
    </section>
  );
}

export default DocumentationPolicyPanel;
