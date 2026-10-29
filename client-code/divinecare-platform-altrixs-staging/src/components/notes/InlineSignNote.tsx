'use client';

import { useState } from 'react';
import Link from 'next/link';
import { PenLine } from 'lucide-react';
import { buttonClasses, ConfirmDialog } from '@/components/ui';
import { apiJson } from '@/lib/api-client';
import { LATE_REASON_MIN_CHARS, SIGNER_ATTESTATION } from '@/lib/notes/standard';

type Readiness = {
  ready: boolean;
  nextStep: string | null;
  lateEntryRequired: boolean;
  lateReasonMinChars: number;
  openHref: string;
};

/**
 * "Sign" without opening the note (worklist, inbox, Today). Offered only for a note with nothing
 * blocking signature: when the caller does not already know (`ready` undefined) it asks
 * GET /api/notes/[id]/sign-readiness first, and a note with blockers shows the first blocker and
 * "Open to finish" instead. Signing is the normal PATCH /api/notes/[id] (attestation required,
 * late-entry reason past the practice deadline); any server refusal is shown with "Open to finish".
 */
export function InlineSignNote({
  noteId,
  clientName,
  ready,
  lateEntryRequired,
  openHref,
  onSigned,
  size = 'sm',
}: {
  noteId: string;
  clientName?: string | null;
  /** Known readiness (worklist row); undefined = check on click */
  ready?: boolean;
  lateEntryRequired?: boolean;
  openHref: string;
  onSigned: () => void;
  size?: 'sm' | 'md';
}) {
  const [checking, setChecking] = useState(false);
  const [info, setInfo] = useState<Readiness | null>(
    ready === undefined ? null : { ready, nextStep: null, lateEntryRequired: Boolean(lateEntryRequired), lateReasonMinChars: LATE_REASON_MIN_CHARS, openHref }
  );
  const [open, setOpen] = useState(false);
  const [attested, setAttested] = useState(false);
  const [lateReason, setLateReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const finishHref = info?.openHref || openHref;

  const start = async () => {
    setError(null);
    let r = info;
    if (!r || ready === undefined) {
      setChecking(true);
      try {
        const res = await apiJson<{ success: true; readiness: Readiness }>(`/api/notes/${encodeURIComponent(noteId)}/sign-readiness`);
        r = res.readiness;
        setInfo(r);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not check the note');
        return;
      } finally {
        setChecking(false);
      }
    }
    if (r.ready) {
      setAttested(false);
      setLateReason('');
      setOpen(true);
    }
  };

  const minChars = info?.lateReasonMinChars ?? LATE_REASON_MIN_CHARS;
  const sign = async () => {
    if (!attested) {
      setError('Confirm the attestation to sign.');
      return;
    }
    if (info?.lateEntryRequired && lateReason.trim().length < minChars) {
      setError(`Enter a late-entry reason (at least ${minChars} characters).`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiJson(`/api/notes/${encodeURIComponent(noteId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'signed', attested: true, ...(info?.lateEntryRequired ? { lateEntryReason: lateReason.trim() } : {}) }),
      });
      setOpen(false);
      onSigned();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign the note');
      setOpen(false);
      setInfo((cur) => (cur ? { ...cur, ready: false } : cur));
    } finally {
      setBusy(false);
    }
  };

  const blocked = info && !info.ready;
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
      {blocked ? (
        <Link href={finishHref} className={buttonClasses({ size: 'sm', variant: 'secondary' })} title={info.nextStep || undefined}>
          Open to finish
        </Link>
      ) : (
        <button type="button" onClick={() => void start()} disabled={checking} aria-busy={checking || undefined} className={buttonClasses({ size: size === 'md' ? 'md' : 'sm' })}>
          <PenLine size={13} aria-hidden /> {checking ? 'Checking…' : 'Sign'}
        </button>
      )}
      {blocked && info.nextStep ? <span className="w-full text-right text-[11px] text-amber-800">Next: {info.nextStep}</span> : null}
      {error && !open ? (
        <span role="alert" className="w-full text-right text-[11px] font-medium text-rose-700">
          {error}
        </span>
      ) : null}
      {open ? (
        <ConfirmDialog
          title="Sign note"
          confirmLabel="Sign note"
          busy={busy}
          onConfirm={sign}
          onCancel={() => {
            setOpen(false);
            setError(null);
          }}
        >
          <p>Sign this note{clientName ? ` for ${clientName}` : ''} as it is? A signed note can only be changed with an addendum.</p>
          <label className="mt-3 flex items-start gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={attested} onChange={(e) => setAttested(e.target.checked)} className="mt-0.5 accent-blue-600" />
            <span>{SIGNER_ATTESTATION}</span>
          </label>
          {info?.lateEntryRequired ? (
            <label className="mt-3 block text-xs font-semibold text-slate-600">
              Late-entry reason * (past the practice sign deadline)
              <textarea
                value={lateReason}
                onChange={(e) => setLateReason(e.target.value)}
                rows={2}
                maxLength={500}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm text-slate-900"
              />
            </label>
          ) : null}
          {error ? <p className="mt-2 text-xs font-medium text-rose-700">{error}</p> : null}
        </ConfirmDialog>
      ) : null}
    </span>
  );
}
