'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { apiJson } from '@/lib/api-client';
import {
  VISIT_TYPE_CATALOG,
  VISIT_TYPE_REASON_MAX,
  type VisitTypeLock,
  type VisitTypeOption,
  type VisitTypeValue,
} from '@/lib/appointments/visitType';

type Props = {
  appointmentId: string;
  /** Called after the server accepted the change (refresh the list / selected row). */
  onChanged?: (visitType: VisitTypeOption) => void;
};

type Loaded = {
  visitType: VisitTypeOption;
  catalog: readonly VisitTypeOption[];
  lock: VisitTypeLock;
};

export function VisitTypeChange({ appointmentId, onChanged }: Props) {
  const [state, setState] = useState<Loaded | null>(null);
  const [open, setOpen] = useState(false);
  const [next, setNext] = useState<VisitTypeValue>('telehealth');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await apiJson<Loaded>(`/api/appointments/${appointmentId}/visit-type`);
      setState(res);
      setNext(res.visitType.value === 'telehealth' ? 'in_person' : 'telehealth');
    } catch {
      setState(null);
    }
  }, [appointmentId]);

  useEffect(() => {
    setOpen(false);
    setReason('');
    setError('');
    void load();
  }, [load]);

  if (!state) return null;

  const catalog = state.catalog.length ? state.catalog : VISIT_TYPE_CATALOG;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      const res = await apiJson<{ visitType: VisitTypeOption }>(
        `/api/appointments/${appointmentId}/visit-type`,
        {
          method: 'PATCH',
          body: JSON.stringify({ visitType: next, reason: reason.trim() || undefined }),
        }
      );
      setState((s) => (s ? { ...s, visitType: res.visitType } : s));
      setOpen(false);
      setReason('');
      onChanged?.(res.visitType);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the visit type');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-2 text-xs text-slate-600" data-testid="visit-type-change">
      <div className="flex flex-wrap items-center gap-2">
        <span>
          Visit type:{' '}
          <span className="font-semibold text-slate-800">{state.visitType.label}</span>
        </span>
        {!state.lock.locked && !open ? (
          <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
            Change
          </Button>
        ) : null}
      </div>

      {state.lock.locked ? (
        <p className="mt-1 text-xs font-medium text-slate-500" role="note">
          {state.lock.message}
        </p>
      ) : null}

      {open && !state.lock.locked ? (
        <form
          onSubmit={submit}
          className="mt-2 space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3"
        >
          <label className="block text-xs font-semibold text-slate-700">
            New visit type
            <select
              value={next}
              onChange={(e) => setNext(e.target.value as VisitTypeValue)}
              className="mt-1 block h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-normal text-slate-900 outline-none focus:border-[#5C2D91] focus:ring-2 focus:ring-[#5C2D91]/15"
            >
              {catalog
                .filter((o) => o.value !== state.visitType.value)
                .map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
            </select>
          </label>

          <label className="block text-xs font-semibold text-slate-700">
            Reason (optional)
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value.slice(0, VISIT_TYPE_REASON_MAX))}
              maxLength={VISIT_TYPE_REASON_MAX}
              rows={2}
              className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:border-[#5C2D91] focus:ring-2 focus:ring-[#5C2D91]/15"
            />
            <span className="mt-0.5 block text-right text-[11px] font-normal text-slate-400">
              {reason.length}/{VISIT_TYPE_REASON_MAX}
            </span>
          </label>

          {error ? (
            <p role="alert" className="text-xs font-medium text-rose-700">
              {error}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" loading={saving}>
              Change visit type
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setOpen(false);
                setError('');
              }}
              disabled={saving}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
