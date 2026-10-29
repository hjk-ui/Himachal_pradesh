'use client';

import { useMemo, useState } from 'react';
import { Info, Link2, Search } from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import { Alert, Button, FormField, StatusBadge, cx, inputClasses } from '@/components/ui';
import { SidePanel } from '@/features/billing/SidePanel';
import {
  CLEARINGHOUSE_OPTIONS,
  ENROLLMENT_STATUSES,
  PAYER_TYPES,
  payerMasterInputSchema,
  prefillFromValant,
  type PayerMasterRow,
  type ValantPayerOption,
} from '@/lib/billing/payerMaster';
import { WaystarRulesEditor } from './WaystarRulesEditor';

type FormState = {
  name: string;
  payerId: string;
  payerType: string;
  clearinghouse: string;
  claimsAddressLine1: string;
  claimsAddressLine2: string;
  claimsCity: string;
  claimsState: string;
  claimsZip: string;
  phone: string;
  fax: string;
  portalUrl: string;
  timelyFilingDays: string;
  eraEnrollmentStatus: string;
  eftEnrollmentStatus: string;
  notes: string;
  active: boolean;
};

const BLANK: FormState = {
  name: '', payerId: '', payerType: '', clearinghouse: 'Waystar', claimsAddressLine1: '', claimsAddressLine2: '', claimsCity: '',
  claimsState: '', claimsZip: '', phone: '', fax: '', portalUrl: '', timelyFilingDays: '', eraEnrollmentStatus: 'unknown',
  eftEnrollmentStatus: 'unknown', notes: '', active: true,
};

function toForm(p: PayerMasterRow): FormState {
  return {
    name: p.name, payerId: p.payerId ?? '', payerType: p.payerType ?? '', clearinghouse: p.clearinghouse || 'Waystar',
    claimsAddressLine1: p.claimsAddressLine1 ?? '', claimsAddressLine2: p.claimsAddressLine2 ?? '', claimsCity: p.claimsCity ?? '',
    claimsState: p.claimsState ?? '', claimsZip: p.claimsZip ?? '', phone: p.phone ?? '', fax: p.fax ?? '', portalUrl: p.portalUrl ?? '',
    timelyFilingDays: p.timelyFilingDays != null ? String(p.timelyFilingDays) : '', eraEnrollmentStatus: p.eraEnrollmentStatus || 'unknown',
    eftEnrollmentStatus: p.eftEnrollmentStatus || 'unknown', notes: p.notes ?? '', active: p.active,
  };
}

export type PayerPanelMode = { kind: 'add' } | { kind: 'valant' } | { kind: 'edit'; payer: PayerMasterRow };

