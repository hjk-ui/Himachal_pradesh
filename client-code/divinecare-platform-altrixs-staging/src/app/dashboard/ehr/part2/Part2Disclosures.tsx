'use client';

import { useCallback, useEffect, useState } from 'react';
import { Download, FileText, Plus } from 'lucide-react';
import {
  DISCLOSURE_BASES,
  DISCLOSURE_METHODS,
  disclosureBasisLabel,
  disclosureMethodLabel,
  type Part2DisclosureView,
} from '@/lib/privacy/part2DisclosureTypes';
import { buttonClasses, cardClasses, cx } from '@/components/ui';

type RosterClient = { id: string; name: string };
type ConsentOption = { id: string; label: string; part2: boolean };

const today = () => new Date().toISOString().slice(0, 10);
const yearsAgo = (n: number) => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - n);
  return d.toISOString().slice(0, 10);
};
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

const EMPTY_FORM = {
  consentFormId: '',
  consentReference: '',
  basis: 'consent',
  disclosedTo: '',
  purpose: '',
  informationDisclosed: '',
  method: 'fax',
  disclosedAt: today(),
};

/**
 * Record 42 CFR Part 2 disclosures (append-only) and run the per-client accounting of
 * disclosures. A wrong entry is corrected by recording a new one; nothing here edits or deletes.
 */
