'use client';

import { useEffect, useState } from 'react';
import { BadgeCheck, Building2, Loader2, Route } from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import { useValantReferences, ValantEdiCell } from './ValantEdiReference';
import { STICKY_ACTIONS_TD, STICKY_ACTIONS_TH } from '@/features/billing/tableLayout';

type PayerMapping = {
  id: string;
  scope: 'global' | 'organization';
  payerName: string;
  aliases: string[];
  waystarPayerId: string;
  claimFilingCode: string;
  telehealthModifier: string;
  requiresPriorAuth: boolean;
  superviseeClaims?: string | null;
  requireTaxonomy?: boolean | null;
  audioOnlyModifier?: string | null;
  filingLimitDays?: number | null;
  verified: boolean;
  active: boolean;
  notes: string | null;
};

type BillingProvider = {
  id: string;
  scope: 'global' | 'organization';
  npi: string;
  name: string;
  label?: string | null;
  taxId: string;
  address1: string;
  address2?: string;
  city: string;
  state: string;
  zip: string;
  phone?: string;
  taxonomyCode?: string | null;
  departments: string[];
  clinicianRoles: string[];
  locationKeys: string[];
  isDefault: boolean;
  active: boolean;
  problems: string[];
};

export const FILING_OPTIONS: Array<[string, string]> = [
  ['MC', 'MC · Medicaid'],
  ['MB', 'MB · Medicare Part B'],
  ['BL', 'BL · Blue Cross / Blue Shield'],
  ['CI', 'CI · Commercial'],
  ['HM', 'HM · HMO'],
  ['CH', 'CH · Tricare'],
  ['VA', 'VA · Veterans Affairs'],
  ['WC', 'WC · Workers comp'],
  ['ZZ', 'ZZ · Mutually defined'],
];

const list = (v: string) => v.split(',').map((x) => x.trim()).filter(Boolean);