/** Add / edit a payer in the right-side panel. "Start from Valant" prefills name + address, never the payer ID. */
export function PayerForm({
  mode,
  canEdit,
  valant,
  payers,
  onClose,
  onSaved,
  onReload,
  onOpenPayer,
}: {
  mode: PayerPanelMode;
  canEdit: boolean;
  valant: ValantPayerOption[];
  payers: PayerMasterRow[];
  onClose: () => void;
  onSaved: (payers: PayerMasterRow[], id: string) => void;
  /** reload the payer list (after Waystar rules change, the link may change) */
  onReload: () => void;
  onOpenPayer: (id: string) => void;
}) {
  const editing = mode.kind === 'edit' ? mode.payer : null;
  const [form, setForm] = useState<FormState>(editing ? toForm(editing) : BLANK);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  // Start from Valant
  const [valantQuery, setValantQuery] = useState('');
  const [valantId, setValantId] = useState<string>('');
  const [addressId, setAddressId] = useState<string | null>(null);
  const [ediHint, setEdiHint] = useState<string | null>(null);
  const [addressWarning, setAddressWarning] = useState<string | null>(null);
  const readOnly = !canEdit;

  const valantMatches = useMemo(() => {
    const q = valantQuery.trim().toLowerCase();
    const list = q ? valant.filter((v) => v.name.toLowerCase().includes(q) || v.ediPayerId.toLowerCase().includes(q)) : valant;
    return list.slice(0, 50);
  }, [valant, valantQuery]);
  const chosen = valant.find((v) => v.id === valantId) ?? null;
  const chosenLinked = chosen?.payerRegistryId ? payers.find((p) => p.id === chosen.payerRegistryId) ?? null : null;
  const linkedValant = editing?.valant ?? [];
  // EDI hint while editing: the Valant companies linked to this payer
  const editingEdi = linkedValant.map((v) => v.ediPayerId).filter(Boolean);

  function pickValant(id: string, addr?: string | null) {
    const v = valant.find((x) => x.id === id);
    setValantId(id);
    if (!v) return;
    const pre = prefillFromValant(v, addr);
    setAddressId(pre.addressId);
    setEdiHint(pre.valantEdiHint);
    setAddressWarning(pre.addressWarning);
    // payerId stays whatever staff typed (blank by default): Valant's EDI ID is a hint only
    setForm((f) => ({ ...f, ...pre.form, payerId: f.payerId }));
  }

  const set = (k: keyof FormState) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save() {
    setServerError(null);
    setSaved(null);
    const parsed = payerMasterInputSchema.safeParse(form);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const k = String(issue.path[0] ?? 'form');
        if (!next[k]) next[k] = issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      if (editing) {
        const d = await apiJson<{ payers: PayerMasterRow[]; changed: string[] }>(`/api/billing/payers/${encodeURIComponent(editing.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ payer: form }),
        });
        onSaved(d.payers, editing.id);
        setSaved(d.changed.length ? 'Saved.' : 'No changes to save.');
      } else {
        const d = await apiJson<{ payers: PayerMasterRow[]; id: string }>('/api/billing/payers', {
          method: 'POST',
          body: JSON.stringify({ payer: form, valantPayerId: mode.kind === 'valant' && valantId ? valantId : null }),
        });
        onSaved(d.payers, d.id);
        onOpenPayer(d.id);
      }
    } catch (error) {
      setServerError(error instanceof Error ? error.message : 'Could not save the payer');
    } finally {
      setBusy(false);
    }
  }

  const field = (k: keyof FormState, label: string, opts: { hint?: string; required?: boolean; placeholder?: string; mono?: boolean; className?: string; inputMode?: 'numeric' | 'tel' | 'url' } = {}) => (
    <FormField label={label} hint={opts.hint} error={errors[k]} required={opts.required} className={opts.className}>
      <input
        value={String(form[k])}
        onChange={set(k)}
        disabled={readOnly}
        placeholder={opts.placeholder}
        inputMode={opts.inputMode}
        className={cx(inputClasses, opts.mono && 'font-mono uppercase')}
      />
    </FormField>
  );

  const title = editing ? (readOnly ? editing.name : `Edit payer: ${editing.name}`) : mode.kind === 'valant' ? 'Add payer from Valant' : 'Add payer';

  return (
    <SidePanel
      title={title}
      titleId="payer-form-title"
      onClose={onClose}
      footer={
        readOnly ? (
          <Button variant="secondary" onClick={onClose}>Close</Button>
        ) : (
          <>
            {saved ? <span role="status" className="mr-auto text-xs text-emerald-700">{saved}</span> : null}
            <Button variant="secondary" onClick={onClose}>{editing ? 'Close' : 'Cancel'}</Button>
            <Button onClick={() => void save()} loading={busy} disabled={mode.kind === 'valant' && !valantId}>
              {editing ? 'Save payer' : 'Add payer'}
            </Button>
          </>
        )
      }
    >
      <div className="space-y-5">
        {readOnly ? <Alert tone="info">View only. Billing and practice leadership edit payers.</Alert> : null}
        {serverError ? <Alert tone="danger">{serverError}</Alert> : null}
        {Object.keys(errors).length ? <Alert tone="danger">Fix the highlighted fields.</Alert> : null}

        {mode.kind === 'valant' ? (
          <section className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <h3 className="text-sm font-semibold text-slate-900">Valant insurance company</h3>
            {valant.length === 0 ? (
              <p className="text-sm text-slate-600">No Valant insurance companies are imported. Import them under Admin › Data import, or add the payer by hand.</p>
            ) : (
              <>
                <label className="relative block">
                  <span className="sr-only">Search Valant insurance companies</span>
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
                  <input value={valantQuery} onChange={(e) => setValantQuery(e.target.value)} placeholder="Search by name or Valant EDI ID" className={cx(inputClasses, 'pl-9')} />
                </label>
                <select value={valantId} onChange={(e) => pickValant(e.target.value)} className={inputClasses} aria-label="Valant insurance company" size={Math.min(6, Math.max(2, valantMatches.length))}>
                  {valantMatches.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}{v.payerRegistryId ? ' (already in payers)' : ''}
                    </option>
                  ))}
                </select>
                {chosenLinked ? (
                  <Alert tone="warning" actions={<Button size="sm" variant="secondary" onClick={() => onOpenPayer(chosenLinked.id)}>Open it</Button>}>
                    This Valant company is already linked to the payer &quot;{chosenLinked.name}&quot;.
                  </Alert>
                ) : null}
                {chosen && chosen.addresses.length > 1 ? (
                  <fieldset className="space-y-1.5">
                    <legend className="mb-1 text-xs font-semibold text-slate-700">Which claims address? ({chosen.addresses.length} in Valant)</legend>
                    {chosen.addresses.map((a) => (
                      <label key={a.id} className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white p-2 text-xs text-slate-700">
                        <input type="radio" name="valant-address" className="mt-0.5" checked={addressId === a.id} onChange={() => pickValant(chosen.id, a.id)} />
                        <span className="min-w-0 break-words">
                          {[a.addressLine, a.city, [a.state, a.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ') || a.addressRaw || 'No address (phone only)'}
                          {a.phone ? ` · ${a.phone}` : ''}
                          {a.addressStatus !== 'ok' ? <StatusBadge size="sm" tone="warning" className="ml-1">{a.addressStatus}</StatusBadge> : null}
                        </span>
                      </label>
                    ))}
                  </fieldset>
                ) : null}
                {addressWarning ? <p className="text-xs text-amber-700">{addressWarning}</p> : null}
                {chosen ? <p className="text-xs text-slate-500">Name, address and phone are copied from Valant as a suggestion. Check them against the payer&apos;s current claims mailing address.</p> : null}
              </>
            )}
          </section>
        ) : null}

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-900">Payer</h3>
          {field('name', 'Payer name', { required: true, placeholder: 'As it should appear on the payer list' })}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              {field('payerId', 'Waystar payer ID', { mono: true, hint: 'From Waystar\'s payer list. 2-15 letters, digits or dashes. Leave blank until confirmed.' })}
              {(mode.kind === 'valant' ? (ediHint ? [ediHint] : []) : editingEdi).length ? (
                <p className="mt-1 flex items-start gap-1 text-xs text-slate-600">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                  <span>
                    Valant EDI ID (verify against Waystar&apos;s payer list):{' '}
                    <span className="font-mono font-semibold">{(mode.kind === 'valant' ? [ediHint] : editingEdi).join(', ')}</span>
                  </span>
                </p>
              ) : null}
            </div>
            <FormField label="Payer type" error={errors.payerType}>
              <select value={form.payerType} onChange={set('payerType')} disabled={readOnly} className={inputClasses}>
                <option value="">Not set</option>
                {PAYER_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </FormField>
            <FormField label="Claims sent through" error={errors.clearinghouse}>
              <select value={form.clearinghouse} onChange={set('clearinghouse')} disabled={readOnly} className={inputClasses}>
                {(CLEARINGHOUSE_OPTIONS as readonly string[]).includes(form.clearinghouse) ? null : <option value={form.clearinghouse}>{form.clearinghouse}</option>}
                {CLEARINGHOUSE_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </FormField>
            <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-700">
              <input type="checkbox" checked={form.active} disabled={readOnly} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} /> Active
            </label>
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-900">Claims mailing address</h3>
          {field('claimsAddressLine1', 'Street or PO box')}
          {field('claimsAddressLine2', 'Line 2 (attn, suite)')}
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_5rem_8rem]">
            {field('claimsCity', 'City')}
            {field('claimsState', 'State', { mono: true, placeholder: 'MD' })}
            {field('claimsZip', 'ZIP', { inputMode: 'numeric', placeholder: '5 or 9 digits' })}
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-900">Contact and enrollment</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {field('phone', 'Provider services phone', { inputMode: 'tel' })}
            {field('fax', 'Fax', { inputMode: 'tel' })}
            {field('portalUrl', 'Provider portal', { inputMode: 'url', placeholder: 'provider.example.com', className: 'sm:col-span-2' })}
            {field('timelyFilingDays', 'Timely filing (days from DOS)', { inputMode: 'numeric', hint: 'From the payer contract. Used as the Waystar filing limit.' })}
            <div className="hidden sm:block" />
            <FormField label="ERA enrollment" error={errors.eraEnrollmentStatus}>
              <select value={form.eraEnrollmentStatus} onChange={set('eraEnrollmentStatus')} disabled={readOnly} className={inputClasses}>
                {ENROLLMENT_STATUSES.some(([v]) => v === form.eraEnrollmentStatus) ? null : <option value={form.eraEnrollmentStatus}>{form.eraEnrollmentStatus}</option>}
                {ENROLLMENT_STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </FormField>
            <FormField label="EFT enrollment" error={errors.eftEnrollmentStatus}>
              <select value={form.eftEnrollmentStatus} onChange={set('eftEnrollmentStatus')} disabled={readOnly} className={inputClasses}>
                {ENROLLMENT_STATUSES.some(([v]) => v === form.eftEnrollmentStatus) ? null : <option value={form.eftEnrollmentStatus}>{form.eftEnrollmentStatus}</option>}
                {ENROLLMENT_STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </FormField>
          </div>
          <FormField label="Notes" error={errors.notes}>
            <textarea rows={3} value={form.notes} onChange={set('notes')} disabled={readOnly} className={cx(inputClasses, 'resize-y')} />
          </FormField>
        </section>

        {editing ? (
          <>
            {linkedValant.length ? (
              <section className="space-y-1">
                <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900"><Link2 className="h-4 w-4 text-slate-400" aria-hidden /> Linked Valant insurance companies</h3>
                <ul className="text-xs text-slate-600">
                  {linkedValant.map((v) => <li key={v.id} className="break-words">{v.name}{v.ediPayerId ? ` · Valant EDI ${v.ediPayerId}` : ''}</li>)}
                </ul>
              </section>
            ) : null}
            <WaystarRulesEditor payer={editing} onSaved={onReload} />
          </>
        ) : (
          <p className="text-xs text-slate-500">Waystar claim rules (insurance type, telehealth modifiers, prior auth) can be set after the payer is added.</p>
        )}
      </div>
    </SidePanel>
  );
}
