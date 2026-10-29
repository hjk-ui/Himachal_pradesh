'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Settings2 } from 'lucide-react';
import { apiJson } from '@/lib/api-client';

type Settings = {
  enabled: boolean;
  chargeCopays: boolean;
  chargeAfterEra: boolean;
  chargeSelfPay: boolean;
  chargeMissedVisitFees: boolean;
  maxPerChargeCents: number | null;
  maxPerMonthCents: number | null;
  statementDescriptorSuffix: string | null;
  receiptSenderName: string | null;
  stripeAccountId: string | null;
};
export type PatientPaymentsStatus = {
  success: boolean;
  settings: Settings;
  configured: boolean;
  mode: 'test' | 'live' | null;
  configProblem: string | null;
  webhookConfigured: boolean;
  env: { name: string; set: boolean; purpose: string }[];
  authorizationTemplateReady: boolean;
  authorizationTemplateReason: string | null;
  canEdit: boolean;
};

const dollars = (c: number | null) => (c == null ? '' : (c / 100).toFixed(2));
const toCents = (s: string) => {
  const v = s.replace(/[$,\s]/g, '');
  if (!v) return null;
  const n = Math.round(Number(v) * 100);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Patient payments status + practice settings (master switch default OFF; leadership edits). */
export function AutopaySettingsPanel({ status, onChanged }: { status: PatientPaymentsStatus | null; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Settings | null>(null);
  const [perCharge, setPerCharge] = useState('');
  const [perMonth, setPerMonth] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!status) return;
    setForm(status.settings);
    setPerCharge(dollars(status.settings.maxPerChargeCents));
    setPerMonth(dollars(status.settings.maxPerMonthCents));
  }, [status]);

  if (!status || !form) return null;
  const s = status.settings;
  const live = s.enabled && status.configured;

  const save = async (patch: Partial<Settings>) => {
    setSaving(true);
    setError('');
    try {
      await apiJson('/api/billing/autopay/settings', { method: 'PUT', body: JSON.stringify(patch) });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const toggleMaster = () => {
    const next = !s.enabled;
    if (next && !window.confirm(`Turn ON automatic patient card charges${status.mode === 'test' ? ' (Stripe TEST mode)' : ''}? Opted-in clients with a signed Card-on-File Authorization will be charged after visits and after insurance processes claims.`)) return;
    if (!next && !window.confirm('Turn OFF automatic patient card charges? No card capture and no charges until it is turned back on.')) return;
    void save({ enabled: next });
  };

  return (
    <section className={`rounded-xl border px-4 py-3 shadow-xs ${live ? 'border-emerald-200 bg-emerald-50/60' : 'border-blue-200 bg-blue-50'}`} aria-label="Patient payments status">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1 text-sm">
          <p className="flex flex-wrap items-center gap-2 font-semibold text-slate-900">
            {live ? <CheckCircle2 size={16} className="text-emerald-700" aria-hidden /> : <AlertTriangle size={16} className="text-blue-700" aria-hidden />}
            Automatic card charges are {s.enabled ? 'ON' : 'OFF'}
            {status.mode ? (
              <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${status.mode === 'test' ? 'bg-amber-100 text-amber-900' : 'bg-emerald-100 text-emerald-800'}`}>
                STRIPE {status.mode.toUpperCase()}
              </span>
            ) : null}
          </p>
          {status.configProblem ? <p className="text-slate-700">{status.configProblem}</p> : null}
          {status.configured && !status.webhookConfigured ? <p className="text-rose-700">The patient payments webhook secret is not set: paid charges cannot post to the ledger.</p> : null}
          {!status.authorizationTemplateReady ? (
            <p className="text-slate-700">
              Card authorization form needs approval in Consents
              {status.authorizationTemplateReason ? ` (${status.authorizationTemplateReason})` : ''}.{' '}
              <Link href="/dashboard/ehr/consents/library" className="font-semibold text-blue-700 hover:underline">Consent library</Link>
            </p>
          ) : null}
          <p className="text-xs text-slate-600">
            Only clients with a saved card and a signed Card-on-File Authorization are charged, and only for the amount types they checked. Medicaid clients are never charged.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {status.canEdit ? (
            <button type="button" onClick={toggleMaster} disabled={saving} className={`rounded-lg px-3 py-2 text-xs font-semibold ${s.enabled ? 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50' : 'bg-blue-600 text-white hover:bg-blue-700'} disabled:opacity-50`}>
              {s.enabled ? 'Turn off' : 'Turn on'}
            </button>
          ) : null}
          <button type="button" onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50" aria-expanded={open}>
            <Settings2 size={13} aria-hidden /> Settings
          </button>
        </div>
      </div>
      {error ? <p role="alert" className="mt-2 text-sm text-rose-700">{error}</p> : null}
      {open ? (
        <div className="mt-3 grid gap-4 border-t border-slate-200 pt-3 md:grid-cols-2">
          <fieldset className="space-y-2 text-sm" disabled={!status.canEdit || saving}>
            <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">What AutoPay charges</legend>
            {([
              ['chargeCopays', 'Copay right after a completed visit'],
              ['chargeAfterEra', 'Coinsurance / deductible after insurance (ERA posted)'],
              ['chargeSelfPay', 'Self-pay visit fee after the visit'],
              ['chargeMissedVisitFees', 'Missed-visit fees (also needs the no-show / late-cancel fee policy)'],
            ] as const).map(([k, label]) => (
              <label key={k} className="flex items-center gap-2">
                <input type="checkbox" checked={Boolean(form[k])} onChange={(e) => setForm({ ...form, [k]: e.target.checked })} /> {label}
              </label>
            ))}
          </fieldset>
          <fieldset className="space-y-2 text-sm" disabled={!status.canEdit || saving}>
            <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Limits and wording</legend>
            <label className="block">Maximum per charge ($, blank = none; above it billing reviews)
              <input value={perCharge} onChange={(e) => setPerCharge(e.target.value)} inputMode="decimal" className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5" />
            </label>
            <label className="block">Maximum per client per month ($)
              <input value={perMonth} onChange={(e) => setPerMonth(e.target.value)} inputMode="decimal" className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5" />
            </label>
            <label className="block">Card statement suffix (A-Z / 0-9, no service words)
              <input value={form.statementDescriptorSuffix ?? ''} maxLength={10} onChange={(e) => setForm({ ...form, statementDescriptorSuffix: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5" />
            </label>
            <label className="block">Receipt sender line (blank = &quot;Your care team&quot;)
              <input value={form.receiptSenderName ?? ''} maxLength={60} onChange={(e) => setForm({ ...form, receiptSenderName: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5" />
            </label>
          </fieldset>
          <div className="md:col-span-2">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Server configuration (values are never shown)</p>
            <ul className="grid gap-1 text-xs sm:grid-cols-2">
              {status.env.map((e) => (
                <li key={e.name} className="flex items-start gap-1.5">
                  <span className={`mt-0.5 rounded px-1 font-semibold ${e.set ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'}`}>{e.set ? 'set' : 'not set'}</span>
                  <span><code className="font-mono">{e.name}</code>: {e.purpose}</span>
                </li>
              ))}
            </ul>
          </div>
          {status.canEdit ? (
            <div className="flex justify-end md:col-span-2">
              <button
                type="button"
                disabled={saving}
                onClick={() =>
                  void save({
                    chargeCopays: form.chargeCopays,
                    chargeAfterEra: form.chargeAfterEra,
                    chargeSelfPay: form.chargeSelfPay,
                    chargeMissedVisitFees: form.chargeMissedVisitFees,
                    maxPerChargeCents: toCents(perCharge),
                    maxPerMonthCents: toCents(perMonth),
                    statementDescriptorSuffix: form.statementDescriptorSuffix?.trim() || null,
                    receiptSenderName: form.receiptSenderName?.trim() || null,
                  })
                }
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? <Loader2 size={13} className="animate-spin" aria-hidden /> : null} Save settings
              </button>
            </div>
          ) : (
            <p className="text-xs text-slate-500 md:col-span-2">Practice leadership (Admin, Practice Director) changes these settings.</p>
          )}
        </div>
      ) : null}
    </section>
  );
}
