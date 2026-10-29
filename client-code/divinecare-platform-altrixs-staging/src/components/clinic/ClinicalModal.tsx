'use client';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export type ClinicalModalSize = 'sm' | 'md' | 'lg' | 'xl';

const SIZE_CLASS: Record<ClinicalModalSize, string> = {
  sm: 'max-w-md',
  md: 'max-w-2xl',
  lg: 'max-w-4xl',
  xl: 'max-w-6xl',
};

/**
 * Native <dialog> modal: focus trap, Escape and inert background come from the browser.
 * `footer` renders in a sticky action bar; `dismissible={false}` blocks Escape/close (e.g. while saving).
 */
export function ClinicalModal({
  title,
  children,
  onClose,
  size = 'md',
  footer,
  dismissible = true,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  size?: ClinicalModalSize;
  footer?: ReactNode;
  dismissible?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (dismissible) onClose();
      }}
      className={`m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-1.5rem)] sm:w-[calc(100%-2rem)] ${SIZE_CLASS[size]} overflow-y-auto overscroll-contain rounded-xl border border-slate-200 bg-white p-0 text-slate-900 shadow-xl backdrop:bg-slate-950/50`}
    >
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:p-5">
        <h2 id={titleId} className="min-w-0 break-words text-lg font-semibold">
          {title}
        </h2>
        <button
          type="button"
          aria-label="Close dialog"
          onClick={onClose}
          disabled={!dismissible}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <X size={20} aria-hidden />
        </button>
      </div>
      <div className="min-w-0 space-y-4 p-4 sm:p-5">{children}</div>
      {footer ? (
        <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5 sm:py-4">
          {footer}
        </div>
      ) : null}
    </dialog>
  );
}
