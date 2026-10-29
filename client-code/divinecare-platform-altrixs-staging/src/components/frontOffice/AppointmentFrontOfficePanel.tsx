'use client';

import { useEffect, useRef } from 'react';
import { ClipboardCheck, Loader2 } from 'lucide-react';
import { isOpen } from '@/lib/frontOffice/rules';
import { FrontOfficeItemList, PHASE_LABELS } from './FrontOfficeItemList';
import { phasesFor } from './FrontDeskHuddle';
import { useFrontOffice } from './useFrontOffice';
import { StatusBadge } from '@/components/ui';

type Props = {
  appointmentId: string;
  /** Visit status as shown on the board; a change reloads the checks */
  statusKey?: string;
  /** Item id to highlight (deep link ?focus=) */
  focus?: string | null;
  onCheckIn?: () => void;
};

/** Front desk checklist inside the appointment detail (front office roles). Same checks as the huddle. */
export function AppointmentFrontOfficePanel({ appointmentId, statusKey, focus, onCheckIn }: Props) {
  const { day, loading, error, reload } = useFrontOffice({ appointmentId });
  const ref = useRef<HTMLDivElement>(null);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    reload();
  }, [statusKey, reload]);

  useEffect(() => {
    if (focus && day) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [focus, day]);

  const row = day?.rows[0];
  if (loading && !row) {
    return (
      <div role="status" className="flex items-center gap-2 rounded-lg border border-slate-200 px-3.5 py-2.5 text-xs text-slate-500">
        <Loader2 size={13} className="animate-spin" aria-hidden /> Loading front desk checks…
      </div>
    );
  }
  if (error || !row) return error ? <p role="alert" className="text-xs text-rose-700">{error}</p> : null;
  const tab = row.date > (day?.today ?? row.date) ? 'tomorrow' : 'today';
  const phases = phasesFor(tab, row.status);
  const open = row.items.filter((x) => phases.includes(x.phase) && isOpen(x) && x.level === 'required').length;

  return (
    <div ref={ref} className="rounded-lg border border-slate-200 p-3.5">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
          <ClipboardCheck size={14} className="text-blue-600" aria-hidden /> Front desk checklist
        </span>
        <StatusBadge tone={open ? 'warning' : 'success'} size="sm">{open ? `${open} to do` : 'Ready'}</StatusBadge>
      </div>
      {phases.map((phase) => {
        const list = row.items.filter((x) => x.phase === phase);
        if (!list.length) return null;
        return (
          <div key={phase} className="mt-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{PHASE_LABELS[phase]}</p>
            <FrontOfficeItemList row={row} items={list} onChanged={reload} onCheckIn={onCheckIn} focus={focus} />
          </div>
        );
      })}
    </div>
  );
}
