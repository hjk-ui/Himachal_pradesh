'use client';

/** Chart Summary tab card: "Pre-Visit Brief" (loads on demand, then Refresh). */
import { ClipboardCheck, Loader2 } from 'lucide-react';
import { PreVisitBriefBody, usePreVisitBrief } from '@/components/ai/PreVisitBrief';
import { canSeePreVisitBrief } from '@/components/ai/PreVisitBriefButton';
import { useAuth } from '@/features/auth';

export function PreVisitBriefCard({ clientId }: { clientId: string }) {
  const { user } = useAuth();
  const { brief, error, loading, load } = usePreVisitBrief(clientId, false);
  if (!canSeePreVisitBrief(user?.role)) return null;
  return (
    <div className="rounded-2xl border-2 border-purple-200 bg-white p-5 shadow-xs">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <ClipboardCheck size={16} className="text-[#5C2D91]" aria-hidden />
        <p className="flex-1 text-sm font-bold text-slate-900">Pre-Visit Brief</p>
      </div>
      {brief || error ? (
        <PreVisitBriefBody brief={brief} loading={loading} error={error} onRefresh={() => void load(true)} />
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-2xl text-xs text-slate-500">
            30-second summary before the session: changes since the last visit, PHQ-9 / GAD-7 / C-SSRS trend, risk flags,
            plan review, session frequency, open items and the last plan. Built from chart facts; verify before relying on it.
          </p>
          <button
            type="button"
            onClick={() => void load(false)}
            disabled={loading}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold text-white shadow-xs transition hover:opacity-90 disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #5C2D91, #7C3AED)' }}
          >
            {loading ? <Loader2 size={13} className="animate-spin" aria-hidden /> : null}
            {loading ? 'Building…' : 'Show brief'}
          </button>
        </div>
      )}
    </div>
  );
}
