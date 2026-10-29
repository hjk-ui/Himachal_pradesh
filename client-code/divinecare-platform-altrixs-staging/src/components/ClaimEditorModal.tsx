'use client';

import { useEffect, useMemo, useState } from 'react';
import { X, Plus, Trash2, Save, FileText, AlertTriangle } from 'lucide-react';
import { PAYER_LIST as PAYER_MASTER_LIST } from '@/lib/constants/payers';
import { Icd10CodeChips } from '@/components/clinical/Icd10Picker';
import { useAuth } from '@/features/auth';
import { BILLING_STAFF_ONLY, canEditClaims } from '@/lib/billing/billingAccess';

export interface ClaimLine {
  cpt: string;
  modifier: string;
  units: number;
  /** Per-unit charge in dollars (line total = charge x units). */
  charge: number;
}

export interface EditableClaim {
  id: string;
  claimNumber?: string;
  client: string;
  dos: string;
  payer: string;
  icd10: string; // comma-separated
  renderingProvider: string;
  billingProvider: string;
  authNumber: string;
  pos: string;
  lines: ClaimLine[];
  totalCharge?: number;
  status?: string;
}

/**
 * Kept for backward compatibility. Rendering providers now load from
 * /api/billing/rendering-providers (org staff with an NPI on file).
 */
export const RENDERING_PROVIDERS: string[] = [];

export const BILLING_PROVIDERS: string[] = [
  'MD Behavioral Health',
];

export const PAYER_LIST = [
  'Optum Maryland (Incedo) — Medicaid BH',
  'Medicare Part B — Novitas',
  'CareFirst BCBS',
  'Aetna Behavioral Health',
  'UnitedHealthcare / Optum',
  'Cigna / Evernorth',
  'Johns Hopkins EHP',
  'Self-Pay',
];

export const POS_OPTIONS = ['02', '10', '11', '12', '15', '53', '55', '56', '99'];

type RenderingProviderOption = { id: string; name: string; npi: string; title: string };

type ServerClaim = {
  status: string;
  submissionInProgress: boolean;
  cptCode: string;
  units: number;
  amountCents: number | null;
  payer: string | null;
  icd10Codes: string[];
  priorAuthNumber: string | null;
  placeOfService: string | null;
  renderingNpi: string | null;
  billingNpi: string | null;
  submissionData: { diagnosisCodes?: string[]; serviceDate?: string | null } | null;
  appointment: { startsAt: string } | null;
  createdAt: string;
  serviceLines: Array<{ cptCode: string; modifier: string | null; units: number; unitCharge: number }>;
};

const EDITABLE_STATUSES = ['DRAFT', 'READY', 'DENIED'];
const OTHER_PROVIDER = '__other__';

function providerLabel(p: RenderingProviderOption) {
  return `${p.name} — NPI ${p.npi}`;
}

/** Claim values from the database replace whatever the opening page passed in. */
function fromServer(base: EditableClaim, c: ServerClaim): EditableClaim {
  const dx = c.icd10Codes?.length ? c.icd10Codes : c.submissionData?.diagnosisCodes || [];
  const [cpt, ...mods] = c.cptCode.split('-');
  const units = c.units || 1;
  const lines: ClaimLine[] = c.serviceLines?.length
    ? c.serviceLines.map((l) => ({
        cpt: l.cptCode,
        modifier: l.modifier || '',
        units: l.units,
        charge: l.unitCharge,
      }))
    : [{ cpt, modifier: mods.join(':'), units, charge: Math.round((c.amountCents ?? 0) / units) / 100 }];
  const dos =
    c.submissionData?.serviceDate ||
    c.appointment?.startsAt?.slice(0, 10) ||
    base.dos ||
    c.createdAt.slice(0, 10);
  return {
    ...base,
    dos,
    payer: c.payer || '',
    icd10: dx.join(', '),
    renderingProvider: c.renderingNpi || '',
    billingProvider: c.billingNpi || base.billingProvider,
    authNumber: c.priorAuthNumber || '',
    pos: c.placeOfService || base.pos || '11',
    lines,
    status: c.status,
  };
}

