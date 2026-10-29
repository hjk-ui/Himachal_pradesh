'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import {
  DISMISS_REASONS,
  dismissConfirmBody,
  type DismissReason,
} from '@/lib/notes/dismiss';

export function DismissNoteDialog({
  open,
  clientName,
  onCancel,
  onConfirm,
  busy,
}: {
  open: boolean;
  clientName?: string | null;
  onCancel: () => void;
  onConfirm: (payload: { reason: DismissReason; details?: string }) => void;
  busy?: boolean;
}) {
  const [reason, setReason] = useState<DismissReason>('Created in error');
  const [details, setDetails] = useState('');

  if (!open) return null;

  const detailsRequired = reason === 'Other…';
  const detailsOk =
    details.trim().length <= 300 &&
    (!detailsRequired || details.trim().length >= 5) &&
    (detailsRequired || details.trim().length === 0 || details.trim().length >= 5);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-xs">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-900">Dismiss note</h2>
        </div>
        <div className="space-y-4 px-5 py-4">
          <p className="text-sm text-slate-700">{dismissConfirmBody(clientName)}</p>
          <div>
            <label className="block text-sm font-medium text-slate-700">
              Reason <span className="text-rose-600">*</span>
            </label>
            <select
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
              value={reason}
              onChange={(e) => setReason(e.target.value as DismissReason)}
            >
              {DISMISS_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700">
              Details{detailsRequired ? <span className="text-rose-600"> *</span> : null}
            </label>
            <textarea
              className="mt-1 min-h-20 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
              value={details}
              maxLength={300}
              onChange={(e) => setDetails(e.target.value)}
              placeholder={detailsRequired ? 'Required (min 5 characters)' : 'Optional'}
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="danger"
            size="sm"
            disabled={!detailsOk || busy}
            loading={busy}
            onClick={() => onConfirm({ reason, details: details.trim() || undefined })}
          >
            Dismiss note
          </Button>
        </div>
      </div>
    </div>
  );
}
