'use client';

import { useState } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import { apiJson } from '@/lib/api-client';

type Method = 'verbal' | 'written' | 'portal';

/**
 * Point-of-care AI Note Drafting consent: the clinician reads the short explanation, asks the client,
 * and records the answer. Saved as the client's AI consent (same record Consents shows), audited.
 */
export function AiConsentInline({ clientId, clientName, onRecorded }: { clientId: string; clientName: string; onRecorded: () => void }) {
  const [method, setMethod] = useState<Method>('verbal');
  const [givenBy, setGivenBy] = useState<'client' | 'representative'>('client');
  const [repName, setRepName] = useState('');
  const [repRel, setRepRel] = useState('');
  const [busy, setBusy] = useState<null | 'consented' | 'declined'>(null);
  const [error, setError] = useState<string | null>(null);

  const record = async (decision: 'consented' | 'declined') => {
    setBusy(decision);
    setError(null);
    try {
      await apiJson('/api/scribe/ai-consent', {
        method: 'POST',
        body: JSON.stringify({
          clientId,
          decision,
          method,
          givenBy,
          representativeName: givenBy === 'representative' ? repName : null,
          representativeRelationship: givenBy === 'representative' ? repRel : null,
        }),
      });
      onRecorded();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the consent.');
    } finally {
      setBusy(null);
    }
  };

  const repMissing = givenBy === 'representative' && (!repName.trim() || !repRel.trim());

  return (
    <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
      <p className="flex items-center gap-2 font-semibold">
        <ShieldCheck size={16} aria-hidden /> AI note drafting consent needed for {clientName}
      </p>
      <p className="rounded-lg bg-white/70 p-3 text-slate-700">
        <span className="font-semibold">Read to the client:</span> &ldquo;With your permission, I&apos;d like to use a tool that
        transcribes our session securely and drafts my note. I review and sign the note myself. The recording isn&apos;t kept,
        and you can say no or change your mind at any time. It won&apos;t affect your care.&rdquo;
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-semibold text-slate-700">
          How it was given
          <select value={method} onChange={(e) => setMethod(e.target.value as Method)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
            <option value="verbal">Verbal (in session)</option>
            <option value="written">Written / signed form</option>
            <option value="portal">Patient portal</option>
          </select>
        </label>
        <label className="text-xs font-semibold text-slate-700">
          Given by
          <select value={givenBy} onChange={(e) => setGivenBy(e.target.value as 'client' | 'representative')} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
            <option value="client">The client</option>
            <option value="representative">Parent / guardian / representative</option>
          </select>
        </label>
        {givenBy === 'representative' && (
          <>
            <label className="text-xs font-semibold text-slate-700">
              Representative name
              <input value={repName} onChange={(e) => setRepName(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
            </label>
            <label className="text-xs font-semibold text-slate-700">
              Relationship
              <input value={repRel} onChange={(e) => setRepRel(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
            </label>
          </>
        )}
      </div>
      {error && <p role="alert" className="text-rose-700">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy !== null || repMissing}
          onClick={() => void record('consented')}
          className="inline-flex items-center gap-1.5 rounded-xl bg-[#5C2D91] px-4 py-2 font-semibold text-white disabled:opacity-50"
        >
          {busy === 'consented' && <Loader2 size={14} className="animate-spin" aria-hidden />} Client agreed
        </button>
        <button
          type="button"
          disabled={busy !== null || repMissing}
          onClick={() => void record('declined')}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-700 disabled:opacity-50"
        >
          {busy === 'declined' && <Loader2 size={14} className="animate-spin" aria-hidden />} Client declined
        </button>
      </div>
      <p className="text-xs text-amber-900/80">Saved to the client&apos;s Consents with your name and the time. Recording consent is asked separately when you start.</p>
    </div>
  );
}
