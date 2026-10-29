'use client';

import { useEffect, useState } from 'react';
import { PRACTICE } from '@/lib/practice';
import { X, Plus, Trash2, Save, FileText } from 'lucide-react';

export interface ClaimLine {
  cpt: string;
  modifier: string;
  units: number;
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

export const RENDERING_PROVIDERS: string[] = [];

export const BILLING_PROVIDERS = [
  PRACTICE.name,
  ...PRACTICE.locations.map((location) => `${PRACTICE.name} (${location.name})`),
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

export function ClaimEditorModal({
  claim,
  isOpen = true,
  onClose,
  onSave,
  saveLabel = 'Save & Re-Scrub',
}: {
  claim: EditableClaim;
  isOpen?: boolean;
  onClose: () => void;
  onSave: (updated: EditableClaim) => void;
  saveLabel?: string;
}) {
  const [staffProviders, setStaffProviders] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/providers/roster')
      .then((response) => response.json())
      .then((data) => {
        if (cancelled || !data?.success || !Array.isArray(data.roster)) return;
        setStaffProviders(
          data.roster
            .map((user: { name?: string }) => user.name || '')
            .filter(Boolean)
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  if (isOpen === false) return null;
  const [draft, setDraft] = useState<EditableClaim>({
    ...claim,
    lines: claim.lines.length ? claim.lines.map(l => ({ ...l })) : [{ cpt: '90837', modifier: '', units: 1, charge: 150 }],
  });

  const set = <K extends keyof EditableClaim>(k: K, v: EditableClaim[K]) =>
    setDraft(prev => ({ ...prev, [k]: v }));

  const setLine = (i: number, patch: Partial<ClaimLine>) =>
    setDraft(prev => ({ ...prev, lines: prev.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));

  const total = draft.lines.reduce((s, l) => s + (Number(l.charge) || 0) * (Number(l.units) || 0), 0);

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-3 sm:p-4 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col my-auto overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between p-4 sm:p-5 border-b sticky top-0 bg-white rounded-t-2xl z-10">
          <h2 className="font-bold text-gray-900 text-sm sm:text-base flex items-center gap-2 truncate">
            <FileText size={18} className="text-purple-600 shrink-0" />
            <span className="truncate">Claim {draft.id} — {draft.client}</span>
          </h2>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="p-4 sm:p-6 space-y-4 overflow-y-auto flex-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Date of Service (DOS)</label>
              <input type="date" value={draft.dos} onChange={e => set('dos', e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-purple-400" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Payer</label>
              <input list="claim-editor-payers" value={draft.payer} onChange={e => set('payer', e.target.value)}
                placeholder="Payer name..."
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-purple-400" />
              <datalist id="claim-editor-payers">
                {PAYER_LIST.map(p => <option key={p} value={p} />)}
              </datalist>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Rendering Provider</label>
              <select value={draft.renderingProvider} onChange={e => set('renderingProvider', e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-purple-400">
                <option value="">Select rendering provider…</option>
                {staffProviders.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Billing Provider / Location</label>
              <select value={draft.billingProvider} onChange={e => set('billingProvider', e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-purple-400">
                <option value="">Select billing provider…</option>
                {BILLING_PROVIDERS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-gray-600 mb-1">ICD-10 Diagnosis Codes (comma-separated, primary first)</label>
              <input value={draft.icd10} onChange={e => set('icd10', e.target.value)} placeholder="F33.1, F10.20, Z79.899"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-purple-400" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Prior Auth #</label>
              <input value={draft.authNumber} onChange={e => set('authNumber', e.target.value)} placeholder="PA-2026-99214"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-purple-400" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Place of Service (POS)</label>
              <select value={draft.pos} onChange={e => set('pos', e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-purple-400">
                {POS_OPTIONS.map(p => <option key={p} value={p}>POS {p}</option>)}
              </select>
            </div>
          </div>

          {/* Service lines */}
          <div className="pt-2">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-gray-700">CPT / HCPCS Service Lines</label>
              <button
                type="button"
                onClick={() => setDraft(prev => ({ ...prev, lines: [...prev.lines, { cpt: '', modifier: '', units: 1, charge: 0 }] }))}
                className="flex items-center gap-1 text-xs font-bold text-purple-600 hover:text-purple-800">
                <Plus size={13} /> Add CPT Line
              </button>
            </div>
            <div className="border border-gray-200 rounded-xl overflow-x-auto">
              <div className="min-w-[450px]">
                <div className="grid grid-cols-[1fr_80px_60px_90px_36px] gap-2 px-3 py-2 bg-gray-50 text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                  <span>CPT / Code</span><span>Modifier</span><span>Units</span><span>Charge ($)</span><span />
                </div>
                {draft.lines.map((line, i) => (
                  <div key={i} className="grid grid-cols-[1fr_80px_60px_90px_36px] gap-2 px-3 py-2 border-t border-gray-100 items-center">
                    <input value={line.cpt} onChange={e => setLine(i, { cpt: e.target.value })} placeholder="90837"
                      className="border border-gray-200 rounded-lg px-2 py-1 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-purple-400" />
                    <input value={line.modifier} onChange={e => setLine(i, { modifier: e.target.value })} placeholder="95"
                      className="border border-gray-200 rounded-lg px-2 py-1 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-purple-400" />
                    <input type="number" min={1} value={line.units} onChange={e => setLine(i, { units: Math.max(1, Number(e.target.value)) })}
                      className="border border-gray-200 rounded-lg px-2 py-1 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-purple-400" />
                    <input type="number" min={0} value={line.charge} onChange={e => setLine(i, { charge: Math.max(0, Number(e.target.value)) })}
                      className="border border-gray-200 rounded-lg px-2 py-1 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-purple-400" />
                    <button
                      type="button"
                      onClick={() => setDraft(prev => ({ ...prev, lines: prev.lines.filter((_, j) => j !== i) }))}
                      disabled={draft.lines.length === 1}
                      className="text-gray-300 hover:text-red-500 disabled:opacity-20 flex justify-center" aria-label="Remove line">
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
                <div className="px-3 py-2.5 border-t border-gray-100 bg-gray-50 flex justify-between items-center text-xs sm:text-sm">
                  <span className="text-gray-500 font-medium">Claim Total ({draft.lines.length} service line{draft.lines.length > 1 ? 's' : ''}):</span>
                  <span className="font-bold text-gray-900">${total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex gap-2 sm:gap-3 p-4 sm:p-5 border-t sticky bottom-0 bg-white rounded-b-2xl">
          <button onClick={onClose} className="flex-1 py-2.5 border border-gray-200 rounded-xl text-xs sm:text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors">
            Cancel
          </button>
          <button
            onClick={() => onSave(draft)}
            className="flex-1 py-2.5 rounded-xl text-white text-xs sm:text-sm font-bold flex items-center justify-center gap-2 hover:opacity-95 shadow-sm transition-all"
            style={{ background: 'linear-gradient(135deg, #5C2D91, #7C3AED)' }}>
            <Save size={15} /> {saveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ClaimEditorModal;
