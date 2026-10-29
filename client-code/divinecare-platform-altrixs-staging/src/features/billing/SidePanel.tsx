'use client';

import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { IconButton } from '@/components/ui';

/**
 * Right-side form panel (same layout as the appointment booking panel): full height, full width
 * on a phone, max-w-xl on larger screens, sticky header and footer. Escape or the backdrop closes it.
 */
export function SidePanel({
  title,
  titleId,
  onClose,
  footer,
  children,
}: {
  title: ReactNode;
  titleId: string;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} aria-hidden />
      <div className="relative flex h-[100dvh] w-full max-w-xl flex-col bg-white shadow-2xl sm:rounded-l-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-3">
          <h2 id={titleId} className="min-w-0 truncate text-sm font-semibold text-slate-900">
            {title}
          </h2>
          <IconButton
            label="Close"
            icon={<X className="h-4 w-4" />}
            onClick={onClose}
            className="p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-5 py-4">{children}</div>
        {footer ? <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 px-5 py-3">{footer}</div> : null}
      </div>
    </div>
  );
}
