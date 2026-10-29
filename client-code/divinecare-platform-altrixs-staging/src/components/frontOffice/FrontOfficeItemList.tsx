'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AlertCircle, CheckCircle2, Info, Loader2, MinusCircle, Phone, ShieldCheck, Undo2 } from 'lucide-react';
import toast from 'react-hot-toast';
import type { FoItem, FoMarkStatus, FoPhase, FoRow } from '@/lib/frontOffice/types';
import { markFrontOfficeItem, runEligibilityFor, unmarkFrontOfficeItem } from './useFrontOffice';
import { StatusBadge } from '@/components/ui';

export const PHASE_LABELS: Record<FoPhase, string> = {
  prep: 'Before the visit',
  check_in: 'At check-in',
  check_out: 'At check-out',
  end_of_day: 'End of day',
};

function StatusIcon({ item }: { item: FoItem }) {
  if (item.status === 'done') return <CheckCircle2 size={16} className={item.warning ? 'text-amber-600' : 'text-emerald-600'} aria-label={item.warning ? 'Done, check' : 'Done'} />;
  if (item.status === 'needs_action')
    return <AlertCircle size={16} className={item.stop ? 'text-rose-600' : item.level === 'optional' ? 'text-slate-500' : 'text-amber-600'} aria-label="Needs action" />;
  if (item.status === 'info') return <Info size={16} className="text-slate-500" aria-label="Info" />;
  return <MinusCircle size={16} className="text-slate-300" aria-label="Not applicable" />;
}

const btn =
  'inline-flex min-h-9 items-center justify-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';
const primaryBtn = `${btn} border-blue-600 bg-blue-600 text-white hover:bg-blue-700`;
const secondaryBtn = `${btn} border-slate-300 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900`;

type Props = {
  row: FoRow;
  items: FoItem[];
  onChanged: () => void;
  /** Check-in from the appointment detail (the board's own handler with the consent soft stop) */
  onCheckIn?: () => void;
  /** Item to highlight (deep link focus) */
  focus?: string | null;
  canMark?: boolean;
};