export function Part2Disclosures({ roster, informationTypes }: { roster: RosterClient[]; informationTypes: string[] }) {
  const [clientId, setClientId] = useState('');
  const [list, setList] = useState<Part2DisclosureView[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [consents, setConsents] = useState<ConsentOption[] | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [from, setFrom] = useState(yearsAgo(6));
  const [to, setTo] = useState(today());

  const loadList = useCallback(async () => {
    if (!clientId) {
      setList([]);
      return;
    }
    setListError(null);
    const res = await fetch(`/api/part2/disclosures?clientId=${encodeURIComponent(clientId)}`, { cache: 'no-store' });
    const d = (await res.json().catch(() => null)) as { success?: boolean; error?: string; disclosures?: Part2DisclosureView[] } | null;
    if (!res.ok || !d?.success) {
      setList([]);
      setListError(d?.error || 'Could not load disclosures');
      return;
    }
    setList(d.disclosures ?? []);
  }, [clientId]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    setConsents(null);
    if (!clientId) return;
    let cancelled = false;
    // Only signed, unexpired, not revoked ROI / Part 2 consents (the POST re-checks)
    fetch(`/api/consents/library/disclosure-consents?clientId=${encodeURIComponent(clientId)}`, { cache: 'no-store' })
      .then(async (r) => {
        const d = (await r.json().catch(() => null)) as { success?: boolean; consents?: ConsentOption[] } | null;
        if (!cancelled) setConsents(r.ok && d?.success ? d.consents ?? [] : []);
      })
      .catch(() => !cancelled && setConsents([]));
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  const save = async () => {
    setSaving(true);
    setFormError(null);
    try {
      const res = await fetch('/api/part2/disclosures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          ...form,
          consentFormId: form.consentFormId || null,
          consentReference: form.consentReference.trim() || null,
          disclosedAt: new Date(`${form.disclosedAt}T12:00:00`).toISOString(),
        }),
      });
      const d = (await res.json().catch(() => null)) as { success?: boolean; error?: string } | null;
      if (!res.ok || !d?.success) throw new Error(d?.error || 'Could not record the disclosure');
      setForm(EMPTY_FORM);
      setShowForm(false);
      await loadList();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Could not record the disclosure');
    } finally {
      setSaving(false);
    }
  };

  const accountingUrl = (csv: boolean) =>
    `/api/part2/disclosures/accounting?${new URLSearchParams({ clientId, from, to, ...(csv ? { format: 'csv' } : {}) })}`;

  const inputCls = 'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300';
  const labelCls = 'block text-xs font-bold text-slate-600 mb-1';
  const inRange = list.filter((d) => d.disclosedAt.slice(0, 10) >= from && d.disclosedAt.slice(0, 10) <= to);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-slate-200/80 shadow-xs p-5 space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-semibold text-slate-900">Disclosures of SUD records</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Record each release of Part 2 information. Entries are permanent (append-only) — to correct one, record a new entry
              that explains the correction.
            </p>
          </div>
          <label className="min-w-[240px]">
            <span className={labelCls}>Client</span>
            <select className={inputCls} value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">Select client…</option>
              {roster.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {clientId ? (
          <>
            {listError ? <p className="text-xs text-rose-700">{listError}</p> : null}
            {!showForm ? (
              <button
                type="button"
                onClick={() => setShowForm(true)}
                disabled={!!listError}
                className={buttonClasses({ variant: 'primary', className: 'inline-flex' })}
              >
                <Plus size={14} /> Record a disclosure
              </button>
            ) : (
              <div className="rounded-xl border border-slate-200 p-4 space-y-3">
                {formError ? <p className="text-xs font-medium text-rose-700">{formError}</p> : null}
                <div className="grid sm:grid-cols-2 gap-3">
                  <label>
                    <span className={labelCls}>Legal basis *</span>
                    <select className={inputCls} value={form.basis} onChange={(e) => setForm({ ...form, basis: e.target.value })}>
                      {DISCLOSURE_BASES.map((b) => (
                        <option key={b.value} value={b.value}>
                          {b.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span className={labelCls}>Date disclosed *</span>
                    <input type="date" max={today()} className={inputCls} value={form.disclosedAt} onChange={(e) => setForm({ ...form, disclosedAt: e.target.value })} />
                  </label>
                  {form.basis === 'consent' ? (
                    <>
                      <label>
                        <span className={labelCls}>Consent on file</span>
                        <select className={inputCls} value={form.consentFormId} onChange={(e) => setForm({ ...form, consentFormId: e.target.value })}>
                          <option value="">{consents === null ? 'Loading…' : consents.length ? 'Select consent…' : 'No valid ROI / Part 2 consent on file'}</option>
                          {(consents ?? []).map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span className={labelCls}>…or consent reference (paper form no.)</span>
                        <input className={inputCls} maxLength={200} value={form.consentReference} onChange={(e) => setForm({ ...form, consentReference: e.target.value })} />
                      </label>
                    </>
                  ) : null}
                  <label>
                    <span className={labelCls}>Disclosed to (name / organization) *</span>
                    <input className={inputCls} maxLength={300} value={form.disclosedTo} onChange={(e) => setForm({ ...form, disclosedTo: e.target.value })} />
                  </label>
                  <label>
                    <span className={labelCls}>Method *</span>
                    <select className={inputCls} value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
                      {DISCLOSURE_METHODS.map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="block">
                  <span className={labelCls}>Purpose *</span>
                  <textarea rows={2} maxLength={1000} className={`${inputCls} resize-none`} value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} />
                </label>
                <div>
                  <span className={labelCls}>Information disclosed *</span>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {informationTypes.map((t) => (
                      <button
                        key={t}
                        type="button"
                        className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 hover:bg-blue-50"
                        onClick={() =>
                          setForm((f) => ({
                            ...f,
                            informationDisclosed: f.informationDisclosed.includes(t) ? f.informationDisclosed : [f.informationDisclosed, t].filter(Boolean).join('; '),
                          }))
                        }
                      >
                        + {t}
                      </button>
                    ))}
                  </div>
                  <textarea
                    rows={2}
                    maxLength={2000}
                    className={`${inputCls} resize-none`}
                    value={form.informationDisclosed}
                    onChange={(e) => setForm({ ...form, informationDisclosed: e.target.value })}
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowForm(false);
                      setFormError(null);
                    }}
                    className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={save}
                    className={buttonClasses({ variant: 'primary' })}
                  >
                    {saving ? 'Saving…' : 'Record disclosure'}
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-slate-500">Select a client to see and record their disclosures.</p>
        )}
      </div>

      {clientId && !listError ? (
        <div className={cx(cardClasses, 'overflow-hidden')}>
          <div className="px-5 py-4 border-b border-slate-200/80 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="font-semibold text-slate-900 flex items-center gap-1.5">
                <FileText size={16} /> Accounting of disclosures
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                For a patient&apos;s request for a list of disclosures (42 CFR Part 2; HIPAA 45 CFR 164.528). Each download is audit-logged.
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-[11px] font-semibold text-slate-500">
                From
                <input type="date" className="block rounded-lg border border-slate-200 px-2 py-1 text-xs" value={from} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label className="text-[11px] font-semibold text-slate-500">
                To
                <input type="date" className="block rounded-lg border border-slate-200 px-2 py-1 text-xs" value={to} onChange={(e) => setTo(e.target.value)} />
              </label>
              <a href={accountingUrl(true)} className="clinic-btn-secondary inline-flex items-center gap-1.5 text-xs">
                <Download size={13} /> Download CSV
              </a>
            </div>
          </div>
          {inRange.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-slate-500">No disclosures recorded for this client in this period.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 font-semibold uppercase text-slate-600">
                    <th scope="col" className="px-4 py-2">Date</th>
                    <th scope="col" className="px-4 py-2">Disclosed to</th>
                    <th scope="col" className="px-4 py-2">Purpose</th>
                    <th scope="col" className="px-4 py-2">Information</th>
                    <th scope="col" className="px-4 py-2">Basis</th>
                    <th scope="col" className="px-4 py-2">Method</th>
                    <th scope="col" className="px-4 py-2">Recorded by</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {inRange.map((d) => (
                    <tr key={d.id} className="align-top">
                      <td className="whitespace-nowrap px-4 py-2">{fmtDay(d.disclosedAt)}</td>
                      <td className="px-4 py-2 font-medium text-slate-800">{d.disclosedTo}</td>
                      <td className="px-4 py-2">{d.purpose}</td>
                      <td className="px-4 py-2">{d.informationDisclosed}</td>
                      <td className="px-4 py-2">
                        {disclosureBasisLabel(d.basis)}
                        {d.consentReference ? <span className="block text-slate-500">Ref: {d.consentReference}</span> : null}
                        {d.consentFormId ? <span className="block text-slate-500">Consent on file</span> : null}
                      </td>
                      <td className="px-4 py-2">{disclosureMethodLabel(d.method)}</td>
                      <td className="px-4 py-2">
                        {d.disclosedByName || '—'}
                        <span className="block text-slate-500">{fmtDay(d.createdAt)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
