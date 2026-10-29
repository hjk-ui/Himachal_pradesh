'use client';

/**
 * Chart card (Documents & consents tab): required consents for this client with their status, and
 * the optional SSN from the intake packet, shown masked (reveal is role-limited and audited).
 */
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Eye, FileSignature, Loader2, Pencil } from 'lucide-react';
import { CONSENT_STATE_LABEL, type ClientConsentItem } from '@/lib/consents/library/status';
import { ssnError, SSN_OPTIONAL_NOTE } from '@/lib/clients/ssn';

const TONE: Record<string, string> = {
  signed: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  pending: 'bg-sky-50 text-sky-800 ring-sky-200',
  missing: 'bg-rose-50 text-rose-800 ring-rose-200',
  expired: 'bg-amber-50 text-amber-800 ring-amber-200',
  revoked: 'bg-slate-200 text-slate-800 ring-slate-300',
  needs_resign: 'bg-violet-50 text-[#5C2D91] ring-violet-200',
  declined: 'bg-slate-100 text-slate-700 ring-slate-200',
};

export function ClientConsentsCard({ clientId, allowed, canEdit }: { clientId: string; allowed: boolean; canEdit: boolean }) {
  const [items, setItems] = useState<ClientConsentItem[] | null>(null);
  const [error, setError] = useState('');
  const [ssn, setSsn] = useState<{ masked: string | null; canReveal: boolean; full: string | null; encryptionConfigured: boolean } | null>(null);
  const [editing, setEditing] = useState(false);
  const [ssnInput, setSsnInput] = useState('');
  const [ssnMsg, setSsnMsg] = useState('');

  const load = useCallback(async () => {
    if (!allowed) return;
    try {
      const [c, s] = await Promise.all([
        fetch(`/api/consents/library/clients/${encodeURIComponent(clientId)}`, { cache: 'no-store' }).then((r) => r.json()),
        fetch(`/api/clients/${encodeURIComponent(clientId)}/ssn`, { cache: 'no-store' }).then((r) => r.json()).catch(() => null),
      ]);
      if (!c.success) throw new Error(c.error || 'Could not load consents');
      setItems((c.items as ClientConsentItem[]).filter((i) => i.required));
      if (s?.success) setSsn({ masked: s.masked, canReveal: s.canReveal, full: null, encryptionConfigured: s.encryptionConfigured });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load consents');
    }
  }, [allowed, clientId]);
  useEffect(() => {
    void load();
  }, [load]);

  const reveal = async () => {
    const d = await fetch(`/api/clients/${encodeURIComponent(clientId)}/ssn?reveal=1`, { cache: 'no-store' }).then((r) => r.json());
    if (d.success && ssn) setSsn({ ...ssn, full: d.ssn ?? null });
    setSsnMsg(d.success ? d.note ?? '' : d.error ?? 'Not allowed');
  };

  const saveSsn = async () => {
    const err = ssnError(ssnInput);
    if (err) return setSsnMsg(err);
    const d = await fetch(`/api/clients/${encodeURIComponent(clientId)}/ssn`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ssn: ssnInput.trim() || null }) }).then((r) => r.json());
    setSsnMsg(d.success ? d.note ?? 'Saved.' : d.error ?? 'Could not save');
    if (d.success) {
      setEditing(false);
      setSsnInput('');
      await load();
    }
  };

  if (!allowed) return null;
  const needs = (items ?? []).filter((i) => i.needsAction);
  return (
    <div className="clinic-card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div>
          <h3 className="clinic-section-title">Required consents</h3>
          <p className="mt-0.5 text-xs text-slate-500">From the practice&apos;s intake packet and this client&apos;s services</p>
        </div>
        <Link href={`/dashboard/ehr/consents/client/${encodeURIComponent(clientId)}`} className="clinic-btn-secondary inline-flex items-center gap-1 text-sm">
          <FileSignature size={14} aria-hidden /> Manage consents
        </Link>
      </div>
      <div className="px-5 py-4">
        {error ? <p className="text-sm text-rose-700">{error}</p> : null}
        {!items && !error ? <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={14} className="animate-spin" aria-hidden /> Loading…</p> : null}
        {items ? (
          <>
            <p className="mb-2 text-sm text-slate-700">{needs.length ? `${needs.length} of ${items.length} need action` : `All ${items.length} required consents are signed`}</p>
            <ul className="grid gap-1 sm:grid-cols-2">
              {items.map((i) => (
                <li key={i.itemKey} className="flex items-center justify-between gap-2 rounded-md border border-slate-100 px-2 py-1 text-[12.5px]">
                  <span className="truncate">{i.title}</span>
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10.5px] font-semibold ring-1 ${TONE[i.state]}`}>{CONSENT_STATE_LABEL[i.state]}{i.signedVersion ? ` v${i.signedVersion}` : ''}</span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {ssn ? (
          <div className="mt-4 border-t border-slate-100 pt-3 text-[12.5px] text-slate-700">
            <span className="font-semibold">Social Security Number:</span> {ssn.full ?? ssn.masked ?? 'not on file'}{' '}
            {ssn.masked && ssn.canReveal && !ssn.full ? (
              <button type="button" onClick={() => void reveal()} className="ml-1 inline-flex items-center gap-1 text-[#5C2D91] underline"><Eye size={12} aria-hidden /> Show (audited)</button>
            ) : null}
            {canEdit && !editing ? (
              <button type="button" onClick={() => setEditing(true)} className="ml-2 inline-flex items-center gap-1 text-[#5C2D91] underline"><Pencil size={12} aria-hidden /> {ssn.masked ? 'Change' : 'Add'}</button>
            ) : null}
            <span className="block text-[11px] text-slate-500">{SSN_OPTIONAL_NOTE}{!ssn.encryptionConfigured ? ' Field encryption is not configured on this server, so only the last four digits are kept.' : ''}</span>
            {editing ? (
              <span className="mt-2 flex flex-wrap items-center gap-2">
                <input aria-label="Social Security Number" inputMode="numeric" autoComplete="off" className="w-40 rounded-lg border border-slate-300 px-2 py-1 text-[13px]" placeholder="123-45-6789 (blank clears)" value={ssnInput} onChange={(e) => setSsnInput(e.target.value)} />
                <button type="button" onClick={() => void saveSsn()} className="rounded-lg bg-[#5C2D91] px-2 py-1 text-[12px] font-semibold text-white">Save</button>
                <button type="button" onClick={() => setEditing(false)} className="text-[12px] underline">Cancel</button>
              </span>
            ) : null}
            {ssnMsg ? <span className="block text-[11.5px] text-slate-600">{ssnMsg}</span> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
