'use client';

import { useEffect, useState } from 'react';
import { BadgeCheck, Route } from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import { Alert, Button, FormField, LoadingState, cx, inputClasses } from '@/components/ui';
import { suggestedFilingCode, type PayerMasterRow } from '@/lib/billing/payerMaster';
import { FILING_OPTIONS } from './WaystarSettingsPanels';

type Mapping = {
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

type RulesForm = {
  aliases: string;
  claimFilingCode: string;
  telehealthModifier: string;
  requiresPriorAuth: boolean;
  superviseeClaims: string;
  requireTaxonomy: string;
  audioOnlyModifier: string;
  verified: boolean;
  active: boolean;
  notes: string;
};

function formOf(m: Mapping | null, payer: PayerMasterRow): RulesForm {
  if (!m) {
    return {
      aliases: '', claimFilingCode: suggestedFilingCode(payer.payerType), telehealthModifier: '95', requiresPriorAuth: false,
      superviseeClaims: '', requireTaxonomy: '', audioOnlyModifier: '', verified: false, active: true, notes: '',
    };
  }
  return {
    aliases: m.aliases.join(', '),
    claimFilingCode: m.claimFilingCode,
    telehealthModifier: m.telehealthModifier,
    requiresPriorAuth: m.requiresPriorAuth,
    superviseeClaims: m.superviseeClaims ?? '',
    requireTaxonomy: m.requireTaxonomy == null ? '' : m.requireTaxonomy ? 'yes' : 'no',
    audioOnlyModifier: m.audioOnlyModifier ?? '',
    verified: m.verified,
    active: m.active,
    notes: m.notes ?? '',
  };
}

/**
 * The payer's Waystar claim rules (WaystarPayerMapping), saved through the existing
 * /api/billing/claims/payer-mappings route (waystarConfig.savePayerMapping). The payer ID and the
 * timely filing limit come from the payer master so they are entered once.
 */
export function WaystarRulesEditor({ payer, onSaved }: { payer: PayerMasterRow; onSaved: () => void }) {
  const [mapping, setMapping] = useState<Mapping | null | undefined>(undefined);
  const [canEdit, setCanEdit] = useState(false);
  const [form, setForm] = useState<RulesForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiJson<{ mappings: Mapping[]; canEdit: boolean }>('/api/billing/claims/payer-mappings')
      .then((d) => {
        if (cancelled) return;
        const m = payer.waystar ? d.mappings.find((x) => x.id === payer.waystar?.id) ?? null : null;
        setMapping(m);
        setCanEdit(d.canEdit);
        setForm(formOf(m, payer));
      })
      .catch((e) => {
        if (cancelled) return;
        setMapping(null);
        setMessage({ tone: 'danger', text: e instanceof Error ? e.message : 'Could not load the Waystar rules' });
      });
    return () => { cancelled = true; };
  }, [payer]);

  async function save() {
    if (!form || !payer.payerId) return;
    setBusy(true);
    setMessage(null);
    try {
      const d = await apiJson<{ mapping: Mapping }>('/api/billing/claims/payer-mappings', {
        method: 'PUT',
        body: JSON.stringify({
          payerName: mapping?.payerName ?? payer.name,
          aliases: form.aliases.split(',').map((x) => x.trim()).filter(Boolean),
          waystarPayerId: payer.payerId,
          claimFilingCode: form.claimFilingCode,
          telehealthModifier: form.telehealthModifier,
          requiresPriorAuth: form.requiresPriorAuth,
          superviseeClaims: form.superviseeClaims || undefined,
          requireTaxonomy: form.requireTaxonomy === '' ? undefined : form.requireTaxonomy === 'yes',
          audioOnlyModifier: form.audioOnlyModifier || undefined,
          filingLimitDays: payer.timelyFilingDays ?? mapping?.filingLimitDays ?? null,
          verified: form.verified,
          notes: form.notes || null,
          active: form.active,
        }),
      });
      setMapping(d.mapping);
      setMessage({ tone: 'success', text: 'Waystar rules saved. New and unsent claims for this payer use them.' });
      onSaved();
    } catch (e) {
      setMessage({ tone: 'danger', text: e instanceof Error ? e.message : 'Could not save the Waystar rules' });
    } finally {
      setBusy(false);
    }
  }

  const ro = !canEdit;
  const sel = (k: keyof RulesForm, label: string, options: Array<[string, string]>) => (
    <FormField label={label}>
      <select value={String(form?.[k] ?? '')} disabled={ro} onChange={(e) => setForm((f) => (f ? { ...f, [k]: e.target.value } : f))} className={inputClasses}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </FormField>
  );

  const idDiffers = mapping && payer.payerId && mapping.waystarPayerId.toUpperCase() !== payer.payerId.toUpperCase();
  const filingDiffers = mapping && payer.timelyFilingDays != null && mapping.filingLimitDays !== payer.timelyFilingDays;

  return (
    <section className="space-y-3 rounded-xl border border-purple-200 p-3">
      <div className="flex items-start gap-2">
        <Route className="mt-0.5 h-4 w-4 shrink-0 text-purple-700" aria-hidden />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-900">Waystar claim rules</h3>
          <p className="text-xs text-slate-500">
            Applied to claims for this payer. Payer ID and timely filing come from the fields above.
            {mapping ? ` Linked by ${payer.waystar?.by === 'payer_id' ? 'payer ID' : payer.waystar?.by ?? 'name'} to "${mapping.payerName}"${mapping.scope === 'global' ? ' (deployment default; saving makes a practice copy)' : ''}.` : ''}
          </p>
        </div>
      </div>
      {mapping === undefined || !form ? (
        message ? <Alert tone={message.tone}>{message.text}</Alert> : <LoadingState label="Loading Waystar rules…" />
      ) : (
        <>
          {!mapping ? <p className="text-xs text-amber-700">No Waystar rules yet: claims for this payer are blocked at the pre-send check until they are saved.</p> : null}
          {!payer.payerId ? <Alert tone="warning">Enter and save the Waystar payer ID above before setting claim rules.</Alert> : null}
          {idDiffers ? <Alert tone="warning">Claims currently use Waystar payer ID {mapping.waystarPayerId}. Saving these rules changes it to {payer.payerId}.</Alert> : null}
          {filingDiffers ? <p className="text-xs text-amber-700">Waystar filing limit is {mapping.filingLimitDays ?? 'not set'}; saving sets it to {payer.timelyFilingDays} days.</p> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            {sel('claimFilingCode', 'Insurance type (SBR09)', [['', 'Choose…'], ...FILING_OPTIONS])}
            {sel('telehealthModifier', 'Telehealth modifier', [['95', '95'], ['GT', 'GT'], ['both', 'GT and 95'], ['none', 'None (POS 02/10 only)']])}
            {sel('superviseeClaims', 'Supervised (pre-licensed) clinicians', [['', 'Payer default by insurance type'], ['supervisee_with_2310D', 'Bill supervisee, supervisor in 2310D'], ['render_as_supervisor', 'Bill under the supervisor'], ['not_allowed', 'Not allowed (block)']])}
            {sel('audioOnlyModifier', 'Audio-only telehealth', [['', 'Payer default (Medicare 93; others blocked)'], ['93', 'Modifier 93'], ['FQ', 'Modifier FQ'], ['none', 'Allowed, no modifier'], ['not_allowed', 'Not allowed (block)']])}
            {sel('requireTaxonomy', 'Taxonomy (PRV) on claims', [['', 'Payer default (Medicaid: required)'], ['yes', 'Required (block when missing)'], ['no', 'Optional (warn when missing)']])}
            <FormField label="Other names on client insurance (comma separated)">
              <input value={form.aliases} disabled={ro} onChange={(e) => setForm({ ...form, aliases: e.target.value })} className={inputClasses} />
            </FormField>
          </div>
          <FormField label="Rule notes">
            <input value={form.notes} disabled={ro} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={inputClasses} />
          </FormField>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-700">
            <label className="flex items-center gap-1.5"><input type="checkbox" disabled={ro} checked={form.verified} onChange={(e) => setForm({ ...form, verified: e.target.checked })} /> <BadgeCheck className="h-4 w-4 text-emerald-600" aria-hidden /> Confirmed on Waystar&apos;s payer list</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" disabled={ro} checked={form.requiresPriorAuth} onChange={(e) => setForm({ ...form, requiresPriorAuth: e.target.checked })} /> Requires prior auth</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" disabled={ro} checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Rules active</label>
          </div>
          {message ? <p role="status" className={cx('text-xs', message.tone === 'success' ? 'text-emerald-700' : 'text-rose-700')}>{message.text}</p> : null}
          {canEdit ? (
            <Button size="sm" onClick={() => void save()} loading={busy} disabled={!payer.payerId || !form.claimFilingCode}>
              Save Waystar rules
            </Button>
          ) : null}
        </>
      )}
    </section>
  );
}
