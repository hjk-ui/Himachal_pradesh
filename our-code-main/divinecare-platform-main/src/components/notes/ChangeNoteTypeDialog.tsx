'use client';

import { Button } from '@/components/ui/Button';
import {
  TYPE_CHANGE_CTA,
  TYPE_CHANGE_TITLE,
  typeChangeBody,
} from '@/lib/notes/typeChange';

export function ChangeNoteTypeDialog({
  open,
  fromLabel,
  toLabel,
  onCancel,
  onConfirm,
  busy,
}: {
  open: boolean;
  fromLabel: string;
  toLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  busy?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-xs">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-900">{TYPE_CHANGE_TITLE}</h2>
        </div>
        <div className="px-5 py-4">
          <p className="text-sm text-slate-700">{typeChangeBody(fromLabel, toLabel)}</p>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" loading={busy} onClick={onConfirm}>
            {TYPE_CHANGE_CTA}
          </Button>
        </div>
      </div>
    </div>
  );
}
