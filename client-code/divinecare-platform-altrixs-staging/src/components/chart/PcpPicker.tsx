'use client';

import { useState } from 'react';
import { apiJson } from '@/lib/api-client';
import type { PcpReviewDisplay } from '@/lib/medical/pcpAssignment';

type PcpInfo = {
  current: { userId: string | null; displayName: string; source: string } | null;
  status: string;
  statusLabel: string;
  suggested: { id: string; name: string } | null;
  evidence: { userId: string | null; name: string; last12Months: number; total: number; lastDate: string }[];
  canEdit: boolean;
  choices: { id: string; name: string }[];
};

/** The one PCP set path: PUT /api/clients/[id]/pcp (canChangePcp gate, audited, care team member) */
async function putPcp(clientId: string, providerId: string) {
  await apiJson(`/api/clients/${encodeURIComponent(clientId)}/pcp`, { method: 'PUT', body: JSON.stringify({ providerId, via: 'chart' }) });
}

/**
 * No staff PCP of record: "PCP: to confirm" with every provider the visits point to ("seen by A, B")
 * and a one-click "Set as PCP" next to each (when the viewer may change the PCP and the contender is
 * an active physician / medical NP), or "PCP: not assigned".
 */
export function PcpReviewInline({
  clientId,
  review,
  canSet,
  onSaved,
}: {
  clientId: string;
  review: PcpReviewDisplay;
  canSet: boolean;
  onSaved?: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = async (providerId: string) => {
    setBusy(providerId);
    setError(null);
    try {
      await putPcp(clientId, providerId);
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setBusy(null);
    }
  };
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 whitespace-normal">
      <span className={review.state === 'to_confirm' ? 'text-sky-800' : 'text-amber-700'}>{review.label}</span>
      {review.contenders.length ? <span className="font-medium text-slate-500">seen by</span> : null}
      {review.contenders.map((c, i) => (
        <span key={c.userId ?? c.name} className="inline-flex min-w-0 max-w-full items-center gap-1" title={`${c.inWindow} in the last 12 months, last ${c.lastDate}`}>
          <span className="min-w-0 truncate">
            {c.name}
            {i < review.contenders.length - 1 && !(canSet && c.canSet) ? ',' : ''}
          </span>
          {canSet && c.canSet && c.userId ? (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void set(c.userId!)}
              className="inline-flex min-h-7 shrink-0 items-center rounded-md px-1.5 text-[11px] font-semibold text-[#5C2D91] ring-1 ring-[#5C2D91]/30 hover:bg-[#5C2D91]/5 disabled:opacity-50"
            >
              {busy === c.userId ? 'Saving…' : 'Set as PCP'}
            </button>
          ) : null}
        </span>
      ))}
      {error ? <span className="basis-full text-[11px] font-medium text-rose-700">{error}</span> : null}
    </span>
  );
}

/**
 * "Change" link next to the PCP in the chart header: shows who the visits point to and a picker of
 * active physicians / medical NPs. Saving calls PUT /api/clients/[id]/pcp (audited). The behavioral
 * health clinician is not affected.
 */
export function PcpPicker({ clientId, onSaved }: { clientId: string; onSaved?: () => void }) {
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState<PcpInfo | null>(null);
  const [choice, setChoice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      const data = await apiJson<PcpInfo>(`/api/clients/${encodeURIComponent(clientId)}/pcp`, { cache: 'no-store' });
      setInfo(data);
      setChoice(data.current?.userId ?? '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the PCP');
    }
  };

  const save = async () => {
    if (!choice) return;
    setBusy(true);
    setError(null);
    try {
      await putPcp(clientId, choice);
      setOpen(false);
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="relative shrink-0">
      <button
        type="button"
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) void load();
        }}
        className="inline-flex min-h-8 items-center rounded px-1 text-[11px] font-semibold text-[#5C2D91] hover:underline"
        aria-expanded={open}
      >
        {open ? 'Close' : 'Review'}
      </button>
      {open ? (
        <div className="fixed inset-x-3 top-24 z-30 max-h-[calc(100dvh-8rem)] overflow-y-auto rounded-xl sm:absolute sm:inset-x-auto sm:left-0 sm:top-5 sm:w-80 border border-slate-200 bg-white p-3 text-xs font-normal text-slate-700 shadow-lg">
          {error ? <p className="mb-2 text-rose-700">{error}</p> : null}
          {!info ? (
            !error ? <p className="text-slate-500">Loading…</p> : null
          ) : (
            <div className="space-y-2">
              <p>
                <span className="font-semibold">Current PCP:</span> {info.current?.displayName ?? 'Not set'}
                {info.current && !info.current.userId ? <span className="text-amber-700"> (intake text, not a staff account)</span> : null}
              </p>
              <p>
                <span className="font-semibold">Visits:</span> {info.statusLabel}
              </p>
              {info.evidence.length ? (
                <ul className="list-disc pl-4 text-slate-600">
                  {info.evidence.map((e) => (
                    <li key={`${e.userId ?? e.name}`}>
                      {e.name}: {e.last12Months} in the last 12 months ({e.total} total, last {e.lastDate})
                    </li>
                  ))}
                </ul>
              ) : null}
              {info.canEdit ? (
                <div className="space-y-1.5 border-t border-slate-100 pt-2">
                  <label htmlFor={`pcp-${clientId}`} className="block font-semibold">
                    Set PCP (physicians and medical NPs)
                  </label>
                  <select
                    id={`pcp-${clientId}`}
                    value={choice}
                    onChange={(e) => setChoice(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 p-1.5"
                  >
                    <option value="">Choose a provider</option>
                    {info.choices.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {info.suggested?.id === c.id ? ' (seen most)' : ''}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={!choice || busy || choice === info.current?.userId}
                    onClick={() => void save()}
                    className="rounded-lg bg-[#5C2D91] px-3 py-1.5 font-semibold text-white disabled:opacity-50"
                  >
                    {busy ? 'Saving…' : 'Save PCP'}
                  </button>
                  <p className="text-slate-500">Does not change the behavioral health clinician. The change is recorded in the audit log.</p>
                </div>
              ) : (
                <p className="text-slate-500">Front desk, leadership or a medical provider can change the PCP.</p>
              )}
            </div>
          )}
        </div>
      ) : null}
    </span>
  );
}
