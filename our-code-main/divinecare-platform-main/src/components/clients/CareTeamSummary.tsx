'use client';

import { useMemo, useState } from 'react';
import {
  buildCareTeamSummary,
  SET_AS_PCP,
  UNASSIGNED_LABEL,
  type CareTeamChip,
  type CareTeamSummaryInput,
} from '@/lib/clients/careTeamSummary';

export type CareTeamSummaryProps = Omit<CareTeamSummaryInput, 'maxChips'> & {
  clientId: string;
  /** Show "Set as PCP" (leadership / front desk / caseload — same gate as the API). */
  canSetPcp?: boolean;
  /** Called after the PCP was saved so the list can reload. */
  onPcpSet?: () => void;
  maxChips?: number;
};

const CHIP_BASE = 'inline-flex max-w-full items-center truncate rounded-md px-1.5 py-0.5 text-[11px] font-semibold';
const CHIP_ASSIGNED = `${CHIP_BASE} bg-blue-50 text-blue-700 ring-1 ring-blue-100`;
const CHIP_SEEN = `${CHIP_BASE} bg-slate-100 text-slate-700 ring-1 ring-slate-200`;

function chipTitle(chip: CareTeamChip): string {
  if (chip.kind === 'seen') {
    return chip.lastSeenAt ? `${chip.text} — last seen ${chip.lastSeenAt.slice(0, 10)}` : chip.text;
  }
  return chip.name ? `${chip.label}: ${chip.name}` : chip.label;
}

/**
 * Care team on client cards / list rows: primary clinician, slot chips (assigned + seen-by),
 * "+N more", and the PCP state with "Set as PCP".
 */
export function CareTeamSummary({
  clientId,
  canSetPcp = false,
  onPcpSet,
  maxChips,
  ...input
}: CareTeamSummaryProps) {
  const summary = useMemo(
    () => buildCareTeamSummary({ ...input, maxChips }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [input.treatmentTeam, input.assignedToId, input.assignedToName, input.assignedToRole, input.seenBy, maxChips]
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const setPcp = async (providerId: string) => {
    if (busyId) return;
    setBusyId(providerId);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${encodeURIComponent(clientId)}/pcp`, {
        method: 'PUT',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId, via: 'chart' }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || data.success === false) {
        throw new Error(typeof data?.error === 'string' ? data.error : 'Could not set PCP');
      }
      onPcpSet?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not set PCP');
    } finally {
      setBusyId(null);
    }
  };

  const { primary, chips, moreCount, moreTitle, pcp } = summary;
  const settable = pcp.status === 'to_confirm' ? pcp.candidates.filter((c) => c.canSet) : [];

  return (
    <div className="min-w-0 space-y-1.5">
      {primary ? (
        <p className="truncate text-xs font-semibold text-slate-800" title={primary.text}>
          {primary.text}
        </p>
      ) : (
        <span className="inline-flex items-center rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700 ring-1 ring-amber-200">
          {UNASSIGNED_LABEL}
        </span>
      )}

      {chips.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {chips.map((chip) => (
            <span
              key={chip.key}
              title={chipTitle(chip)}
              className={chip.kind === 'seen' ? CHIP_SEEN : CHIP_ASSIGNED}
            >
              {chip.text}
            </span>
          ))}
          {moreCount > 0 ? (
            <span title={moreTitle} className={`${CHIP_BASE} bg-white text-slate-600 ring-1 ring-slate-200`}>
              +{moreCount} more
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="text-[11px] text-slate-500">
        <span className={pcp.status === 'to_confirm' ? 'font-semibold text-amber-700' : 'font-medium'}>
          {pcp.text}
        </span>
        {pcp.status === 'to_confirm' ? <span> · {pcp.seenByText}</span> : null}

        {canSetPcp && settable.length === 1 ? (
          <button
            type="button"
            onClick={() => void setPcp(settable[0].providerId!)}
            disabled={busyId !== null}
            aria-label={`${SET_AS_PCP}: ${settable[0].name}`}
            className="ml-2 inline-flex min-h-8 items-center rounded-lg px-2 text-[11px] font-semibold text-blue-600 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:opacity-50"
          >
            {SET_AS_PCP}
          </button>
        ) : null}
      </div>

      {canSetPcp && settable.length > 1 ? (
        <ul className="space-y-0.5">
          {settable.map((c) => (
            <li key={c.providerId} className="flex items-center justify-between gap-2 text-[11px] text-slate-600">
              <span className="min-w-0 truncate">{c.name}</span>
              <button
                type="button"
                onClick={() => void setPcp(c.providerId!)}
                disabled={busyId !== null}
                aria-label={`${SET_AS_PCP}: ${c.name}`}
                className="inline-flex min-h-8 shrink-0 items-center rounded-lg px-2 text-[11px] font-semibold text-blue-600 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:opacity-50"
              >
                {SET_AS_PCP}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {error ? (
        <p role="alert" className="text-[11px] text-rose-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
