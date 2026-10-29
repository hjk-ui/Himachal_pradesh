'use client';

/**
 * Why a draft therapy progress note cannot be signed yet (no active, signed treatment plan).
 * Shown to the author, supervisors and admins on the note view. The server applies the same
 * rule when the note is signed.
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ClipboardList, ShieldAlert } from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import { noteRequiresTreatmentPlan } from '@/lib/ehr/therapy/rules';

export function PlanGateNotice({ clientId, noteType, cptCode }: { clientId: string; noteType: string; cptCode: string | null }) {
  const needed = noteRequiresTreatmentPlan({ noteType, cptCode });
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    if (!needed || !clientId) return;
    let cancelled = false;
    const qs = new URLSearchParams({ noteType, ...(cptCode ? { cptCode } : {}) });
    apiJson<{ success: true; gate: { ok: boolean; message: string } }>(`/api/clients/${encodeURIComponent(clientId)}/treatment-plan-status?${qs.toString()}`)
      .then((res) => !cancelled && setMessage(res.gate.ok ? null : res.gate.message))
      .catch(() => !cancelled && setMessage(null));
    return () => {
      cancelled = true;
    };
  }, [needed, clientId, noteType, cptCode]);
  if (!needed || !message) return null;
  return (
    <div className="space-y-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
      <p className="flex items-start gap-2 font-semibold">
        <ShieldAlert size={14} className="mt-0.5 shrink-0" /> This note cannot be signed yet
      </p>
      <p>{message}</p>
      <Link href={`/dashboard/ehr/treatment-plans/therapy?clientId=${encodeURIComponent(clientId)}`} className="inline-flex items-center gap-1 font-semibold underline">
        <ClipboardList size={12} /> Create treatment plan
      </Link>
    </div>
  );
}
