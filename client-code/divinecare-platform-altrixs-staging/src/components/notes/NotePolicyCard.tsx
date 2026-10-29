'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Settings2 } from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import { roleLabel } from '@/lib/auth/userRoles';

type Policy = {
  deadlineHours: number;
  staleDraftDays: number;
  cloneWarnPercent: number;
  requireDiagnosisToSign: boolean;
  diagnosisReviewDays?: number;
  cosignRequiredRoles: string[];
  /** YYYY-MM-DD practice date from which missing note-format elements block signing */
  formatElementsEnforceFrom?: string;
  formatElements?: { enforced: boolean; enforceFrom: string; today: string };
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dateLabel = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return y && m && d ? `${MONTHS[m - 1]} ${d}, ${y}` : ymd;
};

/**
 * Documentation policy (administrators / directors): stale-draft days, cloned-note warning %,
 * diagnosis-to-sign rule. The sign deadline and co-sign roles live in Practice settings › Clinical.
 * Hidden for everyone who cannot edit it.
 */
export function NotePolicyCard() {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiJson<{ success: true; policy: Policy; canEdit: boolean }>('/api/notes/policy')
      .then((r) => {
        setPolicy(r.policy);
        setCanEdit(r.canEdit);
      })
      .catch(() => undefined);
  }, []);

  if (!policy || !canEdit) return null;

  const blockNow = async () => {
    if (!window.confirm('Block signing now when required note sections are missing? Clinicians will no longer be able to sign those notes.')) return;
    setSaving(true);
    setMsg(null);
    try {
      const r = await apiJson<{ success: true; policy: Policy }>('/api/notes/policy', { method: 'PUT', body: JSON.stringify({ formatElementsBlockNow: true }) });
      setPolicy(r.policy);
      setMsg('Saved: required note sections now block signing');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const r = await apiJson<{ success: true; policy: Policy }>('/api/notes/policy', {
        method: 'PUT',
        body: JSON.stringify({
          staleDraftDays: policy.staleDraftDays,
          cloneWarnPercent: policy.cloneWarnPercent,
          requireDiagnosisToSign: policy.requireDiagnosisToSign,
          diagnosisReviewDays: policy.diagnosisReviewDays ?? 90,
          ...(policy.formatElementsEnforceFrom ? { formatElementsEnforceFrom: policy.formatElementsEnforceFrom } : {}),
        }),
      });
      setPolicy(r.policy);
      setMsg('Saved');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex items-center gap-1.5 font-semibold text-slate-700">
        <Settings2 size={14} aria-hidden /> Documentation policy (practice setting)
      </button>
      {open ? (
        <div className="mt-3 space-y-3">
          <dl className="grid gap-2 text-xs text-slate-700 sm:grid-cols-2">
            <div className="rounded-lg border border-slate-100 bg-slate-50 p-2">
              <dt className="font-semibold text-slate-800">Sign deadline (practice policy)</dt>
              <dd className="mt-0.5">
                Notes are due <strong>{policy.deadlineHours} hours</strong> after the service ends; &quot;due soon&quot; in the last 24 hours. Signed later = late
                entry with a required reason. Unsigned more than 7 days past due = escalated to the clinician&apos;s supervisor (else the clinical director /
                practice director / admin).
              </dd>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50 p-2">
              <dt className="font-semibold text-slate-800">Supervisor co-signature required for</dt>
              <dd className="mt-1 flex flex-wrap gap-1">
                {policy.cosignRequiredRoles.map((r) => (
                  <span key={r} className="rounded-full border border-violet-200 bg-white px-2 py-0.5 font-semibold text-[#5C2D91]">
                    {roleLabel(r)}
                  </span>
                ))}
                <span className="rounded-full border border-violet-200 bg-white px-2 py-0.5 font-semibold text-[#5C2D91]">
                  Pre-licensed / licensure-track clinicians (always)
                </span>
              </dd>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50 p-2 sm:col-span-2">
              <dt className="font-semibold text-slate-800">Always required to sign a billable note</dt>
              <dd className="mt-0.5">
                Telehealth: the client&apos;s telehealth consent confirmed (on file or obtained today). Diagnosis: at least one chart ICD-10 diagnosis linked
                (setting below).
              </dd>
            </div>
          </dl>
          <p className="text-xs text-slate-600">
            Change the deadline and co-sign roles in{' '}
            <Link href="/dashboard/practice-setup" className="font-semibold text-[#5C2D91] hover:underline">
              Practice settings › Clinical
            </Link>
            .
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-xs font-semibold text-slate-600">
              Flag drafts untouched for (days)
              <input
                type="number"
                min={1}
                max={365}
                value={policy.staleDraftDays}
                onChange={(e) => setPolicy({ ...policy, staleDraftDays: Number(e.target.value) || 1 })}
                className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm"
              />
            </label>
            <label className="text-xs font-semibold text-slate-600">
              Cloned-note warning at (% similar)
              <input
                type="number"
                min={50}
                max={100}
                value={policy.cloneWarnPercent}
                onChange={(e) => setPolicy({ ...policy, cloneWarnPercent: Number(e.target.value) || 85 })}
                className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm"
              />
            </label>
            <label className="text-xs font-semibold text-slate-600">
              Review each client&apos;s diagnosis list every (days)
              <input
                type="number"
                min={30}
                max={365}
                value={policy.diagnosisReviewDays ?? 90}
                onChange={(e) => setPolicy({ ...policy, diagnosisReviewDays: Math.min(365, Math.max(30, Number(e.target.value) || 90)) })}
                className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm"
              />
            </label>
            <label className="flex items-start gap-2 pt-5 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={policy.requireDiagnosisToSign}
                onChange={(e) => setPolicy({ ...policy, requireDiagnosisToSign: e.target.checked })}
                className="mt-0.5 accent-[#5C2D91]"
              />
              Billable notes must link a chart ICD-10 diagnosis before signing
            </label>
          </div>
          <div className="rounded-lg border border-slate-100 bg-slate-50 p-2 text-xs text-slate-700" data-testid="format-elements-policy">
            <div className="font-semibold text-slate-800">
              Required note sections: warn until {dateLabel(policy.formatElementsEnforceFrom || policy.formatElements?.enforceFrom || '')}, then block
            </div>
            <p className="mt-0.5">
              Missing sections, SI / HI screen or functional status for the note format (SOAP, DAP, BIRP …).{' '}
              {policy.formatElements?.enforced
                ? 'Now blocking: notes missing them cannot be signed.'
                : 'Until then clinicians can sign and see the missing items as a warning in the pre-sign check.'}
            </p>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <label className="font-semibold text-slate-600">
                Block from (practice date)
                <input
                  type="date"
                  value={policy.formatElementsEnforceFrom || policy.formatElements?.enforceFrom || ''}
                  onChange={(e) => e.target.value && setPolicy({ ...policy, formatElementsEnforceFrom: e.target.value })}
                  className="mt-1 block rounded-lg border border-slate-200 p-1.5 text-sm"
                />
              </label>
              {!policy.formatElements?.enforced ? (
                <button
                  type="button"
                  onClick={() => void blockNow()}
                  disabled={saving}
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                >
                  Block now
                </button>
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void save()} disabled={saving} className="rounded-lg bg-[#5C2D91] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
              {saving ? 'Saving…' : 'Save policy'}
            </button>
            {msg ? <span className="text-xs text-slate-600">{msg}</span> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
