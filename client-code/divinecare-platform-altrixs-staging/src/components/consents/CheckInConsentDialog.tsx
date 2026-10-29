'use client';

/**
 * Check-in soft stop dialog (src/lib/consents/library/decisions.ts): the client is missing the
 * consent to treatment (or the telehealth consent for a virtual visit). Staff either have the
 * client sign now (in-office kiosk signing for exactly those consents) or check in anyway with a
 * reason of at least 10 characters (stored and audited server side). Other gaps are listed as
 * flags and never block.
 */
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Loader2, PenLine, X } from 'lucide-react';

export type CheckInConsentPrompt = {
  appointmentId: string;
  clientId: string;
  missing: { key: string; title: string; detail: string }[];
  flags: { key: string; title: string; detail: string }[];
  isVirtual: boolean;
};

const MIN_REASON = 10;

export function CheckInConsentDialog({
  prompt,
  onClose,
  onOverride,
}: {
  prompt: CheckInConsentPrompt | null;
  onClose: () => void;
  /** Check in again with the reason; throw to show an error */
  onOverride: (reason: string) => Promise<void>;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<'choose' | 'override'>('choose');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<'sign' | 'override' | null>(null);
  const [error, setError] = useState('');
  const firstButton = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    setMode('choose');
    setReason('');
    setError('');
    setBusy(null);
    if (prompt) setTimeout(() => firstButton.current?.focus(), 0);
  }, [prompt]);

  useEffect(() => {
    if (!prompt) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prompt, busy, onClose]);

  if (!prompt) return null;

  const signNow = async () => {
    setBusy('sign');
    setError('');
    try {
      const res = await fetch(`/api/consents/library/clients/${encodeURIComponent(prompt.clientId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'in_office', keys: prompt.missing.map((m) => m.key) }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.success || !d.packetId) throw new Error(d?.error || 'Could not open in-office signing');
      router.push(`/dashboard/ehr/consents/packet/${encodeURIComponent(d.packetId)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open in-office signing');
      setBusy(null);
    }
  };

  const override = async () => {
    const r = reason.trim();
    if (r.length < MIN_REASON) {
      setError(`Enter a reason of at least ${MIN_REASON} characters.`);
      return;
    }
    setBusy('override');
    setError('');
    try {
      await onOverride(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not check in');
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="presentation" onClick={() => !busy && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="checkin-consent-title" className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <h2 id="checkin-consent-title" className="flex items-center gap-2 text-[15px] font-bold text-slate-900">
            <AlertTriangle size={17} className="text-amber-600" aria-hidden /> Consent needed before this visit
          </h2>
          <button type="button" aria-label="Close" disabled={Boolean(busy)} onClick={onClose} className="text-slate-500 hover:text-slate-900">
            <X size={16} />
          </button>
        </div>
        <p className="mt-2 text-[12.5px] text-slate-600">
          {prompt.isVirtual ? 'For a telehealth visit the client needs the consent to treatment and the telehealth consent on file.' : 'The client needs the consent to treatment on file.'}
        </p>
        <ul className="mt-3 space-y-1">
          {prompt.missing.map((m) => (
            <li key={m.key} className="rounded-md bg-rose-50 px-2 py-1.5 text-[12.5px] text-rose-800 ring-1 ring-rose-200">
              <strong>{m.title}</strong> <span className="text-rose-700">({m.detail})</span>
            </li>
          ))}
        </ul>
        {prompt.flags.length ? (
          <div className="mt-3">
            <p className="text-[11.5px] font-semibold text-slate-700">Also needs attention (does not block check-in)</p>
            <ul className="mt-1 space-y-0.5 text-[11.5px] text-slate-600">
              {prompt.flags.slice(0, 8).map((f) => (
                <li key={f.key}>{f.title}: {f.detail}</li>
              ))}
              {prompt.flags.length > 8 ? <li>and {prompt.flags.length - 8} more</li> : null}
            </ul>
          </div>
        ) : null}

        {mode === 'override' ? (
          <div className="mt-4">
            <label htmlFor="checkin-consent-reason" className="text-[12px] font-semibold text-slate-800">Reason for checking in without the consent</label>
            <textarea
              id="checkin-consent-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              rows={3}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-[13px]"
              placeholder="e.g. Client signed on paper; scanning after the visit"
            />
            <p className="text-[11px] text-slate-500">At least {MIN_REASON} characters. Recorded with your name.</p>
          </div>
        ) : null}

        {error ? <p role="alert" className="mt-3 rounded-md bg-rose-50 p-2 text-[12px] text-rose-800">{error}</p> : null}

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {mode === 'choose' ? (
            <>
              <button type="button" disabled={Boolean(busy)} onClick={() => setMode('override')} className="rounded-lg border border-slate-300 px-3 py-2 text-[12.5px] font-semibold text-slate-700 disabled:opacity-60">
                Check in anyway
              </button>
              <button ref={firstButton} type="button" disabled={Boolean(busy)} onClick={() => void signNow()} className="inline-flex items-center gap-1 rounded-lg bg-[#5C2D91] px-3 py-2 text-[12.5px] font-semibold text-white disabled:opacity-60">
                {busy === 'sign' ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <PenLine size={14} aria-hidden />} Have the client sign now
              </button>
            </>
          ) : (
            <>
              <button type="button" disabled={Boolean(busy)} onClick={() => setMode('choose')} className="rounded-lg border border-slate-300 px-3 py-2 text-[12.5px] font-semibold text-slate-700 disabled:opacity-60">
                Back
              </button>
              <button type="button" disabled={Boolean(busy) || reason.trim().length < MIN_REASON} onClick={() => void override()} className="inline-flex items-center gap-1 rounded-lg bg-amber-600 px-3 py-2 text-[12.5px] font-semibold text-white disabled:opacity-60">
                {busy === 'override' ? <Loader2 size={14} className="animate-spin" aria-hidden /> : null} Check in anyway
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
