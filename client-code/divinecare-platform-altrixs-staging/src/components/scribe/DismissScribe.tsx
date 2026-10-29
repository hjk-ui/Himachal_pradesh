'use client';

/**
 * "Dismiss scribe": stop and discard the capture (during the session, or after it before a draft
 * note exists). Asks first; the reason is optional and comes from a fixed list (no free text).
 */
import { useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { DISMISS_CONFIRM, DISMISS_LABEL, DISMISS_REASONS, DISMISS_REASON_LABELS, type DismissReason } from '@/lib/scribe/dismiss';

export function DismissScribe({ onConfirm, disabled }: { onConfirm: (reason?: DismissReason) => Promise<void> | void; disabled?: boolean }) {
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState<DismissReason | ''>('');
  const [busy, setBusy] = useState(false);

  if (!asking) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setAsking(true)}
        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-40"
      >
        <Trash2 size={13} /> {DISMISS_LABEL}
      </button>
    );
  }
  return (
    <div role="alertdialog" aria-label={DISMISS_LABEL} className="flex w-full flex-wrap items-center gap-2 rounded-lg border border-rose-200 bg-white px-3 py-2">
      <p className="text-sm font-semibold text-slate-900">{DISMISS_CONFIRM}</p>
      <label className="text-xs text-slate-600">
        Reason (optional){' '}
        <select value={reason} onChange={(e) => setReason(e.target.value as DismissReason | '')} className="rounded-lg border border-slate-200 px-2 py-1 text-xs">
          <option value="">No reason given</option>
          {DISMISS_REASONS.map((r) => (
            <option key={r} value={r}>
              {DISMISS_REASON_LABELS[r]}
            </option>
          ))}
        </select>
      </label>
      <span className="ml-auto flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm(reason || undefined);
            } finally {
              setBusy(false);
              setAsking(false);
            }
          }}
          className="inline-flex items-center gap-1 rounded-lg bg-rose-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Stop and discard
        </button>
        <button type="button" disabled={busy} onClick={() => setAsking(false)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">
          Keep it
        </button>
      </span>
    </div>
  );
}