function errorText(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

/** Live Waystar configuration: payer IDs (billing admins) and billing providers / NPIs (practice admins). */
export function WaystarSettingsPanels() {
  return (
    <div className="space-y-5">
      <PayerMappingPanel />
      <BillingProviderPanel />
      <RenderingProviderPanel />
    </div>
  );
}

// ─── Waystar payer IDs ───────────────────────────────────────────────────────

/** '' = payer default by insurance type (Medicare: supervisees not allowed, audio-only 93; Medicaid: taxonomy required) */
const BLANK_MAPPING = {
  payerName: '', aliases: '', waystarPayerId: '', claimFilingCode: 'CI', telehealthModifier: '95', requiresPriorAuth: false, verified: false, active: true, notes: '',
  superviseeClaims: '', requireTaxonomy: '', audioOnlyModifier: '', filingLimitDays: '',
};

export function PayerMappingPanel() {
  const [rows, setRows] = useState<PayerMapping[] | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [form, setForm] = useState(BLANK_MAPPING);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const valantRefs = useValantReferences(rows);

  useEffect(() => {
    apiJson<{ mappings: PayerMapping[]; canEdit: boolean }>('/api/billing/claims/payer-mappings')
      .then((d) => { setRows(d.mappings); setCanEdit(d.canEdit); })
      .catch((error) => { setRows([]); setMessage({ tone: 'error', text: errorText(error, 'Could not load the payer mapping') }); });
  }, []);

  function edit(m: PayerMapping) {
    setForm({
      ...m,
      aliases: m.aliases.join(', '),
      notes: m.notes ?? '',
      superviseeClaims: m.superviseeClaims ?? '',
      requireTaxonomy: m.requireTaxonomy == null ? '' : m.requireTaxonomy ? 'yes' : 'no',
      audioOnlyModifier: m.audioOnlyModifier ?? '',
      filingLimitDays: m.filingLimitDays != null ? String(m.filingLimitDays) : '',
    });
    setMessage(null);
  }

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const d = await apiJson<{ mappings: PayerMapping[] }>('/api/billing/claims/payer-mappings', {
        method: 'PUT',
        body: JSON.stringify({
          ...form,
          aliases: list(form.aliases),
          notes: form.notes || null,
          superviseeClaims: form.superviseeClaims || undefined,
          requireTaxonomy: form.requireTaxonomy === '' ? undefined : form.requireTaxonomy === 'yes',
          audioOnlyModifier: form.audioOnlyModifier || undefined,
          filingLimitDays: form.filingLimitDays === '' ? null : Number(form.filingLimitDays),
        }),
      });
      setRows(d.mappings);
      setForm(BLANK_MAPPING);
      setMessage({ tone: 'ok', text: 'Payer mapping saved. New and unsent claims for this payer pick up the ID.' });
    } catch (error) {
      setMessage({ tone: 'error', text: errorText(error, 'Could not save') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-purple-200 bg-white">
      <div className="flex items-start gap-3 border-b border-purple-100 p-4">
        <Route className="mt-0.5 h-5 w-5 shrink-0 text-purple-700" />
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-gray-900">Waystar payer IDs</h2>
          <p className="text-xs text-gray-500">
            Claims get their Waystar payer ID and insurance type from the client&apos;s payer name (exact name or alias). Unmapped payers are blocked at the pre-send check.
            Only enter IDs confirmed on Waystar&apos;s payer list; unverified IDs can be sent to the Waystar test account only.
          </p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-xs">
          <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
            <tr><th className="px-4 py-2">Payer / aliases</th><th className="px-4 py-2">Waystar ID</th><th className="px-4 py-2">Valant EDI ID (reference)</th><th className="px-4 py-2">Type</th><th className="px-4 py-2">Telehealth</th><th className="px-4 py-2">Status</th><th className={`px-4 py-2 ${STICKY_ACTIONS_TH}`}><span className="sr-only">Actions</span></th></tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows == null ? (
              <tr><td colSpan={7} className="px-4 py-4 text-gray-500"><Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" /> Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-4 text-gray-500">No payers mapped yet.</td></tr>
            ) : rows.map((m) => (
              <tr key={m.id} className={m.active ? '' : 'opacity-50'}>
                <td className="px-4 py-2"><p className="font-semibold text-gray-900">{m.payerName}</p>{m.aliases.length ? <p className="text-gray-500">{m.aliases.join(', ')}</p> : null}{m.notes ? <p className="text-[11px] text-gray-400">{m.notes}</p> : null}</td>
                <td className="px-4 py-2 font-mono font-bold">{m.waystarPayerId}</td>
                <ValantEdiCell reference={valantRefs?.get(m.id)} />
                <td className="px-4 py-2">{m.claimFilingCode}{m.requiresPriorAuth ? <span className="ml-1 rounded bg-amber-50 px-1 text-amber-800">auth</span> : null}</td>
                <td className="px-4 py-2">{m.telehealthModifier === 'none' ? 'POS only' : m.telehealthModifier === 'both' ? 'GT + 95' : m.telehealthModifier}</td>
                <td className="px-4 py-2">
                  {m.verified ? <span className="inline-flex items-center gap-1 text-emerald-700"><BadgeCheck className="h-3.5 w-3.5" /> Verified</span> : <span className="text-amber-700">Unverified</span>}
                  {!m.active ? <span className="ml-1 text-gray-500">(off)</span> : null}
                  {m.scope === 'global' ? <span className="ml-1 text-gray-400">default</span> : null}
                </td>
                <td className={`px-4 py-2 text-right ${STICKY_ACTIONS_TD}`}>{canEdit ? <button type="button" onClick={() => edit(m)} className="inline-flex min-h-10 items-center px-1 font-semibold text-purple-700 sm:min-h-0">Edit</button> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canEdit ? (
        <div className="grid gap-2 border-t border-gray-100 p-4 text-xs sm:grid-cols-3">
          <label>Payer name<input value={form.payerName} onChange={(e) => setForm({ ...form, payerName: e.target.value })} className="mt-1 block min-h-10 w-full rounded border p-1.5 sm:min-h-0" placeholder="As on the client record" /></label>
          <label className="sm:col-span-2">Aliases (comma separated)<input value={form.aliases} onChange={(e) => setForm({ ...form, aliases: e.target.value })} className="mt-1 block min-h-10 w-full rounded border p-1.5 sm:min-h-0" /></label>
          <label>Waystar payer ID<input value={form.waystarPayerId} onChange={(e) => setForm({ ...form, waystarPayerId: e.target.value.toUpperCase() })} className="mt-1 block min-h-10 w-full rounded border p-1.5 sm:min-h-0 font-mono" /></label>
          <label>Insurance type (SBR09)<select value={form.claimFilingCode} onChange={(e) => setForm({ ...form, claimFilingCode: e.target.value })} className="mt-1 block min-h-10 w-full rounded border p-1.5 sm:min-h-0">{FILING_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label>Telehealth modifier<select value={form.telehealthModifier} onChange={(e) => setForm({ ...form, telehealthModifier: e.target.value })} className="mt-1 block min-h-10 w-full rounded border p-1.5 sm:min-h-0"><option value="95">95</option><option value="GT">GT</option><option value="both">GT and 95</option><option value="none">None (POS 02/10 only)</option></select></label>
          <label>Supervised (pre-licensed) clinicians<select value={form.superviseeClaims} onChange={(e) => setForm({ ...form, superviseeClaims: e.target.value })} className="mt-1 block min-h-10 w-full rounded border p-1.5 sm:min-h-0"><option value="">Payer default (Medicare: not allowed; others: supervisee + 2310D)</option><option value="supervisee_with_2310D">Bill supervisee, supervisor in 2310D</option><option value="render_as_supervisor">Bill under the supervisor</option><option value="not_allowed">Not allowed (block)</option></select></label>
          <label>Audio-only telehealth<select value={form.audioOnlyModifier} onChange={(e) => setForm({ ...form, audioOnlyModifier: e.target.value })} className="mt-1 block min-h-10 w-full rounded border p-1.5 sm:min-h-0"><option value="">Payer default (Medicare 93; others blocked)</option><option value="93">Modifier 93</option><option value="FQ">Modifier FQ</option><option value="none">Allowed, no modifier</option><option value="not_allowed">Not allowed (block)</option></select></label>
          <label>Taxonomy (PRV) on claims<select value={form.requireTaxonomy} onChange={(e) => setForm({ ...form, requireTaxonomy: e.target.value })} className="mt-1 block min-h-10 w-full rounded border p-1.5 sm:min-h-0"><option value="">Payer default (Medicaid: required)</option><option value="yes">Required (block when missing)</option><option value="no">Optional (warn when missing)</option></select></label>
          <label>Timely filing limit (days from DOS; verify contract)<input value={form.filingLimitDays} onChange={(e) => setForm({ ...form, filingLimitDays: e.target.value.replace(/\D/g, '') })} className="mt-1 block min-h-10 w-full rounded border p-1.5 sm:min-h-0" placeholder="e.g. 365" /></label>
          <label className="sm:col-span-3">Notes<input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="mt-1 block min-h-10 w-full rounded border p-1.5 sm:min-h-0" /></label>
          <div className="flex flex-wrap items-center gap-4 sm:col-span-3">
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={form.verified} onChange={(e) => setForm({ ...form, verified: e.target.checked })} /> Confirmed on Waystar&apos;s payer list</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={form.requiresPriorAuth} onChange={(e) => setForm({ ...form, requiresPriorAuth: e.target.checked })} /> Requires prior auth</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Active</label>
            <button type="button" disabled={busy || !form.payerName || !form.waystarPayerId} onClick={() => void save()} className="min-h-10 rounded-lg bg-purple-700 px-3 py-1.5 font-semibold sm:min-h-0 text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save payer'}</button>
            <button type="button" onClick={() => setForm(BLANK_MAPPING)} className="font-semibold text-gray-600">Clear</button>
          </div>
        </div>
      ) : null}
      {message ? <p role="status" className={`px-4 pb-3 text-xs ${message.tone === 'ok' ? 'text-emerald-700' : 'text-rose-700'}`}>{message.text}</p> : null}
    </section>
  );
}

// ─── Billing providers (2010AA) ──────────────────────────────────────────────

type ProviderForm = {
  npi: string; name: string; label: string; taxId: string; address1: string; address2: string; city: string; state: string; zip: string; phone: string;
  taxonomyCode: string; departments: string; clinicianRoles: string; locationKeys: string; isDefault: boolean; active: boolean;
};

const BLANK_PROVIDER: ProviderForm = {
  npi: '', name: '', label: '', taxId: '', address1: '', address2: '', city: '', state: 'MD', zip: '', phone: '',
  taxonomyCode: '', departments: '', clinicianRoles: '', locationKeys: '', isDefault: false, active: true,
};

export function BillingProviderPanel() {
  const [rows, setRows] = useState<BillingProvider[] | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [form, setForm] = useState<ProviderForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    apiJson<{ providers: BillingProvider[]; canEdit: boolean }>('/api/billing/claims/billing-providers')
      .then((d) => { setRows(d.providers); setCanEdit(d.canEdit); })
      .catch((error) => { setRows([]); setMessage({ tone: 'error', text: errorText(error, 'Could not load billing providers') }); });
  }, []);

  function edit(p: BillingProvider) {
    setForm({
      npi: p.npi, name: p.name, label: p.label ?? '', taxId: p.taxId, address1: p.address1, address2: p.address2 ?? '', city: p.city, state: p.state,
      zip: p.zip, phone: p.phone ?? '', taxonomyCode: p.taxonomyCode ?? '', departments: p.departments.join(', '), clinicianRoles: p.clinicianRoles.join(', '),
      locationKeys: p.locationKeys.join(', '), isDefault: p.isDefault, active: p.active,
    });
    setMessage(null);
  }

  async function save() {
    if (!form) return;
    setBusy(true);
    setMessage(null);
    try {
      const d = await apiJson<{ providers: BillingProvider[] }>('/api/billing/claims/billing-providers', {
        method: 'PUT',
        body: JSON.stringify({
          ...form,
          label: form.label || null,
          address2: form.address2 || null,
          phone: form.phone || null,
          taxonomyCode: form.taxonomyCode.trim().toUpperCase() || null,
          departments: list(form.departments),
          clinicianRoles: list(form.clinicianRoles),
          locationKeys: list(form.locationKeys),
        }),
      });
      setRows(d.providers);
      setForm(null);
      setMessage({ tone: 'ok', text: 'Billing provider saved.' });
    } catch (error) {
      setMessage({ tone: 'error', text: errorText(error, 'Could not save') });
    } finally {
      setBusy(false);
    }
  }

  const field = (key: keyof ProviderForm, label: string, extra = '') => (
    <label className={extra}>{label}<input value={String(form?.[key] ?? '')} onChange={(e) => setForm((f) => (f ? { ...f, [key]: e.target.value } : f))} className="mt-1 block min-h-10 w-full rounded border p-1.5 sm:min-h-0" /></label>
  );

  return (
    <section className="rounded-xl border border-gray-200 bg-white">
      <div className="flex items-start gap-3 border-b border-gray-100 p-4">
        <Building2 className="mt-0.5 h-5 w-5 shrink-0 text-purple-700" />
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-gray-900">Billing providers (NPIs on Waystar claims)</h2>
          <p className="text-xs text-gray-500">
            Each claim is billed under one of these organization NPIs (837P loop 2010AA). Order of selection: the billing provider set on the claim, then department,
            then the rendering clinician&apos;s role, narrowed by client location, then the default. One Waystar file can carry claims for every NPI.
          </p>
        </div>
      </div>
      <div className="divide-y divide-gray-100">
        {rows == null ? <p className="px-4 py-4 text-xs text-gray-500"><Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" /> Loading…</p> : null}
        {rows?.map((p) => (
          <div key={p.id} className={`flex flex-wrap items-start justify-between gap-3 px-4 py-3 text-xs ${p.active ? '' : 'opacity-50'}`}>
            <div className="min-w-0 flex-1 break-words">
              <p className="font-semibold text-gray-900">{p.label || p.name} <span className="font-mono text-gray-600">NPI {p.npi}</span>{p.isDefault ? <span className="ml-1 rounded bg-purple-50 px-1.5 text-purple-700">default</span> : null}</p>
              <p className="text-gray-600">{p.name} · TIN {p.taxId} · {p.address1}{p.address2 ? ` ${p.address2}` : ''}, {p.city} {p.state} {p.zip}</p>
              <p className="text-gray-500">
                Departments: {p.departments.join(', ') || '—'} · Clinician roles: {p.clinicianRoles.join(', ') || '—'} · Locations: {p.locationKeys.join(', ') || '—'}
              </p>
              {p.problems.length ? <p className="text-rose-700">{p.problems.join('; ')}</p> : null}
            </div>
            {canEdit ? <button type="button" onClick={() => edit(p)} className="inline-flex min-h-10 items-center px-1 font-semibold text-purple-700 sm:min-h-0">Edit</button> : null}
          </div>
        ))}
      </div>
      {canEdit ? (
        form ? (
          <div className="grid gap-2 border-t border-gray-100 p-4 text-xs sm:grid-cols-3">
            {field('npi', 'NPI')}
            {field('name', 'Organization name (as on NPPES)', 'sm:col-span-2')}
            {field('label', 'Label')}
            {field('taxId', 'Tax ID (EIN)')}
            {field('phone', 'Phone')}
            {field('address1', 'Street (no PO box)')}
            {field('address2', 'Suite')}
            {field('city', 'City')}
            {field('state', 'State')}
            {field('zip', 'ZIP+4 (9 digits)')}
            {field('taxonomyCode', 'Taxonomy (NUCC, e.g. 261QM0801X; blank = practice settings)')}
            {field('departments', 'Departments (comma separated)')}
            {field('clinicianRoles', 'Clinician roles (e.g. PSYCHIATRIST, NP)')}
            {field('locationKeys', 'Client locations (id, code or name)')}
            <div className="flex flex-wrap items-center gap-4 sm:col-span-3">
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={form.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} /> Default</label>
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Active</label>
              <button type="button" disabled={busy} onClick={() => void save()} className="min-h-10 rounded-lg bg-purple-700 px-3 py-1.5 font-semibold sm:min-h-0 text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save billing provider'}</button>
              <button type="button" onClick={() => setForm(null)} className="font-semibold text-gray-600">Cancel</button>
            </div>
          </div>
        ) : (
          <div className="border-t border-gray-100 p-4">
            <button type="button" onClick={() => setForm(BLANK_PROVIDER)} className="text-xs font-semibold text-purple-700">Add billing provider</button>
          </div>
        )
      ) : null}
      {message ? <p role="status" className={`px-4 pb-3 text-xs ${message.tone === 'ok' ? 'text-emerald-700' : 'text-rose-700'}`}>{message.text}</p> : null}
    </section>
  );
}

// ─── Rendering providers (2310B legal names / taxonomy) ─────────────────────

type StaffRow = {
  id: string; name: string | null; role: string; npi: string | null;
  legalFirstName: string | null; legalLastName: string | null; credentials: string | null; taxonomyCode: string | null; problems: string[];
};

/** Clinicians as billed on claims: NM1 uses the legal name here (never the display name), PRV*PE the taxonomy. */
export function RenderingProviderPanel() {
  const [rows, setRows] = useState<StaffRow[] | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [editing, setEditing] = useState<{ userId: string; legalFirstName: string; legalLastName: string; credentials: string; taxonomyCode: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    apiJson<{ staff: StaffRow[]; canEdit: boolean }>('/api/billing/claims/rendering-providers')
      .then((d) => { setRows(d.staff); setCanEdit(d.canEdit); })
      .catch((error) => { setRows([]); setMessage({ tone: 'error', text: errorText(error, 'Could not load rendering providers') }); });
  }, []);

  async function save() {
    if (!editing) return;
    setBusy(true);
    setMessage(null);
    try {
      const d = await apiJson<{ staff: StaffRow[] }>('/api/billing/claims/rendering-providers', {
        method: 'PUT',
        body: JSON.stringify({
          userId: editing.userId,
          legalFirstName: editing.legalFirstName.trim() || null,
          legalLastName: editing.legalLastName.trim() || null,
          credentials: editing.credentials.trim() || null,
          taxonomyCode: editing.taxonomyCode.trim().toUpperCase() || null,
        }),
      });
      setRows(d.staff);
      setEditing(null);
      setMessage({ tone: 'ok', text: 'Rendering provider saved.' });
    } catch (error) {
      setMessage({ tone: 'error', text: errorText(error, 'Could not save') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white">
      <div className="flex items-start gap-3 border-b border-gray-100 p-4">
        <BadgeCheck className="mt-0.5 h-5 w-5 shrink-0 text-purple-700" />
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-gray-900">Rendering providers (legal name and taxonomy on claims)</h2>
          <p className="text-xs text-gray-500">
            Claims name the clinician who signed the note (837P 2310B) by the legal name entered here, exactly as enrolled with NPPES and the payers, with their NUCC
            taxonomy (PRV). Claims for a clinician with a missing legal name are blocked; missing taxonomy blocks Medicaid / PBHS claims.
          </p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-xs">
          <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
            <tr><th className="px-4 py-2">Staff</th><th className="px-4 py-2">NPI</th><th className="px-4 py-2">Legal name</th><th className="px-4 py-2">Credentials</th><th className="px-4 py-2">Taxonomy</th><th className={`px-4 py-2 ${STICKY_ACTIONS_TH}`}><span className="sr-only">Actions</span></th></tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows == null ? (
              <tr><td colSpan={6} className="px-4 py-4 text-gray-500"><Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" /> Loading…</td></tr>
            ) : rows.map((u) => (
              <tr key={u.id}>
                <td className="px-4 py-2"><p className="font-semibold text-gray-900">{u.name || u.id}</p><p className="text-gray-500">{u.role}</p>{u.problems.length ? <p className="text-rose-700">{u.problems.join('; ')}</p> : null}</td>
                <td className="px-4 py-2 font-mono">{u.npi || '—'}</td>
                <td className="px-4 py-2">{[u.legalFirstName, u.legalLastName].filter(Boolean).join(' ') || '—'}</td>
                <td className="px-4 py-2">{u.credentials || '—'}</td>
                <td className="px-4 py-2 font-mono">{u.taxonomyCode || '—'}</td>
                <td className={`px-4 py-2 text-right ${STICKY_ACTIONS_TD}`}>{canEdit ? <button type="button" onClick={() => setEditing({ userId: u.id, legalFirstName: u.legalFirstName ?? '', legalLastName: u.legalLastName ?? '', credentials: u.credentials ?? '', taxonomyCode: u.taxonomyCode ?? '' })} className="inline-flex min-h-10 items-center px-1 font-semibold text-purple-700 sm:min-h-0">Edit</button> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing ? (
        <div className="grid gap-2 border-t border-gray-100 p-4 text-xs sm:grid-cols-4">
          <label>Legal first name<input value={editing.legalFirstName} onChange={(e) => setEditing({ ...editing, legalFirstName: e.target.value })} className="mt-1 block min-h-10 w-full rounded border p-1.5 sm:min-h-0" /></label>
          <label>Legal last name<input value={editing.legalLastName} onChange={(e) => setEditing({ ...editing, legalLastName: e.target.value })} className="mt-1 block min-h-10 w-full rounded border p-1.5 sm:min-h-0" /></label>
          <label>Credentials<input value={editing.credentials} onChange={(e) => setEditing({ ...editing, credentials: e.target.value })} className="mt-1 block min-h-10 w-full rounded border p-1.5 sm:min-h-0" placeholder="e.g. LCSW-C" /></label>
          <label>Taxonomy (NUCC)<input value={editing.taxonomyCode} onChange={(e) => setEditing({ ...editing, taxonomyCode: e.target.value.toUpperCase() })} className="mt-1 block min-h-10 w-full rounded border p-1.5 sm:min-h-0 font-mono" placeholder="e.g. 1041C0700X" /></label>
          <div className="flex items-center gap-4 sm:col-span-4">
            <button type="button" disabled={busy} onClick={() => void save()} className="min-h-10 rounded-lg bg-purple-700 px-3 py-1.5 font-semibold sm:min-h-0 text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save'}</button>
            <button type="button" onClick={() => setEditing(null)} className="font-semibold text-gray-600">Cancel</button>
          </div>
        </div>
      ) : null}
      {message ? <p role="status" className={`px-4 pb-3 text-xs ${message.tone === 'ok' ? 'text-emerald-700' : 'text-rose-700'}`}>{message.text}</p> : null}
    </section>
  );
}
