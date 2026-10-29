'use client';

import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { ClinicalModal } from '@/components/clinic/ClinicalModal';

/**
 * Confirmation for destructive or legally significant actions. Render it only while open.
 * `busy` disables both buttons and blocks Escape so the action cannot be dismissed mid-flight.
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  busy = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'default';
  busy?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const confirmClass =
    tone === 'danger'
      ? 'bg-rose-700 hover:bg-rose-800 focus-visible:ring-rose-700'
      : 'bg-blue-600 hover:bg-blue-700 focus-visible:ring-blue-600';
  return (
    <ClinicalModal
      title={title}
      size="sm"
      onClose={onCancel}
      dismissible={!busy}
      footer={
        <>
          <button type="button" onClick={onCancel} disabled={busy} className="clinic-btn-secondary">
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={() => void onConfirm()}
            disabled={busy}
            aria-busy={busy || undefined}
            className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${confirmClass}`}
          >
            {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
            {confirmLabel}
          </button>
        </>
      }
    >
      {children ? <div className="text-sm text-slate-700">{children}</div> : null}
    </ClinicalModal>
  );
}