/** Front-office checks for one appointment: status, reason from data, one action, mark done / N/A with a reason. */
export function FrontOfficeItemList({ row, items, onChanged, onCheckIn, focus, canMark = true }: Props) {
  const [editing, setEditing] = useState<{ id: string; status: FoMarkStatus } | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const save = async (item: FoItem, status: FoMarkStatus, text: string | null) => {
    setBusy(item.id);
    try {
      const r = await markFrontOfficeItem(row.appointmentId, item.id, status, text);
      toast.success(r.data.confirmed ? 'Marked confirmed' : status === 'done' ? 'Marked done' : status === 'deferred' ? 'Deferred' : 'Marked not applicable');
      setEditing(null);
      setReason('');
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setBusy(null);
    }
  };

  const undo = async (item: FoItem) => {
    setBusy(item.id);
    try {
      await unmarkFrontOfficeItem(row.appointmentId, item.id);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not undo');
    } finally {
      setBusy(null);
    }
  };

  const runEligibility = async (item: FoItem) => {
    setBusy(item.id);
    try {
      const r = await runEligibilityFor(row);
      const s = r.check.status;
      toast.success(s === 'PENDING' ? `Sent to ${r.channel === 'waystar' ? 'Waystar' : 'the clearinghouse'}: awaiting the payer response` : `Eligibility: ${s.toLowerCase()}`);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Eligibility check failed');
    } finally {
      setBusy(null);
    }
  };

  const action = (item: FoItem) => {
    const a = item.action;
    if (!a || item.status === 'not_applicable') return null;
    if (a.kind === 'run_eligibility') {
      return (
        <button type="button" disabled={busy === item.id} onClick={() => void runEligibility(item)} className={primaryBtn}>
          {busy === item.id ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <ShieldCheck size={13} aria-hidden />} Run eligibility
        </button>
      );
    }
    if (a.kind === 'check_in') {
      if (onCheckIn) {
        return (
          <button type="button" onClick={onCheckIn} className={primaryBtn}>
            Check in
          </button>
        );
      }
      return (
        <Link href={`/dashboard/appointments?view=calendar&cal=day&d=${row.date}&appt=${encodeURIComponent(row.appointmentId)}&focus=check_in`} className={primaryBtn}>
          Check in
        </Link>
      );
    }
    if (a.kind === 'call') {
      return a.phone ? (
        <a href={`tel:${a.phone.replace(/[^\d+]/g, '')}`} className={secondaryBtn}>
          <Phone size={13} aria-hidden /> {a.phone}
        </a>
      ) : null;
    }
    return (
      <Link href={a.href} className={secondaryBtn}>
        {a.label}
      </Link>
    );
  };

  return (
    <ul className="divide-y divide-slate-100">
      {items.map((item) => {
        const isEditing = editing?.id === item.id;
        const highlighted = focus && focus === item.id;
        const marked = Boolean(item.mark);
        const canEdit = canMark && item.markable && !row.locked;
        return (
          <li key={item.id} className={`py-2.5 ${highlighted ? 'rounded-lg bg-blue-50 px-2 ring-1 ring-blue-200' : ''}`}>
            <div className="flex flex-wrap items-start gap-2 lg:flex-nowrap">
              <span className="mt-0.5 shrink-0">
                <StatusIcon item={item} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-900">
                  {item.label}
                  {item.stop && item.status === 'needs_action' ? (
                    <StatusBadge tone="danger" size="sm" className="ml-2 align-middle">Resolve before check-in</StatusBadge>
                  ) : null}
                  {item.level === 'optional' ? <span className="ml-2 text-xs font-normal text-slate-500">optional</span> : null}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">{item.reason}</p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                {action(item)}
                {canEdit && marked ? (
                  <button type="button" disabled={busy === item.id} onClick={() => void undo(item)} className={secondaryBtn} title="Remove the mark">
                    <Undo2 size={13} aria-hidden /> Undo
                  </button>
                ) : null}
                {canEdit && !marked && item.status !== 'done' && item.status !== 'info' ? (
                  <>
                    <button
                      type="button"
                      disabled={busy === item.id}
                      onClick={() => {
                        if (item.noteRequired) {
                          setEditing({ id: item.id, status: 'done' });
                          setReason('');
                        } else void save(item, 'done', null);
                      }}
                      className={`${btn} border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100`}
                    >
                      Done
                    </button>
                    <button
                      type="button"
                      disabled={busy === item.id}
                      onClick={() => {
                        setEditing({ id: item.id, status: 'not_applicable' });
                        setReason('');
                      }}
                      className={secondaryBtn}
                    >
                      N/A
                    </button>
                  </>
                ) : null}
              </div>
            </div>
            {isEditing ? (
              <form
                className="mt-2 flex flex-col gap-2 pl-6 sm:flex-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  void save(item, editing.status, reason.trim() || null);
                }}
              >
                <label className="sr-only" htmlFor={`fo-reason-${row.appointmentId}-${item.id}`}>
                  {editing.status === 'done' ? 'What was done' : 'Reason'}
                </label>
                <input
                  id={`fo-reason-${row.appointmentId}-${item.id}`}
                  autoFocus
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={500}
                  placeholder={editing.status === 'done' ? (item.id === 'outreach' ? 'e.g. Called, left voicemail; texted reschedule link' : 'What was done (e.g. verified by phone with the payer, ref #)') : 'Reason it does not apply'}
                  className="min-h-9 min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                />
                <div className="flex gap-1.5">
                  <button type="submit" disabled={reason.trim().length < 3 || busy === item.id} className={primaryBtn}>
                    Save
                  </button>
                  {editing.status === 'not_applicable' ? (
                    <button type="button" disabled={reason.trim().length < 3 || busy === item.id} onClick={() => void save(item, 'deferred', reason.trim())} className={secondaryBtn}>
                      Defer
                    </button>
                  ) : null}
                  <button type="button" onClick={() => setEditing(null)} className={secondaryBtn}>
                    Cancel
                  </button>
                </div>
              </form>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
