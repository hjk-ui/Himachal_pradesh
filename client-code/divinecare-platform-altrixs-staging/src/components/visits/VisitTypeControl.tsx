'use client';

/**
 * "Visit type" control for an open visit (note editor header, telehealth in-call chart, Visit Guide
 * link). Shows the appointment's current type and setting; Change lets the clinician pick another
 * type offered for their role and switch in person / telehealth. One API:
 * PATCH /api/appointments/[id]/visit-type (audited). A signed note or a billed visit shows why and
 * offers nothing (rules: src/lib/appointments/visitTypeChange.ts).
 */
import { useCallback, useEffect, useId, useState } from 'react';
import { CalendarClock, Monitor, Building2 } from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import { VISIT_TYPE_REASON_MAX } from '@/lib/appointments/visitTypeChange';

type Option = { type: string; durationMin: number | null; current: boolean; noteType: string | null };
type State = {
  type: string;
  isVirtual: boolean;
  status: string;
  options: Option[];
  block: { code: string; message: string } | null;
};

export type VisitTypeChanged = {
  type: string;
  isVirtual: boolean;
  endsAt: string;
  changed: string[];
  lengthMessage: string | null;
  place: { telehealth: boolean; placeOfService: string | null; modifier: string | null; audioOnly: boolean };
  /** Note template matching the new type (null = keep the note as it is) */
  noteType: string | null;
};

