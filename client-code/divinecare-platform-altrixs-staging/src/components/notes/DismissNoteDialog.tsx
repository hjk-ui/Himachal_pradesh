'use client';

import { useState } from 'react';
import { ConfirmDialog } from '@/components/ui';
import { apiJson } from '@/lib/api-client';
import {
  composeDismissReason,
  DISMISS_REASON_MAX_CHARS,
  DISMISS_REASONS,
  DISMISS_UNDO_DAYS,
  dismissReasonError,
} from '@/lib/notes/dismiss';

/**
 * "Dismiss note" confirmation for an unsigned note (editor, note view, worklist row): reason picker
 * + details, POST /api/notes/[id]/dismiss. The note is kept (read-only) and can be undone by the
 * author within DISMISS_UNDO_DAYS.
 */
export function DismissNoteDialog({
  noteId,
  clientName,
  onDismissed,
  onCancel,
}: {
  noteId: string;
  clientName?: string | null;
  onDismissed: () => void;
  onCancel: () => void;
}) {
  const [choice, setChoice] = useState<string>('');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reason = composeDismissReason(choice, details);
  const reasonError = !choice ? 'Choose a reason.' : choice === 'Other' && !details.trim() ? 'Describe the reason.' : dismissReasonError(reason);

  const confirm = async () => {
    if (reasonError) {
      setError(reasonError);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiJson(`/api/notes/${encodeURIComponent(noteId)}/dismiss`, { method: 'POST', body: JSON.stringify({ reason }) });
      onDismissed();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not dismiss the note');
      setBusy(false);
    }
  };

  return (
    <ConfirmDialog
      title="Dismiss note"
      confirmLabel="Dismiss note"
      tone="danger"
      busy={busy}
      onConfirm={confirm}
      onCancel={onCancel}
    >
      <p>
        Dismiss this unsigned note{clientName ? ` for ${clientName}` : ''}? It leaves your drafts, the visit shows &quot;No note&quot; again and
        nothing is billed. The note is kept read-only for the record; you can undo within {DISMISS_UNDO_DAYS} days.
      </p>
      <label className="mt-3 block text-xs font-semibold text-slate-600">
        Reason *
        <select
          aria-label="Reason for dismissing"
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm text-slate-900"
        >
          <option value="">Select reason…</option>
          {DISMISS_REASONS.map((r) => (
            <option key={r} value={r}>
              {r === 'Other' ? 'Other…' : r}
            </option>
          ))}
        </select>
      </label>
      <label className="mt-2 block text-xs font-semibold text-slate-600">
        {choice === 'Other' ? 'Details *' : 'Details (optional)'}
        <textarea
          aria-label="Dismiss details"
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          rows={2}
          maxLength={DISMISS_REASON_MAX_CHARS - 10}
          placeholder={choice === "Visit didn't happen" ? 'e.g. Client cancelled at check-in' : 'e.g. Started a second note for the same visit'}
          className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm text-slate-900"
        />
      </label>
      {error ? <p className="mt-2 text-xs font-medium text-rose-700">{error}</p> : null}
    </ConfirmDialog>
  );
}
