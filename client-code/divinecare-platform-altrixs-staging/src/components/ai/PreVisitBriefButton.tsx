'use client';

/**
 * "Brief" button for appointment rows (therapist / prescriber homes, calendar details) that opens
 * the pre-visit brief in a right-side drawer. Hidden for roles that cannot get a brief.
 * The drawer is portaled to <body> so it works inside transformed modals.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { ClipboardCheck, X } from 'lucide-react';
import { useAuth } from '@/features/auth';
import { isClinicalStaff } from '@/types/roles';
import { PreVisitBriefBody, usePreVisitBrief } from '@/components/ai/PreVisitBrief';

export function canSeePreVisitBrief(role: string | null | undefined): boolean {
  return isClinicalStaff(role) && role !== 'PEER_SUPPORT';
}

function Drawer({ clientId, clientLabel, onClose }: { clientId: string; clientLabel?: string; onClose: () => void }) {
  const { brief, error, loading, load } = usePreVisitBrief(clientId, true);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[70] flex justify-end bg-black/30" onClick={onClose} role="presentation">
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Pre-visit brief"
        className="flex h-full w-full max-w-md flex-col bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#5C2D91]">Pre-Visit Brief</p>
            {clientLabel ? <p className="truncate text-base font-bold text-slate-900">{clientLabel}</p> : null}
            <Link href={`/dashboard/clients/${encodeURIComponent(clientId)}`} className="text-xs font-semibold text-[#5C2D91] hover:underline">
              Open chart
            </Link>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <PreVisitBriefBody brief={brief} loading={loading} error={error} onRefresh={() => void load(true)} />
        </div>
      </aside>
    </div>
  );
}

export function PreVisitBriefButton({ clientId, clientLabel, className = '', label = 'Brief' }: { clientId: string | null | undefined; clientLabel?: string; className?: string; label?: string }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!clientId || !canSeePreVisitBrief(user?.role)) return null;
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className={`inline-flex shrink-0 items-center gap-1 rounded-full border border-purple-200 bg-purple-50 px-2.5 py-1 text-xs font-semibold text-[#5C2D91] hover:bg-purple-100 ${className}`}
        title="Pre-visit brief: changes since last visit, scores, risk flags, open items"
      >
        <ClipboardCheck size={12} aria-hidden /> {label}
      </button>
      {open && mounted ? createPortal(<Drawer clientId={clientId} clientLabel={clientLabel} onClose={() => setOpen(false)} />, document.body) : null}
    </>
  );
}