async function readJson(res: Response) {
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.success === false) {
    const msg = data && typeof data.error === 'string' ? data.error : `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

export function ClaimEditorModal({
  claim,
  isOpen = true,
  onClose,
  onSave,
  onSubmit,
  loadFromServer,
  saveLabel = 'Save & Re-Scrub',
  title,
}: {
  claim: EditableClaim;
  isOpen?: boolean;
  onClose: () => void;
  /** Called only after the claim was saved (2xx). */
  onSave: (updated: EditableClaim) => void;
  /**
   * Custom persistence (e.g. create a new claim from a charge). Throw to show an
   * error. When omitted the modal saves to PUT /api/billing/claims/[id].
   */
  onSubmit?: (draft: EditableClaim) => Promise<void>;
  /** Load the stored claim first. Defaults to true when saving to an existing claim. */
  loadFromServer?: boolean;
  saveLabel?: string;
  title?: string;
}) {
  const shouldLoad = loadFromServer ?? !onSubmit;
  const { user } = useAuth();
  // PUT /api/billing/claims/[id] is billing core only (canMutateClaims); Office Manager views read-only.
  // A custom onSubmit (e.g. residential-crisis "Create Claim") is gated by its own page.
  const readOnly = !onSubmit && !canEditClaims(user?.role);
  const [draft, setDraft] = useState<EditableClaim>(() => ({
    ...claim,
    lines: claim.lines.length ? claim.lines.map((l) => ({ ...l })) : [{ cpt: '90837', modifier: '', units: 1, charge: 150 }],
  }));
  const [loading, setLoading] = useState(shouldLoad);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [providers, setProviders] = useState<RenderingProviderOption[]>([]);
  const [providersError, setProvidersError] = useState(false);
  const [otherProvider, setOtherProvider] = useState(false);

  useEffect(() => {
    if (!isOpen || !shouldLoad) return;
    let active = true;
    setLoading(true);
    fetch(`/api/billing/claims/${encodeURIComponent(claim.id)}`)
      .then(readJson)
      .then((data: { data: ServerClaim }) => {
        if (active) setDraft((prev) => fromServer(prev, data.data));
      })
      .catch((err: unknown) => {
        if (active) setLoadError(err instanceof Error ? err.message : 'Could not load the claim');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [isOpen, shouldLoad, claim.id]);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    fetch('/api/billing/rendering-providers')
      .then(readJson)
      .then((data: { providers?: RenderingProviderOption[] }) => {
        if (active) setProviders(Array.isArray(data.providers) ? data.providers : []);
      })
      .catch(() => {
        if (active) setProvidersError(true);
      });
    return () => {
      active = false;
    };
  }, [isOpen]);

  const payerOptions = useMemo(
    () => Array.from(new Set([...PAYER_LIST, ...PAYER_MASTER_LIST.map((p) => p.label)])),
    []
  );

  if (isOpen === false) return null;

  const set = <K extends keyof EditableClaim>(k: K, v: EditableClaim[K]) =>
    setDraft(prev => ({ ...prev, [k]: v }));

  const setLine = (i: number, patch: Partial<ClaimLine>) =>
    setDraft(prev => ({ ...prev, lines: prev.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));

  const total = draft.lines.reduce((s, l) => s + (Number(l.charge) || 0) * (Number(l.units) || 0), 0);

  // Which provider (if any) the current rendering value matches
  const matched = providers.find(
    (p) => draft.renderingProvider === providerLabel(p) || draft.renderingProvider.includes(p.npi)
  );
  const providerSelectValue = matched && !otherProvider ? matched.id : draft.renderingProvider || otherProvider ? OTHER_PROVIDER : '';
  const showFreeText = otherProvider || (!matched && Boolean(draft.renderingProvider));

  const locked = shouldLoad && !loading && !loadError && draft.status && !EDITABLE_STATUSES.includes(draft.status);
  const canSave = !readOnly && !saving && !loading && !loadError && !locked && draft.lines.every((l) => l.cpt.trim());

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setSaveError(null);
    const updated: EditableClaim = { ...draft, totalCharge: Math.round(total * 100) / 100 };
    try {
      if (onSubmit) {
        await onSubmit(updated);
      } else {
        const res = await fetch(`/api/billing/claims/${encodeURIComponent(draft.id)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            dos: draft.dos || undefined,
            payer: draft.payer,
            renderingProvider: draft.renderingProvider,
            billingProvider: draft.billingProvider,
            icd10: draft.icd10,
            authNumber: draft.authNumber,
            pos: draft.pos,
            lines: draft.lines.map((l) => ({
              cpt: l.cpt.trim().toUpperCase(),
              modifier: l.modifier,
              units: Number(l.units) || 1,
              charge: Number(l.charge) || 0,
            })),
          }),
        });
        await readJson(res);
      }
      onSave(updated);
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Could not save the claim');
    } finally {
      setSaving(false);
    }
  };

  const fieldCls =
    'w-full border border-slate-200 rounded-xl px-3 py-2 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-brand-600';
  const cellCls =
    'border border-slate-200 rounded-lg px-2 py-1 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-brand-600';

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-3 sm:p-4 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92dvh] flex flex-col my-auto overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between gap-3 p-4 sm:p-5 border-b sticky top-0 bg-white rounded-t-2xl z-10">
          <h2 className="min-w-0 font-bold text-slate-900 text-sm sm:text-base flex items-center gap-2 truncate">
            <FileText size={18} className="text-brand-600 shrink-0" />
            <span className="truncate">{title || `Claim ${draft.claimNumber || draft.id}`} — {draft.client}</span>
          </h2>
          <button onClick={onClose} className="inline-flex h-10 w-10 shrink-0 items-center justify-center text-slate-500 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition-colors sm:h-8 sm:w-8" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="p-4 sm:p-6 space-y-4 overflow-y-auto flex-1">
          {loading && <p className="text-xs text-slate-500">Loading the saved claim…</p>}
          {loadError && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
              {loadError}. Nothing can be saved until the claim loads.
            </div>
          )}
          {readOnly && (
            <div className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              {BILLING_STAFF_ONLY}: this claim is read-only for your role. Billing staff make claim changes.
            </div>
          )}
          {locked && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              This claim is {draft.status?.toLowerCase()} and can no longer be edited here.
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Date of Service (DOS)</label>
              <input type="date" value={draft.dos} onChange={e => set('dos', e.target.value)} className={fieldCls} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Payer</label>
              <input list="claim-editor-payers" value={draft.payer} onChange={e => set('payer', e.target.value)}
                placeholder="Start typing a payer…" className={fieldCls} />
              <datalist id="claim-editor-payers">
                {payerOptions.map(p => <option key={p} value={p} />)}
              </datalist>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Rendering Provider</label>
              <select
                value={providerSelectValue}
                onChange={e => {
                  const v = e.target.value;
                  if (v === OTHER_PROVIDER) {
                    setOtherProvider(true);
                    if (matched) set('renderingProvider', '');
                    return;
                  }
                  setOtherProvider(false);
                  const p = providers.find(x => x.id === v);
                  set('renderingProvider', p ? providerLabel(p) : '');
                }}
                className={fieldCls}
              >
                <option value="">{providers.length ? 'Select rendering provider…' : 'No staff with an NPI on file'}</option>
                {providers.map(p => (
                  <option key={p.id} value={p.id}>{providerLabel(p)} · {p.title}</option>
                ))}
                <option value={OTHER_PROVIDER}>Other (type name and NPI)</option>
              </select>
              {showFreeText && (
                <input value={draft.renderingProvider} onChange={e => set('renderingProvider', e.target.value)}
                  placeholder="Provider name, credential — NPI"
                  className={`${fieldCls} mt-1.5`} />
              )}
              {providersError && (
                <p className="mt-1 text-[11px] text-slate-500">Could not load the staff list; type the provider and NPI.</p>
              )}
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Billing Provider / Location</label>
              <select value={draft.billingProvider} onChange={e => set('billingProvider', e.target.value)} className={fieldCls}>
                <option value="">Select billing provider…</option>
                {draft.billingProvider && !BILLING_PROVIDERS.includes(draft.billingProvider) && (
                  <option value={draft.billingProvider}>{draft.billingProvider}</option>
                )}
                {BILLING_PROVIDERS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-600 mb-1">ICD-10-CM Diagnosis Codes (primary first; billable codes only)</label>
              <Icd10CodeChips
                codes={draft.icd10.split(/[,;\s]+/).map(c => c.trim().toUpperCase()).filter(Boolean)}
                onChange={codes => set('icd10', codes.join(', '))}
                requireBillable
                context="bh"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Prior Auth #</label>
              <input value={draft.authNumber} onChange={e => set('authNumber', e.target.value)} placeholder="PA-2026-99214" className={fieldCls} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Place of Service (POS)</label>
              <select value={draft.pos} onChange={e => set('pos', e.target.value)} className={fieldCls}>
                {!POS_OPTIONS.includes(draft.pos) && draft.pos && <option value={draft.pos}>POS {draft.pos}</option>}
                {POS_OPTIONS.map(p => <option key={p} value={p}>POS {p}</option>)}
              </select>
            </div>
          </div>

          {/* Service lines */}
          <div className="pt-2">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-slate-700">CPT / HCPCS Service Lines</label>
              <button
                type="button"
                onClick={() => setDraft(prev => ({ ...prev, lines: [...prev.lines, { cpt: '', modifier: '', units: 1, charge: 0 }] }))}
                className="flex items-center gap-1 text-xs font-bold text-brand-700 hover:text-brand-900">
                <Plus size={13} /> Add CPT Line
              </button>
            </div>
            <div className="border border-slate-200 rounded-xl overflow-x-auto">
              <div className="min-w-[450px]">
                <div className="grid grid-cols-[minmax(0,1fr)_80px_60px_90px_40px] gap-2 px-3 py-2 bg-slate-50 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  <span>CPT / Code</span><span>Modifier</span><span>Units</span><span>$ / Unit</span><span />
                </div>
                {draft.lines.map((line, i) => (
                  <div key={i} className="grid grid-cols-[minmax(0,1fr)_80px_60px_90px_40px] gap-2 px-3 py-2 border-t border-slate-100 items-center">
                    <input value={line.cpt} onChange={e => setLine(i, { cpt: e.target.value })} placeholder="90837" className={cellCls} aria-label={`Line ${i + 1} CPT`} />
                    <input value={line.modifier} onChange={e => setLine(i, { modifier: e.target.value })} placeholder="95" className={cellCls} aria-label={`Line ${i + 1} modifier`} />
                    <input type="number" min={1} value={line.units} onChange={e => setLine(i, { units: Math.max(1, Number(e.target.value)) })} className={cellCls} aria-label={`Line ${i + 1} units`} />
                    <input type="number" min={0} step="0.01" value={line.charge} onChange={e => setLine(i, { charge: Math.max(0, Number(e.target.value)) })} className={cellCls} aria-label={`Line ${i + 1} charge per unit`} />
                    <button
                      type="button"
                      onClick={() => setDraft(prev => ({ ...prev, lines: prev.lines.filter((_, j) => j !== i) }))}
                      disabled={draft.lines.length === 1}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:text-rose-600 disabled:opacity-30 sm:h-8 sm:w-8" aria-label="Remove line">
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
                <div className="px-3 py-2.5 border-t border-slate-100 bg-slate-50 flex justify-between items-center text-xs sm:text-sm">
                  <span className="text-slate-500 font-medium">Claim Total ({draft.lines.length} service line{draft.lines.length > 1 ? 's' : ''}):</span>
                  <span className="font-bold text-slate-900">${total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
              </div>
            </div>
          </div>
          {saveError && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{saveError}</div>
          )}
        </div>

        <div className="flex gap-2 sm:gap-3 p-4 sm:p-5 border-t sticky bottom-0 bg-white rounded-b-2xl">
          <button onClick={onClose} className="flex-1 py-2.5 border border-slate-200 rounded-xl text-xs sm:text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors">
            {readOnly ? 'Close' : 'Cancel'}
          </button>
          {!readOnly && (
            <button
              onClick={() => void save()}
              disabled={!canSave}
              className="flex-1 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-xs sm:text-sm font-bold flex items-center justify-center gap-2 shadow-sm transition-all disabled:opacity-50">
              <Save size={15} /> {saving ? 'Saving…' : saveLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default ClaimEditorModal;