export function VisitTypeControl({
  appointmentId,
  tone = 'light',
  locked,
  lockedMessage,
  openSignal,
  onChanged,
  className = '',
}: {
  appointmentId: string;
  tone?: 'light' | 'dark';
  /** The open note is signed: show the type, no Change */
  locked?: boolean;
  lockedMessage?: string;
  /** Bump to open the change form (e.g. from the Visit Guide link) */
  openSignal?: number;
  onChanged?: (r: VisitTypeChanged) => void;
  className?: string;
}) {
  const [state, setState] = useState<State | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [type, setType] = useState('');
  const [virtual, setVirtual] = useState(false);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const baseId = useId();
  const dark = tone === 'dark';

  const load = useCallback(async () => {
    try {
      const s = await apiJson<{ success: true } & State>(`/api/appointments/${encodeURIComponent(appointmentId)}/visit-type`);
      setState({ type: s.type, isVirtual: s.isVirtual, status: s.status, options: s.options, block: s.block });
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Visit type unavailable');
    }
  }, [appointmentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const startEdit = useCallback(() => {
    if (!state || state.block || locked) return;
    setType(state.type);
    setVirtual(state.isVirtual);
    setReason('');
    setError(null);
    setDone(null);
    setOpen(true);
  }, [state, locked]);

  useEffect(() => {
    if (openSignal) startEdit();
    // Only a new signal opens the form
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSignal]);

  const apply = async () => {
    if (!state || saving) return;
    setSaving(true);
    setError(null);
    try {
      const r = await apiJson<{ success: true } & VisitTypeChanged>(`/api/appointments/${encodeURIComponent(appointmentId)}/visit-type`, {
        method: 'PATCH',
        body: JSON.stringify({ type, isVirtual: virtual, reason: reason.trim() || null }),
      });
      setState((s) => (s ? { ...s, type: r.type, isVirtual: r.isVirtual, options: s.options.map((o) => ({ ...o, current: o.type === r.type })) } : s));
      setOpen(false);
      const pos = r.place.telehealth
        ? r.place.placeOfService
          ? `POS ${r.place.placeOfService}${r.place.modifier ? `, modifier ${r.place.modifier}` : ', audio-only modifier'}`
          : 'telehealth POS needs the patient location'
        : `POS ${r.place.placeOfService ?? '11'}`;
      setDone([`Visit type changed to ${r.type} (${r.isVirtual ? 'telehealth' : 'in person'}, ${pos}).`, r.lengthMessage].filter(Boolean).join(' '));
      onChanged?.(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change the visit type');
      void load();
    } finally {
      setSaving(false);
    }
  };

  const box = dark ? 'border-white/10 bg-slate-800/60 text-slate-200' : 'border-slate-200 bg-slate-50 text-slate-700';
  const muted = dark ? 'text-slate-400' : 'text-slate-500';
  const input = dark
    ? 'rounded-lg border border-white/15 bg-slate-900 p-2 text-xs text-white'
    : 'rounded-lg border border-slate-200 bg-white p-2 text-sm text-slate-800';
  const link = dark ? 'text-emerald-300 hover:text-emerald-200' : 'text-[#5C2D91] hover:underline';

  if (loadError) return <p className={`text-xs ${muted} ${className}`}>Visit type: {loadError}</p>;
  if (!state) return <p className={`text-xs ${muted} ${className}`}>Visit type: loading…</p>;

  const blockedMessage = state.block?.message ?? (locked ? lockedMessage || 'The note is signed; the visit type is final.' : null);
  const chosen = state.options.find((o) => o.type === type);

  return (
    <div id="visit-type-control" className={`rounded-xl border p-2.5 text-xs ${box} ${className}`}>
      <div className="flex flex-wrap items-center gap-2">
        <CalendarClock size={14} aria-hidden className={muted} />
        <span className="font-semibold">Visit type:</span>
        <span className="font-bold">{state.type}</span>
        <span className={`inline-flex items-center gap-1 ${muted}`}>
          {state.isVirtual ? <Monitor size={12} aria-hidden /> : <Building2 size={12} aria-hidden />}
          {state.isVirtual ? 'Telehealth' : 'In person'}
        </span>
        {!blockedMessage && !open ? (
          <button type="button" onClick={startEdit} className={`ml-auto text-xs font-semibold ${link}`}>
            Change
          </button>
        ) : null}
      </div>
      {blockedMessage ? <p className={`mt-1 ${muted}`}>{blockedMessage}</p> : null}
      {open ? (
        <div className="mt-2 space-y-2">
          <label htmlFor={`${baseId}-type`} className="block font-semibold">
            New visit type
          </label>
          <select id={`${baseId}-type`} value={type} onChange={(e) => setType(e.target.value)} className={`w-full ${input}`}>
            {state.options.map((o) => (
              <option key={o.type} value={o.type}>
                {o.type}
                {o.durationMin ? ` (${o.durationMin} min)` : ''}
                {o.current ? ' — current' : ''}
              </option>
            ))}
          </select>
          <fieldset className="flex flex-wrap gap-3">
            <legend className="sr-only">Setting</legend>
            <label className="inline-flex items-center gap-1.5">
              <input type="radio" name={`${baseId}-mode`} checked={!virtual} onChange={() => setVirtual(false)} />
              In person
            </label>
            <label className="inline-flex items-center gap-1.5">
              <input type="radio" name={`${baseId}-mode`} checked={virtual} onChange={() => setVirtual(true)} />
              Telehealth
            </label>
          </fieldset>
          <label htmlFor={`${baseId}-reason`} className="block font-semibold">
            Reason <span className={`font-normal ${muted}`}>(optional, kept in the audit log)</span>
          </label>
          <input
            id={`${baseId}-reason`}
            value={reason}
            maxLength={VISIT_TYPE_REASON_MAX}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Med check became a re-evaluation"
            className={`w-full ${input}`}
          />
          <p className={muted}>
            The schedule moves to {chosen?.durationMin ? `${chosen.durationMin} minutes` : "the type's length"} only if it doesn&apos;t run into your next
            appointment. Billing uses the codes on the signed note.
          </p>
          {error ? <p className={dark ? 'text-rose-300' : 'text-rose-600'}>{error}</p> : null}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void apply()}
              disabled={saving || (type === state.type && virtual === state.isVirtual)}
              className="rounded-lg bg-[#5C2D91] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Change visit type'}
            </button>
            <button type="button" onClick={() => setOpen(false)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${link}`}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {done ? (
        <p role="status" className={`mt-1 ${dark ? 'text-emerald-300' : 'text-emerald-700'}`}>
          {done}
        </p>
      ) : null}
    </div>
  );
}
