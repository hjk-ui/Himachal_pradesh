'use client';

import { Button } from '@/components/ui/Button';
import {
  DISMISS_SCRIBE_AFTER,
  DISMISS_SCRIBE_BTN,
  DISMISS_SCRIBE_CANCEL,
  DISMISS_SCRIBE_CONFIRM,
  DISMISS_SCRIBE_CTA,
} from '@/lib/scribe/formats';

export function DismissScribeDialog({
  open,
  onKeep,
  onDiscard,
  busy,
}: {
  open: boolean;
  onKeep: () => void;
  onDiscard: () => void;
  busy?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-xs">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-900">{DISMISS_SCRIBE_BTN}</h2>
        </div>
        <div className="px-5 py-4">
          <p className="text-sm text-slate-700">{DISMISS_SCRIBE_CONFIRM}</p>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
          <Button variant="secondary" size="sm" onClick={onKeep} disabled={busy}>
            {DISMISS_SCRIBE_CANCEL}
          </Button>
          <Button variant="danger" size="sm" loading={busy} onClick={onDiscard}>
            {DISMISS_SCRIBE_CTA}
          </Button>
        </div>
      </div>
    </div>
  );
}

export { DISMISS_SCRIBE_AFTER, DISMISS_SCRIBE_BTN };
